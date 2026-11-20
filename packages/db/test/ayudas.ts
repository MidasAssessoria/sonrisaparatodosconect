/** Ayudas compartidas por las pruebas de este paquete. */
import pg from 'pg';
import { afterAll, inject } from 'vitest';
import type { UrlsDeBanco } from '../src/pruebas/index.js';

export function urls(): UrlsDeBanco {
  return inject('conectaDb');
}

const pools: pg.Pool[] = [];

/** Pool que se cierra solo al terminar el archivo de pruebas. */
export function nuevoPool(url: string, max = 5): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max });
  pool.on('error', () => undefined);
  pools.push(pool);
  return pool;
}

afterAll(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

export type Resultado =
  | { ok: true; filas: Record<string, unknown>[]; cantidad: number }
  /** `restriccion`: el campo `constraint` del error (restricción real o nombre de regla). */
  | { ok: false; codigo: string; mensaje: string; restriccion: string | null };

/**
 * Ejecuta una sentencia dentro de un SAVEPOINT: si falla, devuelve el código de error y la
 * transacción sigue usable. Sirve para probar muchos ataques en la misma transacción.
 */
export async function intentar(
  cliente: pg.ClientBase,
  texto: string,
  parametros: unknown[] = [],
): Promise<Resultado> {
  await cliente.query('SAVEPOINT intento');
  try {
    const resultado = await cliente.query<Record<string, unknown>>(texto, parametros);
    await cliente.query('RELEASE SAVEPOINT intento');
    return { ok: true, filas: resultado.rows, cantidad: resultado.rowCount ?? 0 };
  } catch (error) {
    await cliente.query('ROLLBACK TO SAVEPOINT intento');
    const e = error as { code?: string; message?: string; constraint?: string };
    return {
      ok: false,
      codigo: e.code ?? '?',
      mensaje: e.message ?? String(error),
      restriccion: e.constraint ?? null,
    };
  }
}

/** Espera un rechazo con ese código y, si se indica, ese nombre de regla o restricción. */
export function rechazo(codigo: string, restriccion?: string): Record<string, unknown> {
  return restriccion === undefined ? { ok: false, codigo } : { ok: false, codigo, restriccion };
}

/** Valores crudos para app.clinica_id / app.usuario_id / app.ip (null = no se fija). */
export interface ContextoCrudo {
  clinica?: string | null;
  usuario?: string | null;
  ip?: string | null;
}

/**
 * Abre una transacción en `pool`, fija el contexto crudo (cualquier texto, incluso inválido) y
 * ejecuta `fn`. Por defecto hace ROLLBACK al final; con `confirmar` hace COMMIT.
 */
export async function enTransaccion<T>(
  pool: pg.Pool,
  contexto: ContextoCrudo,
  fn: (cliente: pg.PoolClient) => Promise<T>,
  opciones: { confirmar?: boolean } = {},
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const ajustes: [string, string | null | undefined][] = [
      ['app.clinica_id', contexto.clinica],
      ['app.usuario_id', contexto.usuario],
      ['app.ip', contexto.ip],
    ];
    for (const [nombre, valor] of ajustes) {
      if (valor !== null && valor !== undefined) {
        await cliente.query('select set_config($1, $2, true)', [nombre, valor]);
      }
    }
    const resultado = await fn(cliente);
    await cliente.query(opciones.confirmar ? 'COMMIT' : 'ROLLBACK');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }
}

/** Primera columna de la primera fila. */
export async function valor<T = unknown>(
  cliente: pg.ClientBase,
  texto: string,
  parametros: unknown[] = [],
): Promise<T> {
  const resultado = await cliente.query(texto, parametros);
  const fila = resultado.rows[0] as Record<string, unknown> | undefined;
  return (fila ? Object.values(fila)[0] : undefined) as T;
}
