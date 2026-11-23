-- 0026_paciente_relacion_marcas_sexo: marcas del vínculo desde los dos lados y espejos que siguen
-- al sexo del paciente.
--
--   * paciente_relacion.espejo (no cambia): true si la fila la creó la base como el otro sentido de
--     un vínculo (trigger paciente_relacion_espejo). Solo la base la crea así: una fila con
--     espejo = true tiene que tener el otro sentido cargado y ser su inverso
--     (relacion_espejo_inconsistente, 23514, si no).
--     Datos anteriores: no se sabe qué lado se cargó. En los pares madre/padre/otro <-> hijo se toma
--     el lado «hijo» como el cargado y el otro como espejo (así se arreglan los espejos que quedaron
--     mal: «otro» de una madre sin sexo, «madre» de alguien que pasó a M).
--   * Cambio de sexo de un paciente P (trigger paciente_vinculos_sexo, AFTER UPDATE OF sexo,
--     SECURITY INVOKER: pasa por RLS y por pacientes:editar como el cambio del paciente):
--       - Los ESPEJOS que dependen del sexo de P (filas con familiar_id = P y espejo, cuyo otro
--         sentido es «hijo») se recalculan: madre si P es F, padre si es M, otro sin sexo. Nadie
--         eligió ese tipo: es una consecuencia del sexo, y tiene que seguirlo.
--       - Un tipo EXPLÍCITO que ya no corresponde (alguien cargó a P como madre y P pasa a M, o como
--         padre y pasa a F) se rechaza con relacion_tipo_sexo (23514), el mismo error que al crearlo:
--         ese tipo lo eligió una persona y la base no lo cambia sola; hay que quitar el vínculo y
--         cargarlo de nuevo (o revisar el sexo). Pasar a «sin sexo» no rechaza nada (madre y padre
--         admiten un familiar sin sexo cargado).
--     El tipo sigue sin editarse: la única forma de cambiarlo es ese recálculo, y la base lo
--     verifica (un UPDATE de tipo que no sea el inverso que corresponde: 42501, como antes).
--   * app.crear_relacion(paciente, familiar, tipo, es_tutor_legal, es_responsable_pago,
--     familiar_es_tutor_legal, familiar_es_responsable_pago): reemplaza a la de 5 parámetros (se
--     borra; con las dos, una llamada de 5 sería ambigua). Las marcas del otro lado se guardan en
--     el espejo en la misma transacción.
--   * app.editar_relacion(relacion, es_tutor_legal, es_responsable_pago, familiar_es_tutor_legal,
--     familiar_es_responsable_pago): cambia las marcas de un vínculo activo vistas desde el lado
--     del id (cualquiera de los dos); NULL = no cambia. Devuelve false si no cambió nada.
--     Errores: relacion_no_encontrada (P0002), relacion_dada_de_baja (22023),
--     relacion_marca_un_sentido (23514), relacion_espejo_inconsistente (23514, falta el otro
--     sentido), pacientes_sin_permiso (42501).
--   * relacion_marca_un_sentido (A tutor de B y B tutor de A a la vez; igual con responsable de
--     pago): se controla en el trigger AFTER de cada fila contra el otro sentido, que ahora se lee
--     con FOR UPDATE: con dos ediciones concurrentes del mismo par, la segunda espera a la primera y
--     ve su resultado (READ COMMITTED) o falla por serialización (REPEATABLE READ); nunca quedan las
--     dos marcas. app.editar_relacion bloquea los dos sentidos en orden de id antes de cambiar y
--     escribe los dos en UNA sentencia (los triggers AFTER miran el estado final): se puede pasar la
--     tutoría de un lado al otro en un solo pedido. Dos UPDATE directos cruzados (sin la función)
--     pueden terminar en deadlock_detected (40P01): uno de los dos se revierte, nunca las dos marcas.

-- ---------------------------------------------------------------------------------------------
-- Columna espejo y datos anteriores
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente_relacion ADD COLUMN espejo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN app.paciente_relacion.espejo IS
  'true si la fila es el otro sentido creado por la base (su tipo se recalcula si cambia el sexo). No cambia.';

