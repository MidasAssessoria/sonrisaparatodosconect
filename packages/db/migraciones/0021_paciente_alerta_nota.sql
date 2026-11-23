-- 0021_paciente_alerta_nota: alertas manuales y nota interna del paciente (módulo ficha_clinica).
--
--   * paciente_alerta: alerta manual (alergias, embarazo… que carga el odontólogo; las médicas se
--     derivan de la anamnesis en el Sprint 4). texto de 3 a 200 caracteres (sin espacios alrededor),
--     activa, creada_por (la fija la base con el usuario del contexto). texto, paciente_id y
--     creada_por no cambian: una alerta solo se activa o desactiva. La lee cualquiera con acceso a la
--     clínica (recepción la necesita en el mostrador; el permiso pacientes:ver lo controla la API).
--   * paciente_nota: la nota interna, una por paciente (paciente_nota_paciente_key). Es dato clínico y
--     va APARTE de paciente a propósito:
--       - RLS: la política de SELECT exige además app.tiene_permiso('ficha_clinica', 'ver') del
--         usuario del contexto. Sin ese permiso la fila no existe para app_api, consulte como consulte
--         (SELECT directo, joins, funciones INVOKER): no depende de que la API se acuerde de filtrar.
--       - Auditoría: sus altas y ediciones quedan con módulo ficha_clinica. Si la nota estuviera en
--         paciente, cada edición del paciente (módulo pacientes, que recepción ve en la auditoría)
--         llevaría la nota en antes/después.
--     texto NULL = nota borrada (el contrato manda null para borrar; la fila y su historial quedan).
--     app.guardar_nota_interna(paciente, texto) crea o reemplaza.
--   * Escribir alertas o la nota exige ficha_clinica:editar del actor (app.proteger_pacientes, 0019):
--     ficha_clinica_sin_permiso (42501).
--   * app.auditar(): igual que en 0017, y además una columna «activa» que pasa de true a false se
--     registra como «anular» (desactivar una alerta es su baja), como activo y deleted_at.

-- ---------------------------------------------------------------------------------------------
-- paciente_alerta
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.paciente_alerta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  paciente_id uuid NOT NULL,
  texto text NOT NULL
    CONSTRAINT paciente_alerta_texto_check CHECK (char_length(btrim(texto)) BETWEEN 3 AND 200),
  activa boolean NOT NULL DEFAULT true,
  creada_por uuid REFERENCES app.usuario (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT paciente_alerta_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT paciente_alerta_paciente_fkey FOREIGN KEY (clinica_id, paciente_id)
    REFERENCES app.paciente (clinica_id, id)
);
COMMENT ON TABLE app.paciente_alerta IS
  'Alertas manuales del paciente (ficha_clinica). Solo se activan o desactivan; no se editan ni se borran.';
COMMENT ON COLUMN app.paciente_alerta.creada_por IS 'Usuario del contexto al crearla (lo fija la base).';

CREATE INDEX paciente_alerta_paciente_idx ON app.paciente_alerta (clinica_id, paciente_id)
  WHERE activa;

-- texto sin espacios alrededor; creada_por = usuario del contexto, lo mande o no el cliente.
CREATE OR REPLACE FUNCTION app.normalizar_alerta() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.texto := pg_catalog.btrim(NEW.texto);
    NEW.creada_por := app.usuario_actual();
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.normalizar_alerta() IS
  'BEFORE INSERT de paciente_alerta: texto sin espacios alrededor y creada_por del contexto.';

CREATE TRIGGER paciente_alerta_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente_alerta
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('paciente_id', 'texto', 'creada_por');
CREATE TRIGGER paciente_alerta_normalizar BEFORE INSERT ON app.paciente_alerta
  FOR EACH ROW EXECUTE FUNCTION app.normalizar_alerta();
CREATE TRIGGER paciente_alerta_proteger BEFORE INSERT OR UPDATE ON app.paciente_alerta
  FOR EACH ROW EXECUTE FUNCTION app.proteger_pacientes();
CREATE TRIGGER paciente_alerta_auditar AFTER INSERT OR UPDATE OR DELETE ON app.paciente_alerta
  FOR EACH ROW EXECUTE FUNCTION app.auditar('ficha_clinica');
CREATE TRIGGER paciente_alerta_sin_borrado BEFORE DELETE OR TRUNCATE ON app.paciente_alerta
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- paciente_nota
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.paciente_nota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  paciente_id uuid NOT NULL,
  texto text CONSTRAINT paciente_nota_texto_check
    CHECK (btrim(texto) <> '' AND char_length(texto) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT paciente_nota_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT paciente_nota_paciente_key UNIQUE (clinica_id, paciente_id),
  CONSTRAINT paciente_nota_paciente_fkey FOREIGN KEY (clinica_id, paciente_id)
    REFERENCES app.paciente (clinica_id, id)
);
COMMENT ON TABLE app.paciente_nota IS
  'Nota interna del paciente (dato clínico). Solo la ve quien tiene ficha_clinica:ver (RLS) y la escribe quien tiene ficha_clinica:editar.';
