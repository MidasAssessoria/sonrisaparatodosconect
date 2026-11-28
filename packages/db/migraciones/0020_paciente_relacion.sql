-- 0020_paciente_relacion: grupo familiar (módulo pacientes).
--
-- Una fila (paciente_id = P, familiar_id = F, tipo = T) se lee desde la ficha de P: «F es T de P»;
-- es_tutor_legal y es_responsable_pago dicen «P es tutor legal de F» y «P paga por F» (relacionSchema
-- del contrato). Todo vínculo existe en los dos sentidos:
--   * Espejo automático (trigger paciente_relacion_espejo, AFTER INSERT, SECURITY INVOKER): al dar de
--     alta (P, F, T) se crea en la misma transacción (F, P, inverso(T)) si no existe, sin marcas.
--     Inverso: madre/padre -> hijo; hijo -> madre o padre según el sexo de P (sin sexo: otro);
--     abuelo <-> nieto; tutor <-> tutelado; hermano, pareja y otro, el mismo. Si el otro sentido ya
--     existe (p. ej. dos filas en la misma sentencia), tiene que ser compatible:
--     relacion_espejo_inconsistente (23514).
--   * Una relación activa por par y sentido: índice único parcial paciente_relacion_par_activo (23505).
--     Con el espejo, eso es «una por par».
--   * Nunca consigo mismo: paciente_relacion_consigo_mismo (23514). Los dos pacientes son de la
--     clínica (FK compuestas paciente_relacion_paciente_fkey / paciente_relacion_familiar_fkey, 23503)
--     y tienen que estar activos al crear el vínculo: relacion_paciente_inactivo (22023).
--   * madre exige que el familiar no sea de sexo M, y padre que no sea F: relacion_tipo_sexo (23514).
--   * es_tutor_legal y es_responsable_pago valen en un solo sentido: si están en los dos, error
--     relacion_marca_un_sentido (23514).
--   * paciente_id, familiar_id y tipo no cambian. La baja (deleted_at, motivo_baja opcional) da de
--     baja también el otro sentido en la misma transacción. Un vínculo dado de baja no se toca más
--     (relacion_dada_de_baja, 22023): para volver a vincular, se crea otro.
--   * Permiso de la base: pacientes:editar (app.proteger_pacientes, 0019).
-- Funciones (SECURITY INVOKER): app.crear_relacion(...), app.baja_relacion(relacion, motivo).

CREATE TABLE app.paciente_relacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  paciente_id uuid NOT NULL,
  familiar_id uuid NOT NULL,
  tipo text NOT NULL CONSTRAINT paciente_relacion_tipo_check CHECK (tipo IN (
    'madre', 'padre', 'hijo', 'hermano', 'pareja', 'abuelo', 'nieto', 'tutor', 'tutelado', 'otro')),
  es_tutor_legal boolean NOT NULL DEFAULT false,
  es_responsable_pago boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app.usuario (id),
  motivo_baja text CONSTRAINT paciente_relacion_motivo_baja_check
    CHECK (btrim(motivo_baja) <> '' AND char_length(motivo_baja) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT paciente_relacion_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT paciente_relacion_paciente_fkey FOREIGN KEY (clinica_id, paciente_id)
    REFERENCES app.paciente (clinica_id, id),
  CONSTRAINT paciente_relacion_familiar_fkey FOREIGN KEY (clinica_id, familiar_id)
    REFERENCES app.paciente (clinica_id, id),
  CONSTRAINT paciente_relacion_consigo_mismo CHECK (paciente_id <> familiar_id)
);
COMMENT ON TABLE app.paciente_relacion IS
  'Grupo familiar: «familiar es tipo de paciente». Siempre en los dos sentidos (espejo en la misma transacción). Se da de baja, no se borra.';
COMMENT ON COLUMN app.paciente_relacion.es_tutor_legal IS 'paciente_id es tutor legal de familiar_id (un solo sentido).';
COMMENT ON COLUMN app.paciente_relacion.es_responsable_pago IS 'paciente_id paga por familiar_id (un solo sentido).';

CREATE UNIQUE INDEX paciente_relacion_par_activo
  ON app.paciente_relacion (clinica_id, paciente_id, familiar_id) WHERE deleted_at IS NULL;
CREATE INDEX paciente_relacion_familiar_idx
  ON app.paciente_relacion (clinica_id, familiar_id) WHERE deleted_at IS NULL;

