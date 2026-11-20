-- 0007_auditoria_modulo: audit_log con módulo, sede y autor congelado; registrar_evento endurecido.
--
--   * modulo: el de MODULOS de @conecta/shared. Decide quién puede ver el evento (la API muestra solo
--     los módulos donde el rol tiene 'ver'). Cada tabla lo declara como primer argumento de su
--     trigger app.auditar('<modulo>', <columnas a ignorar>...): es la única fuente, la usan el
--     trigger y app.modulo_de_entidad() (y por ella registrar_evento y el relleno de abajo).
--   * sede_id: la de la fila si la tabla tiene sede_id; para sede, su propio id; si no, NULL.
--   * usuario_nombre: nombre del autor en el momento del evento. Un cambio de nombre posterior ya no
--     reescribe la autoría del pasado.
--   * accion 'ingresar': primer pedido de una sesión nueva (entidad 'sesion', ver 0006).
--   * Cambios de usuario (identidad global, sin clinica_id): una fila por cada clínica donde la
--     persona tiene membresía ACTIVA, más la clínica del contexto. Si no hay ninguna, el cambio se
--     rechaza: nunca más una fila con clinica_id NULL que nadie puede ver. Solo membresías activas
--     porque la fila lleva antes/después completos (correo, teléfono) y una membresía pendiente o
--     inactiva no da derecho a ver el perfil (0009).
--   * Índice (clinica_id, fecha DESC, id DESC) para la paginación por cursor de GET /auditoria.
--
-- Relleno de las filas viejas: audit_log es de solo inserción (trigger por sentencia que rechaza
-- UPDATE para todos, incluido su dueño) y tiene RLS forzado sin política de UPDATE. Dentro de esta
-- migración, que corre en una sola transacción, se desactiva ese trigger y el FORCE, se rellena y se
-- vuelven a activar antes de terminar. ALTER TABLE toma un bloqueo exclusivo hasta el COMMIT: ninguna
-- otra sesión ve la tabla sin la regla. Si algo falla, se revierte todo. Una prueba verifica que
-- después de migrar la regla sigue en pie (también para el dueño).

-- ---------------------------------------------------------------------------------------------
-- Columnas, restricciones e índice
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.audit_log
  ADD COLUMN modulo text
    CONSTRAINT audit_log_modulo_check CHECK (modulo IN (
      'inicio', 'agenda', 'pacientes', 'ficha_clinica', 'presupuestos', 'caja', 'contabilidad',
      'reportes', 'personal', 'inventario', 'mensajeria', 'sedes', 'auditoria', 'configuracion')),
  ADD COLUMN sede_id uuid,
  ADD COLUMN usuario_nombre text;
COMMENT ON COLUMN app.audit_log.modulo IS
  'Módulo de la entidad (argumento del trigger app.auditar). NULL solo en filas viejas de entidades que no son tablas.';
COMMENT ON COLUMN app.audit_log.sede_id IS 'Sede del registro afectado; NULL si no aplica.';
COMMENT ON COLUMN app.audit_log.usuario_nombre IS 'Nombre del autor en el momento del evento.';

ALTER TABLE app.audit_log DROP CONSTRAINT audit_log_accion_check;
ALTER TABLE app.audit_log ADD CONSTRAINT audit_log_accion_check
  CHECK (accion IN ('crear', 'editar', 'anular', 'ver', 'exportar', 'enviar', 'ingresar'));

CREATE INDEX audit_log_clinica_fecha_idx ON app.audit_log (clinica_id, fecha DESC, id DESC);

COMMENT ON TABLE app.audit_log IS
  'Registro de auditoría, solo inserción. crear/editar/anular: trigger app.auditar(); ver/exportar/enviar/ingresar: app.registrar_evento().';

-- ---------------------------------------------------------------------------------------------
-- Módulo de una entidad: primer argumento del trigger app.auditar() de su tabla.
-- ---------------------------------------------------------------------------------------------
-- 'sesion' no se audita fila por fila (0006): sus ingresos son del módulo personal.
-- NULL si no es una tabla auditada de app (numerador, audit_log, migracion, cualquier otro texto).
-- No es ejecutable por app_api: la usan registrar_evento (SECURITY DEFINER) y esta migración.
CREATE OR REPLACE FUNCTION app.modulo_de_entidad(p_entidad text) RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN p_entidad = 'sesion' THEN 'personal'
    ELSE (
      -- tgargs: argumentos separados por bytes 0, que encode(..., 'escape') muestra como \000.
      SELECT pg_catalog.split_part(pg_catalog.encode(t.tgargs, 'escape'), E'\\000', 1)
      FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = pg_catalog.to_regclass('app.' || pg_catalog.quote_ident(p_entidad))
        AND t.tgfoid = 'app.auditar()'::pg_catalog.regprocedure
        AND NOT t.tgisinternal
        AND t.tgenabled <> 'D'
        AND t.tgnargs >= 1
      LIMIT 1)
  END