-- Una sola transacción con bloqueo exclusivo: nadie ve las tablas sin RLS forzado ni sin triggers.
ALTER TABLE app.paciente NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_relacion NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_relacion DISABLE TRIGGER USER;
UPDATE app.paciente_relacion r SET espejo = true
FROM app.paciente_relacion o
WHERE r.deleted_at IS NULL AND r.tipo IN ('madre', 'padre', 'otro')
  AND o.clinica_id = r.clinica_id AND o.paciente_id = r.familiar_id AND o.familiar_id = r.paciente_id
  AND o.deleted_at IS NULL AND o.tipo = 'hijo';
ALTER TABLE app.paciente_relacion ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------------------------
-- Validación (BEFORE INSERT OR UPDATE): como en 0020, más espejo y el recálculo del tipo
-- ---------------------------------------------------------------------------------------------
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
    -- Un espejo solo existe como el inverso de un sentido cargado.
    IF NEW.espejo AND NOT EXISTS (
         SELECT 1 FROM app.paciente_relacion r
         WHERE r.clinica_id = NEW.clinica_id AND r.paciente_id = NEW.familiar_id
           AND r.familiar_id = NEW.paciente_id AND r.deleted_at IS NULL AND NOT r.espejo
           AND app.tipo_relacion_inverso(r.tipo, v_sexo_familiar) = NEW.tipo) THEN
      RAISE EXCEPTION 'Un vínculo espejo solo lo crea la base, como el inverso del otro sentido.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'relacion_espejo_inconsistente';
    END IF;
  ELSIF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    -- El tipo no se edita. Lo único: el espejo se recalcula cuando cambia el sexo del familiar.
    IF NOT OLD.espejo OR NOT EXISTS (
         SELECT 1 FROM app.paciente_relacion r
         JOIN app.paciente p ON p.clinica_id = NEW.clinica_id AND p.id = NEW.familiar_id
         WHERE r.clinica_id = NEW.clinica_id AND r.paciente_id = NEW.familiar_id
           AND r.familiar_id = NEW.paciente_id AND r.deleted_at IS NULL
           AND app.tipo_relacion_inverso(r.tipo, p.sexo) = NEW.tipo) THEN
      RAISE EXCEPTION 'El tipo de un vínculo no se cambia: quitá el vínculo y cargalo de nuevo.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  NEW.motivo_baja := NULLIF(pg_catalog.btrim(NEW.motivo_baja), '');
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.validar_relacion() IS
  'BEFORE INSERT OR UPDATE de paciente_relacion: nada sobre un vínculo dado de baja, pacientes activos al vincular, madre/padre según el sexo del familiar, espejo solo como inverso, tipo fijo salvo el recálculo del espejo.';

-- ---------------------------------------------------------------------------------------------
-- Espejo (AFTER INSERT OR UPDATE): como en 0020, con espejo = true y el otro sentido bloqueado
-- ---------------------------------------------------------------------------------------------
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

  -- FOR UPDATE: una edición concurrente del otro sentido espera a esta (o esta a aquella) y la
  -- regla de las marcas se evalúa sobre lo último confirmado.
  SELECT r.* INTO v_reverso FROM app.paciente_relacion r
  WHERE r.clinica_id = NEW.clinica_id AND r.paciente_id = NEW.familiar_id
    AND r.familiar_id = NEW.paciente_id AND r.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    IF TG_OP = 'INSERT' THEN
      SELECT p.sexo INTO v_sexo FROM app.paciente p
      WHERE p.clinica_id = NEW.clinica_id AND p.id = NEW.paciente_id;
      INSERT INTO app.paciente_relacion (clinica_id, paciente_id, familiar_id, tipo, espejo)
      VALUES (NEW.clinica_id, NEW.familiar_id, NEW.paciente_id,
              app.tipo_relacion_inverso(NEW.tipo, v_sexo), true);
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
  'AFTER INSERT OR UPDATE de paciente_relacion: crea el otro sentido (espejo), controla que sea compatible, marcas en un solo sentido (con el otro sentido bloqueado) y baja de los dos sentidos juntos.';

