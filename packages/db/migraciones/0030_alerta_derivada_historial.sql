-- 0030_alerta_derivada_historial: «con alerta» cuenta las alertas de la anamnesis, e historial del
-- paciente.
--
--   * app.resumen_pacientes (sigue siendo el ÚNICO lugar de con_alerta): con_alerta = alguna alerta
--     manual activa O alguna alerta médica derivada vigente (anamnesis_alerta.vigente, 0029). Lo
--     usan sin cambios app.listar_pacientes (filtro con_alerta), app.buscar_pacientes,
--     app.pacientes_con_ci y obtenerPaciente. Las filas vigentes de anamnesis_alerta las ve toda la
--     clínica (0029), así que el filtro da lo mismo para recepción que para un odontólogo.
--   * app.historial_paciente(paciente, cursor = NULL, limite = 30): línea de tiempo del paciente
--     (eventoHistorialSchema), del más nuevo al más viejo, armada desde audit_log y las tablas:
--       alta (paciente, crear), datos_editados (paciente, editar: dice qué campos, sin valores),
--       baja (paciente, anular, con el motivo), reactivacion (paciente, editar con activo de false a
--       true), vinculo_agregado / vinculo_quitado (paciente_relacion del lado de este paciente,
--       crear / anular; referencia = id del familiar), alerta_creada / alerta_desactivada
--       (paciente_alerta, crear / anular; referencia = id de la alerta) y anamnesis (anamnesis,
--       crear; referencia = número de versión).
--     autor = nombre congelado en audit_log (NULL = el sistema). Descripción lista para mostrar.
--     Sin ficha_clinica:ver no aparece ningún evento clínico (anamnesis ni alertas): la función no
--     los pide, y aunque los pidiera no existirían para esa persona (audit_log_modulo de 0023 oculta
--     las filas de ficha_clinica; anamnesis tiene RLS con ver; las alertas inactivas también).
--     SECURITY INVOKER: corre con RLS.
--     Cursor estable = posición (fecha, id de la fila de auditoría) de la última fila vista,
--     opaca (base64url de «h1:<microsegundos desde 1970>:<id>»): la página siguiente empieza justo
--     después, sin repetidos ni saltos aunque lleguen eventos nuevos. Cursor inválido:
--     cursor_invalido (22023); límite fuera de 1..1000: historial_limite (22023).
--   * Índice paciente_relacion (clinica_id, paciente_id) para el historial (también vínculos dados
--     de baja).

-- ---------------------------------------------------------------------------------------------
-- app.resumen_pacientes: con_alerta suma las alertas derivadas
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.resumen_pacientes(p_ahora timestamptz DEFAULT pg_catalog.now())
  RETURNS TABLE (
    id uuid, clinica_id uuid, nombres text, apellidos text, ci text, sexo text, telefono text,
    fecha_nac date, edad integer, pediatrico boolean, con_alerta boolean, activo boolean,
    orden_apellidos text, orden_nombres text, created_at timestamptz
  )
  LANGUAGE sql
  STABLE
BEGIN ATOMIC
  SELECT p.id, p.clinica_id, p.nombres, p.apellidos, p.ci, p.sexo, p.telefono, p.fecha_nac,
         app.edad_en(p.fecha_nac, k.hoy),
         COALESCE(app.edad_en(p.fecha_nac, k.hoy) < k.edad_pediatrica, false),
         -- Alertas: las manuales activas y las médicas derivadas de la anamnesis vigente (0029).
         (EXISTS (SELECT 1 FROM app.paciente_alerta a
                  WHERE a.clinica_id = p.clinica_id AND a.paciente_id = p.id AND a.activa)
          OR EXISTS (SELECT 1 FROM app.anamnesis_alerta d
                     WHERE d.clinica_id = p.clinica_id AND d.paciente_id = p.id AND d.vigente)),
         p.activo, p.orden_apellidos, p.orden_nombres, p.created_at
  FROM app.paciente p
  JOIN (SELECT c.id, app.hoy_clinica(COALESCE(p_ahora, pg_catalog.now())) AS hoy, c.edad_pediatrica
        FROM app.clinica c
        WHERE c.id = app.clinica_actual()
        OFFSET 0) k ON k.id = p.clinica_id;
END;
COMMENT ON FUNCTION app.resumen_pacientes(timestamptz) IS
  'Resumen de los pacientes de la clínica del contexto (pacienteResumenSchema + clinica_id, claves de orden y created_at). Único lugar de edad, pediátrico y con_alerta (manuales activas o derivadas vigentes, desde 0030).';

-- ---------------------------------------------------------------------------------------------
-- Historial
-- ---------------------------------------------------------------------------------------------
CREATE INDEX paciente_relacion_paciente_idx ON app.paciente_relacion (clinica_id, paciente_id);

