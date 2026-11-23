/** Grupo familiar (0020), como app_api: espejo, tipos inversos, uno por par, baja conjunta. */
import { randomUUID } from 'node:crypto';
import type { TipoRelacion } from '@conecta/shared';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { bajaRelacion, conContexto, crearRelacion, listarRelaciones } from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearPacienteDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, errorDe, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let clinica: ClinicaDePrueba;
let otra: ClinicaDePrueba;
let recepcionId: string;
let asistenteId: string;

beforeAll(async () => {
  [clinica, otra] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
  recepcionId = (await crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId })).usuarioId;
  asistenteId = (
    await crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId, rol: 'asistente' })
  ).usuarioId;
});

const paciente = async (sexo: 'F' | 'M' | null, nombres = 'Familiar'): Promise<string> =>
  (await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId, nombres, sexo })).pacienteId;

const comoRecepcion = <T>(fn: (c: pg.PoolClient) => Promise<T>, confirmar = false): Promise<T> =>
  enTransaccion(api, { clinica: clinica.clinicaId, usuario: recepcionId }, fn, { confirmar });

interface Fila {
  paciente_id: string;
  familiar_id: string;
  tipo: string;
  es_tutor_legal: boolean;
  es_responsable_pago: boolean;
  deleted_at: Date | null;
}

async function filasDelPar(c: pg.PoolClient, a: string, b: string): Promise<Fila[]> {
  const { rows } = await c.query<Fila>(
    `select paciente_id, familiar_id, tipo, es_tutor_legal, es_responsable_pago, deleted_at
     from app.paciente_relacion
     where (paciente_id, familiar_id) in (($1::uuid, $2::uuid), ($2::uuid, $1::uuid))
     order by created_at, (paciente_id = $1::uuid) desc`,
    [a, b],
  );
  return rows;
}

describe('espejo con el tipo inverso', () => {
  // [tipo pedido, sexo del paciente de la ficha, tipo que queda del otro lado]
  const casos: [TipoRelacion, 'F' | 'M' | null, TipoRelacion][] = [
    ['hijo', 'F', 'madre'],
    ['hijo', 'M', 'padre'],
    ['hijo', null, 'otro'],
    ['madre', 'M', 'hijo'],
    ['padre', 'F', 'hijo'],
    ['abuelo', 'F', 'nieto'],
    ['nieto', 'M', 'abuelo'],
    ['tutor', null, 'tutelado'],
    ['tutelado', 'F', 'tutor'],
    ['hermano', 'M', 'hermano'],
    ['pareja', 'F', 'pareja'],
    ['otro', null, 'otro'],
  ];

  it.each(casos)(
    '%s visto desde un paciente de sexo %s deja %s del otro lado',
    async (tipo, sexo, inverso) => {
      const p = await paciente(sexo);
      // El familiar: sexo compatible con el tipo pedido (madre F, padre M).
      const f = await paciente(tipo === 'madre' ? 'F' : tipo === 'padre' ? 'M' : null);
      await comoRecepcion(async (c) => {
        const id = await valor<string>(c, 'select app.crear_relacion($1, $2, $3, true, true)', [
          p,
          f,
          tipo,
        ]);
        const filas = await filasDelPar(c, p, f);
        expect(filas).toEqual([
          {
            paciente_id: p,
            familiar_id: f,
            tipo,
            es_tutor_legal: true,
            es_responsable_pago: true,
            deleted_at: null,
          },
          {
            paciente_id: f,
            familiar_id: p,
            tipo: inverso,
            es_tutor_legal: false,
            es_responsable_pago: false,
            deleted_at: null,
          },
        ]);
        expect(
          await valor(c, 'select paciente_id from app.paciente_relacion where id = $1', [id]),
        ).toBe(p);
      });
    },
  );

  it('crearRelacion devuelve la relación vista desde la ficha y listarRelaciones la muestra en los dos lados', async () => {
    const ana = (
      await crearPacienteDePrueba(admin, {
        clinicaId: clinica.clinicaId,
        nombres: 'Ana',
        apellidos: 'Giménez',
        sexo: 'F',
        fechaNac: '1992-05-14',
      })
    ).pacienteId;
    const mateo = (
      await crearPacienteDePrueba(admin, {
        clinicaId: clinica.clinicaId,
        nombres: 'Mateo',
        apellidos: 'Giménez',
        sexo: 'M',
        fechaNac: '2019-03-08',
      })
    ).pacienteId;
    const ahora = new Date('2026-11-22T12:00:00Z');
    await conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: recepcionId }, async (tx) => {
      const relacion = await crearRelacion(tx, {
        pacienteId: ana,
        familiarId: mateo,
        tipo: 'hijo',
        esTutorLegal: true,
        esResponsablePago: true,
      });
      expect(relacion).toMatchObject({
        familiar: { id: mateo, nombre: 'Mateo Giménez' },
        tipo: 'hijo',
        esTutorLegal: true,
        esResponsablePago: true,
        familiarEsTutorLegal: false,
        familiarEsResponsablePago: false,
      });
      // En la ficha de Mateo, Ana es su madre, su tutora legal y quien paga: las marcas se leen
      // desde los dos lados.
      const deMateo = await listarRelaciones(tx, mateo, { ahora });
      expect(deMateo).toEqual([
        {
          id: expect.any(String) as string,
          familiar: { id: ana, nombre: 'Ana Giménez', edad: 34 },
          tipo: 'madre',
          esTutorLegal: false,
          esResponsablePago: false,
          familiarEsTutorLegal: true,
          familiarEsResponsablePago: true,
        },
      ]);
      expect((await listarRelaciones(tx, ana, { ahora }))[0]?.familiar.edad).toBe(7);
      // La baja con el id de cualquiera de los dos lados da de baja el par.
      expect(await bajaRelacion(tx, deMateo[0]!.id)).toBe(true);
      expect(await listarRelaciones(tx, ana)).toEqual([]);
    });
  });
});