$$;
COMMENT ON FUNCTION app.modulo_de_entidad(text) IS
  'Módulo declarado por el trigger app.auditar() de la tabla app.<entidad>; personal para sesion; NULL si no es una tabla auditada.';

-- ---------------------------------------------------------------------------------------------
-- app.auditar(modulo, columnas_a_ignorar...): AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.
-- ---------------------------------------------------------------------------------------------
--   * INSERT -> crear; UPDATE -> anular (deleted_at NULL -> valor, o activo true -> false) o editar;
--     DELETE -> anular (no ocurre: el borrado está rechazado).
--   * Si solo cambiaron updated_at/updated_by o las columnas a ignorar, no registra nada.
--   * Clínica: la de la fila (clinica_id, o su id para clinica). Para usuario: cada clínica con
--     membresía activa de la persona más la del contexto; sin ninguna, rechaza el cambio.
-- La política de inserción de audit_log exige que la clínica de la fila sea la del contexto: para
-- escribir en otra clínica, el trigger fija app.clinica_id por un momento y después lo devuelve.
CREATE OR REPLACE FUNCTION app.auditar() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_modulo text;
  v_ignorar text[] := ARRAY['updated_at', 'updated_by'];
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
    v_ignorar := v_ignorar || TG_ARGV[i];
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

-- Cada tabla declara su módulo (primer argumento). Una meta-prueba verifica que toda tabla auditada
-- declare uno de MODULOS.
DROP TRIGGER usuario_auditar ON app.usuario;
CREATE TRIGGER usuario_auditar AFTER INSERT OR UPDATE OR DELETE ON app.usuario
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal', 'ultimo_acceso');
DROP TRIGGER membresia_auditar ON app.membresia;
CREATE TRIGGER membresia_auditar AFTER INSERT OR UPDATE OR DELETE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal');
DROP TRIGGER usuario_sede_auditar ON app.usuario_sede;
CREATE TRIGGER usuario_sede_auditar AFTER INSERT OR UPDATE OR DELETE ON app.usuario_sede
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal');
DROP TRIGGER sede_auditar ON app.sede;
CREATE TRIGGER sede_auditar AFTER INSERT OR UPDATE OR DELETE ON app.sede
  FOR EACH ROW EXECUTE FUNCTION app.auditar('sedes');
DROP TRIGGER sede_horario_auditar ON app.sede_horario;
CREATE TRIGGER sede_horario_auditar AFTER INSERT OR UPDATE OR DELETE ON app.sede_horario
  FOR EACH ROW EXECUTE FUNCTION app.auditar('sedes');
DROP TRIGGER sillon_auditar ON app.sillon;
CREATE TRIGGER sillon_auditar AFTER INSERT OR UPDATE OR DELETE ON app.sillon
  FOR EACH ROW EXECUTE FUNCTION app.auditar('sedes');
DROP TRIGGER clinica_auditar ON app.clinica;
CREATE TRIGGER clinica_auditar AFTER INSERT OR UPDATE OR DELETE ON app.clinica
  FOR EACH ROW EXECUTE FUNCTION app.auditar('configuracion');
DROP TRIGGER rol_auditar ON app.rol;
CREATE TRIGGER rol_auditar AFTER INSERT OR UPDATE OR DELETE ON app.rol
  FOR EACH ROW EXECUTE FUNCTION app.auditar('configuracion');
DROP TRIGGER rol_permiso_auditar ON app.rol_permiso;
CREATE TRIGGER rol_permiso_auditar AFTER INSERT OR UPDATE OR DELETE ON app.rol_permiso
  FOR EACH ROW EXECUTE FUNCTION app.auditar('configuracion');

-- ---------------------------------------------------------------------------------------------
-- Relleno de las filas existentes (ver el encabezado).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.audit_log DISABLE TRIGGER audit_log_solo_insercion;
ALTER TABLE app.audit_log NO FORCE ROW LEVEL SECURITY;
-- El nombre actual (último recurso) y las membresías activas están en tablas con RLS forzado.
ALTER TABLE app.usuario NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membresia NO FORCE ROW LEVEL SECURITY;

