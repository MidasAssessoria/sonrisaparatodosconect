/**
 * Ejecutor de migraciones.
 *
 * Aplica `migraciones/NNNN_nombre.sql` en orden, cada una en su propia transacción, y lleva el
 * registro en `app.migracion` (versión, nombre y checksum SHA-256 del texto con saltos de línea LF).
 * Es idempotente: lo ya aplicado no se vuelve a correr. Antes de aplicar nada verifica que lo
 * registrado siga igual en disco; si una migración aplicada cambió o desapareció, no aplica nada.
 * Un bloqueo consultivo evita que dos procesos migren a la vez.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Directorio de migraciones del paquete (`packages/db/migraciones`), tanto desde `src` como desde `dist`. */
export const DIRECTORIO_MIGRACIONES = fileURLToPath(new URL('../migraciones/', import.meta.url));

export interface Migracion {
  version: number;
  /** Nombre del archivo, p. ej. `0001_base.sql`. */
  nombre: string;
  sql: string;
  checksum: string;
}

export interface OpcionesMigrar {
  directorio?: string;
  registrar?: (mensaje: string) => void;
}

export interface ResultadoMigrar {
  /** Migraciones aplicadas en esta corrida, en orden. */
  aplicadas: string[];
  /** Cuántas ya estaban aplicadas antes de esta corrida. */
  yaAplicadas: number;
}

export class ErrorDeMigracion extends Error {
  override name = 'ErrorDeMigracion';
}

const PATRON_ARCHIVO = /^(\d{4})_[a-z0-9_]+\.sql$/;
/** Clave del bloqueo consultivo (pg_advisory_lock) que serializa las corridas del ejecutor. */
const CLAVE_BLOQUEO = '7211502917';

/** Normaliza el texto (sin BOM, saltos LF) para que el checksum no dependa del sistema operativo. */
function normalizar(texto: string): string {
  const sinBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  return sinBom.replace(/\r\n?/g, '\n');
}

export function calcularChecksum(texto: string): string {
  return createHash('sha256').update(normalizar(texto), 'utf8').digest('hex');
}

/** Lee y valida las migraciones de un directorio, ordenadas por versión. */
export async function leerMigraciones(directorio = DIRECTORIO_MIGRACIONES): Promise<Migracion[]> {
  const archivos = (await readdir(directorio)).filter((archivo) => archivo.endsWith('.sql')).sort();
  const migraciones: Migracion[] = [];
  const versiones = new Map<number, string>();
  for (const nombre of archivos) {
    const coincidencia = PATRON_ARCHIVO.exec(nombre);
    if (!coincidencia?.[1]) {
      throw new ErrorDeMigracion(
        `El archivo ${nombre} no sigue el formato NNNN_nombre.sql (cuatro dígitos, minúsculas y guiones bajos).`,
      );
    }
    const version = Number.parseInt(coincidencia[1], 10);
    const repetida = versiones.get(version);
    if (repetida) {
      throw new ErrorDeMigracion(`Las migraciones ${repetida} y ${nombre} tienen el mismo número.`);
    }
    versiones.set(version, nombre);
    const sql = normalizar(await readFile(path.join(directorio, nombre), 'utf8'));
    migraciones.push({ version, nombre, sql, checksum: calcularChecksum(sql) });
  }
  return migraciones;
}

/**
 * Tabla de registro. La crea el ejecutor (no una migración) porque tiene que existir antes de la
 * primera. Como toda tabla de app: RLS forzado, con una política que solo deja verla a su dueño.
 */
const SQL_REGISTRO = `
DO $registro$
BEGIN
  IF pg_catalog.to_regnamespace('app') IS NULL THEN
    CREATE SCHEMA app;
  END IF;
  IF pg_catalog.to_regclass('app.migracion') IS NULL THEN
    CREATE TABLE app.migracion (
      version integer PRIMARY KEY,
      nombre text NOT NULL UNIQUE,
      checksum text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now(),
      aplicada_por text NOT NULL DEFAULT current_user
    );
    COMMENT ON TABLE app.migracion IS 'Migraciones aplicadas por el ejecutor de @conecta/db.';
    ALTER TABLE app.migracion ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app.migracion FORCE ROW LEVEL SECURITY;
    CREATE POLICY migracion_solo_duenio ON app.migracion
      USING (pg_catalog.pg_has_role(
        (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'app.migracion'::pg_catalog.regclass),
        'MEMBER'))
      WITH CHECK (pg_catalog.pg_has_role(
        (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'app.migracion'::pg_catalog.regclass),
        'MEMBER'));
    REVOKE ALL ON app.migracion FROM PUBLIC;
  END IF;
END
$registro$;
`;

