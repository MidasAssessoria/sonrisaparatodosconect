/**
 * Anamnesis, pasada adversarial como app_api: otra clínica en el contexto, pacientes y firmas
 * ajenas, entradas malformadas, versiones viejas y, en una base aparte, una función SECURITY
 * DEFINER que intenta editar lo firmado. También: el cuestionario llega a las clínicas que ya
 * existían antes de 0028.
 */
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  alertasMedicas,
  campoDeError,
  conContexto,
  DIRECTORIO_MIGRACIONES,
  guardarAnamnesis,
  historialPaciente,
  migrar,
  type DatosAnamnesis,
} from '../src/index.js';
import {
  crearAnamnesisDePrueba,
  crearBaseVacia,
  crearClinicaDePrueba,
  crearFirmaDePrueba,
  crearPacienteDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;
let odontologoA: string;
let recepcionA: string;
let odontologoB: string;
let pacienteA: string;
let pacienteB: string;

beforeAll(async () => {
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
  odontologoA = (await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId, rol: 'odontologo' }))
    .usuarioId;
  recepcionA = (await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId, rol: 'recepcion' }))
    .usuarioId;
  odontologoB = (await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId, rol: 'odontologo' }))
    .usuarioId;
  pacienteA = (await crearPacienteDePrueba(admin, { clinicaId: A.clinicaId, sexo: 'F' }))
    .pacienteId;
  pacienteB = (await crearPacienteDePrueba(admin, { clinicaId: B.clinicaId, sexo: 'F' }))
    .pacienteId;
  await crearAnamnesisDePrueba(admin, {
    clinicaId: B.clinicaId,
    pacienteId: pacienteB,
    respuestas: [{ codigo: 'alergias', opciones: ['penicilina'] }],
  });
});

const SQL_GUARDAR = `select * from app.guardar_anamnesis($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`;

/** Llama a guardar_anamnesis crudo como app_api con un contexto cualquiera (se revierte). */
function guardarCrudo(
  contexto: { clinica?: string | null; usuario?: string | null },
  parametros: unknown[],
) {
  return enTransaccion(api, contexto, (c) => intentar(c, SQL_GUARDAR, parametros));
}

