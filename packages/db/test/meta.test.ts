/**
 * Meta-pruebas sobre el catálogo: protegen las migraciones futuras. Si una migración nueva crea una
 * tabla sin RLS forzado, concede algo a PUBLIC/anon/authenticated, olvida los triggers de
 * auditoría o arma una FK que puede cruzar de clínica, alguna de estas pruebas falla.
 */
import { ACCIONES, ACCIONES_AUDITORIA, ESTADOS_SEDE, MODULOS } from '@conecta/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCIONES_EVENTO,
  ESTADOS_MEMBRESIA,
  MOTIVOS_CIERRE_SESION,
  TIPOS_NUMERADOR,
} from '../src/esquema.js';
import { enTransaccion, nuevoPool, urls } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const ROLES_EXPUESTOS = ['anon', 'authenticated', 'service_role'];

async function consultar<T>(texto: string, parametros: unknown[] = []): Promise<T[]> {
  return enTransaccion(admin, {}, async (c) => (await c.query(texto, parametros)).rows as T[]);
}

/** Tablas del schema app (sin la de registro de migraciones). */
async function tablasDeApp(): Promise<string[]> {
  const filas = await consultar<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relname <> 'migracion'
     order by 1`,
  );
  return filas.map((f) => f.relname);
}

/** Tablas de app sin RLS habilitado, sin RLS forzado o sin políticas. */
const SQL_TABLAS_SIN_RLS = `
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not c.relforcerowsecurity
         or not exists (select 1 from pg_policy p where p.polrelid = c.oid))`;

/** Privilegios en el schema app concedidos a PUBLIC o a los roles de la API de datos de Supabase. */
const SQL_CONCESIONES_EXPUESTAS = `
  with objetos as (
    select 'tabla ' || c.relname as objeto,
           aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))) as acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    union all
    select 'columna ' || c.relname || '.' || a.attname, aclexplode(a.attacl)
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and a.attacl is not null
    union all
    select 'función ' || p.oid::regprocedure::text,
           aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
    union all
    select 'schema app', aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner)))
    from pg_namespace n where n.nspname = 'app'
  )
  select o.objeto, (o.acl).privilege_type as privilegio, coalesce(r.rolname, 'PUBLIC') as a
  from objetos o left join pg_roles r on r.oid = (o.acl).grantee
  where (o.acl).grantee = 0 or r.rolname = any($1)`;

describe('RLS en todo el schema app', () => {
  it('toda tabla tiene RLS habilitado y forzado y al menos una política', async () => {
    expect(await tablasDeApp()).toHaveLength(12);
    expect(await consultar(SQL_TABLAS_SIN_RLS)).toEqual([]);
  });

  it('el detector encuentra una tabla nueva sin RLS (prueba de la prueba)', async () => {
    await enTransaccion(admin, {}, async (c) => {
      await c.query('create table app.tabla_olvidada (id uuid primary key)');
      await c.query('create table app.tabla_sin_forzar (id uuid primary key)');
      await c.query('alter table app.tabla_sin_forzar enable row level security');
      await c.query('create policy p on app.tabla_sin_forzar using (false)');
      const { rows } = await c.query<{ relname: string }>(SQL_TABLAS_SIN_RLS);
      expect(rows.map((f) => f.relname).sort()).toEqual(['tabla_olvidada', 'tabla_sin_forzar']);
    });
  });

  it('no hay vistas que salteen RLS, vistas materializadas ni tablas foráneas en app', async () => {
    const filas = await consultar<{ relname: string; relkind: string; opciones: string[] | null }>(
      `select c.relname, c.relkind::text, c.reloptions as opciones
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind in ('v', 'm', 'f')`,
    );
    const peligrosas = filas.filter(
      (f) => f.relkind !== 'v' || !(f.opciones ?? []).includes('security_invoker=true'),
    );
    expect(peligrosas).toEqual([]);
  });

  it('ninguna política deja pasar todo (USING true / WITH CHECK true)', async () => {
    const filas = await consultar<{ tabla: string; politica: string }>(
      `select tablename as tabla, policyname as politica from pg_policies
       where schemaname = 'app' and tablename <> 'migracion'
         and (coalesce(qual, '') ~* '^\\(?true\\)?$' or coalesce(with_check, '') ~* '^\\(?true\\)?$')`,
    );
    expect(filas).toEqual([]);
  });

  it('toda tabla con clinica_id tiene una política que la compara con app.clinica_actual()', async () => {
    const filas = await consultar<{ tabla: string; ok: boolean }>(
      `select c.relname as tabla,
              exists (select 1 from pg_policies p
                      where p.schemaname = 'app' and p.tablename = c.relname
                        and (p.qual ~ 'clinica_id = app\\.clinica_actual\\(\\)'
                             or p.with_check ~ 'clinica_id = app\\.clinica_actual\\(\\)')) as ok
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'clinica_id' and not a.attisdropped
       where n.nspname = 'app' and c.relkind in ('r', 'p')`,
    );
    expect(filas.length).toBeGreaterThanOrEqual(9);
    expect(filas.filter((f) => !f.ok)).toEqual([]);
  });

  it('las políticas de escritura de tablas de negocio exigen la clínica del contexto en WITH CHECK', async () => {
    const filas = await consultar<{ tabla: string; politica: string }>(
      `select p.tablename as tabla, p.policyname as politica
       from pg_policies p
       join pg_class c on c.relname = p.tablename
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'clinica_id' and not a.attisdropped
       where p.schemaname = 'app' and p.tablename <> 'audit_log'
         and p.cmd in ('ALL', 'INSERT', 'UPDATE')
         and coalesce(p.with_check, p.qual, '') !~ 'clinica_id = app\\.clinica_actual\\(\\)'`,
    );
    expect(filas).toEqual([]);
  });
});

describe('privilegios', () => {
  it('nada concedido a PUBLIC, anon, authenticated ni service_role (tablas, columnas, secuencias, funciones, schema)', async () => {
    expect(await consultar(SQL_CONCESIONES_EXPUESTAS, [ROLES_EXPUESTOS])).toEqual([]);
  });

  it('el detector encuentra concesiones a PUBLIC y una función nueva sin REVOKE (prueba de la prueba)', async () => {
    await enTransaccion(admin, {}, async (c) => {
      await c.query('grant select on app.sede to public');
      await c.query('grant update (nombre) on app.sillon to public');
      // Una función nueva nace ejecutable por PUBLIC si la migración olvida asegurar_permisos().
      await c.query('create function app.funcion_olvidada() returns int language sql return 1');
      const { rows } = await c.query<{ objeto: string }>(SQL_CONCESIONES_EXPUESTAS, [
        ROLES_EXPUESTOS,
      ]);
      // La función aparece una vez por rol (PUBLIC y, en el embebido, anon/authenticated/service_role).
      expect([...new Set(rows.map((f) => f.objeto))].sort()).toEqual([
        'columna sillon.nombre',
        'función app.funcion_olvidada()',
        'tabla sede',
      ]);
    });
  });

  it('el procedimiento asegurar_permisos() quita lo que concedieron los privilegios por defecto', async () => {
    await enTransaccion(admin, {}, async (c) => {
      await c.query('create table app.tabla_nueva (id uuid primary key)');
      await c.query('create function app.otra_funcion() returns int language sql return 1');
      await c.query('call app.asegurar_permisos()');
      const { rows } = await c.query(SQL_CONCESIONES_EXPUESTAS, [ROLES_EXPUESTOS]);
      expect(rows).toEqual([]);
    });
  });

  it('app_api no es superusuario, no salta RLS, no crea roles ni bases, no es miembro de nada y no es dueño de nada', async () => {
    const [rol] = await consultar<Record<string, boolean>>(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit
       from pg_roles where rolname = 'app_api'`,
    );
    expect(rol).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolinherit: false,
    });
    const membresias = await consultar(
      `select r.rolname from pg_auth_members m join pg_roles r on r.oid = m.roleid
       where m.member = 'app_api'::regrole`,
    );
    expect(membresias).toEqual([]);
    const propios = await consultar(
      `select 'clase ' || relname from pg_class where relowner = 'app_api'::regrole
       union all select 'función ' || proname from pg_proc where proowner = 'app_api'::regrole
       union all select 'schema ' || nspname from pg_namespace where nspowner = 'app_api'::regrole
       union all select 'tipo ' || typname from pg_type where typowner = 'app_api'::regrole
       union all select 'base ' || datname from pg_database where datdba = 'app_api'::regrole`,
    );
    expect(propios).toEqual([]);
  });

  it('app_api no puede crear objetos en ningún schema ni crear schemas en la base', async () => {
    const schemas = await consultar<{ nspname: string }>(
      `select nspname from pg_namespace
       where has_schema_privilege('app_api', oid, 'CREATE') and nspname not like 'pg_temp%'`,
    );
    expect(schemas).toEqual([]);
    const [base] = await consultar<{ crear: boolean }>(
      `select has_database_privilege('app_api', current_database(), 'CREATE') as crear`,
    );
    expect(base?.crear).toBe(false);
  });

  it('app_api tiene exactamente los privilegios de tabla y de columna esperados', async () => {
    const esperados: Record<string, string[]> = {
      audit_log: ['SELECT'],
      clinica: ['SELECT', 'UPDATE'],
      membresia: ['INSERT', 'SELECT', 'UPDATE'],
      migracion: [],
      numerador: ['SELECT'],
      rol: ['INSERT', 'SELECT', 'UPDATE'],
      rol_permiso: ['INSERT', 'SELECT', 'UPDATE'],
      sede: ['INSERT', 'SELECT', 'UPDATE'],
      sede_horario: ['INSERT', 'SELECT', 'UPDATE'],
      sesion: ['SELECT'],
      sillon: ['INSERT', 'SELECT', 'UPDATE'],
      // UPDATE solo por columna (abajo): email y mfa_activo no son escribibles por app_api.
      usuario: ['SELECT'],
      usuario_sede: ['INSERT', 'SELECT', 'UPDATE'],
    };
    const filas = await consultar<{ tabla: string; privilegios: string[] }>(
      `select c.relname as tabla,
              coalesce(array_agg(p.priv order by p.priv) filter (where has_table_privilege('app_api', c.oid, p.priv)), '{}') as privilegios
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p(priv)
       where n.nspname = 'app' and c.relkind in ('r', 'p')
       group by c.relname`,
    );
    expect(Object.fromEntries(filas.map((f) => [f.tabla, f.privilegios]))).toEqual(esperados);
    // Privilegios por columna concedidos explícitamente (ACL de columna), de cualquier rol.
    const columnas = await consultar<{ columna: string; rol: string; privilegio: string }>(
      `select c.relname || '.' || a.attname as columna, coalesce(r.rolname, 'PUBLIC') as rol,
              (x.acl).privilege_type as privilegio
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral (select aclexplode(a.attacl) as acl) x
       left join pg_roles r on r.oid = (x.acl).grantee
       where n.nspname = 'app' and a.attacl is not null
       order by 1, 2, 3`,
    );
    expect(columnas).toEqual([
      { columna: 'usuario.nombre', rol: 'app_api', privilegio: 'UPDATE' },
      { columna: 'usuario.telefono', rol: 'app_api', privilegio: 'UPDATE' },
      { columna: 'usuario.ultimo_acceso', rol: 'app_api', privilegio: 'UPDATE' },
    ]);
  });

  it('app_api solo puede ejecutar las funciones previstas', async () => {
    const filas = await consultar<{ funcion: string }>(
      `select p.oid::regprocedure::text as funcion from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and has_function_privilege('app_api', p.oid, 'EXECUTE')
       order by 1`,
    );
    expect(filas.map((f) => f.funcion)).toEqual([
      'app.activar_mfa(timestamp with time zone)',
      'app.cerrar_sesion(uuid)',
      'app.clinica_actual()',
      'app.desactivar_mfa()',
      'app.registrar_evento(text,text,uuid,jsonb,uuid)',
      'app.siguiente_numero(text,uuid)',
      'app.tocar_sesion(uuid,integer)',
      'app.usuario_actual()',
    ]);
  });

  it('ninguna función SECURITY DEFINER escribe en membresia, usuario_sede, rol o rol_permiso', async () => {
    // Corren como el dueño de las tablas, al que app.proteger_acceso() exceptúa: si una (llamada por
    // app_api o disparada como trigger) escribiera ahí, sería un camino para saltarse las reglas.
    const filas = await consultar<{ funcion: string }>(
      `select p.oid::regprocedure::text as funcion from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef
         and p.prosrc ~* '(insert\\s+into|update|merge\\s+into)\\s+app\\.(membresia|usuario_sede|rol|rol_permiso)\\M'`,
    );
    expect(filas).toEqual([]);
    // Prueba de la prueba: el patrón encuentra una escritura así.
    const [control] = await consultar<{ ok: boolean }>(
      `select 'update app.rol_permiso set activo = true' ~* '(insert\\s+into|update|merge\\s+into)\\s+app\\.(membresia|usuario_sede|rol|rol_permiso)\\M' as ok`,
    );
    expect(control?.ok).toBe(true);
  });
});