describe('reglas del vínculo', () => {
  it('uno activo por par (en cualquier sentido), nunca consigo mismo, nunca con otra clínica', async () => {
    const a = await paciente('F');
    const b = await paciente('M');
    const ajeno = (await crearPacienteDePrueba(admin, { clinicaId: otra.clinicaId })).pacienteId;
    await comoRecepcion(async (c) => {
      await c.query("select app.crear_relacion($1, $2, 'hermano')", [a, b]);
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'pareja')", [a, b]),
      ).toMatchObject(rechazo('23505', 'paciente_relacion_par_activo'));
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'hermano')", [b, a]),
      ).toMatchObject(rechazo('23505', 'paciente_relacion_par_activo'));
      expect(await intentar(c, "select app.crear_relacion($1, $1, 'otro')", [a])).toMatchObject(
        rechazo('23514', 'paciente_relacion_consigo_mismo'),
      );
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'otro')", [a, ajeno]),
      ).toMatchObject(rechazo('23503', 'paciente_relacion_familiar_fkey'));
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'otro')", [ajeno, a]),
      ).toMatchObject(rechazo('23503', 'paciente_relacion_paciente_fkey'));
      expect(await intentar(c, "select app.crear_relacion($1, $2, 'primo')", [a, b])).toMatchObject(
        rechazo('23514', 'paciente_relacion_tipo_check'),
      );
    });
  });

  it('dos sentidos incompatibles en la misma sentencia se rechazan; compatibles, se aceptan sin duplicar', async () => {
    const a = await paciente('F');
    const b = await paciente('M');
    const insertarAmbos = (t1: string, t2: string) =>
      `insert into app.paciente_relacion (clinica_id, paciente_id, familiar_id, tipo)
       values ($1, $2, $3, '${t1}'), ($1, $3, $2, '${t2}')`;
    await comoRecepcion(async (c) => {
      expect(
        await intentar(c, insertarAmbos('hermano', 'pareja'), [clinica.clinicaId, a, b]),
      ).toMatchObject(rechazo('23514', 'relacion_espejo_inconsistente'));
      expect(
        await intentar(c, insertarAmbos('padre', 'hijo'), [clinica.clinicaId, a, b]),
      ).toMatchObject({ ok: true, cantidad: 2 });
      expect(await filasDelPar(c, a, b)).toHaveLength(2);
    });
  });

  it('madre/padre tienen que coincidir con el sexo cargado del familiar', async () => {
    const p = await paciente(null);
    const varon = await paciente('M');
    const mujer = await paciente('F');
    const sinSexo = await paciente(null);
    await comoRecepcion(async (c) => {
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'madre')", [p, varon]),
      ).toMatchObject(rechazo('23514', 'relacion_tipo_sexo'));
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'padre')", [p, mujer]),
      ).toMatchObject(rechazo('23514', 'relacion_tipo_sexo'));
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'madre')", [p, sinSexo]),
      ).toMatchObject({ ok: true });
    });
  });

  it('tutor legal y responsable de pago valen en un solo sentido', async () => {
    const a = await paciente('F');
    const b = await paciente('M');
    await comoRecepcion(async (c) => {
      await c.query("select app.crear_relacion($1, $2, 'hijo', true, true)", [a, b]);
      for (const marca of ['es_tutor_legal', 'es_responsable_pago']) {
        expect(
          await intentar(
            c,
            `update app.paciente_relacion set ${marca} = true where paciente_id = $1 and familiar_id = $2`,
            [b, a],
          ),
        ).toMatchObject(rechazo('23514', 'relacion_marca_un_sentido'));
      }
      // Pasar la marca al otro sentido: primero se quita.
      await c.query(
        'update app.paciente_relacion set es_tutor_legal = false where paciente_id = $1 and familiar_id = $2',
        [a, b],
      );
      expect(
        await intentar(
          c,
          'update app.paciente_relacion set es_tutor_legal = true where paciente_id = $1 and familiar_id = $2',
          [b, a],
        ),
      ).toMatchObject({ ok: true, cantidad: 1 });
      // El tipo, los pacientes no cambian.
      for (const set of [
        "tipo = 'hermano'",
        'familiar_id = paciente_id',
        'paciente_id = familiar_id',
      ]) {
        expect(
          await intentar(
            c,
            `update app.paciente_relacion set ${set} where paciente_id = $1 and familiar_id = $2`,
            [a, b],
          ),
        ).toMatchObject({ ok: false, codigo: '42501' });
      }
    });
  });

  it('no se vincula un paciente inactivo', async () => {
    const a = await paciente('F');
    const inactivo = (
      await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId, activo: false })
    ).pacienteId;
    await comoRecepcion(async (c) => {
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'hermano')", [a, inactivo]),
      ).toMatchObject(rechazo('22023', 'relacion_paciente_inactivo'));
    });
  });

  it('pacientes:editar hace falta (asistente no vincula)', async () => {
    const a = await paciente('F');
    const b = await paciente('M');
    await enTransaccion(api, { clinica: clinica.clinicaId, usuario: asistenteId }, async (c) => {
      expect(
        await intentar(c, "select app.crear_relacion($1, $2, 'hermano')", [a, b]),
      ).toMatchObject(rechazo('42501', 'pacientes_sin_permiso'));
    });
  });
});