-- modulo: el que declara hoy el trigger de la tabla (NULL para entidades que no son tablas, p. ej.
-- un 'ver paciente' registrado antes de que exista la tabla paciente).
-- sede_id: altas/ediciones/bajas la traen en la fila; los eventos ver/exportar/enviar la toman del
-- alta del registro (sede_id es inmutable en esas tablas). Nunca del detalle, que escribió la API.
-- usuario_nombre: el nombre que tenía el autor en esa fecha según el historial de auditoría de su
-- fila de usuario; si no hay historial, el actual.
UPDATE app.audit_log a SET
  modulo = app.modulo_de_entidad(a.entidad),
  sede_id = CASE
    WHEN a.entidad = 'sede' THEN a.entidad_id
    WHEN a.entidad IN ('sede_horario', 'sillon', 'usuario_sede') THEN
      CASE
        WHEN a.accion IN ('crear', 'editar', 'anular')
          THEN COALESCE(a.despues ->> 'sede_id', a.antes ->> 'sede_id')::uuid
        ELSE (SELECT (h.despues ->> 'sede_id')::uuid FROM app.audit_log h
              WHERE h.entidad = a.entidad AND h.entidad_id = a.entidad_id AND h.accion = 'crear'
                AND h.despues ? 'sede_id'
              ORDER BY h.fecha LIMIT 1)
      END
  END,
  usuario_nombre = CASE WHEN a.usuario_id IS NOT NULL THEN COALESCE(
    (SELECT h.despues ->> 'nombre' FROM app.audit_log h
     WHERE h.entidad = 'usuario' AND h.entidad_id = a.usuario_id
       AND h.accion IN ('crear', 'editar') AND h.despues ? 'nombre' AND h.fecha <= a.fecha
     ORDER BY h.fecha DESC, h.id DESC LIMIT 1),
    (SELECT u.nombre FROM app.usuario u WHERE u.id = a.usuario_id))
  END;

-- Cambios de usuario que quedaron sin clínica (clinica_id NULL, invisibles): una copia en cada
-- clínica donde la persona tiene hoy membresía activa y ya la tenía cuando hizo el cambio (una
-- clínica a la que entró después no recibe datos de antes), con la misma fecha. El original queda
-- como estaba (no se borra nada).
INSERT INTO app.audit_log (clinica_id, usuario_id, usuario_nombre, fecha, entidad, entidad_id, accion,
                           modulo, sede_id, antes, despues, ip)
SELECT m.clinica_id, a.usuario_id, a.usuario_nombre, a.fecha, a.entidad, a.entidad_id, a.accion,
       a.modulo, a.sede_id, a.antes, a.despues, a.ip
FROM app.audit_log a
JOIN app.membresia m
  ON m.usuario_id = a.entidad_id AND m.estado = 'activo' AND m.created_at <= a.fecha
WHERE a.clinica_id IS NULL AND a.entidad = 'usuario';

ALTER TABLE app.membresia FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log ENABLE TRIGGER audit_log_solo_insercion;

-- De acá en adelante, ninguna fila sin clínica. NOT VALID: las filas viejas sin clínica quedan
-- (no se borra nada), pero toda fila nueva tiene que tener clínica.
ALTER TABLE app.audit_log ADD CONSTRAINT audit_log_clinica_check CHECK (clinica_id IS NOT NULL) NOT VALID;
COMMENT ON CONSTRAINT audit_log_clinica_check ON app.audit_log IS
  'NOT VALID a propósito: filas anteriores a 0007 pueden no tener clínica (tienen su copia por clínica). No se valida.';

-- ---------------------------------------------------------------------------------------------
-- app.registrar_evento(accion, entidad, entidad_id, detalle, sede_id)
-- ---------------------------------------------------------------------------------------------
-- Eventos que registra la API: ver, exportar, enviar e ingresar. Clínica, usuario, nombre del autor,
-- IP y módulo salen de la base, nunca de parámetros. Además:
--   * entidad tiene que ser una tabla auditada de app (el módulo sale de su trigger) o 'sesion', y
--     'ingresar' va solo con 'sesion' (y 'sesion' solo con 'ingresar');
--   * si viene entidad_id, el registro tiene que existir en la clínica del contexto (RLS); su sede
--     pasa a ser la del evento;
--   * ingresar: la sesión tiene que ser del usuario y estar abierta. Una sola vez por sesión y
--     clínica: si ya está registrado, devuelve el id existente;
--   * sede_id (opcional) solo para eventos sobre un conjunto (sin entidad_id) o si coincide con la
--     del registro; tiene que ser una sede de la clínica;
--   * detalle: un objeto JSON de hasta 4096 bytes;
--   * la clínica tiene que estar activa y el usuario ser miembro activo.
DROP FUNCTION app.registrar_evento(text, text, uuid, jsonb);

