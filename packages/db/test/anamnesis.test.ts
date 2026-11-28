/**
 * Anamnesis (0028–0030), como app_api: catálogo y su reemplazo, versiones firmadas e inmutables,
 * numeración con guardados simultáneos, versionBase, validación contra el catálogo, tutor por edad,
 * alerta médica derivada (con su exposición a recepción y el filtro «Con alerta») y permisos.
 */
import type { Pregunta } from '@conecta/shared';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  alertasMedicas,
  campoDeError,
  catalogoPreguntas,
  conContexto,
  guardarAnamnesis,
  listarAnamnesis,
  listarPacientes,
  obtenerAnamnesis,
  obtenerPaciente,
  reemplazarPreguntas,
  type CampoDeError,
  type DatosAnamnesis,
} from '../src/index.js';
import {
  crearAlertaDePrueba,
  crearAnamnesisDePrueba,
  crearArchivoDePrueba,
  crearClinicaDePrueba,
  crearFirmaDePrueba,
  crearPacienteDePrueba,
  crearRolDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 12);

type Rol = 'recepcion' | 'odontologo' | 'asistente' | 'administracion';
type Quien = 'dueno' | Rol | 'creaSinVer';

interface Clinica {
  datos: ClinicaDePrueba;
  usuarios: Record<Rol | 'creaSinVer', string>;
}

/** A: cuestionario de la semilla sin tocar. B: cuestionario propio (reemplazado en las pruebas). */
let A: Clinica;
let B: Clinica;

async function prepararClinica(): Promise<Clinica> {
  const datos = await crearClinicaDePrueba(admin);
  const usuarios = {} as Clinica['usuarios'];
  for (const rol of ['recepcion', 'odontologo', 'asistente', 'administracion'] as const) {
    usuarios[rol] = (
      await crearUsuarioDePrueba(admin, { clinicaId: datos.clinicaId, rol })
    ).usuarioId;
  }
  // Un rol que puede crear en la ficha clínica pero no verla.
  const { rolId } = await crearRolDePrueba(admin, {
    clinicaId: datos.clinicaId,
    permisos: ['pacientes:ver', 'ficha_clinica:crear'],
  });
  usuarios.creaSinVer = (
    await crearUsuarioDePrueba(admin, { clinicaId: datos.clinicaId, rolId })
  ).usuarioId;
  return { datos, usuarios };
}

beforeAll(async () => {
  [A, B] = await Promise.all([prepararClinica(), prepararClinica()]);
});

const idDe = (c: Clinica, quien: Quien): string =>
  quien === 'dueno' ? c.datos.duenoId : c.usuarios[quien];

function conApi<T>(
  quien: Quien,
  fn: Parameters<typeof conContexto<T>>[2],
  c: Clinica = A,
): Promise<T> {
  return conContexto(api, { clinicaId: c.datos.clinicaId, usuarioId: idDe(c, quien) }, fn);
}

/** Transacción cruda como app_api (se revierte). */
function como<T>(quien: Quien, fn: (cl: pg.PoolClient) => Promise<T>, c: Clinica = A): Promise<T> {
  return enTransaccion(api, { clinica: c.datos.clinicaId, usuario: idDe(c, quien) }, fn);
}

async function nuevoPaciente(
  opciones: { sexo?: 'F' | 'M' | null; fechaNac?: string | null; nombres?: string } = {},
  c: Clinica = A,
): Promise<string> {
  return (
    await crearPacienteDePrueba(admin, {
      clinicaId: c.datos.clinicaId,
      sexo: opciones.sexo === undefined ? 'F' : opciones.sexo,
      fechaNac: opciones.fechaNac ?? null,
      ...(opciones.nombres ? { nombres: opciones.nombres } : {}),
    })
  ).pacienteId;
}

async function firma(pacienteId: string, c: Clinica = A): Promise<string> {
  return (await crearFirmaDePrueba(admin, { clinicaId: c.datos.clinicaId, pacienteId })).archivoId;
}

function datos(firmaArchivoId: string, extra: Partial<DatosAnamnesis> = {}): DatosAnamnesis {
  return {
    versionBase: null,
    respuestas: [],
    firmante: { nombre: 'Ana Prueba', ci: null, esTutor: false },
    firmaArchivoId,
    declaracionVeracidad: true,
    ...extra,
  };
}

/** Guarda con una firma nueva del paciente. */
async function guardar(
  quien: Quien,
  pacienteId: string,
  extra: Partial<DatosAnamnesis> = {},
  c: Clinica = A,
): Promise<{ id: string; version: number }> {
  const f = await firma(pacienteId, c);
  return conApi(quien, (tx) => guardarAnamnesis(tx, pacienteId, datos(f, extra)), c);
}

async function falla(promesa: Promise<unknown>): Promise<CampoDeError> {
  try {
    await promesa;
  } catch (error) {
    const campo = campoDeError(error);
    if (!campo) throw error;
    return campo;
  }
  throw new Error('Se esperaba un error y la operación terminó bien.');
}

/** Pregunta completa (forma de salida de preguntaSchema). */
function pregunta(p: Partial<Pregunta> & Pick<Pregunta, 'codigo' | 'tipo'>): Pregunta {
  return {
    seccion: 5,
    orden: 100,
    texto: `Pregunta ${p.codigo}`,
    opciones: [],
    alertaSiSi: null,
    conDetalle: false,
    unidad: null,
    minimo: null,
    maximo: null,
    soloSexo: null,
    obligatoria: false,
    activa: true,
    ...p,
  };
}

