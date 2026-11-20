/**
 * Sesiones del lado del servidor: app.sesion, app.tocar_sesion() y app.cerrar_sesion(), y sus
 * envoltorios tipados. Incluye la pasada adversarial: tocar o cerrar la sesión de otra persona,
 * escribir la tabla directamente, reabrir una sesión cerrada.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cerrarSesion, conUsuario, crearPool, sesion, tocarSesion } from '../src/index.js';
import { crearClinicaDePrueba, type ClinicaDePrueba } from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 6);
const poolApi = crearPool(urls().urlApi, { max: 3 });

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;

beforeAll(async () => {
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
});
afterAll(() => poolApi.end());

/** Transacción de app_api solo con el usuario (como el paso previo del login), confirmada. */
function comoUsuario<T>(usuario: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return enTransaccion(api, { usuario }, fn, { confirmar: true });
}

const tocar = (usuario: string, id: string, minutos = 30): Promise<string> =>
  comoUsuario(usuario, (c) => valor<string>(c, 'select app.tocar_sesion($1, $2)', [id, minutos]));

interface FilaSesion {
  usuario_id: string;
  iniciada_en: Date;
  ultima_actividad: Date;
  cerrada_en: Date | null;
  motivo_cierre: string | null;
}

async function leer(usuario: string, id: string): Promise<FilaSesion | undefined> {
  return enTransaccion(admin, { usuario }, async (c) => {
    const { rows } = await c.query<FilaSesion>(
      `select usuario_id, iniciada_en, ultima_actividad, cerrada_en, motivo_cierre
       from app.sesion where id = $1`,
      [id],
    );
    return rows[0];
  });
}

/** Sesión vieja: la crea el rol de administración con fechas en el pasado. */
async function sesionVieja(usuario: string, minutosAtras: number): Promise<string> {
  const id = randomUUID();
  await enTransaccion(
    admin,
    { usuario },
    (c) =>
      c.query(
        `insert into app.sesion (id, usuario_id, iniciada_en, ultima_actividad)
         values ($1, $2, now() - make_interval(mins => $3), now() - make_interval(mins => $3))`,
        [id, usuario, minutosAtras],
      ),
    { confirmar: true },
  );
  return id;
}

describe('app.tocar_sesion()', () => {
  it('el primer pedido crea la sesión (nueva); los siguientes la encuentran activa', async () => {
    const id = randomUUID();
    expect(await tocar(A.duenoId, id)).toBe('nueva');
    expect(await tocar(A.duenoId, id)).toBe('activa');
    expect(await leer(A.duenoId, id)).toMatchObject({
      usuario_id: A.duenoId,
      cerrada_en: null,
      motivo_cierre: null,
    });
  });

  it('no necesita clínica en el contexto, y la sesión sirve para todas las clínicas de la persona', async () => {
    const id = randomUUID();
    expect(await tocar(A.duenoId, id)).toBe('nueva');
    const conClinica = await enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, (c) =>
      valor<string>(c, 'select app.tocar_sesion($1, 30)', [id]),
    );
    expect(conClinica).toBe('activa');
  });

  it('actualiza ultima_actividad como mucho una vez por minuto', async () => {
    const reciente = randomUUID();
    expect(await tocar(A.duenoId, reciente)).toBe('nueva');
    const antes = (await leer(A.duenoId, reciente))?.ultima_actividad;
    expect(await tocar(A.duenoId, reciente)).toBe('activa');
    expect((await leer(A.duenoId, reciente))?.ultima_actividad).toEqual(antes);

    const deHaceDos = await sesionVieja(A.duenoId, 2);
    const vieja = (await leer(A.duenoId, deHaceDos))?.ultima_actividad;
    expect(await tocar(A.duenoId, deHaceDos)).toBe('activa');
    const nueva = (await leer(A.duenoId, deHaceDos))?.ultima_actividad;
    expect(nueva!.getTime()).toBeGreaterThan(vieja!.getTime() + 60_000);
  });

  it('pasado el límite de inactividad la cierra (motivo inactividad), aunque el pedido no siga', async () => {
    const id = await sesionVieja(A.duenoId, 16);
    // Con 30 minutos todavía sirve; con 15 (recepción) ya venció.
    const otra = await sesionVieja(A.duenoId, 16);
    expect(await tocar(A.duenoId, otra, 30)).toBe('activa');
    expect(await tocar(A.duenoId, id, 15)).toBe('vencida');
    expect(await leer(A.duenoId, id)).toMatchObject({ motivo_cierre: 'inactividad' });
    expect((await leer(A.duenoId, id))?.cerrada_en).not.toBeNull();
    // Ya cerrada: aunque el próximo pedido traiga un límite más largo, no se reabre.
    expect(await tocar(A.duenoId, id, 240)).toBe('cerrada');
  });

  it('con vencida, si la API revierte la transacción, la sesión sigue abierta (por eso no lanza error)', async () => {
    const id = await sesionVieja(A.duenoId, 40);
    await enTransaccion(api, { usuario: A.duenoId }, async (c) => {
      expect(await valor(c, 'select app.tocar_sesion($1, 30)', [id])).toBe('vencida');
    });
    expect((await leer(A.duenoId, id))?.cerrada_en).toBeNull();
  });

  it('dos primeros pedidos simultáneos: solo uno ve la sesión como nueva', async () => {
    const id = randomUUID();
    const resultados = await Promise.all(Array.from({ length: 5 }, () => tocar(A.duenoId, id)));
    expect(resultados.filter((r) => r === 'nueva')).toHaveLength(1);
    expect(resultados.filter((r) => r === 'activa')).toHaveLength(4);
  });

  it('valida los datos y exige usuario en el contexto', async () => {
    await enTransaccion(api, { usuario: A.duenoId }, async (c) => {
      for (const minutos of [4, 241, 0, null]) {
        expect(
          await intentar(c, 'select app.tocar_sesion($1, $2)', [randomUUID(), minutos]),
        ).toMatchObject(rechazo('22023'));
      }
      expect(await intentar(c, 'select app.tocar_sesion(null, 30)')).toMatchObject(
        rechazo('22023'),
      );
    });
    await enTransaccion(api, { clinica: A.clinicaId }, async (c) => {
      expect(await intentar(c, 'select app.tocar_sesion($1, 30)', [randomUUID()])).toMatchObject(
        rechazo('42501'),
      );
      expect(await intentar(c, 'select app.cerrar_sesion($1)', [randomUUID()])).toMatchObject(
        rechazo('42501'),
      );
    });
  });
});

