-- 0023_ficha_clinica_lectura: lo que es de ficha_clinica no se lee sin ficha_clinica:ver, por ningún
-- camino (revisión de seguridad del Sprint 3).
--
-- Corrige el encabezado de 0021, que prometía que sin ficha_clinica:ver la nota interna «no existe,
-- consulte como consulte». No era cierto:
--   * audit_log guarda el texto de paciente_nota en antes/despues y su política solo miraba la
--     clínica: cualquiera de la clínica leía la nota (y su historial) en la auditoría;
--   * una alerta inactiva (paciente_alerta.activa = false) se leía por SQL directo;
--   * con ficha_clinica:editar sin ver, un UPDATE app.paciente_nota SET texto = … sin WHERE pisaba
--     notas que esa persona no ve.
--
--   * audit_log_modulo (política RESTRICTIVA de SELECT, genérica por módulo): una fila de auditoría
--     se ve solo si el usuario del contexto tiene <modulo>:ver (las filas sin módulo, filas viejas
--     de entidades que no son tablas, cuentan como configuracion, igual que GET /auditoria), o si es
--     un evento propio registrado con app.registrar_evento (ver/exportar/enviar/ingresar del mismo
--     usuario: su detalle lo mandó esa persona; sin esto, registrar un «ingresar» sin personal:ver
--     fallaría, porque registrar_evento hace INSERT … RETURNING y la fila nueva tiene que pasar las
--     políticas de SELECT). Los cambios de fila (crear/editar/anular, con antes/despues) de un
--     módulo sin ver no se leen nunca. Los módulos con ver salen de app.modulos_con_accion('ver'),
--     una vez por consulta.
--   * paciente_alerta_inactiva_ver / _editar (RESTRICTIVAS): una alerta inactiva solo existe para
--     quien tiene ficha_clinica:ver (SELECT y UPDATE). Además app.proteger_pacientes exige
--     ficha_clinica:ver para cargar una alerta inactiva, desactivarla o tocar una inactiva
--     (ficha_clinica_sin_permiso, 42501): la API no podría devolverla.
--   * paciente_nota: escribirla exige ficha_clinica:editar Y ficha_clinica:ver
--     (app.proteger_pacientes, ficha_clinica_sin_permiso, 42501), y las políticas RESTRICTIVAS
--     paciente_nota_escribir_ver (INSERT) y paciente_nota_editar_ver (UPDATE) piden ver también:
--     un UPDATE sin WHERE de quien no tiene ver no encuentra ninguna fila.
-- Como app.proteger_pacientes, las cinco políticas exceptúan a una SESIÓN del dueño de las tablas
-- (migraciones, semilla, fábricas, administración: app.sesion_del_dueno()), no a una función
-- SECURITY DEFINER llamada por app_api.
-- Ahora sí: sin ficha_clinica:ver, la nota interna y las alertas inactivas no existen para app_api
-- (SELECT directo, joins, funciones INVOKER ni auditoría).

-- ---------------------------------------------------------------------------------------------
-- Módulos en los que el usuario del contexto tiene una acción (para políticas)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.modulos_con_accion(p_accion text) RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT p.modulo), '{}'::text[])
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id AND r.activo
  JOIN app.clinica c ON c.id = m.clinica_id AND c.activo
  JOIN app.rol_permiso p ON p.clinica_id = m.clinica_id AND p.rol_id = m.rol_id AND p.activo
  WHERE m.clinica_id = app.clinica_actual() AND m.usuario_id = app.usuario_actual()
    AND m.estado = 'activo' AND p.accion = p_accion
$$;
COMMENT ON FUNCTION app.modulos_con_accion(text) IS
  'Módulos en los que el usuario del contexto tiene p_accion en la clínica del contexto (mismas condiciones que app.tiene_permiso).';

-- ¿La sesión es del dueño de las tablas? (current_user Y session_user: dentro de una función
-- SECURITY DEFINER llamada por app_api, current_user es el dueño pero session_user no.)
CREATE OR REPLACE FUNCTION app.sesion_del_dueno() RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE')
         AND pg_catalog.pg_has_role(session_user, c.relowner, 'USAGE')
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'app.audit_log'::pg_catalog.regclass
$$;
COMMENT ON FUNCTION app.sesion_del_dueno() IS
  'true si la sesión (y el usuario actual) es del dueño de las tablas de app: migraciones, semilla, administración. Nunca para app_api, tampoco dentro de una función SECURITY DEFINER.';

-- ---------------------------------------------------------------------------------------------
-- audit_log: cada módulo solo para quien lo puede ver
-- ---------------------------------------------------------------------------------------------
CREATE POLICY audit_log_modulo ON app.audit_log
  AS RESTRICTIVE
  FOR SELECT
  USING (
    COALESCE(modulo, 'configuracion') = ANY ((SELECT app.modulos_con_accion('ver'))::text[])
    OR (accion IN ('ver', 'exportar', 'enviar', 'ingresar')
        AND usuario_id = (SELECT app.usuario_actual()))
    OR (SELECT app.sesion_del_dueno())
  );

COMMENT ON TABLE app.audit_log IS
  'Registro de auditoría, solo inserción. crear/editar/anular: trigger app.auditar(); ver/exportar/enviar/ingresar: app.registrar_evento(). Se lee solo con <modulo>:ver (o el evento propio), desde 0023.';