-- tipo deja de estar en la lista de columnas fijas (lo controla validar_relacion); espejo entra.
DROP TRIGGER paciente_relacion_auditoria_fila ON app.paciente_relacion;
CREATE TRIGGER paciente_relacion_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente_relacion
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('paciente_id', 'familiar_id', 'espejo');

-- ---------------------------------------------------------------------------------------------
-- Cambio de sexo de un paciente
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.revisar_vinculos_por_sexo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tipo text;
BEGIN
  IF NEW.sexo IS NOT DISTINCT FROM OLD.sexo THEN
    RETURN NULL;
  END IF;
  -- Un tipo elegido por una persona que ya no corresponde: se rechaza.
  SELECT r.tipo INTO v_tipo FROM app.paciente_relacion r
  WHERE r.clinica_id = NEW.clinica_id AND r.familiar_id = NEW.id AND r.deleted_at IS NULL
    AND NOT r.espejo
    AND ((r.tipo = 'madre' AND NEW.sexo = 'M') OR (r.tipo = 'padre' AND NEW.sexo = 'F'))
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Este paciente figura como % en su grupo familiar y no coincide con el sexo nuevo: quitá ese vínculo y cargalo de nuevo, o revisá el sexo.', v_tipo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'relacion_tipo_sexo';
  END IF;
  -- Los espejos que dependen del sexo se recalculan.
  UPDATE app.paciente_relacion r
  SET tipo = app.tipo_relacion_inverso(o.tipo, NEW.sexo)
  FROM app.paciente_relacion o
  WHERE r.clinica_id = NEW.clinica_id AND r.familiar_id = NEW.id AND r.deleted_at IS NULL AND r.espejo
    AND o.clinica_id = r.clinica_id AND o.paciente_id = r.familiar_id AND o.familiar_id = r.paciente_id
    AND o.deleted_at IS NULL
    AND r.tipo IS DISTINCT FROM app.tipo_relacion_inverso(o.tipo, NEW.sexo);
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.revisar_vinculos_por_sexo() IS
  'AFTER UPDATE OF sexo de paciente: recalcula los espejos que dependen del sexo y rechaza (relacion_tipo_sexo) si un madre/padre explícito ya no corresponde.';

CREATE TRIGGER paciente_vinculos_sexo AFTER UPDATE OF sexo ON app.paciente
  FOR EACH ROW EXECUTE FUNCTION app.revisar_vinculos_por_sexo();

-- Datos anteriores: los espejos, con el tipo que corresponde al sexo de hoy (queda en auditoría).
UPDATE app.paciente_relacion r
SET tipo = app.tipo_relacion_inverso(o.tipo, p.sexo)
FROM app.paciente_relacion o, app.paciente p
WHERE r.deleted_at IS NULL AND r.espejo
  AND o.clinica_id = r.clinica_id AND o.paciente_id = r.familiar_id AND o.familiar_id = r.paciente_id
  AND o.deleted_at IS NULL
  AND p.clinica_id = r.clinica_id AND p.id = r.familiar_id
  AND r.tipo IS DISTINCT FROM app.tipo_relacion_inverso(o.tipo, p.sexo);