COMMENT ON COLUMN app.paciente_nota.texto IS 'NULL = nota borrada (el historial queda en audit_log).';

CREATE OR REPLACE FUNCTION app.normalizar_nota() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.texto := NULLIF(pg_catalog.btrim(NEW.texto), '');
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.normalizar_nota() IS
  'BEFORE INSERT OR UPDATE de paciente_nota: texto sin espacios alrededor; vacío = NULL.';

CREATE TRIGGER paciente_nota_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente_nota
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('paciente_id');
CREATE TRIGGER paciente_nota_normalizar BEFORE INSERT OR UPDATE ON app.paciente_nota
  FOR EACH ROW EXECUTE FUNCTION app.normalizar_nota();
CREATE TRIGGER paciente_nota_proteger BEFORE INSERT OR UPDATE ON app.paciente_nota
  FOR EACH ROW EXECUTE FUNCTION app.proteger_pacientes();
CREATE TRIGGER paciente_nota_auditar AFTER INSERT OR UPDATE OR DELETE ON app.paciente_nota
  FOR EACH ROW EXECUTE FUNCTION app.auditar('ficha_clinica');
CREATE TRIGGER paciente_nota_sin_borrado BEFORE DELETE OR TRUNCATE ON app.paciente_nota
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- Funciones (SECURITY INVOKER: corren como app_api con RLS y las defensas)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.crear_alerta(p_paciente_id uuid, p_texto text) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_id uuid;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de cargar la alerta.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.paciente_alerta (clinica_id, paciente_id, texto)
  VALUES (v_clinica, p_paciente_id, p_texto)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.crear_alerta(uuid, text) IS
  'Carga una alerta manual activa. Corre como app_api (ficha_clinica:editar).';

-- Activa o desactiva. false si ya estaba así.
CREATE OR REPLACE FUNCTION app.cambiar_alerta(p_alerta_id uuid, p_activa boolean) RETURNS boolean
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_activa boolean;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de cambiar la alerta.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_activa IS NULL THEN
    RAISE EXCEPTION 'Decí si la alerta queda activa o no.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT a.activa INTO v_activa FROM app.paciente_alerta a
  WHERE a.clinica_id = v_clinica AND a.id = p_alerta_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ninguna alerta con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'alerta_no_encontrada';
  END IF;
  IF v_activa = p_activa THEN
    RETURN false;
  END IF;
  UPDATE app.paciente_alerta a SET activa = p_activa
  WHERE a.clinica_id = v_clinica AND a.id = p_alerta_id;
  RETURN true;
END
$$;
COMMENT ON FUNCTION app.cambiar_alerta(uuid, boolean) IS
  'Activa o desactiva una alerta manual. false si ya estaba así. Corre como app_api (ficha_clinica:editar).';

-- Crea o reemplaza la nota interna. NULL o vacío la borra (texto NULL; la fila queda).
CREATE OR REPLACE FUNCTION app.guardar_nota_interna(p_paciente_id uuid, p_texto text) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de guardar la nota.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.paciente_nota AS n (clinica_id, paciente_id, texto)
  VALUES (v_clinica, p_paciente_id, p_texto)
  ON CONFLICT (clinica_id, paciente_id) DO UPDATE SET texto = EXCLUDED.texto
    WHERE n.texto IS DISTINCT FROM EXCLUDED.texto;
END
$$;
COMMENT ON FUNCTION app.guardar_nota_interna(uuid, text) IS
  'Crea o reemplaza la nota interna (NULL la borra). Corre como app_api: ficha_clinica:editar (y ver, para reemplazar).';

-- ---------------------------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente_alerta ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_alerta FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_nota ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_nota FORCE ROW LEVEL SECURITY;

CREATE POLICY paciente_alerta_aislamiento ON app.paciente_alerta
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

-- (SELECT …): se evalúa una vez por consulta, no por fila.
CREATE POLICY paciente_nota_ver ON app.paciente_nota
  FOR SELECT
  USING (clinica_id = app.clinica_actual() AND (SELECT app.tiene_permiso('ficha_clinica', 'ver')));
CREATE POLICY paciente_nota_insertar ON app.paciente_nota
  FOR INSERT
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY paciente_nota_editar ON app.paciente_nota
  FOR UPDATE
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT, INSERT, UPDATE ON app.paciente_alerta TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.paciente_nota TO app_api;
GRANT EXECUTE ON FUNCTION app.crear_alerta(uuid, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.cambiar_alerta(uuid, boolean) TO app_api;
GRANT EXECUTE ON FUNCTION app.guardar_nota_interna(uuid, text) TO app_api;

-- ---------------------------------------------------------------------------------------------
-- app.auditar(): igual que en 0017, más «activa» true -> false = anular
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
       OR (v_antes ? 'activa' AND (v_antes ->> 'activa')::boolean IS TRUE
          AND (v_despues ->> 'activa')::boolean IS FALSE)
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
COMMENT ON FUNCTION app.auditar() IS
  'Trigger de auditoría: app.auditar(modulo, columnas a ignorar, -columnas a no guardar). Desde 0021, activa true -> false también es anular.';

CALL app.asegurar_permisos();
