-- 0001_base: schema app, rol de la API, funciones de contexto y funciones genéricas de triggers.
--
-- Reglas para todas las migraciones de este directorio:
--   * SQL plano (sin metacomandos de psql) y sin BEGIN/COMMIT: el ejecutor envuelve cada archivo en
--     una transacción; otras herramientas que solo reciben el texto también pueden aplicarlo.
--   * No requieren superusuario: alcanza con un rol con CREATEROLE (en Supabase, el rol postgres).
--   * Todo objeto va en el schema app y nada se concede a PUBLIC, anon, authenticated ni service_role.
--     Cada migración termina con CALL app.asegurar_permisos().
--   * Las funciones SECURITY DEFINER fijan search_path = pg_catalog, pg_temp y califican todo con app.

CREATE SCHEMA IF NOT EXISTS app;
COMMENT ON SCHEMA app IS
  'Datos de Sonrisa Para Todos Conecta. No se expone por la API de datos de Supabase.';

-- Rol con el que se conecta la API. Se crea sin LOGIN: la contraseña y el LOGIN se configuran fuera
-- de las migraciones (en las pruebas lo hace el banco de pruebas).
DO $$
DECLARE
  v_rol pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_rol FROM pg_catalog.pg_roles WHERE rolname = 'app_api';
  IF NOT FOUND THEN
    CREATE ROLE app_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ELSIF v_rol.rolsuper OR v_rol.rolbypassrls OR v_rol.rolcreaterole OR v_rol.rolcreatedb
        OR v_rol.rolreplication THEN
    RAISE EXCEPTION 'El rol app_api ya existe con atributos que saltan el aislamiento entre clínicas '
                    '(SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB o REPLICATION). Quitáselos antes de migrar.';
  END IF;
END
$$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_api;

-- ---------------------------------------------------------------------------------------------
-- Contexto de la transacción
-- ---------------------------------------------------------------------------------------------
-- La API fija app.clinica_id, app.usuario_id y app.ip con set_config(..., true) al empezar cada
-- transacción, a partir del JWT verificado y de una membresía activa. Las políticas RLS dependen
-- de eso: quien puede ejecutar SQL como app_api puede fijar cualquier clínica.
--
-- Cuerpo SQL estándar (RETURN): se analiza al crear la función, así que las referencias quedan
-- ligadas por OID y un search_path manipulado no las puede redirigir. Un valor ausente, vacío o
-- que no es un UUID devuelve NULL, y con NULL ninguna política deja ver ni escribir nada.

CREATE OR REPLACE FUNCTION app.clinica_actual() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN CASE
    WHEN pg_catalog.current_setting('app.clinica_id', true) OPERATOR(pg_catalog.~)
         '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
    THEN pg_catalog.current_setting('app.clinica_id', true)::uuid
  END;
COMMENT ON FUNCTION app.clinica_actual() IS
  'Clínica del contexto (app.clinica_id) o NULL si falta o no es un UUID.';

CREATE OR REPLACE FUNCTION app.usuario_actual() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN CASE
    WHEN pg_catalog.current_setting('app.usuario_id', true) OPERATOR(pg_catalog.~)
         '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
    THEN pg_catalog.current_setting('app.usuario_id', true)::uuid
  END;
COMMENT ON FUNCTION app.usuario_actual() IS
  'Usuario del contexto (app.usuario_id) o NULL si falta o no es un UUID.';

CREATE OR REPLACE FUNCTION app.ip_actual() RETURNS inet
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN NULLIF(pg_catalog.current_setting('app.ip', true), '')::inet;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.ip_actual() IS 'IP del contexto (app.ip) o NULL si falta o no es válida.';

GRANT EXECUTE ON FUNCTION app.clinica_actual() TO app_api;
GRANT EXECUTE ON FUNCTION app.usuario_actual() TO app_api;