describe('funciones', () => {
  it('las SECURITY DEFINER fijan search_path = pg_catalog, pg_temp', async () => {
    const filas = await consultar<{ funcion: string; config: string[] | null }>(
      `select p.oid::regprocedure::text as funcion, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef order by 1`,
    );
    expect(filas.map((f) => f.funcion)).toEqual([
      'app.activar_mfa(timestamp with time zone)',
      'app.auditar()',
      'app.cerrar_sesion(uuid)',
      'app.desactivar_mfa()',
      'app.registrar_evento(text,text,uuid,jsonb,uuid)',
      'app.siguiente_numero(text,uuid)',
      'app.tocar_sesion(uuid,integer)',
    ]);
    for (const fila of filas) {
      expect({ funcion: fila.funcion, config: fila.config }).toEqual({
        funcion: fila.funcion,
        config: ['search_path=pg_catalog, pg_temp'],
      });
    }
  });

  it('toda función de app tiene search_path fijo o cuerpo SQL estándar (ligado al crearla)', async () => {
    const filas = await consultar<{ funcion: string }>(
      `select p.oid::regprocedure::text as funcion from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosqlbody is null
         and not coalesce(p.proconfig, '{}') && array['search_path=pg_catalog, pg_temp']`,
    );
    expect(filas).toEqual([]);
  });
});

