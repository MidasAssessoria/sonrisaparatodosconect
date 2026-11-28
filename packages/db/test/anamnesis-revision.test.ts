/**
 * Revisión del Sprint 4 (0028–0030 corregidas): huella del cuestionario (con reemplazos y guardados
 * concurrentes), detalle de la alerta aparte y enmascarado por la base, «Ninguna» en una pregunta
 * obligatoria de opción múltiple, la firma (archivo) solo con ficha_clinica:ver y sin baja si está
 * en uso, y el tope de 500 preguntas. Cada prueba usa su propia clínica.
 */
import type { Pregunta } from '@conecta/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alertasMedicas,
  campoDeError,
  catalogoPreguntas,
  conContexto,
  guardarAnamnesis,
  obtenerPaciente,
  reemplazarPreguntas,
  type CampoDeError,
  type DatosAnamnesis,
} from '../src/index.js';
import {
  CLAVES_DE_PRUEBA,
  crearAnamnesisDePrueba,
  crearArchivoDePrueba,
  crearClinicaDePrueba,
  crearFirmaDePrueba,
  crearPacienteDePrueba,
  crearUsuarioDePrueba,
  urlCon,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 8);

type Rol = 'odontologo' | 'recepcion' | 'administracion';
interface Clinica {
  datos: ClinicaDePrueba;
  usuarios: Record<Rol, string>;
}

async function clinicaPropia(): Promise<Clinica> {
  const datos = await crearClinicaDePrueba(admin);
  const usuarios = {} as Record<Rol, string>;
  for (const rol of ['odontologo', 'recepcion', 'administracion'] as const) {
    usuarios[rol] = (
      await crearUsuarioDePrueba(admin, { clinicaId: datos.clinicaId, rol })
    ).usuarioId;
  }
  return { datos, usuarios };
}

