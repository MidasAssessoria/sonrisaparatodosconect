/**
 * Cola de trabajos (0014): schema cola de pg-boss, rol app_worker y lo que app_api puede hacer en la
 * cola. El worker no salta RLS ni es dueño de nada; app_api solo encola.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLA_ARCHIVO_VERIFICAR,
  conClinica,
  leerTrabajoVerificarArchivo,
  VERSION_ESQUEMA_COLA,
} from '../src/cola.js';
import {
  crearArchivoDePrueba,
  crearClinicaDePrueba,
  urlCon,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);
let worker: pg.Pool;

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;
let archivoA: string;
let archivoB: string;

async function consultar<T>(texto: string, parametros: unknown[] = []): Promise<T[]> {
  return enTransaccion(admin, {}, async (c) => (await c.query(texto, parametros)).rows as T[]);
}

beforeAll(async () => {
  // LOGIN y contraseña de app_worker: fuera de las migraciones, como los de app_api.
  const clave = randomBytes(18).toString('base64url');
  await admin.query(`alter role app_worker login password '${clave}'`);
  worker = new pg.Pool({
    connectionString: urlCon(urls().urlApi, { usuario: 'app_worker', clave }),
    max: 3,
  });
  worker.on('error', () => undefined);
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
  archivoA = (await crearArchivoDePrueba(admin, { clinicaId: A.clinicaId })).archivoId;
  archivoB = (await crearArchivoDePrueba(admin, { clinicaId: B.clinicaId })).archivoId;
});

afterAll(async () => {
  await worker.end();
});

describe('rol app_worker', () => {
  it('no es superusuario, no salta RLS, no crea roles ni bases, no es miembro ni dueño de nada', async () => {
    const [rol] = await consultar<Record<string, boolean>>(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
       from pg_roles where rolname = 'app_worker'`,
    );
    expect(rol).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
    });
    expect(
      await consultar(
        `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid
         where m.member = 'app_worker'::regrole`,
      ),
    ).toEqual([]);
    expect(
      await consultar(
        `select 'clase ' || relname from pg_class where relowner = 'app_worker'::regrole
         union all select 'función ' || proname from pg_proc where proowner = 'app_worker'::regrole
         union all select 'schema ' || nspname from pg_namespace where nspowner = 'app_worker'::regrole
         union all select 'tipo ' || typname from pg_type where typowner = 'app_worker'::regrole`,
      ),
    ).toEqual([]);
  });

  it('no puede crear objetos en ningún schema', async () => {
    const schemas = await consultar<{ nspname: string }>(
      `select nspname from pg_namespace
       where has_schema_privilege('app_worker', oid, 'CREATE') and nspname not like 'pg_temp%'`,
    );
    expect(schemas).toEqual([]);
  });

  it('en app solo puede leer archivo', async () => {
    const filas = await consultar<{ tabla: string; privilegios: string[] }>(
      `select c.relname as tabla,
              array_agg(p.priv order by p.priv) as privilegios
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
       where n.nspname = 'app' and c.relkind in ('r', 'p') and has_table_privilege('app_worker', c.oid, p.priv)
       group by c.relname`,
    );
    expect(filas).toEqual([{ tabla: 'archivo', privilegios: ['SELECT'] }]);
    const funciones = await consultar<{ funcion: string }>(
      `select p.oid::regprocedure::text as funcion from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and has_function_privilege('app_worker', p.oid, 'EXECUTE')`,
    );
    expect(funciones.map((f) => f.funcion)).toEqual(['app.clinica_actual()']);
  });

  it('lee archivo con RLS: sin contexto nada, con contexto solo su clínica', async () => {
    await enTransaccion(worker, {}, async (c) => {
      expect(await valor(c, 'select count(*)::int from app.archivo')).toBe(0);
    });
    await enTransaccion(worker, { clinica: A.clinicaId }, async (c) => {
      const { rows } = await c.query<{ id: string }>('select id from app.archivo');
      expect(rows.map((f) => f.id)).toContain(archivoA);
      expect(rows.map((f) => f.id)).not.toContain(archivoB);
      // Apagar RLS hace fallar la consulta en vez de mostrar todo.
      await c.query('set local row_security = off');
      expect(await intentar(c, 'select count(*) from app.archivo')).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
  });

  it('no escribe en app ni cambia la estructura de la cola', async () => {
    await enTransaccion(worker, { clinica: A.clinicaId }, async (c) => {
      for (const texto of [
        `update app.archivo set motivo_baja = 'x' where id = '${archivoA}'`,
        'select count(*) from app.sede',
        'select count(*) from app.audit_log',
        'alter table cola.job_common add column x int',
        'drop table cola.warning',
        'create table cola.robada (id int)',
        "create table cola.robada partition of cola.job for values in ('robada')",
        'create schema propio',
        'set role app_api',
      ]) {
        const r = await intentar(c, texto);
        expect({ texto, ok: r.ok }).toEqual({ texto, ok: false });
        if (!r.ok) expect(['42501', '22023'], `${texto} -> ${r.codigo}`).toContain(r.codigo);
      }
    });
  });
});

describe('schema cola', () => {
  it('pg-boss quedó en la versión de esquema esperada, con la cola archivo.verificar', async () => {
    const [version] = await consultar<{ version: number }>('select version from cola.version');
    expect(version?.version).toBe(VERSION_ESQUEMA_COLA);
    const [cola] = await consultar<Record<string, unknown>>(
      `select policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds,
              partition, table_name
       from cola.queue where name = $1`,
      [COLA_ARCHIVO_VERIFICAR.nombre],
    );
    const o = COLA_ARCHIVO_VERIFICAR.opciones;
    expect(cola).toEqual({
      policy: 'standard',
      retry_limit: o.retryLimit,
      retry_delay: o.retryDelay,
      retry_backoff: o.retryBackoff,
      retry_delay_max: o.retryDelayMax,
      expire_seconds: o.expireInSeconds,
      partition: false,
      table_name: 'job_common',
    });
  });

  it('nada concedido a PUBLIC, anon, authenticated ni service_role', async () => {
    const filas = await consultar(
      `with objetos as (
         select 'tabla ' || c.relname as objeto,
                aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) as acl
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'cola' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
         union all
         select 'función ' || p.oid::regprocedure::text,
                aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'cola'
         union all
         select 'schema cola', aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner)))
         from pg_namespace n where n.nspname = 'cola'
       )
       select o.objeto, (o.acl).privilege_type as privilegio, coalesce(r.rolname, 'PUBLIC') as a
       from objetos o left join pg_roles r on r.oid = (o.acl).grantee
       where (o.acl).grantee = 0 or r.rolname = any(array['anon', 'authenticated', 'service_role'])`,
    );
    expect(filas).toEqual([]);
  });

  it('app_api solo puede encolar: insertar en job_common, leer queue y version', async () => {
    const tablas = await consultar<{ tabla: string; privilegios: string[] }>(
      `select c.relname as tabla, array_agg(p.priv order by p.priv) as privilegios
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
       where n.nspname = 'cola' and c.relkind in ('r', 'p') and has_table_privilege('app_api', c.oid, p.priv)
       group by c.relname order by 1`,
    );
    expect(tablas).toEqual([
      { tabla: 'job_common', privilegios: ['INSERT'] },
      { tabla: 'queue', privilegios: ['SELECT'] },
      { tabla: 'version', privilegios: ['SELECT'] },
    ]);
    const columnas = await consultar<{ columna: string }>(
      `select a.attname as columna from pg_attribute a
       where a.attrelid = 'cola.job_common'::regclass and a.attnum > 0 and not a.attisdropped
         and has_column_privilege('app_api', a.attrelid, a.attnum, 'SELECT')`,
    );
    expect(columnas).toEqual([{ columna: 'id' }]);
  });

  it('app_api encola dentro de su transacción y no ve ni toca los datos de los trabajos', async () => {
    const id = randomUUID();
    await enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, async (c) => {
      const insertado = await intentar(
        c,
        `insert into cola.job_common (id, name, data, created_on)
         values ($1, $2, $3, cola.job_now()) returning id`,
        [id, COLA_ARCHIVO_VERIFICAR.nombre, { clinicaId: A.clinicaId, archivoId: archivoA }],
      );
      expect(insertado).toMatchObject({ ok: true, filas: [{ id }] });
      for (const texto of [
        'select data from cola.job_common',
        'select * from cola.job',
        "update cola.job_common set state = 'completed'",
        'delete from cola.job_common',
        'select * from cola.instance',
        "select cola.create_queue('robada', '{}'::jsonb)",
      ]) {
        const r = await intentar(c, texto);
        expect({ texto, ok: r.ok }).toEqual({ texto, ok: false });
        if (!r.ok) expect(r.codigo).toBe('42501');
      }
    });
    // La transacción se revirtió (enTransaccion hace ROLLBACK): el trabajo no quedó.
    expect(await consultar('select 1 from cola.job where id = $1', [id])).toEqual([]);
  });
});

describe('conClinica y datos de los trabajos', () => {
  it('conClinica fija solo la clínica, en solo lectura', async () => {
    const ids = await conClinica(worker, A.clinicaId, async (c) => {
      const { rows } = await c.query<{ id: string; clinica: string | null }>(
        'select id, app.clinica_actual()::text as clinica from app.archivo',
      );
      return rows.map((f) => f.id);
    });
    expect(ids).toContain(archivoA);
    expect(ids).not.toContain(archivoB);
    await expect(
      conClinica(admin, A.clinicaId, (c) =>
        c.query(`update app.archivo set motivo_baja = 'x' where id = $1`, [archivoA]),
      ),
    ).rejects.toMatchObject({ code: '25006' });
    await expect(conClinica(worker, 'no-es-uuid', () => Promise.resolve(1))).rejects.toThrow(
      'UUID',
    );
  });

  it('leerTrabajoVerificarArchivo acepta solo { clinicaId, archivoId } con UUIDs', () => {
    const c = randomUUID();
    const a = randomUUID();
    expect(leerTrabajoVerificarArchivo({ clinicaId: c, archivoId: a })).toEqual({
      clinicaId: c,
      archivoId: a,
    });
    for (const malo of [
      null,
      [],
      'x',
      { clinicaId: c },
      { clinicaId: c, archivoId: a, ruta: '../x' },
      { clinicaId: c, archivoId: '../../etc/passwd' },
      { clinicaId: 1, archivoId: a },
    ]) {
      expect(leerTrabajoVerificarArchivo(malo)).toBeNull();
    }
  });
});