describe('triggers de auditoría y de no borrado', () => {
  // tgtype: 1 fila, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE.
  // numerador y sesion cambian en cada pedido: su registro es otro (el documento numerado, 'ingresar').
  const SIN_AUDITAR = ['audit_log', 'numerador', 'sesion'];

  async function triggers(): Promise<
    { tabla: string; funcion: string; tipo: number; argumentos: string[] }[]
  > {
    return consultar(
      `select c.relname as tabla, p.proname as funcion, t.tgtype::int as tipo,
              array_remove(string_to_array(encode(t.tgargs, 'escape'), E'\\\\000'), '') as argumentos
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
       where n.nspname = 'app' and not t.tgisinternal and t.tgenabled <> 'D'`,
    );
  }

  it('toda tabla auditada declara como primer argumento de app.auditar() un módulo de MODULOS', async () => {
    const auditadas = (await triggers()).filter((t) => t.funcion === 'auditar');
    expect(auditadas.length).toBeGreaterThanOrEqual(9);
    const sinModuloValido = auditadas.filter(
      (t) => !(MODULOS as readonly string[]).includes(t.argumentos[0] ?? ''),
    );
    expect(sinModuloValido.map((t) => ({ tabla: t.tabla, argumentos: t.argumentos }))).toEqual([]);
    // El mapa de hoy, explícito: cambiar el módulo de una tabla cambia quién ve sus eventos.
    expect(
      Object.fromEntries(auditadas.map((t) => [t.tabla, t.argumentos[0]] as const).sort()),
    ).toEqual({
      clinica: 'configuracion',
      membresia: 'personal',
      rol: 'configuracion',
      rol_permiso: 'configuracion',
      sede: 'sedes',
      sede_horario: 'sedes',
      sillon: 'sedes',
      usuario: 'personal',
      usuario_sede: 'personal',
    });
  });

  it('app.modulo_de_entidad() lee el módulo del trigger (y sesion es de personal)', async () => {
    const filas = await consultar<{ entidad: string; modulo: string | null }>(
      `select e as entidad, app.modulo_de_entidad(e) as modulo
       from unnest(array['sede', 'usuario', 'rol_permiso', 'sesion', 'numerador', 'audit_log',
                         'migracion', 'paciente', 'Sede', 'sede"; select 1; --']) e`,
    );
    expect(Object.fromEntries(filas.map((f) => [f.entidad, f.modulo]))).toEqual({
      sede: 'sedes',
      usuario: 'personal',
      rol_permiso: 'configuracion',
      sesion: 'personal',
      numerador: null,
      audit_log: null,
      migracion: null,
      paciente: null,
      Sede: null,
      'sede"; select 1; --': null,
    });
  });

  it('app.auditar() sin módulo rechaza el cambio (prueba de la prueba)', async () => {
    await enTransaccion(admin, {}, async (c) => {
      await c.query('create table app.sin_modulo (id uuid primary key)');
      await c.query(
        'create trigger t after insert on app.sin_modulo for each row execute function app.auditar()',
      );
      await expect(
        c.query('insert into app.sin_modulo values (gen_random_uuid())'),
      ).rejects.toThrow('tiene que declarar su módulo');
    });
  });

  it('membresia, usuario_sede, rol y rol_permiso tienen el trigger de defensa; membresia, el del último dueño', async () => {
    const todas = await triggers();
    for (const tabla of ['membresia', 'usuario_sede', 'rol', 'rol_permiso']) {
      const ok = todas.some(
        (t) => t.tabla === tabla && t.funcion === 'proteger_acceso' && t.tipo === (1 | 2 | 4 | 16),
      );
      expect({ tabla, ok }).toEqual({ tabla, ok: true });
    }
    expect(
      todas.some(
        (t) =>
          t.tabla === 'membresia' && t.funcion === 'proteger_ultimo_dueno' && t.tipo === (1 | 16),
      ),
    ).toBe(true);
  });

  it('toda tabla (salvo audit_log) fija la auditoría de fila antes de insertar y actualizar', async () => {
    const todas = await triggers();
    for (const tabla of (await tablasDeApp()).filter((t) => t !== 'audit_log')) {
      const ok = todas.some(
        (t) =>
          t.tabla === tabla && t.funcion === 'fijar_auditoria_fila' && t.tipo === (1 | 2 | 4 | 16),
      );
      expect({ tabla, ok }).toEqual({ tabla, ok: true });
    }
  });

  it('toda tabla (salvo audit_log y numerador) tiene app.auditar() AFTER INSERT/UPDATE/DELETE', async () => {
    const todas = await triggers();
    for (const tabla of (await tablasDeApp()).filter((t) => !SIN_AUDITAR.includes(t))) {
      const ok = todas.some(
        (t) => t.tabla === tabla && t.funcion === 'auditar' && t.tipo === (1 | 4 | 8 | 16),
      );
      expect({ tabla, ok }).toEqual({ tabla, ok: true });
    }
  });

  it('toda tabla rechaza DELETE y TRUNCATE con trigger; audit_log además UPDATE', async () => {
    const todas = await triggers();
    for (const tabla of await tablasDeApp()) {
      const ok =
        tabla === 'audit_log'
          ? todas.some(
              (t) =>
                t.tabla === tabla &&
                t.funcion === 'rechazar_modificacion' &&
                t.tipo === (2 | 8 | 16 | 32),
            )
          : todas.some(
              (t) =>
                t.tabla === tabla && t.funcion === 'rechazar_borrado' && t.tipo === (2 | 8 | 32),
            );
      expect({ tabla, ok }).toEqual({ tabla, ok: true });
    }
  });

  it('toda tabla (salvo audit_log) tiene created_at, created_by, updated_at y updated_by', async () => {
    const filas = await consultar<{ tabla: string; faltan: string[] }>(
      `select c.relname as tabla,
              array(select x from unnest(array['created_at', 'created_by', 'updated_at', 'updated_by']) x
                    where not exists (select 1 from pg_attribute a where a.attrelid = c.oid
                                      and a.attname = x and not a.attisdropped)) as faltan
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relname not in ('audit_log', 'migracion')`,
    );
    expect(filas.filter((f) => f.faltan.length > 0)).toEqual([]);
  });
});