describe('baja', () => {
  it('da de baja los dos sentidos juntos, no se borra ni se reactiva, y se puede volver a vincular', async () => {
    const a = await paciente('F');
    const b = await paciente('M');
    const id = await comoRecepcion(
      (c) => valor<string>(c, "select app.crear_relacion($1, $2, 'hijo')", [a, b]),
      true,
    );
    await conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: recepcionId }, async (tx) => {
      expect(await bajaRelacion(tx, id, '  Cargado por error ')).toBe(true);
      expect(await bajaRelacion(tx, id)).toBe(false);
      expect(await listarRelaciones(tx, a)).toEqual([]);
      expect(await listarRelaciones(tx, b)).toEqual([]);
    });
    expect(
      await errorDe(
        conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: recepcionId }, (tx) =>
          bajaRelacion(tx, randomUUID()),
        ),
      ),
    ).toMatchObject({ codigo: 'P0002', restriccion: 'relacion_no_encontrada' });
    await comoRecepcion(async (c) => {
      const filas = await filasDelPar(c, a, b);
      expect(filas).toHaveLength(2);
      expect(filas.every((f) => f.deleted_at !== null)).toBe(true);
      const motivos = await c.query<{ motivo_baja: string | null }>(
        'select motivo_baja from app.paciente_relacion where paciente_id in ($1, $2)',
        [a, b],
      );
      expect(motivos.rows.map((f) => f.motivo_baja)).toEqual([
        'Cargado por error',
        'Cargado por error',
      ]);
      expect(
        await intentar(c, 'update app.paciente_relacion set deleted_at = null where id = $1', [id]),
      ).toMatchObject(rechazo('22023', 'relacion_dada_de_baja'));
      expect(
        await intentar(c, 'delete from app.paciente_relacion where id = $1', [id]),
      ).toMatchObject({ ok: false, codigo: '42501' });
      expect(await intentar(c, "select app.crear_relacion($1, $2, 'hijo')", [a, b])).toMatchObject({
        ok: true,
      });
      expect(await filasDelPar(c, a, b)).toHaveLength(4);
    });
    // Auditoría: alta y baja de cada sentido, módulo pacientes.
    await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => {
        const { rows } = await c.query<{ accion: string; modulo: string; n: number }>(
          `select a.accion, a.modulo, count(*)::int as n from app.audit_log a
         join app.paciente_relacion r on r.id = a.entidad_id
         where a.entidad = 'paciente_relacion' and r.paciente_id in ($1, $2)
         group by 1, 2 order by 1`,
          [a, b],
        );
        expect(rows).toEqual([
          { accion: 'anular', modulo: 'pacientes', n: 2 },
          { accion: 'crear', modulo: 'pacientes', n: 2 },
        ]);
      },
    );
  });
});