describe('pasada adversarial como app_api', () => {
  it('con la clínica de otro en el contexto no se guarda ni se reemplaza nada', async () => {
    const f = (await crearFirmaDePrueba(admin, { clinicaId: A.clinicaId, pacienteId: pacienteA }))
      .archivoId;
    // Un usuario de B que fija la clínica A: no tiene membresía ahí.
    const ctx = { clinica: A.clinicaId, usuario: odontologoB };
    expect(
      await guardarCrudo(ctx, [pacienteA, null, '[]', 'Ana Ana', null, false, f, true]),
    ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
    await enTransaccion(api, ctx, async (c) => {
      expect(
        await intentar(c, `select app.reemplazar_preguntas_anamnesis('[{"codigo":"x_x"}]'::jsonb)`),
      ).toMatchObject(rechazo('42501', 'configuracion_sin_permiso'));
      // Sin permisos en A, la auditoría no le muestra nada: el historial sale vacío.
      expect(
        await valor(c, 'select count(*)::int from app.historial_paciente($1)', [pacienteA]),
      ).toBe(0);
    });
    // Sin contexto o con contexto inválido.
    for (const contexto of [{}, { clinica: 'no-es-uuid', usuario: odontologoA }]) {
      expect(
        await guardarCrudo(contexto, [pacienteA, null, '[]', 'Ana Ana', null, false, f, true]),
      ).toMatchObject(rechazo('42501'));
    }
  });

  it('paciente y firma de otra clínica: no existen', async () => {
    const ctx = { clinica: A.clinicaId, usuario: odontologoA };
    const fB = (await crearFirmaDePrueba(admin, { clinicaId: B.clinicaId, pacienteId: pacienteB }))
      .archivoId;
    const fA = (await crearFirmaDePrueba(admin, { clinicaId: A.clinicaId, pacienteId: pacienteA }))
      .archivoId;
    expect(
      await guardarCrudo(ctx, [pacienteB, null, '[]', 'Ana Ana', null, false, fA, true]),
    ).toMatchObject(rechazo('P0002', 'paciente_no_encontrado'));
    expect(
      await guardarCrudo(ctx, [pacienteA, null, '[]', 'Ana Ana', null, false, fB, true]),
    ).toMatchObject(rechazo('22023', 'anamnesis_firma_invalida'));
    await conContexto(api, { clinicaId: A.clinicaId, usuarioId: odontologoA }, async (tx) => {
      expect(await alertasMedicas(tx, pacienteB)).toEqual([]);
      expect(await historialPaciente(tx, pacienteB)).toEqual({
        eventos: [],
        siguienteCursor: null,
      });
    });
    await enTransaccion(api, ctx, async (c) => {
      for (const tabla of [
        'anamnesis',
        'anamnesis_respuesta',
        'anamnesis_alerta',
        'anamnesis_pregunta',
      ]) {
        expect(
          await valor(c, `select count(*)::int from app.${tabla} where clinica_id = $1`, [
            B.clinicaId,
          ]),
        ).toBe(0);
      }
    });
  });

  it('entradas malformadas: errores claros con el campo, nunca un 500 ni datos a medias', async () => {
    const ctx = { clinica: A.clinicaId, usuario: odontologoA };
    const f = (await crearFirmaDePrueba(admin, { clinicaId: A.clinicaId, pacienteId: pacienteA }))
      .archivoId;
    const intento = async (respuestas: string, otros: unknown[] = []) => {
      const parametros: unknown[] = [pacienteA, null, respuestas, 'Ana Ana', null, false, f, true];
      otros.forEach((v, i) => (parametros[i + 3] = v));
      return enTransaccion(api, ctx, async (c) => {
        await c.query('SAVEPOINT x');
        try {
          await c.query(SQL_GUARDAR, parametros);
          return null;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT x');
          return campoDeError(error);
        }
      });
    };
    expect(await intento('{}')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      campo: 'respuestas',
    });
    expect(await intento('[1]')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      campo: 'respuestas',
    });
    expect(await intento('[{"codigo": 5}]')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
    });
    expect(
      await intento(JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ codigo: `c${i}` })))),
    ).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
    });
    expect(await intento(`[{"codigo": "alergias' or '1'='1", "si": true}]`)).toMatchObject({
      restriccion: 'anamnesis_pregunta_desconocida',
      codigoPregunta: null,
    });
    expect(await intento('[{"codigo": "protesis", "si": "true"}]')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      codigoPregunta: 'protesis',
    });
    expect(
      await intento('[{"codigo": "protesis", "si": true, "alerta": {"texto": "Falsa"}}]'),
    ).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      codigoPregunta: 'protesis',
    });
    expect(await intento('[{"codigo": "alergias", "opciones": [1, 2]}]')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      codigoPregunta: 'alergias',
    });
    expect(await intento('[{"codigo": "alergias", "opciones": "penicilina"}]')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      codigoPregunta: 'alergias',
    });
    expect(await intento('[{"codigo": "motivo", "texto": "x", "detalle": 5}]')).toMatchObject({
      restriccion: 'anamnesis_respuesta_invalida',
      codigoPregunta: 'motivo',
    });
    // Firmante: nombre larguísimo, CI con letras, tutor null en un adulto (vale como «no»).
    expect(await intento('[]', ['x'.repeat(121)])).toMatchObject({
      restriccion: 'anamnesis_firmante_nombre',
    });
    expect(await intento('[]', ['Ana Ana', '12a456'])).toMatchObject({
      restriccion: 'anamnesis_firmante_ci',
    });
    expect(await intento('[]', ['Ana Ana', null, null, null])).toMatchObject({
      restriccion: 'anamnesis_sin_firma',
    });
    expect(await intento('[]', ['Ana Ana', null, null, f, null])).toMatchObject({
      restriccion: 'anamnesis_sin_declaracion',
    });
    // versionBase 0 no es «sin versión».
    expect(
      await enTransaccion(api, ctx, (c) =>
        intentar(c, SQL_GUARDAR, [pacienteA, 0, '[]', 'Ana Ana', null, false, f, true]),
      ),
    ).toMatchObject(rechazo('40001', 'anamnesis_conflicto_version'));
    // Y nada quedó guardado.
    await enTransaccion(api, ctx, async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.anamnesis where paciente_id = $1', [
          pacienteA,
        ]),
      ).toBe(0);
    });
  });

  it('las alertas de una versión vieja no se recuperan como recepción, ni filtrando', async () => {
    const p = (await crearPacienteDePrueba(admin, { clinicaId: A.clinicaId })).pacienteId;
    await crearAnamnesisDePrueba(admin, {
      clinicaId: A.clinicaId,
      pacienteId: p,
      respuestas: [{ codigo: 'medicacion', opciones: ['anticoagulantes'] }],
    });
    await crearAnamnesisDePrueba(admin, { clinicaId: A.clinicaId, pacienteId: p });
    await enTransaccion(api, { clinica: A.clinicaId, usuario: recepcionA }, async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.anamnesis_alerta where not vigente'),
      ).toBe(0);
      expect(
        await valor(c, 'select count(*)::int from app.anamnesis_alerta where paciente_id = $1', [
          p,
        ]),
      ).toBe(0);
      // Ni por la auditoría.
      expect(
        await valor(
          c,
          "select count(*)::int from app.audit_log where despues ->> 'texto' = 'Anticoagulantes'",
        ),
      ).toBe(0);
    });
    await enTransaccion(api, { clinica: A.clinicaId, usuario: odontologoA }, async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.anamnesis_alerta where paciente_id = $1', [
          p,
        ]),
      ).toBe(1);
    });
  });

  it('un guardado válido mínimo pasa (prueba de la prueba)', async () => {
    const f = (await crearFirmaDePrueba(admin, { clinicaId: A.clinicaId, pacienteId: pacienteA }))
      .archivoId;
    const datos: DatosAnamnesis = {
      versionBase: null,
      respuestas: [],
      firmante: { nombre: 'Ana Ana', ci: null, esTutor: false },
      firmaArchivoId: f,
      declaracionVeracidad: true,
    };
    const r = await conContexto(api, { clinicaId: A.clinicaId, usuarioId: odontologoA }, (tx) =>
      guardarAnamnesis(tx, pacienteA, datos),
    );
    expect(r.version).toBe(1);
  });
});