describe('integridad entre clínicas', () => {
  it('toda tabla de negocio tiene clinica_id NOT NULL con FK a clinica y UNIQUE (clinica_id, id)', async () => {
    const filas = await consultar<{ tabla: string; no_nulo: boolean; fk: boolean; unico: boolean }>(
      `select c.relname as tabla, a.attnotnull as no_nulo,
              exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f'
                      and k.confrelid = 'app.clinica'::regclass and k.conkey = array[a.attnum]) as fk,
              exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype in ('u', 'p')
                      and (select array_agg(attname::text order by attname) from pg_attribute
                           where attrelid = c.oid and attnum = any(k.conkey)) = array['clinica_id', 'id']) as unico
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'clinica_id' and not a.attisdropped
       where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relname <> 'audit_log'`,
    );
    expect(filas.length).toBeGreaterThanOrEqual(8);
    expect(filas.filter((f) => !f.no_nulo || !f.fk || !f.unico)).toEqual([]);
  });

  it('toda FK entre tablas de negocio es compuesta e incluye clinica_id de los dos lados', async () => {
    const filas = await consultar<{ restriccion: string; ok: boolean }>(
      `select k.conname as restriccion,
              exists (select 1 from generate_subscripts(k.conkey, 1) i
                      where (select attname from pg_attribute where attrelid = k.conrelid and attnum = k.conkey[i]) = 'clinica_id'
                        and (select attname from pg_attribute where attrelid = k.confrelid and attnum = k.confkey[i]) = 'clinica_id') as ok
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and k.contype = 'f' and k.confrelid <> 'app.clinica'::regclass
         and exists (select 1 from pg_attribute where attrelid = k.conrelid and attname = 'clinica_id')
         and exists (select 1 from pg_attribute where attrelid = k.confrelid and attname = 'clinica_id')`,
    );
    expect(filas.length).toBeGreaterThanOrEqual(8);
    expect(filas.filter((f) => !f.ok)).toEqual([]);
  });
});