// ---------------------------------------------------------------------------------------------
describe('catálogo de preguntas', () => {
  it('alta_clinica siembra el cuestionario de la maqueta: 5 secciones, 19 preguntas, sin signos vitales', async () => {
    const preguntas = await conApi('recepcion', (tx) => catalogoPreguntas(tx));
    expect(preguntas).toHaveLength(19);
    expect([...new Set(preguntas.map((p) => p.seccion))]).toEqual([1, 2, 3, 4, 5]);
    expect(preguntas.map((p) => p.codigo)).toEqual([
      'motivo',
      'sintoma',
      'desencadenantes',
      'encias',
      'ultima_consulta',
      'tratamientos_previos',
      'protesis',
      'experiencia_previa',
      'atm',
      'cepillado',
      'higiene_auxiliar',
      'parafunciones',
      'sustancias',
      'enfermedades',
      'medicacion',
      'alergias',
      'cirugias',
      'embarazo',
      'otras_condiciones',
    ]);
    const porCodigo = new Map(preguntas.map((p) => [p.codigo, p]));
    const alertas = (codigo: string) =>
      porCodigo
        .get(codigo)!
        .opciones.filter((o) => o.alerta)
        .map((o) => [o.valor, o.alerta!.texto, o.alerta!.tipo, o.alerta!.grupoAlergia]);
    expect(alertas('alergias')).toEqual([
      ['penicilina', 'Alergia a la penicilina', 'alergia', 'penicilina'],
      ['anestesicos_locales', 'Alergia a anestésicos locales', 'alergia', 'anestesicos_locales'],
      ['latex', 'Alergia al látex', 'alergia', 'latex'],
      ['material_dental', 'Alergia a material dental', 'alergia', 'material_dental'],
      ['otro_medicamento', 'Alergia a medicamentos', 'alergia', 'otro_medicamento'],
    ]);
    expect(alertas('medicacion')).toEqual([
      ['anticoagulantes', 'Anticoagulantes', 'condicion', null],
    ]);
    expect(alertas('enfermedades')).toEqual([
      ['diabetes', 'Diabetes', 'condicion', null],
      ['problemas_cardiacos', 'Cardiopatía', 'condicion', null],
      ['alteraciones_coagulacion', 'Alteración de la coagulación', 'condicion', null],
    ]);
    expect(porCodigo.get('embarazo')).toMatchObject({
      tipo: 'si_no',
      soloSexo: 'F',
      alertaSiSi: {
        tipo: 'condicion',
        texto: 'Embarazo / lactancia',
        gravedad: 'alta',
        grupoAlergia: null,
      },
    });
    // Los signos vitales son columnas de la anamnesis, no preguntas.
    expect(preguntas.filter((p) => p.tipo === 'numero')).toEqual([]);
    // Sin reglas en las demás.
    for (const p of preguntas.filter(
      (x) => !['alergias', 'medicacion', 'enfermedades', 'embarazo'].includes(x.codigo),
    )) {
      expect({
        codigo: p.codigo,
        alertas: p.opciones.filter((o) => o.alerta).length,
        si: p.alertaSiSi,
      }).toEqual({
        codigo: p.codigo,
        alertas: 0,
        si: null,
      });
    }
  });

  it('la semilla no pisa nada: correrla de nuevo no agrega preguntas', async () => {
    await enTransaccion(admin, { clinica: A.datos.clinicaId }, async (c) => {
      expect(
        await valor(c, 'select app.sembrar_preguntas_anamnesis($1)', [A.datos.clinicaId]),
      ).toBe(0);
    });
  });

  it('administración reemplaza el cuestionario: crea, edita, deja inactiva la que falta y la reactiva', async () => {
    const base = await conApi('administracion', (tx) => catalogoPreguntas(tx), B);
    const sinCirugias = base
      .filter((p) => p.codigo !== 'cirugias')
      .map((p) =>
        p.codigo === 'motivo' ? { ...p, obligatoria: true, texto: '¿Por qué nos visita?' } : p,
      );
    const nueva = pregunta({
      codigo: 'presion_habitual',
      tipo: 'numero',
      texto: '¿Cuál es su presión sistólica habitual?',
      unidad: 'mmHg',
      minimo: 50,
      maximo: 260,
    });
    const resultado = await conApi(
      'administracion',
      (tx) => reemplazarPreguntas(tx, [...sinCirugias, nueva]),
      B,
    );
    expect(resultado.filter((p) => p.activa)).toHaveLength(19);
    expect(resultado.find((p) => p.codigo === 'cirugias')).toMatchObject({ activa: false });
    expect(resultado.find((p) => p.codigo === 'motivo')).toMatchObject({
      obligatoria: true,
      texto: '¿Por qué nos visita?',
    });
    expect(resultado.find((p) => p.codigo === 'presion_habitual')).toEqual({ ...nueva });
    // La inactiva no está en el GET y queda en auditoría como baja (módulo configuracion).
    const activas = await conApi('odontologo', (tx) => catalogoPreguntas(tx), B);
    expect(activas.map((p) => p.codigo)).not.toContain('cirugias');
    // El editor del catálogo lo pide entero con configuracion:editar, sin ficha_clinica:ver.
    const completo = await conApi(
      'administracion',
      (tx) => catalogoPreguntas(tx, { incluirInactivas: true }),
      B,
    );
    expect(completo).toEqual(resultado);
    expect(completo.at(-1)).toMatchObject({ codigo: 'cirugias', activa: false });
    await enTransaccion(admin, { clinica: B.datos.clinicaId }, async (c) => {
      expect(
        await valor(
          c,
          `select count(*)::int from app.audit_log a join app.anamnesis_pregunta q on q.id = a.entidad_id
           where a.entidad = 'anamnesis_pregunta' and q.codigo = 'cirugias' and a.accion = 'anular'
             and a.modulo = 'configuracion' and a.usuario_id = $1`,
          [B.usuarios.administracion],
        ),
      ).toBe(1);
    });
    // Reactivarla: mandarla de nuevo.
    const otraVez = await conApi(
      'administracion',
      (tx) =>
        reemplazarPreguntas(tx, [
          ...sinCirugias,
          nueva,
          base.find((p) => p.codigo === 'cirugias')!,
        ]),
      B,
    );
    expect(otraVez.filter((p) => p.activa)).toHaveLength(20);
    // Y de vuelta sin cirugías (las pruebas de abajo lo usan).
    await conApi('administracion', (tx) => reemplazarPreguntas(tx, [...sinCirugias, nueva]), B);
  });

  it('reemplazar sin configuracion:editar se rechaza en la base', async () => {
    const base = await conApi('dueno', (tx) => catalogoPreguntas(tx));
    for (const quien of ['odontologo', 'recepcion', 'asistente'] as const) {
      expect(await falla(conApi(quien, (tx) => reemplazarPreguntas(tx, base)))).toMatchObject({
        codigoPg: '42501',
        restriccion: 'configuracion_sin_permiso',
      });
    }
  });

  it('reemplazar valida y dice qué pregunta falló (column = preguntas.<codigo>)', async () => {
    const base = await conApi('dueno', (tx) => catalogoPreguntas(tx));
    const casos: [Pregunta[], Partial<CampoDeError>][] = [
      [
        [...base, base[0]!],
        { restriccion: 'anamnesis_pregunta_repetida', codigoPregunta: 'motivo' },
      ],
      [
        [...base, pregunta({ codigo: 'sin_opciones', tipo: 'multiple' })],
        { restriccion: 'anamnesis_pregunta_tipo_campos', codigoPregunta: 'sin_opciones' },
      ],
      [
        [
          ...base,
          pregunta({
            codigo: 'mala_regla',
            tipo: 'si_no',
            alertaSiSi: { tipo: 'alergia', texto: 'Al', gravedad: 'alta', grupoAlergia: null },
          }),
        ],
        { restriccion: 'anamnesis_pregunta_alerta_si_check', codigoPregunta: 'mala_regla' },
      ],
      [
        [
          ...base,
          pregunta({
            codigo: 'opcion_rara',
            tipo: 'multiple',
            opciones: [
              { valor: 'a', etiqueta: 'A', alerta: null },
              { valor: 'a', etiqueta: 'Otra A', alerta: null },
            ],
          }),
        ],
        { restriccion: 'anamnesis_pregunta_opciones_check', codigoPregunta: 'opcion_rara' },
      ],
      [
        [...base, pregunta({ codigo: 'rango', tipo: 'numero', minimo: 10, maximo: 1 })],
        { restriccion: 'anamnesis_pregunta_tipo_campos', codigoPregunta: 'rango' },
      ],
      [
        [...base, pregunta({ codigo: 'seccion_6', tipo: 'texto', seccion: 6 })],
        { restriccion: 'anamnesis_pregunta_seccion_check', codigoPregunta: 'seccion_6' },
      ],
      [[], { restriccion: 'anamnesis_catalogo_invalido', campo: 'preguntas' }],
    ];
    for (const [preguntas, esperado] of casos) {
      expect(
        await falla(conApi('administracion', (tx) => reemplazarPreguntas(tx, preguntas))),
      ).toMatchObject(esperado);
    }
    // Nada cambió.
    expect(await conApi('dueno', (tx) => catalogoPreguntas(tx))).toEqual(base);
  });

  it('app_api no escribe el catálogo directamente', async () => {
    await como('dueno', async (c) => {
      expect(
        await intentar(
          c,
          "update app.anamnesis_pregunta set texto = 'Hackeada' where codigo = 'motivo'",
        ),
      ).toMatchObject(rechazo('42501'));
      expect(
        await intentar(
          c,
          "insert into app.anamnesis_pregunta (clinica_id, codigo, seccion, orden, texto, tipo) values ($1, 'x_x', 1, 1, 'Texto', 'texto')",
          [A.datos.clinicaId],
        ),
      ).toMatchObject(rechazo('42501'));
      expect(await intentar(c, 'delete from app.anamnesis_pregunta')).toMatchObject(
        rechazo('42501'),
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('versiones', () => {
  it('guarda la versión 1 con copia de los textos, y la 2 deja la 1 intacta y consultable', async () => {
    const pacienteId = await nuevoPaciente();
    const v1 = await guardar('odontologo', pacienteId, {
      respuestas: [
        { codigo: 'motivo', texto: '  Control  ' },
        { codigo: 'alergias', opciones: ['penicilina'], detalle: 'urticaria con amoxicilina.' },
        { codigo: 'protesis', si: true, detalle: 'Retenedor nocturno' },
      ],
      signosVitales: { presionSistolica: 120, presionDiastolica: 80, pulso: 70, pesoKg: 61.5 },
      firmante: { nombre: '  Ana   Prueba ', ci: '4.123.456', esTutor: false },
    });
    expect(v1.version).toBe(1);
    const leida = await conApi('odontologo', (tx) => obtenerAnamnesis(tx, pacienteId, 'vigente'));
    expect(leida).toMatchObject({
      id: v1.id,
      pacienteId,
      version: 1,
      firmante: { nombre: 'Ana Prueba', ci: '4123456', esTutor: false },
      signosVitales: { presionSistolica: 120, presionDiastolica: 80, pulso: 70, pesoKg: 61.5 },
      alertas: 1,
      alertasMedicas: [
        {
          tipo: 'alergia',
          texto: 'Alergia a la penicilina (urticaria con amoxicilina)',
          gravedad: 'alta',
          grupoAlergia: 'penicilina',
          codigo: 'alergias',
        },
      ],
      esVigente: true,
    });
    expect(typeof leida?.registradaPor).toBe('string');
    expect(leida?.respuestas).toEqual([
      {
        codigo: 'motivo',
        pregunta: '¿Cuál es el motivo principal de su visita hoy?',
        seccion: 1,
        tipo: 'texto',
        etiquetas: [],
        unidad: null,
        texto: 'Control',
      },
      {
        codigo: 'protesis',
        pregunta: '¿Usa prótesis removibles o retenedores?',
        seccion: 2,
        tipo: 'si_no',
        etiquetas: [],
        unidad: null,
        si: true,
        detalle: 'Retenedor nocturno',
      },
      {
        codigo: 'alergias',
        pregunta:
          '¿Es alérgico a algún medicamento (como penicilina o anestésicos locales), látex o material dental?',
        seccion: 4,
        tipo: 'multiple',
        etiquetas: ['Penicilina'],
        unidad: null,
        opciones: ['penicilina'],
        detalle: 'urticaria con amoxicilina.',
      },
    ]);

    const v2 = await guardar('odontologo', pacienteId, {
      versionBase: 1,
      respuestas: [{ codigo: 'motivo', texto: 'Dolor' }],
    });
    expect(v2.version).toBe(2);
    const vieja = await conApi('asistente', (tx) => obtenerAnamnesis(tx, pacienteId, 1));
    expect(vieja).toMatchObject({ id: v1.id, version: 1, esVigente: false, alertas: 1 });
    expect(vieja?.respuestas).toHaveLength(3);
    const lista = await conApi('asistente', (tx) => listarAnamnesis(tx, pacienteId));
    expect(lista.versiones.map((v) => [v.version, v.alertas])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    expect(lista.requiereTutor).toBe(false);
    // La alerta vigente es la de la versión 2: ninguna.
    expect(await conApi('recepcion', (tx) => alertasMedicas(tx, pacienteId))).toEqual([]);
    // Auditoría: el alta de cada versión, módulo ficha_clinica, autor el odontólogo.
    await enTransaccion(admin, { clinica: A.datos.clinicaId }, async (c) => {
      expect(
        await valor(
          c,
          `select count(*)::int from app.audit_log
           where entidad = 'anamnesis' and entidad_id = any($1::uuid[]) and accion = 'crear'
             and modulo = 'ficha_clinica' and usuario_id = $2`,
          [[v1.id, v2.id], A.usuarios.odontologo],
        ),
      ).toBe(2);
    });
  });

  it('versionBase desactualizada: conflicto (40001) y nada se guarda', async () => {
    const pacienteId = await nuevoPaciente();
    await guardar('odontologo', pacienteId);
    await guardar('odontologo', pacienteId, { versionBase: 1 });
    for (const versionBase of [null, 1, 3]) {
      expect(await falla(guardar('odontologo', pacienteId, { versionBase }))).toMatchObject({
        codigoPg: '40001',
        restriccion: 'anamnesis_conflicto_version',
        campo: 'versionBase',
      });
    }
    const lista = await conApi('odontologo', (tx) => listarAnamnesis(tx, pacienteId));
    expect(lista.versiones.map((v) => v.version)).toEqual([2, 1]);
  });

  it('dos guardados simultáneos del mismo paciente: uno gana y el otro recibe el conflicto, sin huecos', async () => {
    const pacienteId = await nuevoPaciente();
    const [f1, f2] = [await firma(pacienteId), await firma(pacienteId)];
    const sentencia = `select * from app.guardar_anamnesis($1, null, '[]'::jsonb, 'Ana Prueba', null, false, $2, true)`;
    const c1 = await api.connect();
    const c2 = await api.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query('begin');
        await c.query(
          "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
          [A.datos.clinicaId, A.usuarios.odontologo],
        );
      }
      const primero = await c1.query(sentencia, [pacienteId, f1]);
      expect(primero.rows[0]).toMatchObject({ version: 1 });
      // El segundo espera el bloqueo del paciente…
      const segundo = c2.query(sentencia, [pacienteId, f2]).then(
        () => null,
        (e: unknown) => campoDeError(e),
      );
      await new Promise((listo) => setTimeout(listo, 300));
      await c1.query('commit');
      // …y al ver la versión 1, su versionBase (null) ya no es la vigente.
      expect(await segundo).toMatchObject({
        codigoPg: '40001',
        restriccion: 'anamnesis_conflicto_version',
      });
      await c2.query('rollback');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('con REPEATABLE READ el segundo también recibe el conflicto (no la violación de unicidad)', async () => {
    const pacienteId = await nuevoPaciente();
    const [f1, f2] = [await firma(pacienteId), await firma(pacienteId)];
    const sentencia = `select * from app.guardar_anamnesis($1, null, '[]'::jsonb, 'Ana Prueba', null, false, $2, true)`;
    const c1 = await api.connect();
    const c2 = await api.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query('begin isolation level repeatable read');
        // Toma la instantánea ya: el segundo no va a ver la versión del primero.
        await c.query(
          "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
          [A.datos.clinicaId, A.usuarios.odontologo],
        );
      }
      await c1.query(sentencia, [pacienteId, f1]);
      const segundo = c2.query(sentencia, [pacienteId, f2]).then(
        () => null,
        (e: unknown) => campoDeError(e),
      );
      await new Promise((listo) => setTimeout(listo, 300));
      await c1.query('commit');
      expect(await segundo).toMatchObject({
        codigoPg: '40001',
        restriccion: 'anamnesis_conflicto_version',
      });
      await c2.query('rollback');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('seis personas guardando a la vez (con reintento ante el conflicto): versiones 1..6, sin repetidas ni huecos', async () => {
    const pacienteId = await nuevoPaciente();
    let conflictos = 0;
    const trabajador = async (): Promise<number> => {
      const f = await firma(pacienteId);
      for (;;) {
        try {
          return await conApi('odontologo', async (tx) => {
            const { versiones } = await listarAnamnesis(tx, pacienteId);
            const base = versiones[0]?.version ?? null;
            return (await guardarAnamnesis(tx, pacienteId, datos(f, { versionBase: base })))
              .version;
          });
        } catch (error) {
          if (campoDeError(error)?.restriccion !== 'anamnesis_conflicto_version') throw error;
          conflictos++;
        }
      }
    };
    const versiones = await Promise.all(Array.from({ length: 6 }, trabajador));
    expect([...versiones].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(conflictos).toBeGreaterThanOrEqual(0);
    const lista = await conApi('odontologo', (tx) => listarAnamnesis(tx, pacienteId));
    expect(lista.versiones.map((v) => v.version)).toEqual([6, 5, 4, 3, 2, 1]);
    // Solo las alertas de la última están vigentes (ninguna acá) y no hay versiones repetidas.
    await enTransaccion(admin, { clinica: A.datos.clinicaId }, async (c) => {
      expect(
        await valor(
          c,
          'select count(distinct version)::int from app.anamnesis where paciente_id = $1',
          [pacienteId],
        ),
      ).toBe(6);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('validación contra el catálogo vigente', () => {
  it('cada error dice la regla y la pregunta (column = respuestas.<codigo>), y nada queda guardado', async () => {
    const mujer = await nuevoPaciente({ sexo: 'F' }, B);
    const casos: [DatosAnamnesis['respuestas'], string, string][] = [
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'no_existe', si: true },
        ],
        'anamnesis_pregunta_desconocida',
        'no_existe',
      ],
      // Inactiva (B la sacó del cuestionario).
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'cirugias', si: true },
        ],
        'anamnesis_pregunta_desconocida',
        'cirugias',
      ],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'protesis', si: true },
          { codigo: 'protesis', si: false },
        ],
        'anamnesis_respuesta_repetida',
        'protesis',
      ],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'protesis', opciones: ['a'] },
        ],
        'anamnesis_respuesta_invalida',
        'protesis',
      ],
      [
        [{ codigo: 'motivo', texto: 'x' }, { codigo: 'protesis' }],
        'anamnesis_respuesta_invalida',
        'protesis',
      ],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'alergias', si: true },
        ],
        'anamnesis_respuesta_invalida',
        'alergias',
      ],
      [[{ codigo: 'motivo', si: true }], 'anamnesis_respuesta_invalida', 'motivo'],
      [
        [{ codigo: 'motivo', texto: 'x', detalle: 'no va' }],
        'anamnesis_respuesta_invalida',
        'motivo',
      ],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'alergias', opciones: [], detalle: 'x'.repeat(301) },
        ],
        'anamnesis_respuesta_invalida',
        'alergias',
      ],
      [[{ codigo: 'motivo', texto: 'x'.repeat(1001) }], 'anamnesis_respuesta_invalida', 'motivo'],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'alergias', opciones: ['penicilina', 'mariscos'] },
        ],
        'anamnesis_opcion_desconocida',
        'alergias',
      ],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'presion_habitual', numero: 300 },
        ],
        'anamnesis_numero_fuera_de_rango',
        'presion_habitual',
      ],
      [
        [
          { codigo: 'motivo', texto: 'x' },
          { codigo: 'presion_habitual', numero: 49.9 },
        ],
        'anamnesis_numero_fuera_de_rango',
        'presion_habitual',
      ],
      // motivo es obligatoria en B: sin responder o con texto vacío.
      [[{ codigo: 'protesis', si: false }], 'anamnesis_obligatoria_sin_responder', 'motivo'],
      [[{ codigo: 'motivo', texto: '   ' }], 'anamnesis_obligatoria_sin_responder', 'motivo'],
    ];
    for (const [respuestas, restriccion, codigo] of casos) {
      expect({
        codigo,
        error: await falla(guardar('odontologo', mujer, { respuestas }, B)),
      }).toMatchObject({
        codigo,
        error: {
          codigoPg: '22023',
          restriccion,
          campo: `respuestas.${codigo}`,
          codigoPregunta: codigo,
        },
      });
    }
    // Lo que sí vale: número en rango (en el borde), opción múltiple vacía, repetidas una vez.
    const ok = await guardar(
      'odontologo',
      mujer,
      {
        respuestas: [
          { codigo: 'motivo', texto: 'Control' },
          { codigo: 'presion_habitual', numero: 50 },
          { codigo: 'alergias', opciones: ['latex', 'penicilina', 'latex'] },
          { codigo: 'encias', opciones: [] },
        ],
      },
      B,
    );
    expect(ok.version).toBe(1);
    const leida = await conApi('odontologo', (tx) => obtenerAnamnesis(tx, mujer, 1), B);
    expect(leida?.respuestas.find((r) => r.codigo === 'alergias')).toMatchObject({
      opciones: ['penicilina', 'latex'],
      etiquetas: ['Penicilina', 'Látex'],
    });
    expect(leida?.respuestas.find((r) => r.codigo === 'presion_habitual')).toMatchObject({
      numero: 50,
      tipo: 'numero',
      unidad: 'mmHg',
    });
    expect(leida?.respuestas.find((r) => r.codigo === 'encias')).toMatchObject({
      opciones: [],
      etiquetas: [],
    });
  });

  it('embarazo: rechazado si el sexo es M; se acepta con sexo F o sin sexo cargado', async () => {
    const hombre = await nuevoPaciente({ sexo: 'M' });
    expect(
      await falla(
        guardar('odontologo', hombre, { respuestas: [{ codigo: 'embarazo', si: false }] }),
      ),
    ).toMatchObject({ restriccion: 'anamnesis_pregunta_no_aplica', codigoPregunta: 'embarazo' });
    // Sin la pregunta, el hombre guarda igual.
    expect((await guardar('odontologo', hombre)).version).toBe(1);
    for (const sexo of ['F', null] as const) {
      const p = await nuevoPaciente({ sexo });
      await guardar('odontologo', p, { respuestas: [{ codigo: 'embarazo', si: true }] });
      expect(await conApi('recepcion', (tx) => alertasMedicas(tx, p))).toEqual([
        {
          tipo: 'condicion',
          texto: 'Embarazo / lactancia',
          gravedad: 'alta',
          grupoAlergia: null,
          codigo: 'embarazo',
        },
      ]);
    }
  });

  it('firmante, firma, declaración y signos vitales', async () => {
    const p = await nuevoPaciente();
    const otro = await nuevoPaciente();
    const casos: [Partial<DatosAnamnesis>, string, string][] = [
      [
        { firmante: { nombre: 'An', ci: null, esTutor: false } },
        'anamnesis_firmante_nombre',
        'firmante.nombre',
      ],
      [
        { firmante: { nombre: 'Ana Prueba', ci: '12', esTutor: false } },
        'anamnesis_firmante_ci',
        'firmante.ci',
      ],
      [
        { firmante: { nombre: 'Ana Prueba', ci: null, esTutor: true } },
        'anamnesis_tutor_sin_ci',
        'firmante.ci',
      ],
      [{ declaracionVeracidad: false }, 'anamnesis_sin_declaracion', 'declaracionVeracidad'],
      [{ signosVitales: { pulso: 10 } }, 'anamnesis_signos_vitales', 'signosVitales.pulso'],
      [
        { signosVitales: { presionSistolica: 261 } },
        'anamnesis_signos_vitales',
        'signosVitales.presionSistolica',
      ],
      [
        { signosVitales: { presionDiastolica: 29 } },
        'anamnesis_signos_vitales',
        'signosVitales.presionDiastolica',
      ],
      [{ signosVitales: { pesoKg: 0.5 } }, 'anamnesis_signos_vitales', 'signosVitales.pesoKg'],
    ];
    for (const [extra, restriccion, campo] of casos) {
      expect(await falla(guardar('odontologo', p, extra))).toMatchObject({
        codigoPg: '22023',
        restriccion,
        campo,
      });
    }
    // Firmas que no sirven: de otro paciente, de otra categoría, dada de baja, ya usada, de otra clínica.
    const deOtro = await firma(otro);
    const logo = (await crearArchivoDePrueba(admin, { clinicaId: A.datos.clinicaId })).archivoId;
    const deBaja = await firma(p);
    await enTransaccion(
      admin,
      { clinica: A.datos.clinicaId },
      (c) =>
        c.query("update app.archivo set deleted_at = now(), motivo_baja = 'Error' where id = $1", [
          deBaja,
        ]),
      { confirmar: true },
    );
    const usada = await firma(p);
    await conApi('odontologo', (tx) => guardarAnamnesis(tx, p, datos(usada)));
    const deB = await firma(await nuevoPaciente({}, B), B);
    for (const f of [deOtro, logo, deBaja, usada, deB]) {
      expect(
        await falla(
          conApi('odontologo', (tx) => guardarAnamnesis(tx, p, datos(f, { versionBase: 1 }))),
        ),
      ).toMatchObject({ restriccion: 'anamnesis_firma_invalida', campo: 'firmaPng' });
    }
    // Paciente dado de baja y paciente de otra clínica.
    const baja = (
      await crearPacienteDePrueba(admin, { clinicaId: A.datos.clinicaId, activo: false })
    ).pacienteId;
    expect(await falla(guardar('odontologo', baja))).toMatchObject({
      restriccion: 'anamnesis_paciente_inactivo',
    });
    const ajeno = await nuevoPaciente({}, B);
    const f = await firma(ajeno, B);
    expect(
      await falla(conApi('odontologo', (tx) => guardarAnamnesis(tx, ajeno, datos(f)))),
    ).toMatchObject({
      codigoPg: 'P0002',
      restriccion: 'paciente_no_encontrado',
    });
    // Ninguna versión de más.
    expect((await conApi('odontologo', (tx) => listarAnamnesis(tx, p))).versiones).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('tutor por edad (zona de la clínica)', () => {
  it('app.requiere_tutor usa la fecha de Asunción, no la de UTC, en el borde del cumpleaños', async () => {
    await como('odontologo', async (c) => {
      const tutor = (fechaNac: string | null, instante: string) =>
        valor<boolean>(c, 'select app.requiere_tutor($1::date, $2::timestamptz)', [
          fechaNac,
          instante,
        ]);
      // 02:30 UTC del 28 = 23:30 del 27 en Asunción: todavía tiene 17.
      expect(await tutor('2008-11-28', '2026-11-28T02:30:00Z')).toBe(true);
      // 03:30 UTC del 28 = 00:30 del 28 en Asunción: cumplió 18.
      expect(await tutor('2008-11-28', '2026-11-28T03:30:00Z')).toBe(false);
      expect(await tutor('2008-11-29', '2026-11-28T12:00:00Z')).toBe(true);
      // Sin fecha de nacimiento no se exige tutor.
      expect(await tutor(null, '2026-11-28T12:00:00Z')).toBe(false);
    });
  });

  it('guardar exige tutor con CI para quien cumple 18 mañana y no para quien los cumple hoy', async () => {
    const fechas = await enTransaccion(admin, { clinica: A.datos.clinicaId }, async (c) => {
      const { rows } = await c.query<{ hoy18: string; manana18: string }>(
        `select (app.hoy_clinica() - interval '18 years')::date::text as hoy18,
                (app.hoy_clinica() - interval '18 years' + interval '1 day')::date::text as manana18`,
      );
      return rows[0]!;
    });
    const menor = await nuevoPaciente({ fechaNac: fechas.manana18 });
    const mayor = await nuevoPaciente({ fechaNac: fechas.hoy18 });
    expect(await falla(guardar('odontologo', menor))).toMatchObject({
      restriccion: 'anamnesis_tutor_requerido',
      campo: 'firmante.esTutor',
    });
    expect(
      await falla(
        guardar('odontologo', menor, {
          firmante: { nombre: 'Tutora Prueba', ci: null, esTutor: true },
        }),
      ),
    ).toMatchObject({ restriccion: 'anamnesis_tutor_sin_ci' });
    expect(
      (
        await guardar('odontologo', menor, {
          firmante: { nombre: 'Tutora Prueba', ci: '4123456', esTutor: true },
        })
      ).version,
    ).toBe(1);
    expect((await guardar('odontologo', mayor)).version).toBe(1);
    expect((await conApi('odontologo', (tx) => listarAnamnesis(tx, menor))).requiereTutor).toBe(
      true,
    );
    expect((await conApi('odontologo', (tx) => listarAnamnesis(tx, mayor))).requiereTutor).toBe(
      false,
    );
    // Sin fecha de nacimiento: firma el paciente (decisión documentada en 0029).
    const sinFecha = await nuevoPaciente({ fechaNac: null });
    expect((await guardar('odontologo', sinFecha)).version).toBe(1);
    // clinica.edad_tutor manda (no un 18 fijo).
    await enTransaccion(
      admin,
      { clinica: B.datos.clinicaId },
      (c) => c.query('update app.clinica set edad_tutor = 21 where id = $1', [B.datos.clinicaId]),
      { confirmar: true },
    );
    const de19 = await nuevoPaciente(
      { fechaNac: fechas.hoy18.replace(/^\d{4}/, (a) => String(Number(a) - 1)) },
      B,
    );
    expect(
      await falla(
        guardar('odontologo', de19, { respuestas: [{ codigo: 'motivo', texto: 'Control' }] }, B),
      ),
    ).toMatchObject({ restriccion: 'anamnesis_tutor_requerido' });
    await enTransaccion(
      admin,
      { clinica: B.datos.clinicaId },
      (c) => c.query('update app.clinica set edad_tutor = 18 where id = $1', [B.datos.clinicaId]),
      { confirmar: true },
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('alerta médica derivada', () => {
  it('cada regla de la semilla, en orden, con el detalle en la última alerta de la pregunta', async () => {
    const p = await nuevoPaciente({ sexo: 'F' });
    await guardar('odontologo', p, {
      respuestas: [
        { codigo: 'embarazo', si: true },
        {
          codigo: 'alergias',
          opciones: [
            'otro_medicamento',
            'latex',
            'penicilina',
            'material_dental',
            'anestesicos_locales',
          ],
          detalle: 'ibuprofeno...',
        },
        {
          codigo: 'medicacion',
          opciones: ['anticoagulantes', 'antiinflamatorios'],
          detalle: 'Warfarina',
        },
        {
          codigo: 'enfermedades',
          opciones: [
            'hipertension',
            'diabetes',
            'problemas_cardiacos',
            'alteraciones_coagulacion',
            'asma',
          ],
        },
        { codigo: 'otras_condiciones', opciones: ['hepatitis'] },
        { codigo: 'protesis', si: true },
      ],
    });
    expect(await conApi('recepcion', (tx) => alertasMedicas(tx, p))).toEqual([
      {
        codigo: 'enfermedades',
        tipo: 'condicion',
        texto: 'Diabetes',
        gravedad: 'media',
        grupoAlergia: null,
      },
      {
        codigo: 'enfermedades',
        tipo: 'condicion',
        texto: 'Cardiopatía',
        gravedad: 'alta',
        grupoAlergia: null,
      },
      {
        codigo: 'enfermedades',
        tipo: 'condicion',
        texto: 'Alteración de la coagulación',
        gravedad: 'alta',
        grupoAlergia: null,
      },
      {
        codigo: 'medicacion',
        tipo: 'condicion',
        texto: 'Anticoagulantes (Warfarina)',
        gravedad: 'alta',
        grupoAlergia: null,
      },
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia a la penicilina',
        gravedad: 'alta',
        grupoAlergia: 'penicilina',
      },
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia a anestésicos locales',
        gravedad: 'alta',
        grupoAlergia: 'anestesicos_locales',
      },
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia al látex',
        gravedad: 'alta',
        grupoAlergia: 'latex',
      },
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia a material dental',
        gravedad: 'alta',
        grupoAlergia: 'material_dental',
      },
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia a medicamentos (ibuprofeno)',
        gravedad: 'alta',
        grupoAlergia: 'otro_medicamento',
      },
      {
        codigo: 'embarazo',
        tipo: 'condicion',
        texto: 'Embarazo / lactancia',
        gravedad: 'alta',
        grupoAlergia: null,
      },
    ]);
    // «No» al embarazo y opciones sin regla: sin alertas.
    const q = await nuevoPaciente({ sexo: 'F' });
    await guardar('odontologo', q, {
      respuestas: [
        { codigo: 'embarazo', si: false, detalle: 'Nada' },
        { codigo: 'enfermedades', opciones: ['asma'], detalle: 'leve' },
      ],
    });
    expect(await conApi('recepcion', (tx) => alertasMedicas(tx, q))).toEqual([]);
  });

  it('cambiar el catálogo después no cambia la alerta (ni los textos) de una versión firmada', async () => {
    const p = await nuevoPaciente({}, B);
    const motivo = { codigo: 'motivo', texto: 'Control' };
    await guardar(
      'odontologo',
      p,
      {
        respuestas: [
          motivo,
          { codigo: 'alergias', opciones: ['penicilina'], detalle: 'urticaria' },
        ],
      },
      B,
    );
    const actual = await conApi('administracion', (tx) => catalogoPreguntas(tx), B);
    const cambiado = actual.map((q) =>
      q.codigo !== 'alergias'
        ? q
        : {
            ...q,
            texto: '¿Tiene alergias?',
            opciones: q.opciones.map((o) =>
              o.valor === 'penicilina'
                ? {
                    ...o,
                    etiqueta: 'Betalactámicos',
                    alerta: {
                      tipo: 'alergia' as const,
                      texto: 'Alergia a betalactámicos',
                      gravedad: 'media' as const,
                      grupoAlergia: 'betalactamicos',
                    },
                  }
                : { ...o, alerta: null },
            ),
          },
    );
    await conApi('administracion', (tx) => reemplazarPreguntas(tx, cambiado), B);
    // La versión 1 sigue diciendo lo que se firmó.
    const v1 = await conApi('odontologo', (tx) => obtenerAnamnesis(tx, p, 1), B);
    expect(v1?.alertasMedicas.map((a) => [a.texto, a.gravedad, a.grupoAlergia])).toEqual([
      ['Alergia a la penicilina (urticaria)', 'alta', 'penicilina'],
    ]);
    expect(v1?.respuestas.find((r) => r.codigo === 'alergias')).toMatchObject({
      pregunta:
        '¿Es alérgico a algún medicamento (como penicilina o anestésicos locales), látex o material dental?',
      etiquetas: ['Penicilina'],
    });
    expect(
      (await conApi('recepcion', (tx) => alertasMedicas(tx, p), B)).map((a) => a.texto),
    ).toEqual(['Alergia a la penicilina (urticaria)']);
    // Una versión nueva usa las reglas de hoy.
    await guardar(
      'odontologo',
      p,
      {
        versionBase: 1,
        respuestas: [motivo, { codigo: 'alergias', opciones: ['penicilina', 'latex'] }],
      },
      B,
    );
    expect(await conApi('recepcion', (tx) => alertasMedicas(tx, p), B)).toEqual([
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia a betalactámicos',
        gravedad: 'media',
        grupoAlergia: 'betalactamicos',
      },
    ]);
    // Vuelve el catálogo de antes para las demás pruebas.
    await conApi('administracion', (tx) => reemplazarPreguntas(tx, actual), B);
  });

  it('«Con alerta» incluye a quien solo tiene alertas derivadas, también para recepción, y deja de incluirlo con una versión sin alertas', async () => {
    const nombres = `Derivada ${Date.now()}`;
    const p = await nuevoPaciente({ nombres });
    const conAlerta = (quien: Quien) =>
      conApi(quien, async (tx) => {
        const { items } = await listarPacientes(tx, {
          filtro: 'con_alerta',
          texto: nombres,
          limite: 10,
        });
        return items.map((i) => i.id);
      });
    expect(await conAlerta('recepcion')).toEqual([]);
    await guardar('odontologo', p, {
      respuestas: [{ codigo: 'medicacion', opciones: ['anticoagulantes'] }],
    });
    expect(await conAlerta('recepcion')).toEqual([p]);
    expect(await conAlerta('odontologo')).toEqual([p]);
    const ficha = await conApi('recepcion', (tx) => obtenerPaciente(tx, p));
    expect(ficha).toMatchObject({
      conAlerta: true,
      alertas: [],
      alertasMedicas: [
        {
          codigo: 'medicacion',
          tipo: 'condicion',
          texto: 'Anticoagulantes',
          gravedad: 'alta',
          grupoAlergia: null,
        },
      ],
    });
    await guardar('odontologo', p, { versionBase: 1 });
    expect(await conAlerta('recepcion')).toEqual([]);
    expect((await conApi('recepcion', (tx) => obtenerPaciente(tx, p)))?.alertasMedicas).toEqual([]);
    // Y una manual sigue contando sola.
    await crearAlertaDePrueba(admin, { clinicaId: A.datos.clinicaId, pacienteId: p });
    expect(await conAlerta('recepcion')).toEqual([p]);
  });

  it('recepción ve el texto de la alerta vigente y nada más de la anamnesis', async () => {
    const p = await nuevoPaciente();
    await guardar('odontologo', p, {
      respuestas: [{ codigo: 'alergias', opciones: ['latex'], detalle: 'guantes' }],
      signosVitales: { pulso: 80 },
    });
    await guardar('odontologo', p, {
      versionBase: 1,
      respuestas: [{ codigo: 'alergias', opciones: ['penicilina'] }],
    });
    await como('recepcion', async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.anamnesis where paciente_id = $1', [p]),
      ).toBe(0);
      expect(await valor(c, 'select count(*)::int from app.anamnesis_respuesta')).toBe(0);
      // Solo la alerta vigente (la de la versión 2), no la del látex de la 1.
      const { rows } = await c.query(
        'select texto, vigente from app.anamnesis_alerta where paciente_id = $1',
        [p],
      );
      expect(rows).toEqual([{ texto: 'Alergia a la penicilina', vigente: true }]);
      // Ni su historial en la auditoría (módulo ficha_clinica).
      expect(
        await valor(
          c,
          `select count(*)::int from app.audit_log
           where entidad in ('anamnesis', 'anamnesis_respuesta', 'archivo') and modulo = 'ficha_clinica'`,
        ),
      ).toBe(0);
    });
    expect(await conApi('recepcion', (tx) => listarAnamnesis(tx, p))).toEqual({
      versiones: [],
      requiereTutor: false,
    });
    expect(await conApi('recepcion', (tx) => obtenerAnamnesis(tx, p, 'vigente'))).toBeNull();
    // El asistente (ficha_clinica:ver) ve las dos versiones y las tres alertas… del látex con detalle.
    await como('asistente', async (c) => {
      const { rows } = await c.query(
        'select texto, vigente from app.anamnesis_alerta where paciente_id = $1 order by created_at, orden',
        [p],
      );
      expect(rows).toEqual([
        { texto: 'Alergia al látex (guantes)', vigente: false },
        { texto: 'Alergia a la penicilina', vigente: true },
      ]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('permisos e inmutabilidad en la base', () => {
  it('guardar exige ficha_clinica:crear y ficha_clinica:ver', async () => {
    const p = await nuevoPaciente();
    for (const quien of ['recepcion', 'asistente', 'administracion', 'creaSinVer'] as const) {
      expect({ quien, error: await falla(guardar(quien, p)) }).toMatchObject({
        quien,
        error: { codigoPg: '42501', restriccion: 'ficha_clinica_sin_permiso' },
      });
    }
    expect((await guardar('dueno', p)).version).toBe(1);
  });

  it('app_api no inserta, edita ni borra versiones, respuestas ni alertas derivadas', async () => {
    const p = await nuevoPaciente();
    const { anamnesisId } = await crearAnamnesisDePrueba(admin, {
      clinicaId: A.datos.clinicaId,
      pacienteId: p,
      respuestas: [{ codigo: 'alergias', opciones: ['penicilina'] }],
    });
    await como('dueno', async (c) => {
      for (const texto of [
        'update app.anamnesis set pulso = 60 where id = $1',
        'update app.anamnesis_respuesta set detalle = $1::text where anamnesis_id is not null',
        'update app.anamnesis_alerta set vigente = true where anamnesis_id = $1',
        "update app.anamnesis_alerta set texto = 'Otra' where anamnesis_id = $1",
        'delete from app.anamnesis where id = $1',
        'delete from app.anamnesis_respuesta where anamnesis_id = $1',
        'delete from app.anamnesis_alerta where anamnesis_id = $1',
        'truncate app.anamnesis_alerta',
      ]) {
        const r = await intentar(c, texto, texto.includes('$1') ? [anamnesisId] : []);
        expect({ texto, r }).toMatchObject({ texto, r: { ok: false, codigo: '42501' } });
      }
      expect(
        await intentar(
          c,
          `insert into app.anamnesis_alerta (clinica_id, anamnesis_id, paciente_id, orden, pregunta_codigo, tipo, texto, gravedad)
           values ($1, $2, $3, 9, 'alergias', 'alergia', 'Falsa', 'alta')`,
          [A.datos.clinicaId, anamnesisId, p],
        ),
      ).toMatchObject(rechazo('42501'));
    });
  });

  it('ni el dueño de las tablas borra una versión; en su sesión el UPDATE no se rechaza (relleno de columnas nuevas), pero lo firmado sigue fijo', async () => {
    const p = await nuevoPaciente();
    const { anamnesisId } = await crearAnamnesisDePrueba(admin, {
      clinicaId: A.datos.clinicaId,
      pacienteId: p,
    });
    await enTransaccion(admin, { clinica: A.datos.clinicaId }, async (c) => {
      for (const tabla of ['anamnesis', 'anamnesis_respuesta', 'anamnesis_alerta']) {
        expect(await intentar(c, `delete from app.${tabla}`)).toMatchObject(rechazo('42501'));
      }
      for (const tabla of ['anamnesis', 'anamnesis_respuesta']) {
        const columna = tabla === 'anamnesis' ? 'id' : 'anamnesis_id';
        expect(
          await intentar(
            c,
            `update app.${tabla} set created_at = created_at where ${columna} = $1`,
            [anamnesisId],
          ),
        ).toMatchObject({ ok: true });
      }
      // Las columnas firmadas siguen fijas para todos (fijar_auditoria_fila).
      for (const set of [
        "firmante_nombre = 'Otra'",
        'pulso = 61',
        'version = 9',
        'es_tutor = true',
      ]) {
        expect(
          await intentar(c, `update app.anamnesis set ${set} where id = $1`, [anamnesisId]),
        ).toMatchObject(rechazo('42501'));
      }
    });
  });
});