CREATE FUNCTION app.registrar_evento(
  p_accion text,
  p_entidad text,
  p_entidad_id uuid DEFAULT NULL,
  p_detalle jsonb DEFAULT NULL,
  p_sede_id uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_usuario uuid := app.usuario_actual();
  v_modulo text;
  v_sede uuid;
  v_columna_sede text;
  v_filas integer;
  v_nombre text;
  v_id uuid;
BEGIN
  IF p_accion IS NULL OR p_accion NOT IN ('ver', 'exportar', 'enviar', 'ingresar') THEN
    RAISE EXCEPTION 'registrar_evento solo acepta ver, exportar, enviar o ingresar: las altas, ediciones y bajas las registra la base sola.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_entidad IS NULL OR p_entidad !~ '^[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'La entidad tiene que ser un nombre de tabla en minúsculas (p. ej. sede).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_accion = 'ingresar') <> (p_entidad = 'sesion') THEN
    RAISE EXCEPTION 'ingresar se registra solo sobre sesion, y sesion solo admite ingresar.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_detalle IS NOT NULL AND (pg_catalog.jsonb_typeof(p_detalle) <> 'object'
                                OR pg_catalog.octet_length(p_detalle::text) > 4096) THEN
    RAISE EXCEPTION 'El detalle tiene que ser un objeto JSON de hasta 4096 bytes.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_clinica IS NULL OR v_usuario IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica y usuario: la API tiene que fijarlo antes de registrar el evento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.clinica c WHERE c.id = v_clinica AND c.activo) THEN
    RAISE EXCEPTION 'La clínica del contexto no está activa.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.membresia m
    WHERE m.clinica_id = v_clinica AND m.usuario_id = v_usuario AND m.estado = 'activo'
  ) THEN
    RAISE EXCEPTION 'El usuario del contexto no tiene una membresía activa en la clínica del contexto.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_modulo := app.modulo_de_entidad(p_entidad);
  IF v_modulo IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna tabla auditada llamada %.', p_entidad
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_accion = 'ingresar' THEN
    IF p_entidad_id IS NULL OR p_sede_id IS NOT NULL THEN
      RAISE EXCEPTION 'ingresar lleva el id de la sesión y no lleva sede.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM app.sesion s
      WHERE s.id = p_entidad_id AND s.usuario_id = v_usuario AND s.cerrada_en IS NULL
    ) THEN
      RAISE EXCEPTION 'Esa sesión no existe, no es tuya o ya está cerrada.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT a.id INTO v_id FROM app.audit_log a
    WHERE a.clinica_id = v_clinica AND a.entidad = 'sesion' AND a.entidad_id = p_entidad_id
      AND a.accion = 'ingresar'
    LIMIT 1;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  ELSE
    IF p_entidad_id IS NOT NULL THEN
      v_columna_sede := CASE
        WHEN p_entidad = 'sede' THEN 'id'
        WHEN EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = pg_catalog.to_regclass('app.' || pg_catalog.quote_ident(p_entidad))
            AND a.attname = 'sede_id' AND NOT a.attisdropped
        ) THEN 'sede_id'
      END;
      -- Como dueño de las tablas y con RLS forzado: solo encuentra registros de la clínica del contexto.
      EXECUTE pg_catalog.format(
        'SELECT %s FROM app.%I t WHERE t.id = $1',
        CASE WHEN v_columna_sede IS NULL THEN 'NULL::uuid'
             ELSE 't.' || pg_catalog.quote_ident(v_columna_sede) END,
        p_entidad)
        INTO v_sede USING p_entidad_id;
      GET DIAGNOSTICS v_filas = ROW_COUNT;
      IF v_filas = 0 THEN
        RAISE EXCEPTION 'No existe ese registro de % en esta clínica.', p_entidad
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;
    IF p_sede_id IS NOT NULL THEN
      IF p_entidad_id IS NOT NULL AND v_sede IS DISTINCT FROM p_sede_id THEN
        RAISE EXCEPTION 'La sede no corresponde a ese registro.'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM app.sede s WHERE s.id = p_sede_id) THEN
        RAISE EXCEPTION 'Esa sede no existe en esta clínica.'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_sede := p_sede_id;
    END IF;
  END IF;

  SELECT u.nombre INTO v_nombre FROM app.usuario u WHERE u.id = v_usuario;

  INSERT INTO app.audit_log (clinica_id, usuario_id, usuario_nombre, entidad, entidad_id, accion,
                             modulo, sede_id, antes, despues, ip)
  VALUES (v_clinica, v_usuario, v_nombre, p_entidad, p_entidad_id, p_accion,
          v_modulo, v_sede, NULL, p_detalle, app.ip_actual())
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.registrar_evento(text, text, uuid, jsonb, uuid) IS
  'Registra ver/exportar/enviar/ingresar con clínica, usuario, nombre, IP y módulo salidos de la base. Valida entidad, registro, sede y detalle.';

GRANT EXECUTE ON FUNCTION app.registrar_evento(text, text, uuid, jsonb, uuid) TO app_api;

CALL app.asegurar_permisos();
