/**
 * Profesionales (0011): disponibilidad sin superposición el mismo día aunque sea en sedes distintas
 * (también con dos transacciones simultáneas), sillón de esa sede, membresía de la misma clínica, a lo
 * sumo un profesional por membresía, tramos y bloqueos inmutables salvo la baja. Como app_api.
 */
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { conContexto, crearPool, listarPersonal } from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearProfesionalDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin, 6);
const api = nuevoPool(urls().urlApi, 6);
const poolApi = crearPool(urls().urlApi, { max: 3 });

interface Clinica extends ClinicaDePrueba {
  centro: { sedeId: string; sillonId: string };
  norte: { sedeId: string; sillonId: string };
}

let A: Clinica;
let B: Clinica;

async function preparar(): Promise<Clinica> {
  const clinica = await crearClinicaDePrueba(admin);
  const [centro, norte] = await Promise.all([
    crearSedeDePrueba(admin, clinica.clinicaId),
    crearSedeDePrueba(admin, clinica.clinicaId),
  ]);
  return { ...clinica, centro, norte };
}

beforeAll(async () => {
  [A, B] = await Promise.all([preparar(), preparar()]);
  return () => poolApi.end();
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, fn);

const SQL_TRAMO = `insert into app.profesional_disponibilidad
  (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin, sillon_id)
  values ($1, $2, $3, $4, $5, $6, $7) returning id`;

describe('disponibilidad', () => {
  it('no se pisan dos tramos activos del mismo profesional el mismo día, aunque sean en sedes distintas', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    const otro = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    await comoA(async (c) => {
      const tramo = (
        sede: string,
        dia: number,
        desde: string,
        hasta: string,
        profesional = profesionalId,
      ) => intentar(c, SQL_TRAMO, [A.clinicaId, profesional, sede, dia, desde, hasta, null]);
      expect(await tramo(A.centro.sedeId, 1, '08:00', '12:00')).toMatchObject({ ok: true });
      for (const [sede, desde, hasta] of [
        [A.norte.sedeId, '11:00', '13:00'],
        [A.centro.sedeId, '09:00', '10:00'],
        [A.norte.sedeId, '07:00', '08:01'],
        [A.norte.sedeId, '06:00', '20:00'],
      ] as const) {
        expect({ sede, desde, r: await tramo(sede, 1, desde, hasta) }).toMatchObject({
          sede,
          desde,
          r: rechazo('23P01', 'profesional_disponibilidad_superpuesta'),
        });
      }
      // Contiguos, otro día, u otro profesional a la misma hora: sí.
      expect(await tramo(A.norte.sedeId, 1, '12:00', '14:00')).toMatchObject({ ok: true });
      expect(await tramo(A.norte.sedeId, 2, '08:00', '12:00')).toMatchObject({ ok: true });
      expect(await tramo(A.centro.sedeId, 1, '08:00', '12:00', otro.profesionalId)).toMatchObject({
        ok: true,
      });
    });
  });

  it('un tramo desactivado no bloquea: reemplazar la disponibilidad es desactivar y crear', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    await comoA(async (c) => {
      await c.query(SQL_TRAMO, [
        A.clinicaId,
        profesionalId,
        A.centro.sedeId,
        3,
        '08:00',
        '12:00',
        null,
      ]);
      await c.query(
        'update app.profesional_disponibilidad set activo = false where profesional_id = $1 and activo',
        [profesionalId],
      );
      expect(
        await intentar(c, SQL_TRAMO, [
          A.clinicaId,
          profesionalId,
          A.norte.sedeId,
          3,
          '10:00',
          '14:00',
          null,
        ]),
      ).toMatchObject({ ok: true });
      // Reactivar el viejo ahora sí choca.
      expect(
        await intentar(
          c,
          `update app.profesional_disponibilidad set activo = true
           where profesional_id = $1 and not activo`,
          [profesionalId],
        ),
      ).toMatchObject(rechazo('23P01', 'profesional_disponibilidad_superpuesta'));
    });
  });

  it('dos transacciones simultáneas con tramos que se pisan en sedes distintas: pasa una sola', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    const uno = await api.connect();
    const dos = await api.connect();
    try {
      for (const cliente of [uno, dos]) {
        await cliente.query('BEGIN');
        await cliente.query("set local lock_timeout = '5s'");
        await cliente.query(
          "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
          [A.clinicaId, A.duenoId],
        );
      }
      await uno.query(SQL_TRAMO, [
        A.clinicaId,
        profesionalId,
        A.centro.sedeId,
        4,
        '08:00',
        '12:00',
        null,
      ]);
      const segunda = dos
        .query(SQL_TRAMO, [A.clinicaId, profesionalId, A.norte.sedeId, 4, '10:00', '11:00', null])
        .then(
          () => null,
          (e: unknown) => e as { code?: string; constraint?: string },
        );
      await new Promise((r) => setTimeout(r, 300));
      await uno.query('COMMIT');
      expect(await segunda).toMatchObject({
        code: '23P01',
        constraint: 'profesional_disponibilidad_superpuesta',
      });
      await dos.query('ROLLBACK');
    } finally {
      await uno.query('ROLLBACK').catch(() => undefined);
      await dos.query('ROLLBACK').catch(() => undefined);
      uno.release();
      dos.release();
    }
    const activos = await enTransaccion(admin, { clinica: A.clinicaId }, (c) =>
      valor<number>(
        c,
        'select count(*)::int from app.profesional_disponibilidad where profesional_id = $1 and activo',
        [profesionalId],
      ),
    );
    expect(activos).toBe(1);
  });

  it('el sillón tiene que ser de esa sede (y de esa clínica); la sede, de la clínica', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    await comoA(async (c) => {
      const tramo = (sede: string, sillon: string | null) =>
        intentar(c, SQL_TRAMO, [A.clinicaId, profesionalId, sede, 5, '08:00', '09:00', sillon]);
      expect(await tramo(A.centro.sedeId, A.norte.sillonId)).toMatchObject(
        rechazo('23503', 'profesional_disponibilidad_sillon_fkey'),
      );
      expect(await tramo(A.centro.sedeId, B.centro.sillonId)).toMatchObject(
        rechazo('23503', 'profesional_disponibilidad_sillon_fkey'),
      );
      expect(await tramo(B.centro.sedeId, null)).toMatchObject(
        rechazo('23503', 'profesional_disponibilidad_sede_fkey'),
      );
      expect(await tramo(A.centro.sedeId, A.centro.sillonId)).toMatchObject({ ok: true });
    });
  });

  it('valida día y horas, y un tramo no se edita (se desactiva y se crea otro)', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    await comoA(async (c) => {
      const tramo = (dia: number, desde: string, hasta: string) =>
        intentar(c, SQL_TRAMO, [
          A.clinicaId,
          profesionalId,
          A.centro.sedeId,
          dia,
          desde,
          hasta,
          null,
        ]);
      expect(await tramo(7, '08:00', '09:00')).toMatchObject(
        rechazo('23514', 'profesional_disponibilidad_dia_check'),
      );
      expect(await tramo(-1, '08:00', '09:00')).toMatchObject(
        rechazo('23514', 'profesional_disponibilidad_dia_check'),
      );
      expect(await tramo(0, '09:00', '09:00')).toMatchObject(
        rechazo('23514', 'profesional_disponibilidad_rango_check'),
      );
      expect(await tramo(0, '10:00', '09:00')).toMatchObject(
        rechazo('23514', 'profesional_disponibilidad_rango_check'),
      );
      const creado = await tramo(0, '08:00', '09:00');
      const id = (creado.ok ? creado.filas[0]?.['id'] : null) as string;
      for (const set of [
        "hora_fin = '10:00'",
        'dia_semana = 6',
        `sede_id = '${A.norte.sedeId}'`,
        `sillon_id = '${A.centro.sillonId}'`,
        `profesional_id = '${profesionalId}'::uuid`,
      ]) {
        const r = await intentar(
          c,
          `update app.profesional_disponibilidad set ${set} where id = $1`,
          [id],
        );
        if (set.startsWith('profesional_id')) expect(r).toMatchObject({ ok: true });
        else expect({ set, r }).toMatchObject({ set, r: rechazo('42501') });
      }
    });
  });
});

