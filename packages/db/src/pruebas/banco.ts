/**
 * Banco de pruebas con Postgres real.
 *
 * - Sin DATABASE_URL_TEST: levanta un Postgres 17 embebido en `<cwd>/.pg-test/` (lo borra al terminar).
 * - Con DATABASE_URL_TEST (CI): usa esa base, que tiene que estar vacía, con un rol que pueda crear
 *   roles (p. ej. `postgresql://postgres:postgres@localhost:5432/conecta_test`).
 *
 * Si la conexión de administración es superusuario, las migraciones NO se aplican con ella: se crea
 * el rol `conecta_migrador` (NOSUPERUSER, CREATEROLE, CREATEDB, sin BYPASSRLS), como el rol postgres
 * de Supabase pero sin BYPASSRLS, y las pruebas usan ese rol como «administración». Así se verifica
 * en cada corrida que las migraciones no necesitan superusuario.
 *
 * En el Postgres embebido además se simula lo peor de Supabase: existen anon, authenticated y
 * service_role, y el rol de migraciones concede por defecto todo a esos roles en cualquier schema.
 * Las migraciones tienen que quitárselo (lo verifica la meta-prueba).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrar } from '../migrar.js';
import { iniciarPostgresEmbebido } from './postgres-embebido.js';

/** URLs que el banco entrega a las pruebas. */
export interface UrlsDeBanco {
  /** Rol de migraciones/administración (dueño de las tablas, sujeto a RLS). */
  urlAdmin: string;
  /** Rol app_api, con LOGIN y contraseña de prueba. */
  urlApi: string;
}

export interface BancoDePruebas extends UrlsDeBanco {
  /** true si se usó DATABASE_URL_TEST en vez del Postgres embebido. */
  externo: boolean;
  /** Apaga el Postgres embebido y borra sus datos (con DATABASE_URL_TEST no hace nada). */
  detener(): Promise<void>;
}

export interface OpcionesBanco {
  /** URL externa; por defecto DATABASE_URL_TEST. Una cadena vacía cuenta como no definida. */
  urlExterna?: string | undefined;
  /** Raíz de los datos del Postgres embebido. Por defecto `<cwd>/.pg-test`. */
  directorioDatos?: string | undefined;
  registrar?: ((mensaje: string) => void) | undefined;
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** Lo provee el globalSetup de `@conecta/db/pruebas/global-setup`. */
    conectaDb: UrlsDeBanco;
  }
}

export const ROL_MIGRADOR_DE_PRUEBA = 'conecta_migrador';
const BASE_EMBEBIDA = 'conecta_test';

function claveAleatoria(): string {
  return randomBytes(18).toString('base64url');
}

/** Misma URL con otro usuario/contraseña y, opcionalmente, otra base. */
export function urlCon(
  base: string,
  cambios: { usuario?: string; clave?: string; baseDeDatos?: string },
): string {
  const url = new URL(base);
  if (cambios.usuario !== undefined) url.username = encodeURIComponent(cambios.usuario);
  if (cambios.clave !== undefined) url.password = encodeURIComponent(cambios.clave);
  if (cambios.baseDeDatos !== undefined)
    url.pathname = `/${encodeURIComponent(cambios.baseDeDatos)}`;
  return url.toString();
}

async function conCliente<T>(url: string, fn: (cliente: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: url, application_name: 'conecta-banco' });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

