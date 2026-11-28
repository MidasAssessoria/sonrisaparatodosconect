/**
 * Anamnesis versionada (Sprint 4) contra el Postgres real y el almacén local: catálogo de
 * preguntas, guardado con firma (PNG verificado, archivo `firma_paciente` en la misma transacción,
 * sin huérfanos), errores por campo, versión base vieja y guardados simultáneos (409), lectura de
 * una versión (auditoría `ver`, URL firmada que vence), alerta médica en la ficha y en la lista, y
 * que nada clínico llegue al registro.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { crearRolDePrueba, crearUsuarioDePrueba } from '@conecta/db/pruebas';
import {
  anamnesisSchema,
  catalogoPreguntasSchema,
  errorApiSchema,
  paginaPacientesSchema,
  pacienteSchema,
  versionesAnamnesisSchema,
  type Pregunta,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../src/archivos/almacen.js';
import { verificarToken } from '../src/archivos/firma.js';
import type { DatoRegistro, Registro } from '../src/comun/registro.js';
import {
  ALERGIA_PENICILINA,
  cuerpoAnamnesis,
  firmaDataUrl,
  firmasDe,
  guardarApi,
  tokenDeUrl,
  vencimientoDe,
  versionesDe,
} from './anamnesis-ayudas.js';
import {
  archivosEnDisco,
  BUCKET_PRUEBA,
  configLocal,
  jpeg,
  png,
  SECRETO_PRUEBA,
  SVG_LIMPIO,
  trabajosDe,
} from './archivos-ayudas.js';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';
import { alerta, paciente, vinculo } from './pacientes-ayudas.js';

/** Todo lo que la API manda al registro en este archivo (para buscar datos clínicos). */
const lineas: { evento: string; datos: Record<string, DatoRegistro> }[] = [];
const registro: Registro = {
  info: (evento, datos = {}) => lineas.push({ evento, datos }),
  advertencia: (evento, datos = {}) => lineas.push({ evento, datos }),
  error: (evento, datos = {}) => lineas.push({ evento, datos }),
};

let prueba: Prueba;
let directorio: string;
let borrarDirectorio: () => Promise<void>;
let A: Clinica;
let odontologo: Persona;
let recepcion: Persona;
let asistente: Persona;
let tOdo: string;

const ADULTA = { fechaNac: '1990-05-01', sexo: 'F' as const };

beforeAll(async () => {
  const local = await configLocal();
  directorio = local.archivos.directorio;
  borrarDirectorio = local.borrar;
  prueba = await crearPrueba({ config: { archivos: local.archivos }, registro });
  A = await crearClinica(prueba, { sedes: 1 });
  [odontologo, recepcion, asistente] = await Promise.all([
    crearPersona(prueba, A.clinicaId, { rol: 'odontologo' }),
    crearPersona(prueba, A.clinicaId, { rol: 'recepcion' }),
    crearPersona(prueba, A.clinicaId, { rol: 'asistente' }),
  ]);
  tOdo = await odontologo.token();
});

afterAll(async () => {
  await prueba.cerrar();
  await borrarDirectorio();
});

const almacen = (): AlmacenArchivos =>
  prueba.app.get<AlmacenArchivos>(ALMACEN_ARCHIVOS, { strict: false });

const guardar = (pacienteId: string, extra: Record<string, unknown> = {}, token = tOdo) =>
  prueba.pedir('post', `/pacientes/${pacienteId}/anamnesis`, {
    token,
    cuerpo: cuerpoAnamnesis(extra),
  });

/** 400 `datos_invalidos` con un detalle en `campo`. */
async function esperarCampo(pedido: ReturnType<typeof guardar>, campo: string) {
  const respuesta = await esperarError(pedido, 400, 'datos_invalidos');
  const cuerpo = segun(errorApiSchema, respuesta.body);
  expect(cuerpo.detalles?.map((d) => d.campo)).toContain(campo);
  return cuerpo;
}

/** Ni archivo `firma_paciente`, ni versión, ni objeto en el almacén para este paciente. */
async function sinRastro(pacienteId: string, archivosAntes: string[]) {
  expect(await firmasDe(prueba, A.clinicaId, pacienteId)).toEqual([]);
  expect(await versionesDe(prueba, A.clinicaId, pacienteId)).toEqual([]);
  expect(await archivosEnDisco(directorio, A.clinicaId)).toEqual(archivosAntes);
}

