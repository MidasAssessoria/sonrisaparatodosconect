/** Políticas de usuario, membresia y clinica (las tablas que cruzan clínicas a propósito). */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buscarMembresiaActiva,
  clinica,
  conContexto,
  conUsuario,
  crearPool,
  membresia,
  usuario,
} from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);
const poolApi = crearPool(urls().urlApi, { max: 3 });

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;
let C: ClinicaDePrueba;
let D: ClinicaDePrueba;
/** X: activo en A (recepcion) y en B (odontologo), inactivo en C. */
let x: string;
let xEnA: string;
let xEnB: string;
let xEnC: string;
/** Y: solo en B. P: pendiente en A. */
let y: string;
let p: string;

beforeAll(async () => {
  [A, B, C, D] = await Promise.all([
    crearClinicaDePrueba(admin),
    crearClinicaDePrueba(admin),
    crearClinicaDePrueba(admin),
    crearClinicaDePrueba(admin),
  ]);
  const enA = await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId, rol: 'recepcion' });
  x = enA.usuarioId;
  xEnA = enA.membresiaId;
  xEnB = (
    await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId, usuarioId: x, rol: 'odontologo' })
  ).membresiaId;
  xEnC = (
    await crearUsuarioDePrueba(admin, { clinicaId: C.clinicaId, usuarioId: x, estado: 'inactivo' })
  ).membresiaId;
  y = (await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId })).usuarioId;
  p = (await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId, estado: 'pendiente' }))
    .usuarioId;
  return () => poolApi.end();
});

async function ids(c: pg.ClientBase, texto: string, parametros: unknown[] = []): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(texto, parametros);
  return rows.map((f) => f.id).sort();
}

const ordenar = (lista: string[]): string[] => [...lista].sort();

describe('usuario (identidad global)', () => {
  it('sin clínica en el contexto (login), cada uno ve solo su propia fila', async () => {
    const filas = await conUsuario(poolApi, x, (tx) => tx.select({ id: usuario.id }).from(usuario));
    expect(filas).toEqual([{ id: x }]);
  });

  it('con clínica A se ven quienes tienen membresía en A (en cualquier estado) y nadie más', async () => {
    await enTransaccion(api, { clinica: A.clinicaId, usuario: x }, async (c) => {
      expect(await ids(c, 'select id from app.usuario')).toEqual(ordenar([A.duenoId, x, p]));
    });
  });

  it('solo se edita la fila propia', async () => {
    await enTransaccion(api, { clinica: A.clinicaId, usuario: x }, async (c) => {
      expect(
        await intentar(c, "update app.usuario set telefono = '0981 000 000' where id = $1", [x]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      for (const otro of [A.duenoId, p, y]) {
        expect(
          await intentar(c, "update app.usuario set nombre = 'tomado' where id = $1", [otro]),
        ).toMatchObject({
          ok: true,
          cantidad: 0,
        });
      }
      expect(await intentar(c, "update app.usuario set nombre = 'todos'")).toMatchObject({
        ok: true,
        cantidad: 1,
      });
    });
  });

  it('app_api no da de alta usuarios, ni siquiera el propio', async () => {
    const nuevo = randomUUID();
    await enTransaccion(api, { clinica: A.clinicaId, usuario: nuevo }, async (c) => {
      const r = await intentar(
        c,
        "insert into app.usuario (id, nombre, email) values ($1, 'Nuevo', 'nuevo@prueba.test')",
        [nuevo],
      );
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
    });
  });

  it('el correo es único sin distinguir mayúsculas', async () => {
    const existente = await crearUsuarioDePrueba(admin, { clinicaId: D.clinicaId });
    const otro = randomUUID();
    await enTransaccion(admin, { clinica: D.clinicaId, usuario: otro }, async (c) => {
      const r = await intentar(
        c,
        'insert into app.usuario (id, nombre, email) values ($1, $2, $3)',
        [otro, 'Copia', existente.email.toUpperCase()],
      );
      expect(r).toMatchObject({ ok: false, codigo: '23505' });
    });
  });

  it('la administración tampoco inserta una identidad que no es la del contexto', async () => {
    await enTransaccion(admin, { clinica: D.clinicaId, usuario: randomUUID() }, async (c) => {
      const r = await intentar(
        c,
        "insert into app.usuario (id, nombre, email) values ($1, 'X', 'x2@prueba.test')",
        [randomUUID()],
      );
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
    });
  });
});

describe('membresia', () => {
  it('en el login se ven las membresías propias de todas las clínicas, y ninguna ajena', async () => {
    const filas = await conUsuario(poolApi, x, (tx) =>
      tx.select({ id: membresia.id, usuarioId: membresia.usuarioId }).from(membresia),
    );
    expect(filas.map((f) => f.id).sort()).toEqual(ordenar([xEnA, xEnB, xEnC]));
    expect(filas.every((f) => f.usuarioId === x)).toBe(true);
  });

  it('con clínica A se ven todas las de A más las propias de otras clínicas', async () => {
    await enTransaccion(api, { clinica: A.clinicaId, usuario: x }, async (c) => {
      const visibles = await c.query<{ clinica_id: string; usuario_id: string }>(
        'select clinica_id, usuario_id from app.membresia',
      );
      for (const fila of visibles.rows) {
        expect(fila.clinica_id === A.clinicaId || fila.usuario_id === x).toBe(true);
      }
      expect(visibles.rows.filter((f) => f.clinica_id === A.clinicaId)).toHaveLength(3);
      expect(
        await valor(c, 'select count(*)::int from app.membresia where usuario_id = $1', [y]),
      ).toBe(0);
      expect(
        await valor(c, 'select count(*)::int from app.membresia where usuario_id = $1', [
          B.duenoId,
        ]),
      ).toBe(0);
    });
  });

  it('solo se escriben las de la clínica del contexto', async () => {
    await enTransaccion(api, { clinica: A.clinicaId, usuario: x }, async (c) => {
      // La propia de B se ve, pero no se puede tocar desde el contexto A.
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [xEnB]),
      ).toMatchObject({
        ok: true,
        cantidad: 0,
      });
      // Reactivarse en C desde A, tampoco.
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [xEnC]),
      ).toMatchObject({
        ok: true,
        cantidad: 0,
      });
      // Una de A, sí.
      expect(
        await intentar(
          c,
          "update app.membresia set estado = 'activo' where clinica_id = $1 and usuario_id = $2",
          [A.clinicaId, p],
        ),
      ).toMatchObject({ ok: true, cantidad: 1 });
      // Afiliarse a B desde A: no.
      expect(
        await intentar(
          c,
          'insert into app.membresia (clinica_id, usuario_id, rol_id) values ($1, $2, $3)',
          [B.clinicaId, y, B.roles.dueno],
        ),
      ).toMatchObject({ ok: false, codigo: '42501' });
      // Darse rol de dueño de B en la membresía de A: la FK compuesta lo impide.
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          B.roles.dueno,
          xEnA,
        ]),
      ).toMatchObject({ ok: false, codigo: '23503' });
    });
  });
});

