-- 0017_auditoria_sin_token: la auditoría de una invitación no guarda el hash del token.
--
--   * app.auditar(modulo, columnas...) acepta un argumento nuevo: '-columna' = esa columna NO se
--     guarda en antes/después (sí cuenta como cambio: una edición que solo la toca queda registrada,
--     sin el valor). Las demás columnas siguen siendo «a ignorar» como en 0007. El trigger de
--     invitacion pasa a app.auditar('personal', '-token_hash').
--   * De paso (0015 agregó membresia.motivo_baja): una membresía que pasa a estado inactivo
--     (desactivar a una persona o anular su invitación) queda como «anular», igual que deleted_at o
--     activo = false en las demás tablas; el motivo va en después.
--   * Relleno: se quita token_hash de antes/después de las filas de invitacion que ya están en
--     audit_log. audit_log es de solo inserción (trigger por sentencia) y tiene RLS forzado sin
--     política de UPDATE: como en 0007, dentro de esta migración (una sola transacción, con bloqueo
--     exclusivo hasta el COMMIT) se desactivan el trigger y el FORCE, se corrige y se vuelven a
--     activar. Una prueba verifica que después de migrar la regla sigue en pie.

-- ---------------------------------------------------------------------------------------------
-- app.auditar(): igual que en 0013, con columnas que no se guardan ('-columna')
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.auditar() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_modulo text;
  v_ignorar text[] := ARRAY['updated_at', 'updated_by'];
  v_ocultar text[] := '{}'::text[];
  v_antes jsonb;
  v_despues jsonb;
  v_fila jsonb;
  v_accion text;
  v_usuario uuid := app.usuario_actual();
  v_nombre text;
  v_sede uuid;
  v_persona uuid;
  v_clinicas uuid[];
  v_clinica uuid;
  v_ctx_clinica text := pg_catalog.current_setting('app.clinica_id', true);
  v_ctx_usuario text := pg_catalog.current_setting('app.usuario_id', true);
  i integer;