-- ---------------------------------------------------------------------------------------------
-- paciente_alerta: las inactivas, solo con ficha_clinica:ver
-- ---------------------------------------------------------------------------------------------
CREATE POLICY paciente_alerta_inactiva_ver ON app.paciente_alerta
  AS RESTRICTIVE
  FOR SELECT
  USING (activa OR (SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno()));
CREATE POLICY paciente_alerta_inactiva_editar ON app.paciente_alerta
  AS RESTRICTIVE
  FOR UPDATE
  USING (activa OR (SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno()))
  WITH CHECK (clinica_id = app.clinica_actual());

COMMENT ON TABLE app.paciente_alerta IS
  'Alertas manuales del paciente (ficha_clinica). Solo se activan o desactivan; no se editan ni se borran. Las inactivas solo las ve quien tiene ficha_clinica:ver (RLS).';

-- ---------------------------------------------------------------------------------------------
-- paciente_nota: escribir exige también ver
-- ---------------------------------------------------------------------------------------------
CREATE POLICY paciente_nota_escribir_ver ON app.paciente_nota
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (clinica_id = app.clinica_actual()
              AND ((SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno())));
CREATE POLICY paciente_nota_editar_ver ON app.paciente_nota
  AS RESTRICTIVE
  FOR UPDATE
  USING ((SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno()))
  WITH CHECK (clinica_id = app.clinica_actual());

COMMENT ON TABLE app.paciente_nota IS
  'Nota interna del paciente (dato clínico). Sin ficha_clinica:ver no existe para app_api: ni la fila (RLS) ni su historial (audit_log_modulo). Escribirla exige ficha_clinica:editar y ver.';
COMMENT ON FUNCTION app.guardar_nota_interna(uuid, text) IS
  'Crea o reemplaza la nota interna (NULL la borra). Corre como app_api: ficha_clinica:editar y ficha_clinica:ver.';

-- ---------------------------------------------------------------------------------------------
-- app.proteger_pacientes(): igual que en 0019, con ver para la nota y las alertas inactivas
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_pacientes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_dueno_tablas oid;
  v_permisos text[] := '{}'::text[];
  v_permiso text;
  v_ignorar CONSTANT text[] := ARRAY['updated_at', 'updated_by', 'activo', 'motivo_baja',
                                     'orden_apellidos', 'orden_nombres'];
BEGIN
  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

  -- Excepción explícita: una SESIÓN del dueño de las tablas (migraciones, semilla, fábricas). Una
  -- función SECURITY DEFINER llamada por app_api corre como el dueño, pero su sesión es de app_api.
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NEW;
  END IF;

  -- (Las referencias a columnas van dentro del IF de cada tabla: tienen columnas distintas.)
  IF TG_TABLE_NAME = 'paciente' THEN
    IF TG_OP = 'INSERT' THEN
      v_permisos := ARRAY['pacientes:crear'];
      IF NOT NEW.activo THEN
        RAISE EXCEPTION 'Un paciente nuevo nace activo.'
          USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'paciente_nace_activo';
      END IF;
    ELSE
      IF (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) v_ignorar)
         IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) v_ignorar) THEN
        v_permisos := v_permisos || 'pacientes:editar'::text;
      END IF;
      IF NEW.activo IS DISTINCT FROM OLD.activo
         OR NEW.motivo_baja IS DISTINCT FROM OLD.motivo_baja THEN
        v_permisos := v_permisos || 'pacientes:anular'::text;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'paciente_relacion' THEN
    v_permisos := ARRAY['pacientes:editar'];
  ELSIF TG_TABLE_NAME = 'paciente_alerta' THEN
    v_permisos := ARRAY['ficha_clinica:editar'];
    -- Una alerta inactiva solo existe para quien tiene ficha_clinica:ver.
    IF NOT NEW.activa OR (TG_OP = 'UPDATE' AND NOT OLD.activa) THEN
      v_permisos := v_permisos || 'ficha_clinica:ver'::text;
    END IF;
  ELSIF TG_TABLE_NAME = 'paciente_nota' THEN
    -- No se escribe lo que no se ve (ni se pisa una nota ajena a ciegas).
    v_permisos := ARRAY['ficha_clinica:editar', 'ficha_clinica:ver'];
  ELSE
    RAISE EXCEPTION 'app.proteger_pacientes() no está pensada para %.%.', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  FOREACH v_permiso IN ARRAY v_permisos LOOP
    IF NOT app.tiene_permiso(pg_catalog.split_part(v_permiso, ':', 1),
                             pg_catalog.split_part(v_permiso, ':', 2)) THEN
      RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para este cambio (%).', v_permiso
        USING ERRCODE = 'insufficient_privilege',
              CONSTRAINT = CASE WHEN v_permiso LIKE 'ficha_clinica:%' THEN 'ficha_clinica_sin_permiso'
                                ELSE 'pacientes_sin_permiso' END;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_pacientes() IS
  'Defensa de paciente, paciente_relacion, paciente_alerta y paciente_nota: permiso del actor (pacientes:crear/editar/anular; ficha_clinica:editar, y además ver para la nota y para alertas inactivas). Exceptúa solo a una sesión del dueño de las tablas.';

GRANT EXECUTE ON FUNCTION app.modulos_con_accion(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.sesion_del_dueno() TO app_api;

CALL app.asegurar_permisos();
