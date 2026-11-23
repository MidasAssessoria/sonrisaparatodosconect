/**
 * Meta-pruebas sobre el catálogo: protegen las migraciones futuras. Si una migración nueva crea una
 * tabla sin RLS forzado, concede algo a PUBLIC/anon/authenticated, olvida los triggers de
 * auditoría o arma una FK que puede cruzar de clínica, alguna de estas pruebas falla.
 */
import {
  ACCIONES,
  ACCIONES_AUDITORIA,
  CATEGORIAS_ARCHIVO,
  ESTADOS_SEDE,
  MODULOS,
  NOMBRES_CATEGORIA_ARCHIVO,
  IDIOMAS_PACIENTE,
  ORIGENES_PACIENTE,
  SEXOS,
  TASAS_IVA,
  TIPOS_ALERTA,
  TIPOS_RELACION,
} from '@conecta/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCIONES_EVENTO,
  ALMACENES_ARCHIVO,
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
    expect(await tablasDeApp()).toHaveLength(24);
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

  it('las políticas RESTRICTIVAS son las previstas (0023: ficha_clinica solo con ver, auditoría por módulo)', async () => {
    const filas = await consultar<{ tabla: string; politica: string; cmd: string }>(
      `select tablename as tabla, policyname as politica, cmd from pg_policies
       where schemaname = 'app' and permissive = 'RESTRICTIVE' order by 1, 2`,
    );
    expect(filas).toEqual([
      { tabla: 'audit_log', politica: 'audit_log_modulo', cmd: 'SELECT' },
      { tabla: 'paciente_alerta', politica: 'paciente_alerta_inactiva_editar', cmd: 'UPDATE' },
      { tabla: 'paciente_alerta', politica: 'paciente_alerta_inactiva_ver', cmd: 'SELECT' },
      { tabla: 'paciente_nota', politica: 'paciente_nota_editar_ver', cmd: 'UPDATE' },
      { tabla: 'paciente_nota', politica: 'paciente_nota_escribir_ver', cmd: 'INSERT' },
    ]);
    // La de auditoría mira el módulo de la fila contra los módulos con «ver» del usuario.
    const [auditoria] = await consultar<{ qual: string }>(
      `select qual from pg_policies where schemaname = 'app' and policyname = 'audit_log_modulo'`,
    );
    expect(auditoria?.qual).toMatch(/modulos_con_accion\('ver'::text\)/);
    // Todas exceptúan solo a una SESIÓN del dueño (como las defensas): current_user y session_user.
    const sinExcepcion = await consultar<{ politica: string }>(
      `select policyname as politica from pg_policies
       where schemaname = 'app' and permissive = 'RESTRICTIVE'
         and coalesce(qual, with_check) !~ 'sesion_del_dueno\\(\\)'`,
    );
    expect(sinExcepcion).toEqual([]);
    const [cuerpo] = await consultar<{ src: string }>(
      `select prosrc as src from pg_proc where oid = 'app.sesion_del_dueno()'::regprocedure`,
    );
    expect(cuerpo?.src).toMatch(/pg_has_role\(current_user/);
    expect(cuerpo?.src).toMatch(/pg_has_role\(session_user/);
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
      agenda_config: ['INSERT', 'SELECT', 'UPDATE'],
      archivo: ['INSERT', 'SELECT', 'UPDATE'],
      audit_log: ['SELECT'],
      clinica: ['SELECT', 'UPDATE'],
      // INSERT y UPDATE solo por columna (abajo): ni id, ni uso, ni autor; solo anular.
      invitacion: ['SELECT'],
      membresia: ['INSERT', 'SELECT', 'UPDATE'],
      migracion: [],
      numerador: ['SELECT'],
      profesional: ['INSERT', 'SELECT', 'UPDATE'],
      profesional_bloqueo: ['INSERT', 'SELECT', 'UPDATE'],
      profesional_disponibilidad: ['INSERT', 'SELECT', 'UPDATE'],
      rol: ['INSERT', 'SELECT', 'UPDATE'],
      rol_permiso: ['INSERT', 'SELECT', 'UPDATE'],
      sede: ['INSERT', 'SELECT', 'UPDATE'],
      sede_horario: ['INSERT', 'SELECT', 'UPDATE'],
      sesion: ['SELECT'],
      sillon: ['INSERT', 'SELECT', 'UPDATE'],
      tratamiento: ['INSERT', 'SELECT', 'UPDATE'],
      // UPDATE solo por columna (abajo): email y mfa_activo no son escribibles por app_api.
      usuario: ['SELECT'],
      usuario_sede: ['INSERT', 'SELECT', 'UPDATE'],
      paciente: ['INSERT', 'SELECT', 'UPDATE'],
      // Índice de búsqueda: lo escribe la base (paciente_indexar).
      paciente_busqueda: ['SELECT'],
      paciente_relacion: ['INSERT', 'SELECT', 'UPDATE'],
      paciente_alerta: ['INSERT', 'SELECT', 'UPDATE'],
      paciente_nota: ['INSERT', 'SELECT', 'UPDATE'],
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
      { columna: 'invitacion.anulada_en', rol: 'app_api', privilegio: 'UPDATE' },
      { columna: 'invitacion.clinica_id', rol: 'app_api', privilegio: 'INSERT' },
      { columna: 'invitacion.email', rol: 'app_api', privilegio: 'INSERT' },
      { columna: 'invitacion.membresia_id', rol: 'app_api', privilegio: 'INSERT' },
      { columna: 'invitacion.motivo_anulacion', rol: 'app_api', privilegio: 'UPDATE' },
      { columna: 'invitacion.nombre', rol: 'app_api', privilegio: 'INSERT' },
      { columna: 'invitacion.token_hash', rol: 'app_api', privilegio: 'INSERT' },
      { columna: 'invitacion.vence_en', rol: 'app_api', privilegio: 'INSERT' },
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
    expect(filas.map((f) => f.funcion).sort()).toEqual(
      [
        'app.aceptar_invitacion(text,uuid,text)',
        'app.activar_mfa(timestamp with time zone)',
        // 0015: ayudas de los límites (SECURITY INVOKER, con RLS) y bajas con motivo.
        'app.alcance_sedes(uuid,uuid)',
        'app.anular_invitacion(uuid,text)',
        'app.cerrar_sesion(uuid)',
        'app.clinica_actual()',
        'app.consultar_invitacion(text)',
        'app.crear_invitacion(text,text,uuid,uuid[],uuid,text,timestamp with time zone)',
        'app.desactivar_membresia(uuid,text)',
        'app.desactivar_mfa()',
        'app.desactivar_rol(uuid,text)',
        // 0018: la única forma de encolar.
        'app.encolar(text,jsonb)',
        'app.membresia_en_alcance(uuid)',
        'app.permisos_de_rol(uuid,uuid)',
        'app.reemplazar_permisos_rol(uuid,text[])',
        'app.reenviar_invitacion(uuid,text,timestamp with time zone)',
        'app.registrar_evento(text,text,uuid,jsonb,uuid)',
        'app.siguiente_numero(text,uuid)',
        'app.tocar_sesion(uuid,integer)',
        'app.usuario_actual()',
        // 0019–0022: pacientes (todas SECURITY INVOKER, ver la prueba siguiente).
        'app.baja_relacion(uuid,text)',
        'app.buscar_pacientes(text,integer,boolean,timestamp with time zone)',
        'app.cambiar_alerta(uuid,boolean)',
        'app.clave_orden(text)',
        'app.crear_alerta(uuid,text,text)',
        'app.crear_relacion(uuid,uuid,text,boolean,boolean,boolean,boolean)',
        'app.desactivar_paciente(uuid,text)',
        'app.escapar_like(text)',
        'app.guardar_nota_interna(uuid,text)',
        'app.hoy_clinica(timestamp with time zone)',
        'app.listar_pacientes(text,text,text,integer,timestamp with time zone)',
        'app.normalizar_busqueda(text)',
        'app.pacientes_con_ci(text,uuid,timestamp with time zone)',
        'app.patron_busqueda()',
        'app.reactivar_paciente(uuid)',
        'app.terminos_busqueda(text)',
        'app.tiene_permiso(text,text)',
        'app.tipo_relacion_inverso(text,text)',
        'app.tipos_relacion_compatibles(text,text)',
        // 0023–0027: revisión del Sprint 3 (todas SECURITY INVOKER).
        'app.cursor_paciente(text,text,uuid)',
        'app.edad_en(date,date)',
        'app.editar_relacion(uuid,boolean,boolean,boolean,boolean)',
        'app.modulos_con_accion(text)',
        'app.resumen_pacientes(timestamp with time zone)',
        'app.sesion_del_dueno()',
      ].sort(),
    );
  });

  it('las funciones nuevas que app_api ejecuta, salvo encolar, son SECURITY INVOKER (corren con RLS y las defensas)', async () => {
    const filas = await consultar<{ funcion: string; definer: boolean }>(
      `select p.oid::regprocedure::text as funcion, p.prosecdef as definer from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = any($1)`,
      [
        [
          'alcance_sedes',
          'membresia_en_alcance',
          'permisos_de_rol',
          'desactivar_membresia',
          'desactivar_rol',
          'encolar',
          'buscar_pacientes',
          'listar_pacientes',
          'pacientes_con_ci',
          'desactivar_paciente',
          'reactivar_paciente',
          'crear_relacion',
          'baja_relacion',
          'crear_alerta',
          'cambiar_alerta',
          'guardar_nota_interna',
          'tiene_permiso',
          'editar_relacion',
          'resumen_pacientes',
          'modulos_con_accion',
          'cursor_paciente',
          'edad_en',
          'revisar_vinculos_por_sexo',
          'sesion_del_dueno',
        ],
      ],
    );
    expect(Object.fromEntries(filas.map((f) => [f.funcion, f.definer]))).toEqual({
      'app.alcance_sedes(uuid,uuid)': false,
      'app.membresia_en_alcance(uuid)': false,
      'app.permisos_de_rol(uuid,uuid)': false,
      'app.desactivar_membresia(uuid,text)': false,
      'app.desactivar_rol(uuid,text)': false,
      'app.encolar(text,jsonb)': true,
      'app.buscar_pacientes(text,integer,boolean,timestamp with time zone)': false,
      'app.listar_pacientes(text,text,text,integer,timestamp with time zone)': false,
      'app.pacientes_con_ci(text,uuid,timestamp with time zone)': false,
      'app.desactivar_paciente(uuid,text)': false,
      'app.reactivar_paciente(uuid)': false,
      'app.crear_relacion(uuid,uuid,text,boolean,boolean,boolean,boolean)': false,
      'app.baja_relacion(uuid,text)': false,
      'app.crear_alerta(uuid,text,text)': false,
      'app.cambiar_alerta(uuid,boolean)': false,
      'app.guardar_nota_interna(uuid,text)': false,
      'app.tiene_permiso(text,text)': false,
      'app.editar_relacion(uuid,boolean,boolean,boolean,boolean)': false,
      'app.resumen_pacientes(timestamp with time zone)': false,
      'app.modulos_con_accion(text)': false,
      'app.cursor_paciente(text,text,uuid)': false,
      'app.edad_en(date,date)': false,
      // Trigger de cambio de sexo: también corre como app_api (RLS y pacientes:editar).
      'app.revisar_vinculos_por_sexo()': false,
      'app.sesion_del_dueno()': false,
    });
  });

  it('ninguna función SECURITY DEFINER escribe en membresia, usuario_sede, rol o rol_permiso (salvo aceptar_invitacion)', async () => {
    // Corren como el dueño de las tablas: si una (llamada por app_api o disparada como trigger)
    // escribiera ahí con la excepción del dueño, sería un camino para saltarse las reglas.
    // La única es app.aceptar_invitacion (activa la membresía del token): desde 0010 la excepción de
    // app.proteger_acceso() exige que también la SESIÓN sea del dueño, así que dentro de una función
    // SECURITY DEFINER llamada por app_api las reglas se aplican igual (ver la prueba siguiente y
    // test/invitaciones-adversarial.test.ts). Una función nueva que aparezca acá se revisa a mano.
    const filas = await consultar<{ funcion: string }>(
      `select p.oid::regprocedure::text as funcion from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef
         and p.prosrc ~* '(insert\\s+into|update|merge\\s+into)\\s+app\\.(membresia|usuario_sede|rol|rol_permiso)\\M'`,
    );
    expect(filas).toEqual([{ funcion: 'app.aceptar_invitacion(text,uuid,text)' }]);
    // Prueba de la prueba: el patrón encuentra una escritura así.
    const [control] = await consultar<{ ok: boolean }>(
      `select 'update app.rol_permiso set activo = true' ~* '(insert\\s+into|update|merge\\s+into)\\s+app\\.(membresia|usuario_sede|rol|rol_permiso)\\M' as ok`,
    );
    expect(control?.ok).toBe(true);
  });

  it('las defensas exceptúan solo a una SESIÓN del dueño de las tablas, no a una función SECURITY DEFINER', async () => {
    // current_user es el dueño también dentro de una función SECURITY DEFINER llamada por app_api;
    // session_user no. Toda defensa con excepción del dueño tiene que mirar los dos.
    const filas = await consultar<{ funcion: string; ok: boolean }>(
      `select p.proname as funcion,
              p.prosrc ~ 'pg_has_role\\(current_user, v_dueno_tablas' and p.prosrc ~ 'pg_has_role\\(session_user, v_dueno_tablas' as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.proname in ('proteger_acceso', 'proteger_invitacion', 'proteger_profesional',
                           'limitar_rol_al_actor', 'proteger_pacientes')
       order by 1`,
    );
    expect(filas).toEqual([
      { funcion: 'limitar_rol_al_actor', ok: true },
      { funcion: 'proteger_acceso', ok: true },
      { funcion: 'proteger_invitacion', ok: true },
      { funcion: 'proteger_pacientes', ok: true },
      { funcion: 'proteger_profesional', ok: true },
    ]);
  });
});