BEGIN
  IF TG_NARGS < 1 OR TG_ARGV[0] IS NULL OR TG_ARGV[0] = '' THEN
    RAISE EXCEPTION 'El trigger de auditoría de %.% tiene que declarar su módulo: app.auditar(''<modulo>'', ...).',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  v_modulo := TG_ARGV[0];
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    IF pg_catalog.left(TG_ARGV[i], 1) = '-' THEN
      v_ocultar := v_ocultar || pg_catalog.substr(TG_ARGV[i], 2);
    ELSE
      v_ignorar := v_ignorar || TG_ARGV[i];
    END IF;
  END LOOP;

  IF TG_OP = 'INSERT' THEN
    v_accion := 'crear';
    v_despues := pg_catalog.to_jsonb(NEW);
    v_fila := v_despues;
  ELSIF TG_OP = 'UPDATE' THEN
    v_antes := pg_catalog.to_jsonb(OLD);
    v_despues := pg_catalog.to_jsonb(NEW);
    v_fila := v_despues;
    IF (v_antes - v_ignorar) = (v_despues - v_ignorar) THEN
      RETURN NULL;
    END IF;
    IF (v_antes ? 'deleted_at' AND v_antes ->> 'deleted_at' IS NULL
          AND v_despues ->> 'deleted_at' IS NOT NULL)
       OR (v_antes ? 'activo' AND (v_antes ->> 'activo')::boolean IS TRUE
          AND (v_despues ->> 'activo')::boolean IS FALSE)
       OR (TG_TABLE_NAME = 'membresia' AND v_antes ->> 'estado' <> 'inactivo'
          AND v_despues ->> 'estado' = 'inactivo') THEN
      v_accion := 'anular';
    ELSE
      v_accion := 'editar';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_accion := 'anular';
    v_antes := pg_catalog.to_jsonb(OLD);
    v_fila := v_antes;
  ELSE
    RAISE EXCEPTION 'app.auditar() solo va en AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';
  END IF;

  -- Módulo por fila: solo de una columna «modulo» generada (no la escribe el cliente).
  IF v_fila ? 'modulo' AND app.tiene_modulo_generado(TG_RELID) THEN
    v_modulo := v_fila ->> 'modulo';
  END IF;

  -- Sede del evento.
  IF TG_TABLE_NAME = 'sede' THEN
    v_sede := (v_fila ->> 'id')::uuid;
  ELSIF v_fila ? 'sede_id' THEN
    v_sede := (v_fila ->> 'sede_id')::uuid;
  END IF;

  -- Nombre del autor en este momento (la política de usuario deja ver la fila propia).
  IF v_usuario IS NOT NULL THEN
    SELECT u.nombre INTO v_nombre FROM app.usuario u WHERE u.id = v_usuario;
  END IF;

  -- Clínicas donde queda el evento.
  IF v_fila ? 'clinica_id' THEN
    v_clinicas := ARRAY[(v_fila ->> 'clinica_id')::uuid];
  ELSIF TG_TABLE_NAME = 'clinica' THEN
    v_clinicas := ARRAY[(v_fila ->> 'id')::uuid];
  ELSIF TG_TABLE_NAME = 'usuario' THEN
    -- Con la persona como usuario del contexto, RLS deja ver todas sus membresías.
    v_persona := (v_fila ->> 'id')::uuid;
    PERFORM pg_catalog.set_config('app.usuario_id', v_persona::text, true);
    SELECT pg_catalog.array_agg(DISTINCT m.clinica_id) INTO v_clinicas
    FROM app.membresia m
    WHERE m.usuario_id = v_persona AND m.estado = 'activo';
    PERFORM pg_catalog.set_config('app.usuario_id', COALESCE(v_ctx_usuario, ''), true);
    IF app.clinica_actual() IS NOT NULL
       AND NOT (app.clinica_actual() = ANY (COALESCE(v_clinicas, '{}'::uuid[]))) THEN
      v_clinicas := COALESCE(v_clinicas, '{}'::uuid[]) || app.clinica_actual();
    END IF;
  ELSE
    RAISE EXCEPTION 'app.auditar() no sabe en qué clínica registrar los cambios de %.%: no tiene clinica_id.',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  IF v_clinicas IS NULL OR pg_catalog.cardinality(v_clinicas) = 0 THEN
    RAISE EXCEPTION 'Este cambio de % no quedaría registrado en ninguna clínica. Hacelo con la clínica en el contexto.',
      TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'auditoria_sin_clinica';
  END IF;

  -- Columnas que no se guardan (p. ej. el hash del token de una invitación).
  IF pg_catalog.cardinality(v_ocultar) > 0 THEN
    v_antes := v_antes - v_ocultar;
    v_despues := v_despues - v_ocultar;
  END IF;

  FOREACH v_clinica IN ARRAY v_clinicas LOOP
    IF v_clinica IS DISTINCT FROM app.clinica_actual() THEN
      PERFORM pg_catalog.set_config('app.clinica_id', v_clinica::text, true);
    END IF;
    INSERT INTO app.audit_log (clinica_id, usuario_id, usuario_nombre, entidad, entidad_id, accion,
                               modulo, sede_id, antes, despues, ip)
    VALUES (v_clinica, v_usuario, v_nombre, TG_TABLE_NAME, (v_fila ->> 'id')::uuid, v_accion,
            v_modulo, v_sede, v_antes, v_despues, app.ip_actual());
  END LOOP;
  IF pg_catalog.current_setting('app.clinica_id', true) IS DISTINCT FROM v_ctx_clinica THEN
    PERFORM pg_catalog.set_config('app.clinica_id', COALESCE(v_ctx_clinica, ''), true);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER invitacion_auditar ON app.invitacion;
CREATE TRIGGER invitacion_auditar AFTER INSERT OR UPDATE OR DELETE ON app.invitacion
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal', '-token_hash');

-- ---------------------------------------------------------------------------------------------
-- Relleno de las filas existentes (ver el encabezado)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.audit_log DISABLE TRIGGER audit_log_solo_insercion;
ALTER TABLE app.audit_log NO FORCE ROW LEVEL SECURITY;

UPDATE app.audit_log SET
  antes = CASE WHEN antes ? 'token_hash' THEN antes - 'token_hash' ELSE antes END,
  despues = CASE WHEN despues ? 'token_hash' THEN despues - 'token_hash' ELSE despues END
WHERE entidad = 'invitacion' AND (antes ? 'token_hash' OR despues ? 'token_hash');

ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log ENABLE TRIGGER audit_log_solo_insercion;

CALL app.asegurar_permisos();