describe('profesional y membresía', () => {
  it('la membresía es de la misma clínica, y una membresía tiene a lo sumo un profesional', async () => {
    const persona = await crearUsuarioDePrueba(admin, {
      clinicaId: A.clinicaId,
      rol: 'odontologo',
    });
    const deB = await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId, rol: 'odontologo' });
    await comoA(async (c) => {
      const alta = (membresia: string | null) =>
        intentar(
          c,
          "insert into app.profesional (clinica_id, membresia_id, nombre, color) values ($1, $2, 'Dra. X', '#18BFB0') returning id",
          [A.clinicaId, membresia],
        );
      expect(await alta(deB.membresiaId)).toMatchObject(
        rechazo('23503', 'profesional_membresia_fkey'),
      );
      expect(await alta(persona.membresiaId)).toMatchObject({ ok: true });
      expect(await alta(persona.membresiaId)).toMatchObject(
        rechazo('23505', 'profesional_membresia_key'),
      );
      // Sin membresía, todos los que hagan falta (especialistas que no entran al sistema).
      expect(await alta(null)).toMatchObject({ ok: true });
      expect(await alta(null)).toMatchObject({ ok: true });
      // Un profesional existente tampoco se puede pasar a la membresía de otro ni a una de B.
      const otro = await alta(null);
      const otroId = (otro.ok ? otro.filas[0]?.['id'] : null) as string;
      for (const [membresia, codigo, restriccion] of [
        [persona.membresiaId, '23505', 'profesional_membresia_key'],
        [deB.membresiaId, '23503', 'profesional_membresia_fkey'],
      ] as const) {
        expect(
          await intentar(c, 'update app.profesional set membresia_id = $1 where id = $2', [
            membresia,
            otroId,
          ]),
        ).toMatchObject(rechazo(codigo, restriccion));
      }
      expect(
        await intentar(
          c,
          "insert into app.profesional (clinica_id, nombre, color) values ($1, 'X', 'rojo')",
          [A.clinicaId],
        ),
      ).toMatchObject(rechazo('23514', 'profesional_color_check'));
    });
  });

  it('el listado de personal trae el profesional asociado', async () => {
    const persona = await crearUsuarioDePrueba(admin, {
      clinicaId: A.clinicaId,
      rol: 'odontologo',
    });
    const { profesionalId } = await crearProfesionalDePrueba(admin, {
      clinicaId: A.clinicaId,
      membresiaId: persona.membresiaId,
    });
    const [fila] = await conContexto(
      poolApi,
      { clinicaId: A.clinicaId, usuarioId: A.duenoId },
      (tx) => listarPersonal(tx, { membresiaId: persona.membresiaId }),
    );
    expect(fila?.profesionalId).toBe(profesionalId);
  });

  it('desactivar un profesional es anular en la auditoría (módulo personal); la disponibilidad lleva su sede', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    await comoA(async (c) => {
      const tramo = await valor<string>(c, SQL_TRAMO, [
        A.clinicaId,
        profesionalId,
        A.norte.sedeId,
        6,
        '08:00',
        '10:00',
        null,
      ]);
      await c.query('update app.profesional set activo = false where id = $1', [profesionalId]);
      const { rows } = await c.query(
        `select entidad, accion, modulo, sede_id, usuario_id from app.audit_log
         where entidad_id = any($1) and usuario_id is not null order by entidad`,
        [[profesionalId, tramo]],
      );
      expect(rows).toEqual([
        {
          entidad: 'profesional',
          accion: 'anular',
          modulo: 'personal',
          sede_id: null,
          usuario_id: A.duenoId,
        },
        {
          entidad: 'profesional_disponibilidad',
          accion: 'crear',
          modulo: 'personal',
          sede_id: A.norte.sedeId,
          usuario_id: A.duenoId,
        },
      ]);
    });
  });
});