function conApi<T>(c: Clinica, quien: Rol, fn: Parameters<typeof conContexto<T>>[2]): Promise<T> {
  return conContexto(api, { clinicaId: c.datos.clinicaId, usuarioId: c.usuarios[quien] }, fn);
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

async function datosPara(
  c: Clinica,
  pacienteId: string,
  extra: Partial<DatosAnamnesis> & { huellaCatalogo: string },
): Promise<DatosAnamnesis> {
  const { archivoId } = await crearFirmaDePrueba(admin, {
    clinicaId: c.datos.clinicaId,
    pacienteId,
  });
  return {
    versionBase: null,
    respuestas: [],
    firmante: { nombre: 'Paciente Revisión', ci: null, esTutor: false },
    firmaArchivoId: archivoId,
    declaracionVeracidad: true,
    ...extra,
  };
}

const conTexto = (preguntas: Pregunta[], codigo: string, texto: string): Pregunta[] =>
  preguntas.map((p) => (p.codigo === codigo ? { ...p, texto } : p));

// ---------------------------------------------------------------------------------------------
describe('huella del cuestionario', () => {
  let C: Clinica;
  beforeAll(async () => {
    C = await clinicaPropia();
  });

  it('identifica el cuestionario activo: estable si nada cambia, distinta con cualquier edición o activación', async () => {
    const inicial = await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx));
    expect(inicial.huella).toMatch(/^[0-9a-f]{64}$/);
    // La misma para el editor (con inactivas) y para administración sin ficha_clinica:ver.
    const editor = await conApi(C, 'administracion', (tx) =>
      catalogoPreguntas(tx, { incluirInactivas: true }),
    );
    expect(editor.huella).toBe(inicial.huella);
    // Reemplazar con lo mismo no la cambia.
    const igual = await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(tx, inicial.preguntas),
    );
    expect(igual.huella).toBe(inicial.huella);
    // Cambiar un texto, sí; y reemplazar devuelve la nueva.
    const otroTexto = await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(tx, conTexto(inicial.preguntas, 'motivo', '¿Por qué viene hoy?')),
    );
    expect(otroTexto.huella).not.toBe(inicial.huella);
    expect((await conApi(C, 'recepcion', (tx) => catalogoPreguntas(tx))).huella).toBe(
      otroTexto.huella,
    );
    // Desactivar una pregunta también.
    const sinCirugias = await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(
        tx,
        conTexto(inicial.preguntas, 'motivo', '¿Por qué viene hoy?').filter(
          (p) => p.codigo !== 'cirugias',
        ),
      ),
    );
    expect(new Set([inicial.huella, otroTexto.huella, sinCirugias.huella]).size).toBe(3);
    // Volver al cuestionario original vuelve a la huella original (es del contenido).
    const vuelta = await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(tx, inicial.preguntas),
    );
    expect(vuelta.huella).toBe(inicial.huella);
    // Una pregunta inactiva no cuenta: la huella de otra clínica con el mismo cuestionario activo es
    // la misma.
    const otra = await clinicaPropia();
    expect((await conApi(otra, 'odontologo', (tx) => catalogoPreguntas(tx))).huella).toBe(
      inicial.huella,
    );
  });

  it('guardar con la huella vieja: conflicto de catálogo (40001, huellaCatalogo), distinto del de versión', async () => {
    const p = (await crearPacienteDePrueba(admin, { clinicaId: C.datos.clinicaId })).pacienteId;
    const vieja = await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx));
    const nueva = await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(tx, conTexto(vieja.preguntas, 'sintoma', '¿Qué le molesta?')),
    );
    const d = await datosPara(C, p, { huellaCatalogo: vieja.huella });
    expect(await falla(conApi(C, 'odontologo', (tx) => guardarAnamnesis(tx, p, d)))).toEqual({
      codigoPg: '40001',
      restriccion: 'anamnesis_conflicto_catalogo',
      campo: 'huellaCatalogo',
      codigoPregunta: null,
    });
    for (const huellaCatalogo of ['', 'x'.repeat(128)]) {
      expect(
        await falla(
          conApi(C, 'odontologo', (tx) => guardarAnamnesis(tx, p, { ...d, huellaCatalogo })),
        ),
      ).toMatchObject({ restriccion: 'anamnesis_conflicto_catalogo' });
    }
    // Con las dos cosas desactualizadas, primero la versión.
    await crearAnamnesisDePrueba(admin, { clinicaId: C.datos.clinicaId, pacienteId: p });
    expect(await falla(conApi(C, 'odontologo', (tx) => guardarAnamnesis(tx, p, d)))).toMatchObject({
      restriccion: 'anamnesis_conflicto_version',
      campo: 'versionBase',
    });
    // Con la huella de ahora, pasa.
    expect(
      await conApi(C, 'odontologo', (tx) =>
        guardarAnamnesis(tx, p, { ...d, versionBase: 1, huellaCatalogo: nueva.huella }),
      ),
    ).toMatchObject({ version: 2 });
    // Vuelve el cuestionario original.
    await conApi(C, 'administracion', (tx) => reemplazarPreguntas(tx, vieja.preguntas));
  });

  it('un guardado espera al reemplazo en curso y ve su huella; un reemplazo espera al guardado en curso', async () => {
    const p = (await crearPacienteDePrueba(admin, { clinicaId: C.datos.clinicaId })).pacienteId;
    const actual = await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx));
    const cambiado = conTexto(actual.preguntas, 'cepillado', '¿Cómo se cepilla?');
    const d1 = await datosPara(C, p, { huellaCatalogo: actual.huella });
    const fijar = async (cliente: pg.PoolClient, usuario: string) => {
      await cliente.query('begin');
      await cliente.query(
        "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
        [C.datos.clinicaId, usuario],
      );
    };
    const guardarSql = (cliente: pg.PoolClient, d: DatosAnamnesis) =>
      cliente.query(
        `select * from app.guardar_anamnesis($1, $2, $3, $4::jsonb, $5, null, false, $6, true)`,
        [p, d.versionBase, d.huellaCatalogo, '[]', d.firmante.nombre, d.firmaArchivoId],
      );
    const c1 = await api.connect();
    const c2 = await api.connect();
    try {
      // 1. Reemplazo sin confirmar; el guardado con la huella de antes espera y, al confirmarse el
      //    reemplazo, recibe el conflicto de catálogo.
      await fijar(c1, C.usuarios.administracion);
      await fijar(c2, C.usuarios.odontologo);
      await c1.query('select app.reemplazar_preguntas_anamnesis($1::jsonb)', [
        JSON.stringify(cambiado),
      ]);
      let termino = false;
      const guardado = guardarSql(c2, d1).then(
        () => {
          termino = true;
          return null;
        },
        (e: unknown) => {
          termino = true;
          return campoDeError(e);
        },
      );
      await new Promise((listo) => setTimeout(listo, 300));
      expect(termino).toBe(false);
      await c1.query('commit');
      expect(await guardado).toMatchObject({ restriccion: 'anamnesis_conflicto_catalogo' });
      await c2.query('rollback');

      // 2. Guardado sin confirmar (con la huella nueva); el reemplazo espera a que termine.
      const nueva = await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx));
      const d2 = await datosPara(C, p, { huellaCatalogo: nueva.huella });
      await fijar(c1, C.usuarios.odontologo);
      await fijar(c2, C.usuarios.administracion);
      expect((await guardarSql(c1, d2)).rows[0]).toMatchObject({ version: 1 });
      let reemplazado = false;
      const reemplazo = c2
        .query('select app.reemplazar_preguntas_anamnesis($1::jsonb)', [
          JSON.stringify(actual.preguntas),
        ])
        .then(() => {
          reemplazado = true;
        });
      await new Promise((listo) => setTimeout(listo, 300));
      expect(reemplazado).toBe(false);
      await c1.query('commit');
      await reemplazo;
      await c2.query('commit');
      // La versión se guardó con el cuestionario que vio (el de «¿Cómo se cepilla?»), y el catálogo
      // quedó como el original.
      expect((await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx))).huella).toBe(
        actual.huella,
      );
    } finally {
      await c1.query('rollback').catch(() => undefined);
      await c2.query('rollback').catch(() => undefined);
      c1.release();
      c2.release();
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('«Ninguna» y detalle de la alerta', () => {
  let C: Clinica;
  beforeAll(async () => {
    C = await clinicaPropia();
    const { preguntas } = await conApi(C, 'administracion', (tx) => catalogoPreguntas(tx));
    await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(
        tx,
        preguntas.map((p) => (p.codigo === 'alergias' ? { ...p, obligatoria: true } : p)),
      ),
    );
  });

  it('en una obligatoria de opción múltiple, opciones: [] («Ninguna») cuenta como respondida; no mandarla, no', async () => {
    const p = (await crearPacienteDePrueba(admin, { clinicaId: C.datos.clinicaId })).pacienteId;
    const { huella } = await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx));
    const sinResponder = await datosPara(C, p, { huellaCatalogo: huella });
    expect(
      await falla(conApi(C, 'odontologo', (tx) => guardarAnamnesis(tx, p, sinResponder))),
    ).toMatchObject({
      restriccion: 'anamnesis_obligatoria_sin_responder',
      codigoPregunta: 'alergias',
    });
    const ninguna = await datosPara(C, p, {
      huellaCatalogo: huella,
      respuestas: [{ codigo: 'alergias', opciones: [] }],
    });
    expect(await conApi(C, 'odontologo', (tx) => guardarAnamnesis(tx, p, ninguna))).toMatchObject({
      version: 1,
    });
    expect(await conApi(C, 'recepcion', (tx) => alertasMedicas(tx, p))).toEqual([]);
  });

  it('el texto de la alerta va sin el detalle; el detalle solo con ficha_clinica:ver, también por SQL directo', async () => {
    const p = (await crearPacienteDePrueba(admin, { clinicaId: C.datos.clinicaId })).pacienteId;
    const { huella } = await conApi(C, 'odontologo', (tx) => catalogoPreguntas(tx));
    const d = await datosPara(C, p, {
      huellaCatalogo: huella,
      respuestas: [
        {
          codigo: 'alergias',
          opciones: ['penicilina', 'latex'],
          detalle: ' urticaria con amoxicilina. ',
        },
      ],
    });
    await conApi(C, 'odontologo', (tx) => guardarAnamnesis(tx, p, d));
    expect(await conApi(C, 'odontologo', (tx) => alertasMedicas(tx, p))).toEqual([
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia a la penicilina',
        detalle: 'urticaria con amoxicilina',
        gravedad: 'alta',
        grupoAlergia: 'penicilina',
      },
      {
        codigo: 'alergias',
        tipo: 'alergia',
        texto: 'Alergia al látex',
        detalle: 'urticaria con amoxicilina',
        gravedad: 'alta',
        grupoAlergia: 'latex',
      },
    ]);
    const ficha = await conApi(C, 'recepcion', (tx) => obtenerPaciente(tx, p));
    expect(ficha?.alertasMedicas.map((a) => [a.texto, a.detalle])).toEqual([
      ['Alergia a la penicilina', null],
      ['Alergia al látex', null],
    ]);
    await enTransaccion(
      api,
      { clinica: C.datos.clinicaId, usuario: C.usuarios.recepcion },
      async (c) => {
        const { rows } = await c.query('select texto, detalle from app.alertas_medicas($1)', [p]);
        expect(rows).toEqual([
          { texto: 'Alergia a la penicilina', detalle: null },
          { texto: 'Alergia al látex', detalle: null },
        ]);
        // Ni buscándolo en las alertas ni en las respuestas.
        expect(
          await valor(
            c,
            `select count(*)::int from app.anamnesis_alerta a where to_jsonb(a)::text ilike '%amoxicilina%'`,
          ),
        ).toBe(0);
        expect(await valor(c, 'select count(*)::int from app.anamnesis_respuesta')).toBe(0);
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('archivo de la firma', () => {
  let C: Clinica;
  let worker: pg.Pool;
  beforeAll(async () => {
    C = await clinicaPropia();
    // Como en test/cola.test.ts: LOGIN de app_worker fuera de las migraciones, clave fija.
    await admin.query(`alter role app_worker login password '${CLAVES_DE_PRUEBA.worker}'`);
    worker = new pg.Pool({
      connectionString: urlCon(urls().urlApi, {
        usuario: 'app_worker',
        clave: CLAVES_DE_PRUEBA.worker,
      }),
      max: 1,
    });
    worker.on('error', () => undefined);
  });
  afterAll(async () => {
    await worker.end();
  });

  it('solo con ficha_clinica:ver (y el worker) se ve; la de una anamnesis no se da de baja ni cambia', async () => {
    const p = (await crearPacienteDePrueba(admin, { clinicaId: C.datos.clinicaId })).pacienteId;
    const { firmaArchivoId: usada } = await crearAnamnesisDePrueba(admin, {
      clinicaId: C.datos.clinicaId,
      pacienteId: p,
    });
    const { archivoId: libre } = await crearFirmaDePrueba(admin, {
      clinicaId: C.datos.clinicaId,
      pacienteId: p,
    });
    const { archivoId: logo } = await crearArchivoDePrueba(admin, { clinicaId: C.datos.clinicaId });
    const ver = (quien: Rol) =>
      enTransaccion(api, { clinica: C.datos.clinicaId, usuario: C.usuarios[quien] }, async (c) => {
        const { rows } = await c.query<{ id: string }>('select id from app.archivo order by id');
        return rows.map((f) => f.id).sort();
      });
    expect(await ver('odontologo')).toEqual([usada, libre, logo].sort());
    expect(await ver('recepcion')).toEqual([logo]);
    expect(await ver('administracion')).toEqual([logo]);
    // El worker lee con la clínica del trabajo y sin usuario: también la firma (para verificarla).
    await enTransaccion(worker, { clinica: C.datos.clinicaId }, async (c) => {
      expect(await valor(c, 'select count(*)::int from app.archivo where id = $1', [usada])).toBe(
        1,
      );
    });
    // Recepción no la alcanza ni para darla de baja.
    await enTransaccion(
      api,
      { clinica: C.datos.clinicaId, usuario: C.usuarios.recepcion },
      async (c) => {
        expect(
          await intentar(
            c,
            "update app.archivo set deleted_at = now(), motivo_baja = 'x' where id = $1",
            [usada],
          ),
        ).toMatchObject({ ok: true, cantidad: 0 });
      },
    );
    await enTransaccion(
      api,
      { clinica: C.datos.clinicaId, usuario: C.usuarios.odontologo },
      async (c) => {
        expect(
          await intentar(
            c,
            "update app.archivo set deleted_at = now(), motivo_baja = 'x' where id = $1",
            [usada],
          ),
        ).toMatchObject(rechazo('23514', 'archivo_firma_en_uso'));
        for (const set of [
          "ruta = ruta || 'x'",
          "sha256 = repeat('b', 64)",
          'paciente_id = null',
        ]) {
          expect(
            await intentar(c, `update app.archivo set ${set} where id = $1`, [usada]),
          ).toMatchObject(rechazo('42501'));
        }
        // Una firma que no se usó sí se puede dar de baja.
        expect(
          await intentar(
            c,
            "update app.archivo set deleted_at = now(), motivo_baja = 'Trazo fallido' where id = $1",
            [libre],
          ),
        ).toMatchObject({ ok: true, cantidad: 1 });
      },
    );
    // Ni el dueño de las tablas da de baja una firma en uso.
    await enTransaccion(admin, { clinica: C.datos.clinicaId }, async (c) => {
      expect(
        await intentar(
          c,
          "update app.archivo set deleted_at = now(), motivo_baja = 'x' where id = $1",
          [usada],
        ),
      ).toMatchObject(rechazo('23514', 'archivo_firma_en_uso'));
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('tope del cuestionario', () => {
  it('hasta 500 preguntas por pedido y en total, contando las inactivas', async () => {
    const C = await clinicaPropia();
    const { preguntas } = await conApi(C, 'administracion', (tx) => catalogoPreguntas(tx));
    const extra = (prefijo: string, n: number): Pregunta[] =>
      Array.from({ length: n }, (_, i) => ({
        codigo: `${prefijo}_${i}`,
        seccion: 5,
        orden: 500,
        texto: `Pregunta ${prefijo} ${i}`,
        tipo: 'texto' as const,
        opciones: [],
        alertaSiSi: null,
        conDetalle: false,
        unidad: null,
        minimo: null,
        maximo: null,
        soloSexo: null,
        obligatoria: false,
        activa: true,
      }));
    // 19 + 481 = 500: entra justo.
    const lleno = await conApi(C, 'administracion', (tx) =>
      reemplazarPreguntas(tx, [...preguntas, ...extra('a', 481)]),
    );
    expect(lleno.preguntas).toHaveLength(500);
    // Una nueva más (aunque las 481 queden inactivas) pasaría de 500 en total.
    expect(
      await falla(
        conApi(C, 'administracion', (tx) =>
          reemplazarPreguntas(tx, [...preguntas, ...extra('b', 1)]),
        ),
      ),
    ).toMatchObject({
      codigoPg: '22023',
      restriccion: 'anamnesis_catalogo_lleno',
      campo: 'preguntas',
    });
    // 501 en el pedido.
    expect(
      await falla(
        conApi(C, 'administracion', (tx) =>
          reemplazarPreguntas(tx, [...preguntas, ...extra('a', 481), ...extra('c', 1)]),
        ),
      ),
    ).toMatchObject({ restriccion: 'anamnesis_catalogo_invalido', campo: 'preguntas' });
    // Nada cambió.
    expect(
      (await conApi(C, 'administracion', (tx) => catalogoPreguntas(tx, { incluirInactivas: true })))
        .preguntas,
    ).toHaveLength(500);
  });
});
