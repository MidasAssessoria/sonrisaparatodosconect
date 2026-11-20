-- 0006_sesion: sesiones del lado del servidor (la inactividad deja de depender del navegador).
--
-- Una fila por sesión de Supabase Auth: id = session_id del token. Es global como usuario (sin
-- clinica_id): la misma sesión sirve para todas las clínicas de la persona. Cada quien ve solo sus
-- filas (RLS forzado) y nadie las escribe directamente: app_api tiene solo SELECT; las crean,
-- actualizan y cierran app.tocar_sesion() y app.cerrar_sesion(), que actúan siempre sobre
-- app.usuario_actual(). Un session_id de otra persona no se puede tocar ni cerrar.
--
-- No se audita fila por fila (como numerador): cada pedido la tocaría. El ingreso queda en audit_log
-- como 'ingresar' con app.registrar_evento('ingresar', 'sesion', <id>) (0007).
--
-- Retención (propuesta, no implementada; nada se borra físicamente):
--   * Las filas son chicas (~150 bytes): 30 personas x 4 sesiones por día son ~45.000 filas por año.
--     No hace falta mover nada por años.
--   * Sesiones abandonadas (nadie volvió a usar el token): quedan con cerrada_en NULL aunque ya no
--     sirvan. Un trabajo periódico del worker (pg-boss, función SECURITY DEFINER propia) las cierra
--     con motivo 'inactividad' cuando ultima_actividad supera el máximo de inactividad de cualquier
--     rol (240 min). Es un UPDATE, no un borrado.
--   * Cuando el volumen lo pida, se particiona por mes de iniciada_en igual que audit_log, y las
--     particiones de más de 13 meses pasan a almacenamiento frío sin borrarse. El plazo final lo
--     define el asesor legal (riesgo R4 del plan). El registro probatorio es audit_log ('ingresar');
--     esta tabla es estado operativo.

