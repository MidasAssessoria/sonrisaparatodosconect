-- 0002_auditoria: audit_log (solo inserción), trigger genérico app.auditar() y app.registrar_evento().
--
-- Altas, ediciones y bajas las escribe app.auditar() desde los triggers de cada tabla; ver, exportar
-- y enviar los registra la API con app.registrar_evento(). En los dos casos la clínica, el usuario y
-- la IP salen del contexto de la transacción, nunca de parámetros: app_api no tiene INSERT directo
-- sobre audit_log y la política de inserción exige que clínica y usuario coincidan con el contexto.
--
-- Sin particionar por ahora (decisión del orquestador): se particiona por mes cuando el volumen lo
-- pida. Sin FK hacia clinica/usuario para que el día de mañana se pueda particionar y para que el
-- registro nunca dependa de otras tablas. No lleva created_*/updated_*: fecha y usuario_id son su
-- auditoría de fila y nunca se actualiza.

CREATE TABLE app.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL solo para cambios de entidades globales (usuario) hechos sin clínica en el contexto.
  clinica_id uuid,
  -- NULL cuando escribe un proceso de administración sin usuario (p. ej. el alta de una clínica).
  usuario_id uuid,
  fecha timestamptz NOT NULL DEFAULT clock_timestamp(),
  entidad text NOT NULL CHECK (entidad ~ '^[a-z][a-z0-9_]{0,62}$'),
  entidad_id uuid,
  accion text NOT NULL
    CONSTRAINT audit_log_accion_check
    CHECK (accion IN ('crear', 'editar', 'anular', 'ver', 'exportar', 'enviar')),
  antes jsonb,
  despues jsonb,
  ip inet
);
COMMENT ON TABLE app.audit_log IS
  'Registro de auditoría, solo inserción. crear/editar/anular: trigger app.auditar(); ver/exportar/enviar: app.registrar_evento().';

CREATE INDEX audit_log_entidad_idx ON app.audit_log (clinica_id, entidad, entidad_id);
CREATE INDEX audit_log_usuario_idx ON app.audit_log (clinica_id, usuario_id, fecha);

CREATE TRIGGER audit_log_solo_insercion
  BEFORE UPDATE OR DELETE OR TRUNCATE ON app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_modificacion();

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_ver ON app.audit_log
  FOR SELECT
  USING (clinica_id = app.clinica_actual());

-- Solo lo usan las funciones SECURITY DEFINER de abajo (corren como dueño de la tabla, que también
-- está sujeto a RLS por FORCE). app_api no tiene INSERT: si alguien se lo concediera por error,
-- igual no podría escribir con otra clínica ni con otro usuario.
CREATE POLICY audit_log_insertar ON app.audit_log
  FOR INSERT
  WITH CHECK (
    clinica_id IS NOT DISTINCT FROM app.clinica_actual()
    AND usuario_id IS NOT DISTINCT FROM app.usuario_actual()
  );

GRANT SELECT ON app.audit_log TO app_api;

-- Trigger genérico AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.
--   * INSERT -> crear (despues = fila nueva).
--   * UPDATE -> anular si deleted_at pasa de NULL a no NULL o activo pasa de true a false; si no,
--     editar. Si solo cambiaron updated_at/updated_by (o las columnas pasadas como argumentos del
--     trigger, p. ej. ultimo_acceso), no registra nada.
--   * DELETE -> anular (antes = fila). En la práctica no ocurre: el borrado está rechazado.
-- La clínica es la del contexto; si no hay (un rol con BYPASSRLS que edita a mano), la de la fila.
CREATE OR REPLACE FUNCTION app.auditar() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_antes jsonb;
  v_despues jsonb;
  v_fila jsonb;
  v_accion text;
  v_ignorar text[] := ARRAY['updated_at', 'updated_by'];
  v_clinica uuid;
BEGIN
  IF TG_NARGS > 0 THEN
    v_ignorar := v_ignorar || TG_ARGV;
  END IF;

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
          AND (v_despues ->> 'activo')::boolean IS FALSE) THEN
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

  v_clinica := COALESCE(
    app.clinica_actual(),
    (v_fila ->> 'clinica_id')::uuid,
    CASE WHEN TG_TABLE_NAME = 'clinica' THEN (v_fila ->> 'id')::uuid END
  );

  INSERT INTO app.audit_log (clinica_id, usuario_id, entidad, entidad_id, accion, antes, despues, ip)
  VALUES (v_clinica, app.usuario_actual(), TG_TABLE_NAME, (v_fila ->> 'id')::uuid, v_accion,
          v_antes, v_despues, app.ip_actual());
  RETURN NULL;
END
$$;

-- Eventos que registra la API: ver, exportar y enviar. Clínica, usuario e IP salen del contexto.
CREATE OR REPLACE FUNCTION app.registrar_evento(
  p_accion text,
  p_entidad text,
  p_entidad_id uuid DEFAULT NULL,
  p_detalle jsonb DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_usuario uuid := app.usuario_actual();
  v_id uuid;
BEGIN
  IF p_accion IS NULL OR p_accion NOT IN ('ver', 'exportar', 'enviar') THEN
    RAISE EXCEPTION 'registrar_evento solo acepta ver, exportar o enviar: las altas, ediciones y bajas las registra la base sola.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_entidad IS NULL OR p_entidad !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'La entidad tiene que ser un nombre de tabla en minúsculas (p. ej. paciente).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_clinica IS NULL OR v_usuario IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica y usuario: la API tiene que fijarlo antes de registrar el evento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- El usuario del contexto tiene que ser miembro activo de la clínica del contexto. (membresia se
  -- crea en 0003; plpgsql resuelve la tabla al ejecutar.)
  IF NOT EXISTS (
    SELECT 1 FROM app.membresia m
    WHERE m.clinica_id = v_clinica AND m.usuario_id = v_usuario AND m.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'El usuario del contexto no tiene una membresía activa en la clínica del contexto.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO app.audit_log (clinica_id, usuario_id, entidad, entidad_id, accion, antes, despues, ip)
  VALUES (v_clinica, v_usuario, p_entidad, p_entidad_id, p_accion, NULL, p_detalle, app.ip_actual())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.registrar_evento(text, text, uuid, jsonb) IS
  'Registra ver/exportar/enviar en audit_log con clínica, usuario e IP del contexto.';

GRANT EXECUTE ON FUNCTION app.registrar_evento(text, text, uuid, jsonb) TO app_api;

CALL app.asegurar_permisos();