describe('bloqueos', () => {
  it('desde < hasta, motivo obligatorio, no se editan y se dan de baja con motivo', async () => {
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: A.clinicaId });
    await comoA(async (c) => {
      const alta = (desde: string, hasta: string, motivo: string) =>
        intentar(
          c,
          `insert into app.profesional_bloqueo (clinica_id, profesional_id, desde, hasta, motivo)
           values ($1, $2, $3, $4, $5) returning id`,
          [A.clinicaId, profesionalId, desde, hasta, motivo],
        );
      expect(await alta('2027-01-10T10:00:00Z', '2027-01-10T10:00:00Z', 'Congreso')).toMatchObject(
        rechazo('23514', 'profesional_bloqueo_rango_check'),
      );
      expect(await alta('2027-01-10T10:00:00Z', '2027-01-12T10:00:00Z', '  ')).toMatchObject(
        rechazo('23514', 'profesional_bloqueo_motivo_check'),
      );
      const creado = await alta('2027-01-10T10:00:00Z', '2027-01-20T10:00:00Z', 'Vacaciones');
      const id = (creado.ok ? creado.filas[0]?.['id'] : null) as string;
      for (const set of [
        "hasta = '2027-02-01'",
        "motivo = 'Otro'",
        "desde = desde - interval '1 day'",
      ]) {
        expect(
          await intentar(c, `update app.profesional_bloqueo set ${set} where id = $1`, [id]),
        ).toMatchObject(rechazo('42501'));
      }
      expect(
        await intentar(c, 'update app.profesional_bloqueo set deleted_at = now() where id = $1', [
          id,
        ]),
      ).toMatchObject(rechazo('23514', 'profesional_bloqueo_baja_check'));
      expect(
        await intentar(
          c,
          "update app.profesional_bloqueo set deleted_at = now(), motivo_baja = 'Se suspendió el viaje' where id = $1",
          [id],
        ),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await valor(
          c,
          "select accion from app.audit_log where entidad = 'profesional_bloqueo' and entidad_id = $1 order by fecha desc limit 1",
          [id],
        ),
      ).toBe('anular');
    });
  });
});
