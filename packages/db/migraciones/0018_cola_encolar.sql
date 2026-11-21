-- 0018_cola_encolar: la API encola con una función, no con INSERT directo en la cola.
--
-- Antes app_api insertaba en cola.job_common (pg-boss `send` en su transacción) y podía poner
-- cualquier clinicaId en los datos, cualquier cola, prioridad o reintentos. Ahora:
--   * app.encolar(nombre, datos) -> uuid, SECURITY DEFINER. Se llama dentro de la transacción del
--     pedido (si se revierte, el trabajo no queda). Exige la clínica del contexto (activa); la pone
--     en datos.clinicaId (si el cliente la manda, tiene que ser la misma). Solo acepta las colas de
--     esta lista y valida los datos de cada una. Prioridad 0, sin demora, y las opciones (reintentos,
--     espera, vencimiento, retención, política, cola de descarte) son las de la fila de cola.queue
--     que creó la migración. Inserta como pg-boss 12.38.2 (`insertJobs`); devuelve el id, o NULL si
--     la política de la cola descartó el trabajo (no pasa con las colas de hoy).
--     Colas y datos:
--       archivo.verificar  { archivoId: uuid de un archivo de la clínica del contexto }
--                          -> datos guardados { clinicaId, archivoId }
--     Errores: cola_sin_contexto (42501), cola_no_permitida (22023), cola_datos_invalidos (22023).
--   * app_api pierde todo en el schema cola (INSERT y SELECT(id) en job_common, SELECT en queue y
--     version, EXECUTE de job_now y USAGE del schema). El worker puede confiar en el clinicaId de los
--     trabajos: lo puso la base desde el contexto, igual que el que usa RLS.
--
-- Agregar una cola = una migración nueva que la cree (cola.create_queue) y reemplace esta función con
-- su rama de validación.

CREATE OR REPLACE FUNCTION app.encolar(p_nombre text, p_datos jsonb DEFAULT NULL)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_datos jsonb := COALESCE(p_datos, '{}'::jsonb);
  v_cola record;
  v_ahora timestamptz;
  v_id uuid;
  v_patron_uuid CONSTANT text :=
    '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$';
BEGIN
  IF v_clinica IS NULL OR NOT EXISTS (
    SELECT 1 FROM app.clinica c WHERE c.id = v_clinica AND c.activo
  ) THEN
    RAISE EXCEPTION 'Falta la clínica del contexto (o está dada de baja): la API encola dentro de la transacción del pedido.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'cola_sin_contexto';
  END IF;
  IF pg_catalog.jsonb_typeof(v_datos) <> 'object' OR pg_catalog.octet_length(v_datos::text) > 4096 THEN
    RAISE EXCEPTION 'Los datos del trabajo tienen que ser un objeto JSON de hasta 4096 bytes.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cola_datos_invalidos';
  END IF;
  IF v_datos ? 'clinicaId' THEN
    IF pg_catalog.jsonb_typeof(v_datos -> 'clinicaId') <> 'string'
       OR pg_catalog.lower(v_datos ->> 'clinicaId') <> v_clinica::text THEN
      RAISE EXCEPTION 'La clínica del trabajo es la del contexto: no se puede elegir otra.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cola_datos_invalidos';
    END IF;
    v_datos := v_datos - 'clinicaId';
  END IF;

  CASE p_nombre
    WHEN 'archivo.verificar' THEN
      IF ARRAY(SELECT k FROM pg_catalog.jsonb_object_keys(v_datos) AS k ORDER BY 1)
           IS DISTINCT FROM ARRAY['archivoId']
         OR pg_catalog.jsonb_typeof(v_datos -> 'archivoId') <> 'string'
         OR (v_datos ->> 'archivoId') !~ v_patron_uuid THEN
        RAISE EXCEPTION 'archivo.verificar lleva solo archivoId (un UUID).'
          USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cola_datos_invalidos';
      END IF;
      -- Como dueño de las tablas y con RLS forzado: solo ve archivos de la clínica del contexto.
      IF NOT EXISTS (
        SELECT 1 FROM app.archivo a
        WHERE a.clinica_id = v_clinica AND a.id = (v_datos ->> 'archivoId')::uuid
      ) THEN
        RAISE EXCEPTION 'No existe ese archivo en esta clínica.'
          USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cola_datos_invalidos';
      END IF;
      v_datos := pg_catalog.jsonb_build_object(
        'clinicaId', v_clinica::text,
        'archivoId', pg_catalog.lower(v_datos ->> 'archivoId'));
    ELSE
      RAISE EXCEPTION 'No existe la cola %.', COALESCE(p_nombre, '(sin nombre)')
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cola_no_permitida';
  END CASE;

  SELECT q.policy, q.retry_limit, q.retry_delay, q.retry_backoff, q.retry_delay_max,
         q.expire_seconds, q.retention_seconds, q.deletion_seconds, q.dead_letter,
         q.heartbeat_seconds
    INTO v_cola
  FROM cola.queue q WHERE q.name = p_nombre;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la cola %.', p_nombre
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cola_no_permitida';
  END IF;

  v_ahora := cola.job_now();
  INSERT INTO cola.job (
    id, name, data, priority, start_after, created_on, expire_seconds, deletion_seconds, keep_until,
    retry_limit, retry_delay, retry_backoff, retry_delay_max, policy, dead_letter, heartbeat_seconds,
    blocked, blocking, pending_dependencies
  ) VALUES (
    gen_random_uuid(), p_nombre, v_datos, 0, v_ahora, v_ahora, v_cola.expire_seconds,
    v_cola.deletion_seconds, v_ahora + v_cola.retention_seconds * interval '1 second',
    v_cola.retry_limit, v_cola.retry_delay, v_cola.retry_backoff, v_cola.retry_delay_max,
    v_cola.policy, v_cola.dead_letter, v_cola.heartbeat_seconds, false, false, 0
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
COMMENT ON FUNCTION app.encolar(text, jsonb) IS
  'Encola un trabajo de una cola permitida con la clínica del contexto en datos.clinicaId y las opciones de cola.queue. Devuelve el id (NULL si la política de la cola lo descartó).';

GRANT EXECUTE ON FUNCTION app.encolar(text, jsonb) TO app_api;

-- app_api ya no toca la cola directamente.
REVOKE SELECT (id) ON cola.job_common FROM app_api;
REVOKE ALL ON cola.job_common FROM app_api;
REVOKE ALL ON cola.queue FROM app_api;
REVOKE ALL ON cola.version FROM app_api;
REVOKE ALL ON FUNCTION cola.job_now() FROM app_api;
REVOKE ALL ON SCHEMA cola FROM app_api;

CALL app.asegurar_permisos();