describe('clinica', () => {
  it('en el login se ven las clínicas con membresía activa propia (no las inactivas ni las ajenas)', async () => {
    const filas = await conUsuario(poolApi, x, (tx) =>
      tx
        .select({ id: clinica.id, estado: membresia.estado })
        .from(membresia)
        .innerJoin(clinica, eq(clinica.id, membresia.clinicaId))
        .orderBy(asc(clinica.id)),
    );
    expect(filas.map((f) => f.id)).toEqual(ordenar([A.clinicaId, B.clinicaId]));
    const soloClinicas = await conUsuario(poolApi, x, (tx) =>
      tx.select({ id: clinica.id }).from(clinica),
    );
    expect(soloClinicas.map((f) => f.id).sort()).toEqual(ordenar([A.clinicaId, B.clinicaId]));
    const deY = await conUsuario(poolApi, y, (tx) => tx.select({ id: clinica.id }).from(clinica));
    expect(deY).toEqual([{ id: B.clinicaId }]);
  });

  it('con contexto A se ve A y las clínicas con membresía activa propia; solo se edita A', async () => {
    const visibles = await conContexto(poolApi, { clinicaId: A.clinicaId, usuarioId: x }, (tx) =>
      tx.select({ id: clinica.id }).from(clinica),
    );
    expect(visibles.map((f) => f.id).sort()).toEqual(ordenar([A.clinicaId, B.clinicaId]));
    await enTransaccion(api, { clinica: A.clinicaId, usuario: x }, async (c) => {
      expect(
        await intentar(c, "update app.clinica set nombre = 'tomada' where id = $1", [B.clinicaId]),
      ).toMatchObject({ ok: true, cantidad: 0 });
      expect(await intentar(c, 'update app.clinica set tope_descuento_pct = 40')).toMatchObject({
        ok: true,
        cantidad: 1,
      });
      expect(
        await valor(c, 'select count(*)::int from app.clinica where id = $1', [C.clinicaId]),
      ).toBe(0);
      expect(
        await valor(c, 'select count(*)::int from app.clinica where id = $1', [D.clinicaId]),
      ).toBe(0);
    });
  });

  it('la base confía en el contexto: con la clínica A fijada, alguien sin membresía en A la ve (por eso la API fija el contexto solo desde una membresía activa verificada)', async () => {
    await enTransaccion(api, { clinica: A.clinicaId, usuario: y }, async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.clinica where id = $1', [A.clinicaId]),
      ).toBe(1);
    });
  });
});

describe('buscarMembresiaActiva (lo que la API usa antes de fijar el contexto)', () => {
  it('devuelve la membresía solo si está activa y la clínica también', async () => {
    expect(await buscarMembresiaActiva(poolApi, x, A.clinicaId)).toEqual({
      membresiaId: xEnA,
      rolId: A.roles.recepcion,
      sedeDefectoId: null,
    });
    expect(await buscarMembresiaActiva(poolApi, x, C.clinicaId)).toBeNull(); // inactiva
    expect(await buscarMembresiaActiva(poolApi, x, D.clinicaId)).toBeNull(); // sin membresía
    expect(await buscarMembresiaActiva(poolApi, y, A.clinicaId)).toBeNull(); // es de otra clínica
    expect(await buscarMembresiaActiva(poolApi, p, A.clinicaId)).toBeNull(); // pendiente
    expect(await buscarMembresiaActiva(poolApi, randomUUID(), A.clinicaId)).toBeNull();
  });

  it('una clínica dada de baja deja de dar contexto', async () => {
    const baja = await crearClinicaDePrueba(admin);
    await enTransaccion(
      admin,
      { clinica: baja.clinicaId, usuario: baja.duenoId },
      (c) => c.query('update app.clinica set activo = false where id = $1', [baja.clinicaId]),
      { confirmar: true },
    );
    expect(await buscarMembresiaActiva(poolApi, baja.duenoId, baja.clinicaId)).toBeNull();
  });
});