-- ---------------------------------------------------------------------------------------------
-- Auditoría de fila: created_at/created_by al insertar, updated_at/updated_by al actualizar.
-- ---------------------------------------------------------------------------------------------
-- Los valores salen del contexto y pisan lo que mande el cliente. Además:
--   * id y clinica_id son inmutables, igual que las columnas que se pasen como argumentos del
--     trigger (el RLS ya impide mover una fila de clínica; esto cubre también a roles con BYPASSRLS);
--   * si la tabla tiene deleted_at, deleted_at/deleted_by los fija la base al dar de baja
--     (el cliente solo indica que quiere dar de baja poniendo deleted_at no nulo).
-- Es genérica: trabaja sobre el registro como jsonb, así sirve para tablas con columnas distintas.
CREATE OR REPLACE FUNCTION app.fijar_auditoria_fila() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := app.usuario_actual();
  v_ahora timestamptz := pg_catalog.now();
  v_nuevo jsonb := pg_catalog.to_jsonb(NEW);
  v_viejo jsonb;
  v_parche jsonb;
  v_columna text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_parche := pg_catalog.jsonb_build_object(
      'created_at', v_ahora, 'created_by', v_usuario, 'updated_at', NULL, 'updated_by', NULL);
    IF v_nuevo ? 'deleted_at' THEN
      IF v_nuevo ->> 'deleted_at' IS NULL THEN
        v_parche := v_parche || pg_catalog.jsonb_build_object('deleted_by', NULL);
      ELSE
        v_parche := v_parche
          || pg_catalog.jsonb_build_object('deleted_at', v_ahora, 'deleted_by', v_usuario);
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_viejo := pg_catalog.to_jsonb(OLD);
    IF (v_nuevo -> 'id') IS DISTINCT FROM (v_viejo -> 'id')
       OR (v_nuevo -> 'clinica_id') IS DISTINCT FROM (v_viejo -> 'clinica_id') THEN
      RAISE EXCEPTION 'El id y la clínica de una fila de %.% no se pueden cambiar.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_NARGS > 0 THEN
      FOREACH v_columna IN ARRAY TG_ARGV LOOP
        IF (v_nuevo -> v_columna) IS DISTINCT FROM (v_viejo -> v_columna) THEN
          RAISE EXCEPTION 'La columna % de %.% no se puede cambiar: creá un registro nuevo.',
            v_columna, TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
        END IF;
      END LOOP;
    END IF;
    v_parche := pg_catalog.jsonb_build_object(
      'created_at', v_viejo -> 'created_at', 'created_by', v_viejo -> 'created_by',
      'updated_at', v_ahora, 'updated_by', v_usuario);
    IF v_nuevo ? 'deleted_at' THEN
      IF v_viejo ->> 'deleted_at' IS NULL AND v_nuevo ->> 'deleted_at' IS NOT NULL THEN
        v_parche := v_parche
          || pg_catalog.jsonb_build_object('deleted_at', v_ahora, 'deleted_by', v_usuario);
      ELSIF v_viejo ->> 'deleted_at' IS NOT NULL AND v_nuevo ->> 'deleted_at' IS NOT NULL THEN
        v_parche := v_parche || pg_catalog.jsonb_build_object(
          'deleted_at', v_viejo -> 'deleted_at', 'deleted_by', v_viejo -> 'deleted_by');
      ELSE
        v_parche := v_parche || pg_catalog.jsonb_build_object('deleted_by', NULL);
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'app.fijar_auditoria_fila() solo va en BEFORE INSERT OR UPDATE FOR EACH ROW.';
  END IF;
  NEW := pg_catalog.jsonb_populate_record(NEW, v_parche);
  RETURN NEW;
END
$$;

-- Nada se borra físicamente: BEFORE DELETE OR TRUNCATE FOR EACH STATEMENT en toda tabla.
-- A nivel de sentencia, así rechaza también un DELETE que no alcanzaría ninguna fila.
CREATE OR REPLACE FUNCTION app.rechazar_borrado() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'En %.% no se borra nada: dalo de baja (deleted_at o activo = false).',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

-- Registros inmutables (audit_log y, más adelante, pagos, anamnesis, etc.): rechaza UPDATE,
-- DELETE y TRUNCATE para todos los roles, incluido el dueño de la tabla.
CREATE OR REPLACE FUNCTION app.rechazar_modificacion() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% es de solo inserción: no admite %.', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permisos: nada para PUBLIC ni para los roles de la API de datos de Supabase.
-- ---------------------------------------------------------------------------------------------
-- Las funciones nacen ejecutables por PUBLIC y Supabase puede tener privilegios por defecto para
-- anon/authenticated/service_role: este procedimiento los quita de todo el schema app. Los roles de
-- Supabase pueden no existir (Postgres local, CI): solo se tocan si existen.
CREATE OR REPLACE PROCEDURE app.asegurar_permisos()
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_rol text;
BEGIN
  REVOKE ALL ON SCHEMA app FROM PUBLIC;
  REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
  REVOKE ALL ON ALL ROUTINES IN SCHEMA app FROM PUBLIC;
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_rol) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA app FROM %I', v_rol);
      EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', v_rol);
      EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', v_rol);
      EXECUTE pg_catalog.format('REVOKE ALL ON ALL ROUTINES IN SCHEMA app FROM %I', v_rol);
    END IF;
  END LOOP;
END
$$;
COMMENT ON PROCEDURE app.asegurar_permisos() IS
  'Quita todo privilegio de PUBLIC/anon/authenticated/service_role en el schema app. Va al final de cada migración.';

CALL app.asegurar_permisos();