CREATE TABLE app.sesion (
  -- session_id del token de Supabase Auth: sin valor por defecto.
  id uuid PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES app.usuario (id),
  iniciada_en timestamptz NOT NULL DEFAULT now(),
  ultima_actividad timestamptz NOT NULL DEFAULT now(),
  cerrada_en timestamptz,
  motivo_cierre text
    CONSTRAINT sesion_motivo_cierre_check CHECK (motivo_cierre IN ('salida', 'inactividad')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT sesion_cierre_check CHECK ((cerrada_en IS NULL) = (motivo_cierre IS NULL)),
  CONSTRAINT sesion_actividad_check CHECK (ultima_actividad >= iniciada_en)
);
COMMENT ON TABLE app.sesion IS
  'Sesiones de Supabase Auth (id = session_id del token). Las escriben solo app.tocar_sesion() y app.cerrar_sesion().';
CREATE INDEX sesion_usuario_idx ON app.sesion (usuario_id, iniciada_en DESC);

CREATE TRIGGER sesion_auditoria_fila BEFORE INSERT OR UPDATE ON app.sesion
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('usuario_id', 'iniciada_en');
CREATE TRIGGER sesion_sin_borrado BEFORE DELETE OR TRUNCATE ON app.sesion
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

ALTER TABLE app.sesion ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sesion FORCE ROW LEVEL SECURITY;

-- Cada quien, solo sus filas (también el dueño de la tabla, que es quien ejecuta las funciones).
CREATE POLICY sesion_propia ON app.sesion
  USING (usuario_id = app.usuario_actual())
  WITH CHECK (usuario_id = app.usuario_actual());

GRANT SELECT ON app.sesion TO app_api;

-- ---------------------------------------------------------------------------------------------
-- app.tocar_sesion(sesion, inactividad_min): se llama en cada pedido con sesión.
-- ---------------------------------------------------------------------------------------------
-- Devuelve:
--   'nueva'   la sesión no existía: se creó (primer pedido; la API registra 'ingresar').
--   'activa'  existe, está abierta y dentro del límite; ultima_actividad se actualiza como mucho una
--             vez por minuto (así un pedido no escribe siempre). Por eso el límite efectivo puede ser
--             hasta un minuto más estricto que inactividad_min, nunca más laxo.
--   'vencida' pasó más de inactividad_min desde ultima_actividad: la cierra ahora con motivo
--             'inactividad'. La API tiene que CONFIRMAR la transacción (para que el cierre quede) y
--             responder no_autenticado.
--   'cerrada' ya estaba cerrada (salida o inactividad): la API responde no_autenticado.
-- No lanza error en 'vencida' a propósito: un error revertiría el cierre.
-- Si el id existe pero es de otra persona: error 42501 (restricción 'sesion_ajena') y no la toca.
CREATE OR REPLACE FUNCTION app.tocar_sesion(p_sesion_id uuid, p_inactividad_min integer)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := app.usuario_actual();
  v_ahora timestamptz := pg_catalog.now();
  v_sesion record;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto: la API tiene que fijarlo antes de tocar la sesión.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sesion_id IS NULL THEN
    RAISE EXCEPTION 'Falta el identificador de la sesión (session_id del token).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_inactividad_min IS NULL OR p_inactividad_min NOT BETWEEN 5 AND 240 THEN
    RAISE EXCEPTION 'La inactividad tiene que estar entre 5 y 240 minutos (es un dato del rol).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Primer pedido de la sesión. Con dos pedidos simultáneos, solo uno la crea.
  INSERT INTO app.sesion AS s (id, usuario_id, iniciada_en, ultima_actividad)
  VALUES (p_sesion_id, v_usuario, v_ahora, v_ahora)
  ON CONFLICT (id) DO NOTHING
  RETURNING s.id INTO v_sesion;
  IF FOUND THEN
    RETURN 'nueva';
  END IF;

  -- Ya existía. RLS deja ver solo las propias: si no se ve, es de otra persona.
  SELECT s.ultima_actividad, s.cerrada_en INTO v_sesion
  FROM app.sesion s WHERE s.id = p_sesion_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa sesión no es tuya.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'sesion_ajena';
  END IF;

  IF v_sesion.cerrada_en IS NOT NULL THEN
    RETURN 'cerrada';
  END IF;

  IF v_ahora - v_sesion.ultima_actividad > pg_catalog.make_interval(mins => p_inactividad_min) THEN
    UPDATE app.sesion SET cerrada_en = v_ahora, motivo_cierre = 'inactividad' WHERE id = p_sesion_id;
    RETURN 'vencida';
  END IF;

  IF v_ahora - v_sesion.ultima_actividad >= interval '1 minute' THEN
    UPDATE app.sesion SET ultima_actividad = v_ahora WHERE id = p_sesion_id;
  END IF;
  RETURN 'activa';
END
$$;
COMMENT ON FUNCTION app.tocar_sesion(uuid, integer) IS
  'Crea, renueva o vence la sesión del usuario del contexto. Devuelve nueva | activa | vencida | cerrada.';

-- ---------------------------------------------------------------------------------------------
-- app.cerrar_sesion(sesion): cierre por salida (POST /sesion/cerrar).
-- ---------------------------------------------------------------------------------------------
-- Devuelve true si la cerró ahora y false si ya estaba cerrada. Si la sesión nunca se había tocado,
-- la crea ya cerrada: así ese session_id no sirve más aunque el token siga vigente.
-- Si el id es de otra persona: error 42501 (restricción 'sesion_ajena') y no la toca.
CREATE OR REPLACE FUNCTION app.cerrar_sesion(p_sesion_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := app.usuario_actual();
  v_ahora timestamptz := pg_catalog.now();
  v_cerrada timestamptz;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto: la API tiene que fijarlo antes de cerrar la sesión.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sesion_id IS NULL THEN
    RAISE EXCEPTION 'Falta el identificador de la sesión (session_id del token).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO app.sesion AS s (id, usuario_id, iniciada_en, ultima_actividad, cerrada_en, motivo_cierre)
  VALUES (p_sesion_id, v_usuario, v_ahora, v_ahora, v_ahora, 'salida')
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    RETURN true;
  END IF;

  SELECT s.cerrada_en INTO v_cerrada FROM app.sesion s WHERE s.id = p_sesion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa sesión no es tuya.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'sesion_ajena';
  END IF;
  IF v_cerrada IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE app.sesion SET cerrada_en = v_ahora, motivo_cierre = 'salida' WHERE id = p_sesion_id;
  RETURN true;
END
$$;
COMMENT ON FUNCTION app.cerrar_sesion(uuid) IS
  'Cierra (motivo salida) la sesión del usuario del contexto. true si la cerró ahora, false si ya estaba cerrada.';

GRANT EXECUTE ON FUNCTION app.tocar_sesion(uuid, integer) TO app_api;
GRANT EXECUTE ON FUNCTION app.cerrar_sesion(uuid) TO app_api;

CALL app.asegurar_permisos();