CREATE OR REPLACE FUNCTION app.historial_paciente(
  p_paciente_id uuid,
  p_cursor text DEFAULT NULL,
  p_limite integer DEFAULT 30
) RETURNS TABLE (
  tipo text, fecha timestamptz, descripcion text, autor text, referencia text, cursor text
)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_clinico boolean := COALESCE(app.tiene_permiso('ficha_clinica', 'ver'), false);
  v_desde_fecha timestamptz;
  v_desde_id uuid;
  v_partes text[];
BEGIN
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'El límite va de 1 a 1000.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'historial_limite';
  END IF;
  IF p_cursor IS NOT NULL THEN
    BEGIN
      IF pg_catalog.length(p_cursor) NOT BETWEEN 8 AND 400 OR p_cursor !~ '^[A-Za-z0-9_-]+$' THEN
        RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_partes := pg_catalog.string_to_array(pg_catalog.convert_from(pg_catalog.decode(
        pg_catalog.translate(p_cursor, '-_', '+/')
          || pg_catalog.repeat('=', (4 - pg_catalog.length(p_cursor) % 4) % 4),
        'base64'), 'UTF8'), ':');
      IF pg_catalog.cardinality(v_partes) <> 3 OR v_partes[1] <> 'h1'
         OR v_partes[2] !~ '^-?[0-9]{1,18}$' THEN
        RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_desde_fecha := 'epoch'::timestamptz + (v_partes[2] || ' microseconds')::interval;
      v_desde_id := v_partes[3]::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'El cursor no es válido: pedí el historial desde el principio.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cursor_invalido';
    END;
  END IF;

  RETURN QUERY
    WITH crudos AS (
      -- Datos del paciente: alta, edición, baja y reactivación.
      SELECT a.id, a.fecha, a.usuario_nombre,
             CASE
               WHEN a.accion = 'crear' THEN 'alta'
               WHEN a.accion = 'anular' THEN 'baja'
               WHEN (a.antes ->> 'activo') = 'false' AND (a.despues ->> 'activo') = 'true' THEN 'reactivacion'
               ELSE 'datos_editados'
             END AS tipo_evento,
             a.antes, a.despues,
             NULL::text AS nombre, NULL::text AS texto, NULL::integer AS numero,
             NULL::boolean AS marca, NULL::text AS ref
      FROM app.audit_log a
      WHERE a.clinica_id = v_clinica AND a.entidad = 'paciente' AND a.entidad_id = p_paciente_id
        AND a.accion IN ('crear', 'editar', 'anular')
      UNION ALL
      -- Grupo familiar, del lado de este paciente.
      SELECT a.id, a.fecha, a.usuario_nombre,
             CASE a.accion WHEN 'crear' THEN 'vinculo_agregado' ELSE 'vinculo_quitado' END,
             a.antes, a.despues,
             f.nombres || COALESCE(' ' || f.apellidos, ''),
             COALESCE(a.despues ->> 'tipo', a.antes ->> 'tipo'),
             NULL::integer, NULL::boolean, r.familiar_id::text
      FROM app.paciente_relacion r
      JOIN app.audit_log a
        ON a.clinica_id = r.clinica_id AND a.entidad = 'paciente_relacion' AND a.entidad_id = r.id
      JOIN app.paciente f ON f.clinica_id = r.clinica_id AND f.id = r.familiar_id
      WHERE r.clinica_id = v_clinica AND r.paciente_id = p_paciente_id
        AND a.accion IN ('crear', 'anular')
      UNION ALL
      -- Alertas manuales (clínico).
      SELECT a.id, a.fecha, a.usuario_nombre,
             CASE a.accion WHEN 'crear' THEN 'alerta_creada' ELSE 'alerta_desactivada' END,
             a.antes, a.despues, NULL::text, pa.texto, NULL::integer, NULL::boolean, pa.id::text
      FROM app.paciente_alerta pa
      JOIN app.audit_log a
        ON a.clinica_id = pa.clinica_id AND a.entidad = 'paciente_alerta' AND a.entidad_id = pa.id
      WHERE v_clinico AND pa.clinica_id = v_clinica AND pa.paciente_id = p_paciente_id
        AND a.accion IN ('crear', 'anular')
      UNION ALL
      -- Versiones de la anamnesis (clínico).
      SELECT a.id, a.fecha, a.usuario_nombre, 'anamnesis', a.antes, a.despues,
             an.firmante_nombre,
             (SELECT pg_catalog.count(*)::text FROM app.anamnesis_alerta d
              WHERE d.clinica_id = an.clinica_id AND d.anamnesis_id = an.id),
             an.version, an.es_tutor, an.version::text
      FROM app.anamnesis an
      JOIN app.audit_log a
        ON a.clinica_id = an.clinica_id AND a.entidad = 'anamnesis' AND a.entidad_id = an.id
      WHERE v_clinico AND an.clinica_id = v_clinica AND an.paciente_id = p_paciente_id
        AND a.accion = 'crear'
    )
    SELECT c.tipo_evento,
           c.fecha,
           CASE c.tipo_evento
             WHEN 'alta' THEN
               'Alta del paciente' || CASE WHEN c.despues ->> 'origen' = 'online'
                                           THEN ' (reserva online).' ELSE '.' END
             WHEN 'datos_editados' THEN
               COALESCE('Se editaron los datos: ' || (
                 SELECT CASE
                          WHEN pg_catalog.count(*) = 0 THEN NULL
                          WHEN pg_catalog.count(*) = 1 THEN pg_catalog.min(x.etiqueta)
                          ELSE pg_catalog.array_to_string(
                                 (pg_catalog.array_agg(x.etiqueta ORDER BY x.n))[1:pg_catalog.count(*)::integer - 1], ', ')
                               || ' y ' || (pg_catalog.array_agg(x.etiqueta ORDER BY x.n DESC))[1]
                        END
                 FROM (VALUES (1, 'nombres', 'nombre'), (2, 'apellidos', 'apellido'), (3, 'ci', 'CI'),
                              (4, 'ruc', 'RUC'), (5, 'fecha_nac', 'fecha de nacimiento'),
                              (6, 'sexo', 'sexo'), (7, 'telefono', 'teléfono'), (8, 'email', 'correo'),
                              (9, 'ciudad', 'ciudad'), (10, 'direccion', 'dirección'),
                              (11, 'idioma', 'idioma'),
                              (12, 'acepta_whatsapp', 'recordatorios por WhatsApp')) AS x(n, columna, etiqueta)
                 WHERE (c.antes -> x.columna) IS DISTINCT FROM (c.despues -> x.columna)) || '.',
                 'Se editaron los datos.')
             WHEN 'baja' THEN
               'Se dio de baja' || COALESCE(': ' || NULLIF(pg_catalog.regexp_replace(
                 COALESCE(c.despues ->> 'motivo_baja', ''), '[.\s]+$', ''), ''), '') || '.'
             WHEN 'reactivacion' THEN 'Se reactivó la ficha del paciente.'
             WHEN 'vinculo_agregado' THEN
               'Se agregó a ' || c.nombre || ' al grupo familiar ('
                 || CASE c.texto WHEN 'otro' THEN 'otro vínculo' ELSE c.texto END || ').'
             WHEN 'vinculo_quitado' THEN
               'Se quitó a ' || c.nombre || ' del grupo familiar'
                 || COALESCE(': ' || NULLIF(pg_catalog.regexp_replace(
                      COALESCE(c.despues ->> 'motivo_baja', ''), '[.\s]+$', ''), ''), '') || '.'
             WHEN 'alerta_creada' THEN 'Se cargó la alerta «' || c.texto || '».'
             WHEN 'alerta_desactivada' THEN 'Se desactivó la alerta «' || c.texto || '».'
             WHEN 'anamnesis' THEN
               'Se registró la anamnesis (versión ' || c.numero || '). Firmó ' || c.nombre
                 || CASE WHEN c.marca THEN ' en nombre del paciente.' ELSE '.' END
                 || CASE c.texto WHEN '0' THEN '' WHEN '1' THEN ' Deja 1 alerta médica.'
                                 ELSE ' Deja ' || c.texto || ' alertas médicas.' END
           END,
           c.usuario_nombre,
           c.ref,
           pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(pg_catalog.convert_to(
             'h1:' || (EXTRACT(epoch FROM c.fecha) * 1000000)::bigint::text || ':' || c.id::text,
             'UTF8'), 'base64'), E'+/\n', '-_'), '=')
    FROM crudos c
    WHERE v_desde_id IS NULL OR (c.fecha, c.id) < (v_desde_fecha, v_desde_id)
    ORDER BY c.fecha DESC, c.id DESC
    LIMIT p_limite;
END
$$;
COMMENT ON FUNCTION app.historial_paciente(uuid, text, integer) IS
  'Línea de tiempo del paciente (alta, datos, baja, reactivación, vínculos y, con ficha_clinica:ver, alertas manuales y versiones de la anamnesis), del más nuevo al más viejo, con cursor opaco = columna cursor de la última fila.';

GRANT EXECUTE ON FUNCTION app.historial_paciente(uuid, text, integer) TO app_api;

CALL app.asegurar_permisos();