describe('app.cerrar_sesion()', () => {
  it('cierra con motivo salida; después la sesión ya no sirve', async () => {
    const id = randomUUID();
    expect(await tocar(A.duenoId, id)).toBe('nueva');
    expect(
      await comoUsuario(A.duenoId, (c) => valor(c, 'select app.cerrar_sesion($1)', [id])),
    ).toBe(true);
    expect(await leer(A.duenoId, id)).toMatchObject({ motivo_cierre: 'salida' });
    expect(
      await comoUsuario(A.duenoId, (c) => valor(c, 'select app.cerrar_sesion($1)', [id])),
    ).toBe(false);
    expect(await tocar(A.duenoId, id)).toBe('cerrada');
  });

  it('una sesión que nunca se tocó queda creada y cerrada: ese session_id no sirve más', async () => {
    const id = randomUUID();
    expect(
      await comoUsuario(A.duenoId, (c) => valor(c, 'select app.cerrar_sesion($1)', [id])),
    ).toBe(true);
    expect(await tocar(A.duenoId, id)).toBe('cerrada');
  });
});

describe('la sesión de otra persona (pasada adversarial)', () => {
  it('no se puede tocar ni cerrar, y queda como estaba', async () => {
    const deB = randomUUID();
    expect(await tocar(B.duenoId, deB)).toBe('nueva');
    const antes = await leer(B.duenoId, deB);
    await enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, async (c) => {
      expect(await intentar(c, 'select app.tocar_sesion($1, 30)', [deB])).toMatchObject(
        rechazo('42501', 'sesion_ajena'),
      );
      expect(await intentar(c, 'select app.cerrar_sesion($1)', [deB])).toMatchObject(
        rechazo('42501', 'sesion_ajena'),
      );
      // Ni la ve.
      expect(await valor(c, 'select count(*)::int from app.sesion where id = $1', [deB])).toBe(0);
    });
    expect(await leer(B.duenoId, deB)).toEqual(antes);
  });

  it('app_api no escribe la tabla directamente: ni crear, ni reabrir, ni mover, ni borrar', async () => {
    const propia = randomUUID();
    expect(await tocar(A.duenoId, propia)).toBe('nueva');
    await enTransaccion(api, { usuario: A.duenoId }, async (c) => {
      const intentos: [string, unknown[]][] = [
        ['insert into app.sesion (id, usuario_id) values ($1, $2)', [randomUUID(), A.duenoId]],
        ['update app.sesion set cerrada_en = null, motivo_cierre = null where id = $1', [propia]],
        [
          "update app.sesion set ultima_actividad = now() + interval '1 day' where id = $1",
          [propia],
        ],
        ['update app.sesion set usuario_id = $2 where id = $1', [propia, B.duenoId]],
        ['delete from app.sesion where id = $1', [propia]],
      ];
      for (const [texto, parametros] of intentos) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: rechazo('42501'),
        });
      }
    });
  });

  it('cada quien ve solo sus sesiones, con o sin clínica en el contexto', async () => {
    const deA = randomUUID();
    const deB = randomUUID();
    await tocar(A.duenoId, deA);
    await tocar(B.duenoId, deB);
    const vistas = await conUsuario(poolApi, A.duenoId, (tx) =>
      tx.select({ id: sesion.id, usuarioId: sesion.usuarioId }).from(sesion),
    );
    expect(vistas.some((s) => s.id === deA)).toBe(true);
    expect(vistas.every((s) => s.usuarioId === A.duenoId)).toBe(true);
    await enTransaccion(api, { clinica: B.clinicaId, usuario: A.duenoId }, async (c) => {
      expect(await valor(c, 'select count(*)::int from app.sesion where id = $1', [deB])).toBe(0);
    });
  });
});

describe('envoltorios tipados', () => {
  it('tocarSesion y cerrarSesion dentro de conUsuario', async () => {
    const id = randomUUID();
    expect(await conUsuario(poolApi, A.duenoId, (tx) => tocarSesion(tx, id, 15))).toBe('nueva');
    expect(await conUsuario(poolApi, A.duenoId, (tx) => tocarSesion(tx, id, 15))).toBe('activa');
    expect(await conUsuario(poolApi, A.duenoId, (tx) => cerrarSesion(tx, id))).toBe(true);
    expect(await conUsuario(poolApi, A.duenoId, (tx) => tocarSesion(tx, id, 15))).toBe('cerrada');
    const error = await conUsuario(poolApi, B.duenoId, (tx) => tocarSesion(tx, id, 15)).catch(
      (e: unknown) => e,
    );
    expect(errorPostgres(error)).toMatchObject({ code: '42501', constraint: 'sesion_ajena' });
  });
});

/** El error de `pg` en la cadena de `cause` (Drizzle lo envuelve). */
function errorPostgres(error: unknown): unknown {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual; i++) {
    if (typeof (actual as { code?: unknown }).code === 'string') return actual;
    actual = (actual as { cause?: unknown }).cause;
  }
  return error;
}