-- Tipo que corresponde al otro sentido: «F es p_tipo de P» -> «P es ? de F». p_sexo es el de P.
CREATE OR REPLACE FUNCTION app.tipo_relacion_inverso(p_tipo text, p_sexo text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE p_tipo
    WHEN 'madre' THEN 'hijo'
    WHEN 'padre' THEN 'hijo'
    WHEN 'hijo' THEN CASE p_sexo WHEN 'F' THEN 'madre' WHEN 'M' THEN 'padre' ELSE 'otro' END
    WHEN 'abuelo' THEN 'nieto'
    WHEN 'nieto' THEN 'abuelo'
    WHEN 'tutor' THEN 'tutelado'
    WHEN 'tutelado' THEN 'tutor'
    ELSE p_tipo
  END;
COMMENT ON FUNCTION app.tipo_relacion_inverso(text, text) IS
  'Tipo del otro sentido de un vínculo: madre/padre -> hijo, hijo -> madre/padre según el sexo (o otro), abuelo <-> nieto, tutor <-> tutelado; el resto igual.';

-- ¿Pueden convivir estos dos tipos como los dos sentidos de un vínculo? (hijo admite madre, padre u
-- otro del otro lado: el sexo pudo no saberse o cambiar.)
CREATE OR REPLACE FUNCTION app.tipos_relacion_compatibles(p_tipo text, p_reverso text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN ARRAY[p_tipo, p_reverso] IN (
    ARRAY['madre', 'hijo'], ARRAY['hijo', 'madre'], ARRAY['padre', 'hijo'], ARRAY['hijo', 'padre'],
    ARRAY['otro', 'hijo'], ARRAY['hijo', 'otro'], ARRAY['abuelo', 'nieto'], ARRAY['nieto', 'abuelo'],
    ARRAY['tutor', 'tutelado'], ARRAY['tutelado', 'tutor'], ARRAY['hermano', 'hermano'],
    ARRAY['pareja', 'pareja'], ARRAY['otro', 'otro']);
COMMENT ON FUNCTION app.tipos_relacion_compatibles(text, text) IS
  'true si p_tipo y p_reverso pueden ser los dos sentidos de un mismo vínculo.';

-- BEFORE INSERT OR UPDATE (para todos): baja definitiva, pacientes activos al vincular, tipo y sexo.
CREATE OR REPLACE FUNCTION app.validar_relacion() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_inactivos integer;
  v_sexo_familiar text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese vínculo ya está dado de baja: para volver a vincularlos, creá uno nuevo.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'relacion_dada_de_baja';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Un vínculo nuevo nace activo.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'relacion_dada_de_baja';
    END IF;
    -- Si alguno no existe en la clínica, lo rechaza el FK compuesto.
    SELECT pg_catalog.count(*) FILTER (WHERE NOT p.activo),
           pg_catalog.max(p.sexo) FILTER (WHERE p.id = NEW.familiar_id)
      INTO v_inactivos, v_sexo_familiar
    FROM app.paciente p
    WHERE p.clinica_id = NEW.clinica_id AND p.id IN (NEW.paciente_id, NEW.familiar_id);
    IF v_inactivos > 0 THEN
      RAISE EXCEPTION 'Solo se vinculan pacientes activos: reactivalo antes.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'relacion_paciente_inactivo';
    END IF;
    IF (NEW.tipo = 'madre' AND v_sexo_familiar = 'M') OR (NEW.tipo = 'padre' AND v_sexo_familiar = 'F') THEN
      RAISE EXCEPTION 'El vínculo % no coincide con el sexo cargado del familiar: revisá el vínculo o el sexo.', NEW.tipo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'relacion_tipo_sexo';
    END IF;
  END IF;
  NEW.motivo_baja := NULLIF(pg_catalog.btrim(NEW.motivo_baja), '');
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.validar_relacion() IS
  'BEFORE INSERT OR UPDATE de paciente_relacion: nada sobre un vínculo dado de baja, pacientes activos al vincular, madre/padre según el sexo del familiar.';

-- AFTER INSERT OR UPDATE (SECURITY INVOKER: el espejo pasa por RLS y las defensas como el original).
CREATE OR REPLACE FUNCTION app.espejar_relacion() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reverso app.paciente_relacion%ROWTYPE;
  v_sexo text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- Baja: el otro sentido cae con este (su propio trigger ya no encuentra nada activo).
    UPDATE app.paciente_relacion r
    SET deleted_at = pg_catalog.now(), motivo_baja = NEW.motivo_baja
    WHERE r.clinica_id = NEW.clinica_id AND r.paciente_id = NEW.familiar_id
      AND r.familiar_id = NEW.paciente_id AND r.deleted_at IS NULL;
    RETURN NULL;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.* INTO v_reverso FROM app.paciente_relacion r
  WHERE r.clinica_id = NEW.clinica_id AND r.paciente_id = NEW.familiar_id
    AND r.familiar_id = NEW.paciente_id AND r.deleted_at IS NULL;

  IF NOT FOUND THEN
    IF TG_OP = 'INSERT' THEN
      SELECT p.sexo INTO v_sexo FROM app.paciente p
      WHERE p.clinica_id = NEW.clinica_id AND p.id = NEW.paciente_id;
      INSERT INTO app.paciente_relacion (clinica_id, paciente_id, familiar_id, tipo)
      VALUES (NEW.clinica_id, NEW.familiar_id, NEW.paciente_id,
              app.tipo_relacion_inverso(NEW.tipo, v_sexo));
    END IF;
    RETURN NULL;
  END IF;

  IF NOT app.tipos_relacion_compatibles(NEW.tipo, v_reverso.tipo) THEN
    RAISE EXCEPTION 'Ese vínculo no coincide con el que ya está cargado en el otro sentido (% / %).',
      NEW.tipo, v_reverso.tipo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'relacion_espejo_inconsistente';
  END IF;
  IF (NEW.es_tutor_legal AND v_reverso.es_tutor_legal)
     OR (NEW.es_responsable_pago AND v_reverso.es_responsable_pago) THEN
    RAISE EXCEPTION 'Tutor legal y responsable de pago valen en un solo sentido: quitáselo al otro antes.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'relacion_marca_un_sentido';
  END IF;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.espejar_relacion() IS
  'AFTER INSERT OR UPDATE de paciente_relacion: crea el otro sentido, controla que sea compatible, marcas en un solo sentido y baja de los dos sentidos juntos.';

CREATE TRIGGER paciente_relacion_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente_relacion
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('paciente_id', 'familiar_id', 'tipo');
CREATE TRIGGER paciente_relacion_proteger BEFORE INSERT OR UPDATE ON app.paciente_relacion
  FOR EACH ROW EXECUTE FUNCTION app.proteger_pacientes();
CREATE TRIGGER paciente_relacion_validar BEFORE INSERT OR UPDATE ON app.paciente_relacion
  FOR EACH ROW EXECUTE FUNCTION app.validar_relacion();
CREATE TRIGGER paciente_relacion_auditar AFTER INSERT OR UPDATE OR DELETE ON app.paciente_relacion
  FOR EACH ROW EXECUTE FUNCTION app.auditar('pacientes');
CREATE TRIGGER paciente_relacion_espejo AFTER INSERT OR UPDATE ON app.paciente_relacion
  FOR EACH ROW EXECUTE FUNCTION app.espejar_relacion();
CREATE TRIGGER paciente_relacion_sin_borrado BEFORE DELETE OR TRUNCATE ON app.paciente_relacion
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- Funciones (SECURITY INVOKER)
-- ---------------------------------------------------------------------------------------------
-- Crea «p_familiar es p_tipo de p_paciente» y su espejo. Devuelve el id de la fila vista desde
-- p_paciente.
CREATE OR REPLACE FUNCTION app.crear_relacion(
  p_paciente_id uuid,
  p_familiar_id uuid,
  p_tipo text,
  p_es_tutor_legal boolean DEFAULT false,
  p_es_responsable_pago boolean DEFAULT false
) RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_id uuid;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de vincular.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.paciente_relacion (clinica_id, paciente_id, familiar_id, tipo, es_tutor_legal,
                                     es_responsable_pago)
  VALUES (v_clinica, p_paciente_id, p_familiar_id, p_tipo, COALESCE(p_es_tutor_legal, false),
          COALESCE(p_es_responsable_pago, false))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.crear_relacion(uuid, uuid, text, boolean, boolean) IS
  'Crea el vínculo «familiar es tipo de paciente» y su espejo. Corre como app_api (pacientes:editar).';

-- Da de baja el vínculo y su espejo. false si ya estaba dado de baja.
CREATE OR REPLACE FUNCTION app.baja_relacion(p_relacion_id uuid, p_motivo text DEFAULT NULL)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_baja timestamptz;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de dar de baja.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.deleted_at INTO v_baja FROM app.paciente_relacion r
  WHERE r.clinica_id = v_clinica AND r.id = p_relacion_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ningún vínculo con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'relacion_no_encontrada';
  END IF;
  IF v_baja IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE app.paciente_relacion r
  SET deleted_at = pg_catalog.now(), motivo_baja = NULLIF(pg_catalog.btrim(p_motivo), '')
  WHERE r.clinica_id = v_clinica AND r.id = p_relacion_id;
  RETURN true;
END
$$;
COMMENT ON FUNCTION app.baja_relacion(uuid, text) IS
  'Da de baja un vínculo y su espejo (motivo opcional). false si ya estaba dado de baja. Corre como app_api (pacientes:editar).';

-- ---------------------------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente_relacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_relacion FORCE ROW LEVEL SECURITY;
CREATE POLICY paciente_relacion_aislamiento ON app.paciente_relacion
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT, INSERT, UPDATE ON app.paciente_relacion TO app_api;
GRANT EXECUTE ON FUNCTION app.tipo_relacion_inverso(text, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.tipos_relacion_compatibles(text, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.crear_relacion(uuid, uuid, text, boolean, boolean) TO app_api;
GRANT EXECUTE ON FUNCTION app.baja_relacion(uuid, text) TO app_api;

CALL app.asegurar_permisos();