async function vistasDe(entidad: string, entidadId: string): Promise<number> {
  const { rows } = await comoSistema<{ n: string }>(
    prueba.admin,
    A.clinicaId,
    `select count(*) as n from app.audit_log
     where clinica_id = $1 and entidad = $2 and entidad_id = $3 and accion = 'ver'`,
    [A.clinicaId, entidad, entidadId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function idDeVersion(pacienteId: string, version: number): Promise<string> {
  const { rows } = await comoSistema<{ id: string }>(
    prueba.admin,
    A.clinicaId,
    'select id from app.anamnesis where clinica_id = $1 and paciente_id = $2 and version = $3',
    [A.clinicaId, pacienteId, version],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('No está la versión.');
  return id;
}

// ---------------------------------------------------------------------------------------------

describe('catálogo de preguntas', () => {
  let C: Clinica;
  let tDueno: string;
  let tAdmin: string;

  beforeAll(async () => {
    C = await crearClinica(prueba, { sedes: 1 });
    tDueno = await C.dueno.token();
    tAdmin = await (await crearPersona(prueba, C.clinicaId, { rol: 'administracion' })).token();
  });

  const catalogo = async (token: string) =>
    segun(
      catalogoPreguntasSchema,
      (await prueba.pedir('get', '/anamnesis/preguntas/catalogo', { token }).expect(200)).body,
    ).preguntas;

  it('nace con el cuestionario de la maqueta: 19 preguntas activas en 5 secciones, en orden', async () => {
    const respuesta = await prueba.pedir('get', '/anamnesis/preguntas', { token: tDueno });
    expect(respuesta.status).toBe(200);
    const { preguntas } = segun(catalogoPreguntasSchema, respuesta.body);
    expect(preguntas).toHaveLength(19);
    expect(new Set(preguntas.map((p) => p.seccion))).toEqual(new Set([1, 2, 3, 4, 5]));
    const claves = preguntas.map((p) => p.seccion * 1000 + p.orden);
    expect(claves).toEqual([...claves].sort((x, y) => x - y));
    expect(preguntas.find((p) => p.codigo === 'embarazo')).toMatchObject({
      tipo: 'si_no',
      soloSexo: 'F',
      alertaSiSi: { tipo: 'condicion', gravedad: 'alta' },
    });
    const alergias = preguntas.find((p) => p.codigo === 'alergias');
    expect(alergias?.opciones.find((o) => o.valor === 'penicilina')?.alerta).toEqual({
      tipo: 'alergia',
      texto: 'Alergia a la penicilina',
      gravedad: 'alta',
      grupoAlergia: 'penicilina',
    });
  });

  it('Administración edita el cuestionario sin ver fichas: la que falta queda inactiva y vuelve', async () => {
    const completo = await catalogo(tAdmin);
    const sinCirugias = completo.filter((p) => p.codigo !== 'cirugias');
    const put = await prueba.pedir('put', '/anamnesis/preguntas', {
      token: tAdmin,
      cuerpo: { preguntas: sinCirugias },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const despues = segun(catalogoPreguntasSchema, put.body).preguntas;
    expect(despues).toHaveLength(19);
    expect(despues.find((p) => p.codigo === 'cirugias')?.activa).toBe(false);
    // Las activas primero.
    expect(despues[despues.length - 1]?.codigo).toBe('cirugias');

    const activas = segun(
      catalogoPreguntasSchema,
      (await prueba.pedir('get', '/anamnesis/preguntas', { token: tDueno }).expect(200)).body,
    ).preguntas;
    expect(activas.map((p) => p.codigo)).not.toContain('cirugias');

    // Administración no ve el formulario ni las anamnesis (es de la ficha clínica).
    await esperarError(
      prueba.pedir('get', '/anamnesis/preguntas', { token: tAdmin }),
      403,
      'sin_permiso',
    );

    await prueba
      .pedir('put', '/anamnesis/preguntas', { token: tAdmin, cuerpo: { preguntas: completo } })
      .expect(200);
    expect((await catalogo(tAdmin)).find((p) => p.codigo === 'cirugias')?.activa).toBe(true);
  });

  it('cambia una etiqueta y agrega una pregunta numérica con rango', async () => {
    const completo = await catalogo(tDueno);
    const nueva: Pregunta = {
      codigo: 'horas_sueno',
      seccion: 3,
      orden: 50,
      texto: '¿Cuántas horas duerme por noche?',
      tipo: 'numero',
      opciones: [],
      alertaSiSi: null,
      conDetalle: false,
      unidad: 'h',
      minimo: 0,
      maximo: 24,
      soloSexo: null,
      obligatoria: false,
      activa: true,
    };
    const respuesta = await prueba
      .pedir('put', '/anamnesis/preguntas', {
        token: tDueno,
        cuerpo: {
          preguntas: [
            ...completo.map((p) =>
              p.codigo === 'protesis' ? { ...p, texto: '¿Usa prótesis o retenedores?' } : p,
            ),
            nueva,
          ],
        },
      })
      .expect(200);
    const preguntas = segun(catalogoPreguntasSchema, respuesta.body).preguntas;
    expect(preguntas.find((p) => p.codigo === 'horas_sueno')).toEqual(nueva);
    expect(preguntas.find((p) => p.codigo === 'protesis')?.texto).toBe(
      '¿Usa prótesis o retenedores?',
    );
  });

  it('400 por pregunta: código repetido y opción múltiple sin opciones', async () => {
    const completo = await catalogo(tDueno);
    const motivo = completo.find((p) => p.codigo === 'motivo');
    if (!motivo) throw new Error('Falta la pregunta motivo.');
    const repetida = await esperarError(
      prueba.pedir('put', '/anamnesis/preguntas', {
        token: tDueno,
        cuerpo: { preguntas: [...completo, { ...motivo, orden: 99 }] },
      }),
      400,
      'datos_invalidos',
    );
    expect(segun(errorApiSchema, repetida.body).detalles?.[0]?.campo).toBe('preguntas.motivo');

    const sinOpciones = await esperarError(
      prueba.pedir('put', '/anamnesis/preguntas', {
        token: tDueno,
        cuerpo: {
          preguntas: [
            ...completo,
            { ...motivo, codigo: 'vacia_multiple', tipo: 'multiple', opciones: [] },
          ],
        },
      }),
      400,
      'datos_invalidos',
    );
    expect(segun(errorApiSchema, sinOpciones.body).detalles?.[0]?.campo).toBe(
      'preguntas.vacia_multiple',
    );
    // Nada cambió.
    expect(await catalogo(tDueno)).toEqual(completo);
  });

  it('400 con el contrato: catálogo vacío', async () => {
    await esperarError(
      prueba.pedir('put', '/anamnesis/preguntas', { token: tDueno, cuerpo: { preguntas: [] } }),
      400,
      'datos_invalidos',
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe('guardar una versión', () => {
  it('camino feliz: 201 con la versión completa, la alerta médica, el archivo y el objeto', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const contenido = png(64, 32);
    const respuesta = await guardar(pid, {
      respuestas: [{ codigo: 'motivo', texto: 'Control anual' }, ALERGIA_PENICILINA],
      signosVitales: { presionSistolica: 120, presionDiastolica: 80, pulso: 70, pesoKg: 61.5 },
      firmaPng: firmaDataUrl(contenido),
    });
    expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
    const a = segun(anamnesisSchema, respuesta.body);
    expect(Object.keys(respuesta.body as object).sort()).toEqual(
      Object.keys(anamnesisSchema.shape).sort(),
    );
    expect(a).toMatchObject({
      pacienteId: pid,
      version: 1,
      esVigente: true,
      alertas: 1,
      firmante: { nombre: 'Ana Benítez', ci: null, esTutor: false },
      signosVitales: { presionSistolica: 120, presionDiastolica: 80, pulso: 70, pesoKg: 61.5 },
      alertasMedicas: [
        {
          tipo: 'alergia',
          texto: 'Alergia a la penicilina (urticaria con amoxicilina)',
          gravedad: 'alta',
          grupoAlergia: 'penicilina',
          codigo: 'alergias',
        },
      ],
    });
    expect(a.registradaPor).toEqual(expect.any(String));
    expect(a.respuestas.find((r) => r.codigo === 'alergias')).toMatchObject({
      tipo: 'multiple',
      seccion: 4,
      opciones: ['penicilina'],
      etiquetas: ['Penicilina'],
      detalle: 'urticaria con amoxicilina',
    });
    expect(a.respuestas.find((r) => r.codigo === 'motivo')).toMatchObject({
      tipo: 'texto',
      texto: 'Control anual',
    });
    expect(a.firmaUrl).toMatch(/^https?:\/\/.+\/api\/v1\/archivos\/descarga\?t=/);
    expect(a).not.toHaveProperty('firmaArchivoId');

    // El archivo: firma_paciente de ESTE paciente, con su SHA-256 y su tamaño, y el objeto igual.
    const [firma] = await firmasDe(prueba, A.clinicaId, pid);
    expect(firma).toMatchObject({
      sha256: createHash('sha256').update(contenido).digest('hex'),
      bytes: String(contenido.length),
    });
    if (!firma) throw new Error('Falta la firma.');
    const enDisco = await readFile(path.join(directorio, BUCKET_PRUEBA, ...firma.ruta.split('/')));
    expect(enDisco.equals(contenido)).toBe(true);
    expect(await trabajosDe(prueba.admin, firma.id)).toHaveLength(1);
    // La respuesta trae la versión completa: queda `ver` de la anamnesis y del archivo.
    expect(await vistasDe('anamnesis', a.id)).toBe(1);
    expect(await vistasDe('archivo', firma.id)).toBe(1);
  });

  it('«Actualizar» guarda la versión siguiente y la anterior queda intacta y consultable', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const v1 = await guardarApi(prueba, tOdo, pid, { respuestas: [ALERGIA_PENICILINA] });
    const v2 = await guardarApi(prueba, tOdo, pid, {
      versionBase: 1,
      respuestas: [{ codigo: 'medicacion', opciones: ['anticoagulantes'] }],
    });
    expect(v2.version).toBe(2);
    expect(v2.alertasMedicas.map((x) => x.texto)).toEqual(['Anticoagulantes']);

    const lista = segun(
      versionesAnamnesisSchema,
      (await prueba.pedir('get', `/pacientes/${pid}/anamnesis`, { token: tOdo }).expect(200)).body,
    );
    expect(lista.versiones.map((v) => v.version)).toEqual([2, 1]);
    expect(lista.versiones[1]).toEqual({
      version: 1,
      fecha: v1.fecha,
      registradaPor: v1.registradaPor,
      firmante: { nombre: 'Ana Benítez', esTutor: false },
      alertas: 1,
    });
    expect(lista.requiereTutor).toBe(false);

    const vieja = segun(
      anamnesisSchema,
      (await prueba.pedir('get', `/pacientes/${pid}/anamnesis/1`, { token: tOdo }).expect(200))
        .body,
    );
    expect({ ...vieja, firmaUrl: '', esVigente: true }).toEqual({ ...v1, firmaUrl: '' });
    expect(vieja.esVigente).toBe(false);
    const vigente = segun(
      anamnesisSchema,
      (
        await prueba
          .pedir('get', `/pacientes/${pid}/anamnesis/vigente`, { token: tOdo })
          .expect(200)
      ).body,
    );
    expect(vigente.version).toBe(2);
  });

  it('límite del cuerpo: 1 MB en esta ruta; el resto de la API sigue en 64 KB', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const relleno = 'x'.repeat(1100 * 1024);
    await esperarError(
      guardar(pid, { respuestas: [{ codigo: 'motivo', texto: relleno }] }),
      413,
      'datos_invalidos',
    );
    await esperarError(
      prueba.pedir('post', '/pacientes', {
        token: tOdo,
        cuerpo: { nombres: 'Grande', direccion: 'x'.repeat(100 * 1024) },
      }),
      413,
      'datos_invalidos',
    );
    await esperarError(
      prueba.pedir('patch', `/pacientes/${pid}/anamnesis`, {
        token: tOdo,
        cuerpo: { relleno: 'x'.repeat(100 * 1024) },
      }),
      413,
      'datos_invalidos',
    );
  });

  it('sin firma: 400 en firmaPng y no queda nada', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const sinCampo = cuerpoAnamnesis();
    delete sinCampo['firmaPng'];
    const cuerpo = await esperarCampo(
      prueba.pedir('post', `/pacientes/${pid}/anamnesis`, { token: tOdo, cuerpo: sinCampo }),
      'firmaPng',
    );
    expect(cuerpo.mensaje).toContain('Falta la firma');
    await esperarCampo(guardar(pid, { firmaPng: '' }), 'firmaPng');
    await esperarCampo(guardar(pid, { firmaPng: 'data:image/png;base64,' }), 'firmaPng');
    await sinRastro(pid, antes);
  });

  it('PNG inválido o disfrazado: 400 en firmaPng (SVG, JPEG, basura, CRC roto, datos de más)', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const bueno = png(20, 10);
    const crcRoto = Buffer.from(bueno);
    crcRoto[crcRoto.length - 13] = (crcRoto[crcRoto.length - 13] ?? 0) ^ 0xff; // CRC de IDAT
    const conCola = Buffer.concat([bueno, Buffer.from('<script>alert(1)</script>')]);
    const sinIdat = Buffer.concat([bueno.subarray(0, 33), bueno.subarray(bueno.length - 12)]);
    for (const contenido of [
      SVG_LIMPIO,
      jpeg(20, 10),
      Buffer.from('<html><body>hola</body></html>'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      crcRoto,
      conCola,
      sinIdat,
    ]) {
      const cuerpo = await esperarCampo(
        guardar(pid, { firmaPng: firmaDataUrl(contenido) }),
        'firmaPng',
      );
      expect(cuerpo.mensaje).toContain('PNG');
    }
    // Otro tipo declarado en el prefijo: lo rechaza el contrato.
    await esperarCampo(
      guardar(pid, { firmaPng: `data:image/svg+xml;base64,${SVG_LIMPIO.toString('base64')}` }),
      'firmaPng',
    );
    await sinRastro(pid, antes);
  });

  it('PNG grande: más de 300 KB es 400 en firmaPng (y más de lo que admite el contrato, también)', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const grande = png(10, 10, 305 * 1024);
    expect(firmaDataUrl(grande).length).toBeLessThan(420_000);
    const cuerpo = await esperarCampo(guardar(pid, { firmaPng: firmaDataUrl(grande) }), 'firmaPng');
    expect(cuerpo.mensaje).toContain('300 KB');
    await esperarCampo(
      guardar(pid, { firmaPng: firmaDataUrl(png(10, 10, 330 * 1024)) }),
      'firmaPng',
    );
    // Justo en el límite sí entra.
    const justo = png(10, 10);
    const limite = png(10, 10, 300 * 1024 - justo.length - 12);
    expect(limite.length).toBe(300 * 1024);
    expect((await guardar(pid, { firmaPng: firmaDataUrl(limite) })).status).toBe(201);
    expect(antes.length + 1).toBe((await archivosEnDisco(directorio, A.clinicaId)).length);
  });

  it('declaración de veracidad sin marcar: 400 en declaracionVeracidad', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const cuerpo = await esperarCampo(
      guardar(pid, { declaracionVeracidad: false }),
      'declaracionVeracidad',
    );
    expect(cuerpo.mensaje).toContain('Declaro que la información es verdadera');
    await sinRastro(pid, antes);
  });

  it('menor de 18: exige que firme un tutor con cédula', async () => {
    const hace10 = new Date();
    hace10.setUTCFullYear(hace10.getUTCFullYear() - 10);
    const pid = await paciente(prueba, A.clinicaId, {
      fechaNac: hace10.toISOString().slice(0, 10),
      sexo: 'M',
    });
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const lista = segun(
      versionesAnamnesisSchema,
      (await prueba.pedir('get', `/pacientes/${pid}/anamnesis`, { token: tOdo }).expect(200)).body,
    );
    expect(lista).toEqual({ versiones: [], requiereTutor: true });

    // Firma el paciente: lo rechaza la base, en firmante.esTutor.
    await esperarCampo(guardar(pid), 'firmante.esTutor');
    // Tutor sin cédula: lo rechaza el contrato, en firmante.ci.
    const sinCi = await esperarCampo(
      guardar(pid, { firmante: { nombre: 'Rosa Benítez', ci: null, esTutor: true } }),
      'firmante.ci',
    );
    expect(sinCi.mensaje).toContain('tutor');
    await esperarCampo(
      guardar(pid, { firmante: { nombre: 'Rosa Benítez', ci: '12', esTutor: true } }),
      'firmante.ci',
    );
    await sinRastro(pid, antes);

    const a = await guardarApi(prueba, tOdo, pid, {
      firmante: { nombre: 'Rosa Benítez', ci: '4.123.456', esTutor: true },
    });
    expect(a.firmante).toEqual({ nombre: 'Rosa Benítez', ci: '4123456', esTutor: true });
  });

  it('respuesta inválida: 400 con el campo de la pregunta', async () => {
    const varon = await paciente(prueba, A.clinicaId, { fechaNac: '1980-01-01', sexo: 'M' });
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const casos: [unknown, string][] = [
      [{ codigo: 'alergias', opciones: ['mariscos'] }, 'respuestas.alergias'],
      [{ codigo: 'embarazo', si: true }, 'respuestas.embarazo'],
      [{ codigo: 'protesis', opciones: ['si'] }, 'respuestas.protesis'],
      [{ codigo: 'no_existe', si: true }, 'respuestas.no_existe'],
      [{ codigo: 'motivo', texto: 'x', detalle: 'no admite detalle' }, 'respuestas.motivo'],
    ];
    for (const [respuesta, campo] of casos) {
      await esperarCampo(guardar(varon, { respuestas: [respuesta] }), campo);
    }
    // Repetida.
    await esperarCampo(
      guardar(varon, {
        respuestas: [
          { codigo: 'protesis', si: true },
          { codigo: 'protesis', si: false },
        ],
      }),
      'respuestas.protesis',
    );
    // Signo vital fuera de rango (contrato).
    await esperarCampo(guardar(varon, { signosVitales: { pulso: 400 } }), 'signosVitales.pulso');
    await sinRastro(varon, antes);
  });

  it('paciente inactivo: 400 sin rastro', async () => {
    const pid = await paciente(prueba, A.clinicaId, { ...ADULTA, activo: false });
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const respuesta = await esperarError(guardar(pid), 400, 'datos_invalidos');
    expect(segun(errorApiSchema, respuesta.body).mensaje).toContain('inactivo');
    await sinRastro(pid, antes);
  });

  it('versionBase vieja: 409 que dice qué hacer, sin archivo huérfano', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    await guardarApi(prueba, tOdo, pid);
    await guardarApi(prueba, tOdo, pid, { versionBase: 1 });
    const firmasAntes = await firmasDe(prueba, A.clinicaId, pid);
    const discoAntes = await archivosEnDisco(directorio, A.clinicaId);
    for (const base of [1, null]) {
      const respuesta = await esperarError(guardar(pid, { versionBase: base }), 409, 'conflicto');
      expect(segun(errorApiSchema, respuesta.body).mensaje).toBe(
        'Alguien guardó otra versión mientras completabas esta. Cargá la versión nueva y revisá tus respuestas.',
      );
    }
    expect(await firmasDe(prueba, A.clinicaId, pid)).toEqual(firmasAntes);
    expect(await archivosEnDisco(directorio, A.clinicaId)).toEqual(discoAntes);
    expect(await versionesDe(prueba, A.clinicaId, pid)).toEqual([1, 2]);
  });

  it('dos guardados simultáneos con la misma versión base: uno 201 y el otro 409', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const discoAntes = await archivosEnDisco(directorio, A.clinicaId);
    const otroOdo = await (await crearPersona(prueba, A.clinicaId, { rol: 'odontologo' })).token();
    const respuestas = await Promise.all([
      guardar(pid, {}, tOdo),
      guardar(pid, { firmaPng: firmaDataUrl(png(30, 30)) }, otroOdo),
    ]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    const perdida = respuestas.find((r) => r.status === 409);
    expect(segun(errorApiSchema, perdida?.body).codigo).toBe('conflicto');
    expect(await versionesDe(prueba, A.clinicaId, pid)).toEqual([1]);
    expect(await firmasDe(prueba, A.clinicaId, pid)).toHaveLength(1);
    expect((await archivosEnDisco(directorio, A.clinicaId)).length).toBe(discoAntes.length + 1);
  });

  it('transacción fallida: si el almacén falla no queda ni archivo, ni versión, ni objeto', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const espia = vi.spyOn(almacen(), 'guardar').mockRejectedValueOnce(new Error('almacén caído'));
    try {
      const respuesta = await esperarError(guardar(pid), 503, 'servicio_no_disponible');
      expect(segun(errorApiSchema, respuesta.body).mensaje).toContain('No se guardó nada');
    } finally {
      espia.mockRestore();
    }
    await sinRastro(pid, antes);
    // El número de versión no se gastó.
    expect((await guardarApi(prueba, tOdo, pid)).version).toBe(1);
  });

  it('transacción fallida después de escribir el objeto: se borra (compensación)', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const destino = almacen();
    const original = destino.guardar.bind(destino);
    let escrito: string | null = null;
    const espia = vi.spyOn(destino, 'guardar').mockImplementationOnce(async (u, c, t) => {
      await original(u, c, t);
      escrito = u.ruta;
      throw new Error('se cortó después de escribir');
    });
    try {
      await esperarError(guardar(pid), 503, 'servicio_no_disponible');
    } finally {
      espia.mockRestore();
    }
    expect(escrito).not.toBeNull();
    await sinRastro(pid, antes);
  });

  it('sin ficha_clinica:ver no guarda aunque tenga crear (403, sin rastro)', async () => {
    const { rolId } = await crearRolDePrueba(prueba.admin, {
      clinicaId: A.clinicaId,
      permisos: ['ficha_clinica:crear', 'pacientes:ver'],
    });
    const usuario = await crearUsuarioDePrueba(prueba.admin, { clinicaId: A.clinicaId, rolId });
    const token = await prueba.token({ sub: usuario.usuarioId, email: usuario.email });
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const respuesta = await esperarError(guardar(pid, {}, token), 403, 'sin_permiso');
    expect(segun(errorApiSchema, respuesta.body).mensaje).toContain('ficha clínica');
    await sinRastro(pid, antes);
  });

  it('asistente (solo ver) y recepción no guardan', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    await esperarError(guardar(pid, {}, await asistente.token()), 403, 'sin_permiso');
    await esperarError(guardar(pid, {}, await recepcion.token()), 403, 'sin_permiso');
  });
});

// ---------------------------------------------------------------------------------------------

describe('ver una versión', () => {
  it('cada GET queda en auditoría como ver (anamnesis y archivo de la firma)', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    await guardarApi(prueba, tOdo, pid);
    const id = await idDeVersion(pid, 1);
    const [firma] = await firmasDe(prueba, A.clinicaId, pid);
    if (!firma) throw new Error('Falta la firma.');
    const antesA = await vistasDe('anamnesis', id);
    const antesF = await vistasDe('archivo', firma.id);
    await prueba.pedir('get', `/pacientes/${pid}/anamnesis/1`, { token: tOdo }).expect(200);
    await prueba
      .pedir('get', `/pacientes/${pid}/anamnesis/vigente`, { token: await asistente.token() })
      .expect(200);
    expect(await vistasDe('anamnesis', id)).toBe(antesA + 2);
    expect(await vistasDe('archivo', firma.id)).toBe(antesF + 2);
    // La lista de versiones no abre ninguna.
    await prueba.pedir('get', `/pacientes/${pid}/anamnesis`, { token: tOdo }).expect(200);
    expect(await vistasDe('anamnesis', id)).toBe(antesA + 2);
  });

  it('la URL firmada de la firma descarga el PNG y vence a los 5 minutos', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const contenido = png(50, 25);
    await guardarApi(prueba, tOdo, pid, { firmaPng: firmaDataUrl(contenido) });
    const a = segun(
      anamnesisSchema,
      (await prueba.pedir('get', `/pacientes/${pid}/anamnesis/1`, { token: tOdo }).expect(200))
        .body,
    );
    const token = tokenDeUrl(a.firmaUrl);
    const vence = vencimientoDe(token);
    const ahora = Math.floor(Date.now() / 1000);
    expect(vence - ahora).toBeGreaterThan(250);
    expect(vence - ahora).toBeLessThanOrEqual(300);

    const descarga = await prueba
      .pedir('get', `/archivos/descarga?t=${token}`)
      .buffer(true)
      .parse((res, listo) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => listo(null, Buffer.concat(partes)));
      });
    expect(descarga.status).toBe(200);
    expect(descarga.headers['content-type']).toBe('image/png');
    expect((descarga.body as Buffer).equals(contenido)).toBe(true);

    expect(verificarToken(SECRETO_PRUEBA, token, (vence + 1) * 1000)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime((vence + 1) * 1000);
      await esperarError(prueba.pedir('get', `/archivos/descarga?t=${token}`), 403, 'sin_permiso');
    } finally {
      vi.useRealTimers();
    }
  });

  it('404: versión que no existe, versión mal escrita, y vigente sin ninguna', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    for (const v of ['vigente', '1', '0', 'abc', '1.5', '-1']) {
      await esperarError(
        prueba.pedir('get', `/pacientes/${pid}/anamnesis/${v}`, { token: tOdo }),
        404,
        'no_encontrado',
      );
    }
    await guardarApi(prueba, tOdo, pid);
    await esperarError(
      prueba.pedir('get', `/pacientes/${pid}/anamnesis/2`, { token: tOdo }),
      404,
      'no_encontrado',
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe('alerta médica en la ficha y en la lista', () => {
  it('recepción ve la alerta derivada (solo la alerta) y el filtro «Con alerta» la cuenta', async () => {
    const pid = await paciente(prueba, A.clinicaId, { ...ADULTA, nombres: 'Derivada Única' });
    const tRecepcion = await recepcion.token();
    const antes = segun(
      pacienteSchema,
      (await prueba.pedir('get', `/pacientes/${pid}`, { token: tRecepcion }).expect(200)).body,
    );
    expect(antes.alertasMedicas).toEqual([]);
    expect(antes.conAlerta).toBe(false);

    await guardarApi(prueba, tOdo, pid, {
      respuestas: [ALERGIA_PENICILINA, { codigo: 'embarazo', si: true }],
    });
    const respuesta = await prueba.pedir('get', `/pacientes/${pid}`, { token: tRecepcion });
    expect(respuesta.status).toBe(200);
    const ficha = segun(pacienteSchema, respuesta.body);
    expect(ficha.alertasMedicas.map((x) => x.texto)).toEqual([
      'Alergia a la penicilina (urticaria con amoxicilina)',
      'Embarazo / lactancia',
    ]);
    expect(ficha.conAlerta).toBe(true);
    expect(ficha.alertas).toEqual([]);
    expect(ficha.notaInterna).toBeNull();
    // Nada del cuestionario en la ficha.
    const texto = JSON.stringify(respuesta.body);
    expect(texto).not.toContain('respuestas');
    expect(texto).not.toContain('signosVitales');

    const lista = segun(
      paginaPacientesSchema,
      (
        await prueba
          .pedir('get', '/pacientes?filtro=con_alerta&q=Derivada', { token: tRecepcion })
          .expect(200)
      ).body,
    );
    expect(lista.items.map((p) => p.id)).toContain(pid);
    expect(lista.items.find((p) => p.id === pid)?.conAlerta).toBe(true);

    // Una versión nueva sin alertas las saca de la ficha y de la lista.
    await guardarApi(prueba, tOdo, pid, { versionBase: 1 });
    const sinAlertas = segun(
      pacienteSchema,
      (await prueba.pedir('get', `/pacientes/${pid}`, { token: tRecepcion }).expect(200)).body,
    );
    expect(sinAlertas.alertasMedicas).toEqual([]);
    const listaDespues = segun(
      paginaPacientesSchema,
      (
        await prueba
          .pedir('get', '/pacientes?filtro=con_alerta&q=Derivada', { token: tRecepcion })
          .expect(200)
      ).body,
    );
    expect(listaDespues.items.map((p) => p.id)).not.toContain(pid);
  });

  it('las relaciones traen la cédula del familiar (para completar al tutor)', async () => {
    const hijo = await paciente(prueba, A.clinicaId, { fechaNac: '2018-03-03' });
    const madre = await paciente(prueba, A.clinicaId, { sexo: 'F', ci: '3.456.789' });
    await vinculo(prueba, A.clinicaId, hijo, madre, 'madre');
    const ficha = segun(
      pacienteSchema,
      (await prueba.pedir('get', `/pacientes/${hijo}`, { token: tOdo }).expect(200)).body,
    );
    expect(ficha.relaciones[0]?.familiar).toMatchObject({ id: madre, ci: '3456789' });
    // Y la alerta manual sigue apareciendo junto a las derivadas.
    await alerta(prueba, A.clinicaId, hijo, { texto: 'Asma leve' });
    const conManual = segun(
      pacienteSchema,
      (await prueba.pedir('get', `/pacientes/${hijo}`, { token: tOdo }).expect(200)).body,
    );
    expect(conManual.alertas.map((x) => x.texto)).toEqual(['Asma leve']);
  });
});

// ---------------------------------------------------------------------------------------------

describe('registro sin datos clínicos', () => {
  it('ni respuestas, ni alertas, ni la firma, ni quien firma llegan al registro', async () => {
    const pid = await paciente(prueba, A.clinicaId, ADULTA);
    const firma = firmaDataUrl(png(33, 17));
    await guardarApi(prueba, tOdo, pid, {
      respuestas: [ALERGIA_PENICILINA, { codigo: 'motivo', texto: 'Dolor de muela MarcaClinica' }],
      firmante: { nombre: 'Firmante Rastreable', ci: '1234567', esTutor: false },
      firmaPng: firma,
    });
    // Errores también (409 y uno inesperado del almacén).
    await guardar(pid, { versionBase: null, respuestas: [ALERGIA_PENICILINA] });
    const espia = vi.spyOn(almacen(), 'guardar').mockRejectedValueOnce(new Error('urticaria'));
    try {
      await guardar(pid, {
        versionBase: 1,
        respuestas: [ALERGIA_PENICILINA],
        firmante: { nombre: 'Firmante Rastreable', ci: null, esTutor: false },
      });
    } finally {
      espia.mockRestore();
    }
    await prueba.pedir('get', `/pacientes/${pid}/anamnesis/vigente`, { token: tOdo }).expect(200);
    const todo = JSON.stringify(lineas);
    expect(lineas.length).toBeGreaterThan(0);
    for (const prohibido of [
      'urticaria',
      'penicilina',
      'Penicilina',
      'MarcaClinica',
      'Firmante Rastreable',
      '1234567',
      firma.slice(30, 80),
      'alertasMedicas',
    ]) {
      expect(todo).not.toContain(prohibido);
    }
  });
});