interface FilaMigracion {
  version: number;
  nombre: string;
  checksum: string;
}

function verificarRegistro(registradas: FilaMigracion[], migraciones: Migracion[]): void {
  const porVersion = new Map(migraciones.map((m) => [m.version, m]));
  for (const fila of registradas) {
    const enDisco = porVersion.get(fila.version);
    if (!enDisco) {
      throw new ErrorDeMigracion(
        `La migración aplicada ${fila.nombre} ya no está en el directorio. No se aplicó nada.`,
      );
    }
    if (enDisco.nombre !== fila.nombre) {
      throw new ErrorDeMigracion(
        `La migración ${fila.version} se aplicó como ${fila.nombre} y ahora se llama ${enDisco.nombre}. No se aplicó nada.`,
      );
    }
    if (enDisco.checksum !== fila.checksum) {
      throw new ErrorDeMigracion(
        `La migración ${fila.nombre} cambió después de aplicada (checksum distinto). ` +
          'No edites una migración aplicada: creá una nueva. No se aplicó nada.',
      );
    }
  }
  const ultima = registradas.reduce((max, fila) => Math.max(max, fila.version), 0);
  const aplicadas = new Set(registradas.map((fila) => fila.version));
  const fueraDeOrden = migraciones.find((m) => !aplicadas.has(m.version) && m.version < ultima);
  if (fueraDeOrden) {
    throw new ErrorDeMigracion(
      `La migración ${fueraDeOrden.nombre} es anterior a la última aplicada (${ultima}): ` +
        'renumerala para que vaya después. No se aplicó nada.',
    );
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Aplica las migraciones pendientes sobre la base de `url` (rol con permisos de migración). */
export async function migrar(url: string, opciones: OpcionesMigrar = {}): Promise<ResultadoMigrar> {
  const registrar = opciones.registrar ?? (() => undefined);
  const migraciones = await leerMigraciones(opciones.directorio);
  const cliente = new pg.Client({ connectionString: url, application_name: 'conecta-migraciones' });
  await cliente.connect();
  try {
    await cliente.query('select pg_advisory_lock($1::bigint)', [CLAVE_BLOQUEO]);
    try {
      await cliente.query(SQL_REGISTRO);
      const { rows: registradas } = await cliente.query<FilaMigracion>(
        'select version, nombre, checksum from app.migracion order by version',
      );
      verificarRegistro(registradas, migraciones);

      const yaAplicadas = new Set(registradas.map((fila) => fila.version));
      const aplicadas: string[] = [];
      for (const migracion of migraciones) {
        if (yaAplicadas.has(migracion.version)) continue;
        try {
          await cliente.query('BEGIN');
          await cliente.query(migracion.sql);
          await cliente.query(
            'insert into app.migracion (version, nombre, checksum) values ($1, $2, $3)',
            [migracion.version, migracion.nombre, migracion.checksum],
          );
          await cliente.query('COMMIT');
        } catch (error) {
          await cliente.query('ROLLBACK').catch(() => undefined);
          throw new ErrorDeMigracion(
            `La migración ${migracion.nombre} falló y no se aplicó: ${mensajeDe(error)}`,
            { cause: error },
          );
        }
        aplicadas.push(migracion.nombre);
        registrar(`Aplicada ${migracion.nombre}`);
      }
      return { aplicadas, yaAplicadas: registradas.length };
    } finally {
      await cliente
        .query('select pg_advisory_unlock($1::bigint)', [CLAVE_BLOQUEO])
        .catch(() => undefined);
    }
  } finally {
    await cliente.end();
  }
}
