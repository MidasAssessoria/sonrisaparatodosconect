/**
 * Cola de trabajos (pg-boss sobre el schema `cola`, migración 0014). Lo que comparten la API (que
 * encola dentro de su transacción) y el worker (que procesa): el schema, la versión de esquema que
 * crearon las migraciones, las colas con sus opciones, la forma de los datos de cada trabajo y la
 * transacción con solo la clínica en el contexto con la que el worker lee la base (RLS).
 *
 * pg-boss nunca migra solo: quien lo arranca usa `migrate: false` y `schema: SCHEMA_COLA`. Si la
 * versión de esquema de la base no es `VERSION_ESQUEMA_COLA`, pg-boss no arranca.
 */
import type pg from 'pg';

export const SCHEMA_COLA = 'cola';
/** Versión de esquema de pg-boss 12.38.2 (la que crea 0014_cola.sql). */
export const VERSION_ESQUEMA_COLA = 46;

/**
 * `archivo.verificar`: el worker relee un archivo recién subido y recalcula su SHA-256. Las opciones
 * son las mismas con las que 0014 crea la cola (una prueba lo compara): hasta 5 reintentos, con
 * espera creciente desde 10 s y como máximo 10 min entre intentos.
 */
export const COLA_ARCHIVO_VERIFICAR = {
  nombre: 'archivo.verificar',
  opciones: {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 300,
  },
} as const;

/** Datos de un trabajo `archivo.verificar`: solo identificadores, nada personal. */
export interface TrabajoVerificarArchivo {
  clinicaId: string;
  archivoId: string;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida los datos de un trabajo `archivo.verificar` (vienen de la base: quien puede insertar en la
 * cola no es de confianza para el worker). Devuelve null si no tienen exactamente esa forma.
 */
export function leerTrabajoVerificarArchivo(datos: unknown): TrabajoVerificarArchivo | null {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return null;
  const d = datos as Record<string, unknown>;
  const claves = Object.keys(d).sort();
  if (claves.length !== 2 || claves[0] !== 'archivoId' || claves[1] !== 'clinicaId') return null;
  const { clinicaId, archivoId } = d;
  if (typeof clinicaId !== 'string' || !PATRON_UUID.test(clinicaId)) return null;
  if (typeof archivoId !== 'string' || !PATRON_UUID.test(archivoId)) return null;
  return { clinicaId: clinicaId.toLowerCase(), archivoId: archivoId.toLowerCase() };
}

/**
 * Transacción de SOLO LECTURA con solo la clínica en el contexto (sin usuario: el worker no actúa
 * por nadie). RLS deja ver las filas de esa clínica y nada más. Commit si `fn` termina bien;
 * rollback si lanza.
 */
export async function conClinica<T>(
  pool: pg.Pool,
  clinicaId: string,
  fn: (cliente: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!PATRON_UUID.test(clinicaId)) throw new Error('clinicaId tiene que ser un UUID.');
  const cliente = await pool.connect();
  let conexionRota: Error | undefined;
  try {
    await cliente.query('BEGIN READ ONLY');
    await cliente.query(
      `select set_config('app.clinica_id', $1, true),
              set_config('app.usuario_id', '', true),
              set_config('app.ip', '', true)`,
      [clinicaId.toLowerCase()],
    );
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('ROLLBACK');
    } catch (errorRollback) {
      conexionRota =
        errorRollback instanceof Error ? errorRollback : new Error(String(errorRollback));
    }
    throw error;
  } finally {
    cliente.release(conexionRota);
  }
}