async function simularRolesDeSupabase(superusuario: pg.Client): Promise<void> {
  await superusuario.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END
    $$;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ROL_MIGRADOR_DE_PRUEBA}
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ROL_MIGRADOR_DE_PRUEBA}
      GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ROL_MIGRADOR_DE_PRUEBA}
      GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${ROL_MIGRADOR_DE_PRUEBA}
      GRANT ALL ON SCHEMAS TO anon, authenticated, service_role;
  `);
}

/** Aplica las migraciones y deja listo app_api. Devuelve las URLs de administración y de la API. */
async function prepararBase(
  urlInicial: string,
  simularSupabase: boolean,
  registrar: (mensaje: string) => void,
): Promise<UrlsDeBanco> {
  return conCliente(urlInicial, async (inicial) => {
    const { rows } = await inicial.query<{ rolsuper: boolean; base: string }>(
      'select rolsuper, current_database() as base from pg_roles where rolname = current_user',
    );
    const esSuperusuario = rows[0]?.rolsuper === true;
    const base = rows[0]?.base ?? '';

    let urlAdmin = urlInicial;
    if (esSuperusuario) {
      const clave = claveAleatoria();
      await inicial.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROL_MIGRADOR_DE_PRUEBA}') THEN
            CREATE ROLE ${ROL_MIGRADOR_DE_PRUEBA};
          END IF;
        END
        $$`);
      await inicial.query(
        `ALTER ROLE ${ROL_MIGRADOR_DE_PRUEBA} LOGIN NOSUPERUSER CREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS
         PASSWORD ${inicial.escapeLiteral(clave)}`,
      );
      await inicial.query(
        `GRANT CREATE, CONNECT, TEMPORARY ON DATABASE ${inicial.escapeIdentifier(base)} TO ${ROL_MIGRADOR_DE_PRUEBA}`,
      );
      if (simularSupabase) await simularRolesDeSupabase(inicial);
      urlAdmin = urlCon(urlInicial, { usuario: ROL_MIGRADOR_DE_PRUEBA, clave });
    }

    const resultado = await migrar(urlAdmin);
    registrar(
      `Migraciones: ${resultado.aplicadas.length} aplicadas, ${resultado.yaAplicadas} ya estaban.`,
    );

    // LOGIN y contraseña de app_api: fuera de las migraciones, como en producción.
    const claveApi = claveAleatoria();
    const sentencia = (cliente: pg.Client): string =>
      `ALTER ROLE app_api LOGIN PASSWORD ${cliente.escapeLiteral(claveApi)}`;
    if (esSuperusuario) await inicial.query(sentencia(inicial));
    else await conCliente(urlAdmin, (admin) => admin.query(sentencia(admin)));

    return { urlAdmin, urlApi: urlCon(urlInicial, { usuario: 'app_api', clave: claveApi }) };
  });
}

/** Levanta (o toma) la base de pruebas, aplica las migraciones y habilita app_api. */
export async function iniciarBanco(opciones: OpcionesBanco = {}): Promise<BancoDePruebas> {
  const registrar = opciones.registrar ?? (() => undefined);
  const urlExterna = opciones.urlExterna ?? process.env['DATABASE_URL_TEST'];

  if (urlExterna) {
    const urls = await prepararBase(urlExterna, false, registrar);
    return { ...urls, externo: true, detener: () => Promise.resolve() };
  }

  const servidor = await iniciarPostgresEmbebido({
    raiz: opciones.directorioDatos,
    registrar,
  });
  try {
    const urlServidor = `postgresql://${servidor.usuario}:${encodeURIComponent(servidor.clave)}@127.0.0.1:${servidor.puerto}/postgres`;
    await conCliente(urlServidor, (cliente) => cliente.query(`CREATE DATABASE ${BASE_EMBEBIDA}`));
    const urls = await prepararBase(
      urlCon(urlServidor, { baseDeDatos: BASE_EMBEBIDA }),
      true,
      registrar,
    );
    return { ...urls, externo: false, detener: () => servidor.detener() };
  } catch (error) {
    await servidor.detener();
    throw error;
  }
}

export interface BaseVacia {
  /** URL de la base nueva con el rol de administración (dueño de la base). */
  urlAdmin: string;
  /** URL de la base nueva con app_api. */
  urlApi: string;
  eliminar(): Promise<void>;
}

/**
 * Crea una base vacía en el mismo servidor (para probar migraciones desde cero o extensiones).
 * El rol de administración necesita CREATEDB (conecta_migrador lo tiene).
 */
export async function crearBaseVacia(urls: UrlsDeBanco): Promise<BaseVacia> {
  const nombre = `conecta_tmp_${randomBytes(6).toString('hex')}`;
  await conCliente(urls.urlAdmin, (admin) => admin.query(`CREATE DATABASE ${nombre}`));
  return {
    urlAdmin: urlCon(urls.urlAdmin, { baseDeDatos: nombre }),
    urlApi: urlCon(urls.urlApi, { baseDeDatos: nombre }),
    eliminar: () => eliminarBase(urls.urlAdmin, nombre),
  };
}

/**
 * DROP DATABASE … WITH (FORCE), con reintentos. Un rol sin superusuario no puede terminar procesos
 * de un superusuario: si en ese momento un autovacuum (proceso del superusuario) trabaja en la base,
 * el DROP falla con 42501; si alguien todavía está conectado, con 55006. Los dos pasan solos en
 * instantes.
 */
async function eliminarBase(urlAdmin: string, nombre: string): Promise<void> {
  for (let intento = 1; ; intento++) {
    try {
      await conCliente(urlAdmin, (admin) =>
        admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`),
      );
      return;
    } catch (error) {
      const codigo = (error as { code?: string }).code;
      if (intento >= 20 || (codigo !== '42501' && codigo !== '55006')) throw error;
      await new Promise((listo) => setTimeout(listo, 250));
    }
  }
}