ALTER TABLE app.paciente FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_relacion FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Funciones (SECURITY INVOKER)
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION app.crear_relacion(uuid, uuid, text, boolean, boolean);
CREATE FUNCTION app.crear_relacion(
  p_paciente_id uuid,
  p_familiar_id uuid,
  p_tipo text,
  p_es_tutor_legal boolean DEFAULT false,
  p_es_responsable_pago boolean DEFAULT false,
  p_familiar_es_tutor_legal boolean DEFAULT false,
  p_familiar_es_responsable_pago boolean DEFAULT false
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
  -- Las marcas del otro lado van en el espejo, que el trigger acaba de crear.
  IF COALESCE(p_familiar_es_tutor_legal, false) OR COALESCE(p_familiar_es_responsable_pago, false) THEN
    UPDATE app.paciente_relacion r
    SET es_tutor_legal = COALESCE(p_familiar_es_tutor_legal, false),
        es_responsable_pago = COALESCE(p_familiar_es_responsable_pago, false)
    WHERE r.clinica_id = v_clinica AND r.paciente_id = p_familiar_id
      AND r.familiar_id = p_paciente_id AND r.deleted_at IS NULL;
  END IF;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.crear_relacion(uuid, uuid, text, boolean, boolean, boolean, boolean) IS
  'Crea el vínculo «familiar es tipo de paciente» y su espejo, con las marcas de los dos lados. Corre como app_api (pacientes:editar).';

CREATE OR REPLACE FUNCTION app.editar_relacion(
  p_relacion_id uuid,
  p_es_tutor_legal boolean DEFAULT NULL,
  p_es_responsable_pago boolean DEFAULT NULL,
  p_familiar_es_tutor_legal boolean DEFAULT NULL,
  p_familiar_es_responsable_pago boolean DEFAULT NULL
) RETURNS boolean
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_relacion app.paciente_relacion%ROWTYPE;
  v_reverso app.paciente_relacion%ROWTYPE;
  v_filas integer;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de editar el vínculo.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.* INTO v_relacion FROM app.paciente_relacion r
  WHERE r.clinica_id = v_clinica AND r.id = p_relacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ningún vínculo con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'relacion_no_encontrada';
  END IF;
  -- Los dos sentidos, bloqueados en orden de id: dos ediciones del mismo par (desde una ficha o
  -- desde la otra) se esperan en vez de cruzarse.
  PERFORM 1 FROM app.paciente_relacion r
  WHERE r.clinica_id = v_clinica
    AND (r.id = p_relacion_id
         OR (r.paciente_id = v_relacion.familiar_id AND r.familiar_id = v_relacion.paciente_id
             AND r.deleted_at IS NULL))
  ORDER BY r.id
  FOR UPDATE;
  SELECT r.* INTO v_relacion FROM app.paciente_relacion r
  WHERE r.clinica_id = v_clinica AND r.id = p_relacion_id;
  IF v_relacion.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese vínculo ya está dado de baja: para volver a vincularlos, creá uno nuevo.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'relacion_dada_de_baja';
  END IF;
  SELECT r.* INTO v_reverso FROM app.paciente_relacion r
  WHERE r.clinica_id = v_clinica AND r.paciente_id = v_relacion.familiar_id
    AND r.familiar_id = v_relacion.paciente_id AND r.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falta el otro sentido de este vínculo: quitalo y cargalo de nuevo.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'relacion_espejo_inconsistente';
  END IF;

  -- Una sola sentencia: la regla de las marcas (trigger AFTER) mira los dos sentidos ya cambiados.
  UPDATE app.paciente_relacion r
  SET es_tutor_legal = n.tutor, es_responsable_pago = n.pago
  FROM (VALUES
          (v_relacion.id, COALESCE(p_es_tutor_legal, v_relacion.es_tutor_legal),
           COALESCE(p_es_responsable_pago, v_relacion.es_responsable_pago)),
          (v_reverso.id, COALESCE(p_familiar_es_tutor_legal, v_reverso.es_tutor_legal),
           COALESCE(p_familiar_es_responsable_pago, v_reverso.es_responsable_pago))
       ) AS n(id, tutor, pago)
  WHERE r.clinica_id = v_clinica AND r.id = n.id
    AND (r.es_tutor_legal, r.es_responsable_pago) IS DISTINCT FROM (n.tutor, n.pago);
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas > 0;
END
$$;
COMMENT ON FUNCTION app.editar_relacion(uuid, boolean, boolean, boolean, boolean) IS
  'Cambia las marcas (tutor legal, responsable de pago) de un vínculo activo, vistas desde el lado p_relacion_id; NULL no cambia. false si no cambió nada. Corre como app_api (pacientes:editar).';

GRANT EXECUTE ON FUNCTION app.crear_relacion(uuid, uuid, text, boolean, boolean, boolean, boolean) TO app_api;
GRANT EXECUTE ON FUNCTION app.editar_relacion(uuid, boolean, boolean, boolean, boolean) TO app_api;

CALL app.asegurar_permisos();