describe('base aparte: clínicas anteriores a 0028 y funciones SECURITY DEFINER', () => {
  it('el cuestionario llega a las clínicas existentes y lo firmado no se edita ni desde una función del dueño', async () => {
    const base = await crearBaseVacia(urls());
    const adminTmp = new pg.Pool({ connectionString: base.urlAdmin, max: 2 });
    const apiTmp = new pg.Pool({ connectionString: base.urlApi, max: 2 });
    const directorio = await mkdtemp(path.join(tmpdir(), 'conecta-0027-'));
    try {
      // Hasta 0027, una clínica; después, el resto de las migraciones.
      for (const nombre of await readdir(DIRECTORIO_MIGRACIONES)) {
        if (/^00(0\d|1\d|2[0-7])_.*\.sql$/.test(nombre)) {
          await copyFile(path.join(DIRECTORIO_MIGRACIONES, nombre), path.join(directorio, nombre));
        }
      }
      await migrar(base.urlAdmin, { directorio });
      const vieja = await crearClinicaDePrueba(adminTmp);
      await migrar(base.urlAdmin);
      await enTransaccion(adminTmp, { clinica: vieja.clinicaId }, async (c) => {
        expect(
          await valor(
            c,
            'select count(*)::int from app.anamnesis_pregunta where clinica_id = $1 and activa',
            [vieja.clinicaId],
          ),
        ).toBe(19);
        expect(
          await valor(
            c,
            `select count(*)::int from app.audit_log
             where entidad = 'anamnesis_pregunta' and accion = 'crear' and usuario_id is null`,
          ),
        ).toBe(19);
      });

      const odontologo = (
        await crearUsuarioDePrueba(adminTmp, { clinicaId: vieja.clinicaId, rol: 'odontologo' })
      ).usuarioId;
      const recepcion = (await crearUsuarioDePrueba(adminTmp, { clinicaId: vieja.clinicaId }))
        .usuarioId;
      const p = (await crearPacienteDePrueba(adminTmp, { clinicaId: vieja.clinicaId })).pacienteId;
      const v1 = await crearAnamnesisDePrueba(adminTmp, {
        clinicaId: vieja.clinicaId,
        pacienteId: p,
        respuestas: [{ codigo: 'alergias', opciones: ['latex'] }],
      });
      await crearAnamnesisDePrueba(adminTmp, { clinicaId: vieja.clinicaId, pacienteId: p });

      await enTransaccion(
        adminTmp,
        {},
        async (c) => {
          await c.query(`
            create function app.prueba_tocar(p_id uuid, p_cual text) returns void
              language plpgsql security definer set search_path = pg_catalog, pg_temp
            as $$
            begin
              if p_cual = 'anamnesis' then
                update app.anamnesis set created_at = created_at where id = p_id;
              elsif p_cual = 'respuesta' then
                update app.anamnesis_respuesta set created_at = created_at where anamnesis_id = p_id;
              elsif p_cual = 'vigente' then
                update app.anamnesis_alerta set vigente = true where anamnesis_id = p_id;
              elsif p_cual = 'borrar' then
                delete from app.anamnesis where id = p_id;
              elsif p_cual = 'pregunta' then
                update app.anamnesis_pregunta set texto = 'Cambiada a escondidas' where codigo = 'motivo';
              end if;
            end $$`);
          await c.query('grant execute on function app.prueba_tocar(uuid, text) to app_api');
        },
        { confirmar: true },
      );
      const llamar = (usuario: string, cual: string) =>
        enTransaccion(apiTmp, { clinica: vieja.clinicaId, usuario }, (c) =>
          intentar(c, 'select app.prueba_tocar($1, $2)', [v1.anamnesisId, cual]),
        );
      // La función corre como el dueño de las tablas, pero la sesión es app_api.
      expect(await llamar(odontologo, 'anamnesis')).toMatchObject(
        rechazo('42501', 'anamnesis_inmutable'),
      );
      expect(await llamar(odontologo, 'respuesta')).toMatchObject(
        rechazo('42501', 'anamnesis_inmutable'),
      );
      expect(await llamar(odontologo, 'vigente')).toMatchObject(
        rechazo('42501', 'anamnesis_inmutable'),
      );
      // Recepción ni siquiera ve las alertas viejas: el UPDATE no alcanza ninguna fila.
      expect(await llamar(recepcion, 'vigente')).toMatchObject({ ok: true });
      expect(await llamar(recepcion, 'anamnesis')).toMatchObject(
        rechazo('42501', 'anamnesis_inmutable'),
      );
      await enTransaccion(adminTmp, { clinica: vieja.clinicaId }, async (c) => {
        expect(
          await valor(
            c,
            'select count(*)::int from app.anamnesis_alerta where anamnesis_id = $1 and vigente',
            [v1.anamnesisId],
          ),
        ).toBe(0);
      });
      expect(await llamar(odontologo, 'borrar')).toMatchObject(rechazo('42501'));
      expect(await llamar(odontologo, 'pregunta')).toMatchObject(
        rechazo('42501', 'configuracion_sin_permiso'),
      );
      // Prueba de la prueba: desde una sesión del dueño de las tablas, el UPDATE sin cambios pasa.
      expect(
        await enTransaccion(adminTmp, { clinica: vieja.clinicaId, usuario: '' }, (c) =>
          intentar(c, "select app.prueba_tocar($1, 'anamnesis')", [v1.anamnesisId]),
        ),
      ).toMatchObject({ ok: true });
    } finally {
      await apiTmp.end();
      await adminTmp.end();
      await base.eliminar();
      await rm(directorio, { recursive: true, force: true });
    }
  });
});