describe('valores de los CHECK sincronizados con el código', () => {
  async function valoresDelCheck(restriccion: string): Promise<string[]> {
    const [fila] = await consultar<{ definicion: string }>(
      `select pg_get_constraintdef(oid) as definicion from pg_constraint
       where conname = $1 and connamespace = 'app'::regnamespace`,
      [restriccion],
    );
    expect(fila, `no existe la restricción ${restriccion}`).toBeDefined();
    return [...(fila?.definicion ?? '').matchAll(/'([^']+)'::text/g)].map((m) => m[1] ?? '');
  }

  // Los de @conecta/shared son el contrato de la API: la base tiene que aceptar exactamente eso.
  it.each([
    ['rol_permiso_modulo_check', MODULOS],
    ['rol_permiso_accion_check', ACCIONES],
    ['audit_log_modulo_check', MODULOS],
    ['audit_log_accion_check', ACCIONES_AUDITORIA],
    ['sede_estado_check', ESTADOS_SEDE],
    ['membresia_estado_check', ESTADOS_MEMBRESIA],
    ['numerador_tipo_check', TIPOS_NUMERADOR],
    ['sesion_motivo_cierre_check', MOTIVOS_CIERRE_SESION],
  ] as const)('%s coincide con el código', async (restriccion, valores) => {
    expect((await valoresDelCheck(restriccion)).sort()).toEqual([...valores].sort());
  });

  it('las acciones que acepta registrar_evento son de ACCIONES_AUDITORIA y coinciden con ACCIONES_EVENTO', async () => {
    expect(
      ACCIONES_EVENTO.every((a) => (ACCIONES_AUDITORIA as readonly string[]).includes(a)),
    ).toBe(true);
    const [fila] = await consultar<{ fuente: string }>(
      `select prosrc as fuente from pg_proc
       where oid = 'app.registrar_evento(text,text,uuid,jsonb,uuid)'::regprocedure`,
    );
    const lista = /p_accion NOT IN \(([^)]*)\)/.exec(fila?.fuente ?? '')?.[1] ?? '';
    const enLaBase = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(enLaBase.sort()).toEqual([...ACCIONES_EVENTO].sort());
  });

  it('las matrices de alta_clinica y los roles de sistema usan los módulos y acciones de shared', async () => {
    const [fila] = await consultar<{ fuente: string }>(
      `select prosrc as fuente from pg_proc
       where oid = 'app.alta_clinica(text,uuid,text,text,text,text,uuid)'::regprocedure`,
    );
    const fuente = fila?.fuente ?? '';
    const modulosDelDueno =
      /FROM unnest\(ARRAY\[([^\]]*)\]\) AS m\(modulo\)/.exec(fuente)?.[1] ?? '';
    expect([...modulosDelDueno.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual(
      [...MODULOS].sort(),
    );
  });
});
