-- 0027_alerta_tipo_ruc: tipo de alerta manual y RUC como lo acepta normalizarRuc().
--
--   * paciente_alerta.tipo: 'alergia' o 'condicion' (TIPOS_ALERTA del contrato; CHECK
--     paciente_alerta_tipo_check, 23514). Decide cómo se muestra (alergias en coral, condiciones en
--     sol) y alimenta el cruce de alergias de las recetas (Sprint 11). Las alertas que ya había
--     quedan como 'alergia'. Sin valor por defecto: quien carga una alerta dice de qué tipo es. No
--     cambia (como el texto: una alerta solo se activa o desactiva).
--   * app.crear_alerta(paciente, tipo, texto) reemplaza a app.crear_alerta(paciente, texto) (se
--     borra).
--   * paciente_ruc_check: la base del RUC (antes del guion) va de 3 a 9 caracteres, sin ceros a la
--     izquierda y nunca solo ceros (como normalizarRuc() de @conecta/shared). La base ya sacaba los
--     ceros a la izquierda al normalizar y exigía que empezara con 1-9 o una letra, así que «000-0»
--     ya se rechazaba; lo nuevo es el largo mínimo de 3 (antes «1-1» pasaba). El dígito verificador
--     sigue validándolo la API.

-- ---------------------------------------------------------------------------------------------
-- paciente_alerta.tipo
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente_alerta
  ADD COLUMN tipo text NOT NULL DEFAULT 'alergia'
    CONSTRAINT paciente_alerta_tipo_check CHECK (tipo IN ('alergia', 'condicion'));
ALTER TABLE app.paciente_alerta ALTER COLUMN tipo DROP DEFAULT;
COMMENT ON COLUMN app.paciente_alerta.tipo IS
  'alergia o condicion (embarazo, anticoagulantes, diabetes…). No cambia.';

DROP TRIGGER paciente_alerta_auditoria_fila ON app.paciente_alerta;
CREATE TRIGGER paciente_alerta_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente_alerta
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('paciente_id', 'texto', 'creada_por', 'tipo');

DROP FUNCTION app.crear_alerta(uuid, text);
CREATE FUNCTION app.crear_alerta(p_paciente_id uuid, p_tipo text, p_texto text) RETURNS uuid
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
  INSERT INTO app.paciente_alerta (clinica_id, paciente_id, tipo, texto)
  VALUES (v_clinica, p_paciente_id, p_tipo, p_texto)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.crear_alerta(uuid, text, text) IS
  'Carga una alerta manual activa de tipo alergia o condicion. Corre como app_api (ficha_clinica:editar).';

GRANT EXECUTE ON FUNCTION app.crear_alerta(uuid, text, text) TO app_api;

-- ---------------------------------------------------------------------------------------------
-- RUC
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente DROP CONSTRAINT paciente_ruc_check;
ALTER TABLE app.paciente ADD CONSTRAINT paciente_ruc_check
  CHECK (ruc ~ '^[1-9A-Z][0-9A-Z]{2,8}-[0-9]$');
COMMENT ON COLUMN app.paciente.ruc IS
  'RUC base-dv: base de 3 a 9 caracteres sin ceros a la izquierda (nunca solo ceros). El dígito verificador lo valida la API.';

CALL app.asegurar_permisos();