describe('funciones', () => {
  it('las SECURITY DEFINER fijan search_path = pg_catalog, pg_temp', async () => {
    const filas = await consultar<{ funcion: string; config: string[] | null }>(
      `select p.oid::regprocedure::text as funcion, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef order by 1`,
    );
    expect(filas.map((f) => f.funcion).sort()).toEqual(
      [
        'app.aceptar_invitacion(text,uuid,text)',
        'app.activar_mfa(timestamp with time zone)',
        'app.auditar()',
        'app.cerrar_sesion(uuid)',
        'app.consultar_invitacion(text)',
        'app.desactivar_mfa()',
        'app.encolar(text,jsonb)',
        // 0019: mantiene el índice de búsqueda (app_api no escribe paciente_busqueda).
        'app.indexar_paciente()',
        'app.registrar_evento(text,text,uuid,jsonb,uuid)',
        'app.siguiente_numero(text,uuid)',
        'app.tocar_sesion(uuid,integer)',
      ].sort(),
    );
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
  // paciente_busqueda es un dato derivado de paciente (cuyos cambios sí se auditan).
  const SIN_AUDITAR = ['audit_log', 'numerador', 'sesion', 'paciente_busqueda'];

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
      agenda_config: 'sedes',
      // Módulo de la tabla para app.modulo_de_entidad(); cada evento lleva el de su fila (columna
      // generada modulo, ver la prueba de archivo más abajo).
      archivo: 'configuracion',
      clinica: 'configuracion',
      invitacion: 'personal',
      membresia: 'personal',
      profesional: 'personal',
      profesional_bloqueo: 'personal',
      profesional_disponibilidad: 'personal',
      rol: 'configuracion',
      rol_permiso: 'configuracion',
      sede: 'sedes',
      sede_horario: 'sedes',
      sillon: 'sedes',
      tratamiento: 'configuracion',
      usuario: 'personal',
      usuario_sede: 'personal',
      paciente: 'pacientes',
      paciente_relacion: 'pacientes',
      paciente_alerta: 'ficha_clinica',
      paciente_nota: 'ficha_clinica',
    });
  });

  it('solo una columna «modulo» GENERADA cambia el módulo por fila: hoy, únicamente archivo', async () => {
    // rol_permiso también tiene una columna modulo (el del permiso), pero no es generada: no cuenta.
    const filas = await consultar<{ tabla: string }>(
      `select c.relname as tabla from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r' and app.tiene_modulo_generado(c.oid) order by 1`,
    );
    expect(filas.map((f) => f.tabla)).toEqual(['archivo']);
    const [control] = await consultar<{ rol_permiso: boolean }>(
      "select app.tiene_modulo_generado('app.rol_permiso'::regclass) as rol_permiso",
    );
    expect(control?.rol_permiso).toBe(false);
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
      paciente: 'pacientes',
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
    // 0010: invitacion tiene su propia defensa, y el usuario de una membresía se fija una sola vez.
    expect(
      todas.some(
        (t) =>
          t.tabla === 'invitacion' &&
          t.funcion === 'proteger_invitacion' &&
          t.tipo === (1 | 2 | 4 | 16),
      ),
    ).toBe(true);
    expect(
      todas.some(
        (t) =>
          t.tabla === 'membresia' &&
          t.funcion === 'fijar_usuario_membresia' &&
          t.tipo === (1 | 2 | 16),
      ),
    ).toBe(true);
    // 0015: vínculo profesional-membresía, límite de los roles (al terminar la sentencia) y motivo
    // de baja normalizado. 0016: cascada de la baja de una sede y nada activo en una sede de baja.
    const esperados: [string, string, number][] = [
      ['profesional', 'proteger_profesional', 1 | 2 | 4 | 16],
      ['rol', 'limitar_rol_al_actor', 1 | 4 | 16],
      ['rol_permiso', 'limitar_rol_al_actor', 1 | 4 | 16],
      ['membresia', 'fijar_motivo_baja', 1 | 2 | 4 | 16],
      ['rol', 'fijar_motivo_baja', 1 | 2 | 4 | 16],
      ['sede', 'dar_de_baja_sede_en_cascada', 1 | 16],
      ['membresia', 'exigir_sede_vigente', 1 | 2 | 4 | 16],
      ['usuario_sede', 'exigir_sede_vigente', 1 | 2 | 4 | 16],
      ['profesional_disponibilidad', 'exigir_sede_vigente', 1 | 2 | 4 | 16],
      ['sillon', 'exigir_sede_vigente', 1 | 2 | 4 | 16],
    ];
    for (const [tabla, funcion, tipo] of esperados) {
      const ok = todas.some((t) => t.tabla === tabla && t.funcion === funcion && t.tipo === tipo);
      expect({ tabla, funcion, ok }).toEqual({ tabla, funcion, ok: true });
    }
    // Los límites de rol son CONSTRAINT TRIGGER diferibles (inmediatos por defecto).
    const limites = await consultar<{ nombre: string; diferible: boolean; diferido: boolean }>(
      `select t.tgname as nombre, t.tgdeferrable as diferible, t.tginitdeferred as diferido
       from pg_trigger t where t.tgfoid = 'app.limitar_rol_al_actor()'::regprocedure order by 1`,
    );
    expect(limites).toEqual([
      { nombre: 'rol_limite_actor', diferible: true, diferido: false },
      { nombre: 'rol_permiso_limite_actor', diferible: true, diferido: false },
    ]);
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
    ['archivo_categoria_check', NOMBRES_CATEGORIA_ARCHIVO],
    ['archivo_almacen_check', ALMACENES_ARCHIVO],
    ['paciente_sexo_check', SEXOS],
    ['paciente_idioma_check', IDIOMAS_PACIENTE],
    ['paciente_origen_check', ORIGENES_PACIENTE],
    ['paciente_relacion_tipo_check', TIPOS_RELACION],
    ['paciente_alerta_tipo_check', TIPOS_ALERTA],
  ] as const)('%s coincide con el código', async (restriccion, valores) => {
    expect((await valoresDelCheck(restriccion)).sort()).toEqual([...valores].sort());
  });

  it('tratamiento_iva_check acepta exactamente TASAS_IVA', async () => {
    const [fila] = await consultar<{ definicion: string }>(
      `select pg_get_constraintdef(oid) as definicion from pg_constraint
       where conname = 'tratamiento_iva_check' and connamespace = 'app'::regnamespace`,
    );
    const lista = /ARRAY\[([^\]]*)\]/.exec(fila?.definicion ?? '')?.[1] ?? '';
    const valores = [...lista.matchAll(/-?\d+/g)].map((m) => Number(m[0]));
    expect(valores.sort()).toEqual([...TASAS_IVA].sort());
  });

  it('el módulo generado de archivo es el de CATEGORIAS_ARCHIVO para cada categoría', async () => {
    // La expresión de la columna generada, leída de la base: WHEN '<categoria>' THEN '<modulo>'.
    const [fila] = await consultar<{ expresion: string }>(
      `select pg_get_expr(d.adbin, d.adrelid) as expresion
       from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
       where d.adrelid = 'app.archivo'::regclass and a.attname = 'modulo' and a.attgenerated = 's'`,
    );
    const mapa: Record<string, string> = Object.fromEntries(
      [...(fila?.expresion ?? '').matchAll(/WHEN '([^']+)'::text THEN '([^']+)'::text/g)].map(
        (m): [string, string] => [m[1] ?? '', m[2] ?? ''],
      ),
    );
    expect(mapa).toEqual(
      Object.fromEntries(Object.entries(CATEGORIAS_ARCHIVO).map(([c, d]) => [c, d.modulo])),
    );
    // Y en los hechos: cada categoría, insertada, deja ese módulo (se revierte).
    await enTransaccion(admin, {}, async (c) => {
      const clinica = await c.query<{ id: string }>('select gen_random_uuid() as id');
      const id = clinica.rows[0]!.id;
      await c.query("select set_config('app.clinica_id', $1, true)", [id]);
      await c.query(
        "insert into app.clinica (id, nombre) values ($1, 'Clínica de la meta-prueba')",
        [id],
      );
      for (const [categoria, datos] of Object.entries(CATEGORIAS_ARCHIVO)) {
        const { rows } = await c.query<{ modulo: string }>(
          `insert into app.archivo (clinica_id, categoria, almacen, bucket, ruta, nombre_original,
                                    tipo, bytes, sha256)
           values ($1::uuid, $2::text, 'local', 'pruebas', $1::text || '/' || $2::text || '/x.png',
                   'x.png', 'image/png', 1, repeat('a', 64))
           returning modulo`,
          [id, categoria],
        );
        expect({ categoria, modulo: rows[0]?.modulo }).toEqual({ categoria, modulo: datos.modulo });
      }
    });
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
