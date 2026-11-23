-- 0025_pacientes_resumen_cursor: el resumen del paciente en un solo lugar y un cursor que no salta
-- pacientes cuando alguien se renombra entre páginas.
--
--   * app.edad_en(fecha_nac, hoy): años cumplidos a esa fecha (NULL sin fecha de nacimiento).
--   * app.resumen_pacientes(ahora = now()): «vista con parámetro» con las columnas de
--     pacienteResumenSchema (id, nombres, apellidos, ci, sexo, telefono, fecha_nac, edad,
--     pediatrico, con_alerta, activo) más clinica_id, orden_apellidos, orden_nombres y created_at,
--     de los pacientes de la clínica del contexto. Es el ÚNICO lugar donde se calculan edad,
--     pediátrico (menor de clinica.edad_pediatrica a la fecha de la clínica) y con_alerta (hoy:
--     alguna alerta manual activa; el Sprint 4 suma acá las alertas de la anamnesis). La usan
--     app.buscar_pacientes, app.listar_pacientes, app.pacientes_con_ci y, desde @conecta/db,
--     obtenerPaciente y los familiares de listarRelaciones. SQL estándar (BEGIN ATOMIC), STABLE y
--     SECURITY INVOKER: Postgres la expande dentro de la consulta que la usa (los filtros y el orden
--     llegan a los índices de paciente) y corre con RLS. La fecha de hoy se calcula una vez por
--     consulta (subconsulta con OFFSET 0).
--   * app.listar_pacientes: el cursor ya no es el id del último paciente (si ese paciente se
--     renombraba entre una página y la otra, la lista seguía desde su posición NUEVA y salteaba o
--     repetía pacientes). Ahora lleva la posición de la última fila tal como se vio:
--     (orden_apellidos, orden_nombres, id), codificada en base64url (app.cursor_paciente). Es opaco
--     para la API: se devuelve en la columna nueva «cursor» de cada fila y se pasa tal cual. Un
--     cursor que no se puede decodificar: cursor_invalido (22023). Como el cursor es una posición y
--     no un registro, ya no se rechaza el de otra clínica: solo ubica dentro de la clínica del
--     contexto (RLS). Largo: 1 byte de versión + 16 del id + las dos claves (+1), en base64: unos
--     60 caracteres para un nombre común; pasa de 200 (el máximo del contrato) solo si las dos
--     claves juntas superan ~130 bytes (nombres y apellidos admiten hasta 80 caracteres cada uno).
--   * app.buscar_pacientes y app.pacientes_con_ci: igual que en 0022, con el resumen de
--     app.resumen_pacientes.

CREATE OR REPLACE FUNCTION app.edad_en(p_fecha_nac date, p_hoy date) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN pg_catalog.date_part('year',
    pg_catalog.age(p_hoy::timestamp without time zone, p_fecha_nac::timestamp without time zone))::integer;
COMMENT ON FUNCTION app.edad_en(date, date) IS 'Años cumplidos a p_hoy (NULL sin fecha de nacimiento).';

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
         -- Alertas: hoy, las manuales activas. El Sprint 4 agrega acá las de la anamnesis.
         EXISTS (SELECT 1 FROM app.paciente_alerta a
                 WHERE a.clinica_id = p.clinica_id AND a.paciente_id = p.id AND a.activa),
         p.activo, p.orden_apellidos, p.orden_nombres, p.created_at
  FROM app.paciente p
  JOIN (SELECT c.id, app.hoy_clinica(COALESCE(p_ahora, pg_catalog.now())) AS hoy, c.edad_pediatrica
        FROM app.clinica c
        WHERE c.id = app.clinica_actual()
        OFFSET 0) k ON k.id = p.clinica_id;
END;
COMMENT ON FUNCTION app.resumen_pacientes(timestamptz) IS
  'Resumen de los pacientes de la clínica del contexto (pacienteResumenSchema + clinica_id, claves de orden y created_at). Único lugar de edad, pediátrico y con_alerta.';

-- Posición de una fila de la lista, opaca: base64url(versión 0x01 || id en 16 bytes ||
-- orden_apellidos 0x1F orden_nombres). Las claves de orden nunca tienen caracteres de control.
CREATE OR REPLACE FUNCTION app.cursor_paciente(p_orden_apellidos text, p_orden_nombres text, p_id uuid)
  RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  RETURN pg_catalog.translate(
    pg_catalog.rtrim(
      pg_catalog.translate(
        pg_catalog.encode(
          '\x01'::bytea
          || pg_catalog.decode(pg_catalog.replace(p_id::text, '-', ''), 'hex')
          || pg_catalog.convert_to(p_orden_apellidos || E'\x1f' || p_orden_nombres, 'UTF8'),
          'base64'),
        E'\n', ''),
      '='),
    '+/', '-_');
COMMENT ON FUNCTION app.cursor_paciente(text, text, uuid) IS
  'Cursor de app.listar_pacientes: la posición (orden_apellidos, orden_nombres, id) de una fila, en base64url.';

-- ---------------------------------------------------------------------------------------------
-- app.buscar_pacientes
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.buscar_pacientes(
  p_texto text,
  p_limite integer DEFAULT 6,
  p_incluir_inactivos boolean DEFAULT false,
  p_ahora timestamptz DEFAULT pg_catalog.now()
) RETURNS TABLE (
  id uuid, nombres text, apellidos text, ci text, sexo text, telefono text, fecha_nac date, edad integer,
  pediatrico boolean, con_alerta boolean, activo boolean
)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_terminos text[] := app.terminos_busqueda(p_texto);
  v_patrones text[];
  v_iniciales text[];
  v_principal text;
  v_numero text;
BEGIN
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'El límite va de 1 a 1000.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'pacientes_limite';
  END IF;
  IF pg_catalog.cardinality(v_terminos) = 0 THEN
    RETURN;
  END IF;
  v_patrones := ARRAY(SELECT '%' || app.escapar_like(t) || '%' FROM pg_catalog.unnest(v_terminos) t);
  v_iniciales := ARRAY(SELECT '% ' || app.escapar_like(t) || '%' FROM pg_catalog.unnest(v_terminos) t);
  v_principal := (SELECT t FROM pg_catalog.unnest(v_terminos) t
                  ORDER BY pg_catalog.length(t) DESC LIMIT 1);
  IF pg_catalog.cardinality(v_terminos) = 1 AND v_terminos[1] ~ '^[0-9]+$' THEN
    v_numero := v_terminos[1];
  END IF;

  PERFORM pg_catalog.set_config('app.busqueda_patron', '%' || app.escapar_like(v_principal) || '%', true);
  -- Los candidatos se ordenan y se cortan en paciente_busqueda (tiene activo y las claves de orden);
  -- recién después se arma el resumen, solo para los que se devuelven.
  RETURN QUERY
    WITH candidatos AS (
      SELECT b.id, b.activo, b.orden_apellidos, b.orden_nombres,
             CASE
               -- El número es una palabra entera del texto: la CI o una forma del teléfono.
               WHEN v_numero IS NOT NULL AND (' ' || b.texto || ' ') LIKE '% ' || v_numero || ' %' THEN 0
               WHEN (' ' || b.texto) LIKE ALL (v_iniciales) THEN 1
               ELSE 2
             END AS relevancia
      FROM app.paciente_busqueda b
      WHERE b.texto LIKE ALL (v_patrones)
        AND (p_incluir_inactivos OR b.activo)
      ORDER BY b.activo DESC, relevancia, b.orden_apellidos, b.orden_nombres, b.id
      LIMIT p_limite)
    SELECT r.id, r.nombres, r.apellidos, r.ci, r.sexo, r.telefono, r.fecha_nac, r.edad,
           r.pediatrico, r.con_alerta, r.activo
    FROM candidatos k
    JOIN app.resumen_pacientes(COALESCE(p_ahora, pg_catalog.now())) r ON r.id = k.id
    ORDER BY k.activo DESC, k.relevancia, k.orden_apellidos, k.orden_nombres, k.id;
  PERFORM pg_catalog.set_config('app.busqueda_patron', '', true);
END
$$;
COMMENT ON FUNCTION app.buscar_pacientes(text, integer, boolean, timestamptz) IS
  'Buscador de pacientes por nombre, CI o teléfono (sin tildes, puntuación ni formato), por relevancia. Usa el GIN trigram de paciente_busqueda y el resumen de app.resumen_pacientes.';

-- ---------------------------------------------------------------------------------------------
-- app.listar_pacientes (cambia el tipo de resultado: columna cursor)
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION app.listar_pacientes(text, text, text, integer, timestamptz);
CREATE FUNCTION app.listar_pacientes(
  p_texto text DEFAULT NULL,
  p_filtro text DEFAULT 'todos',
  p_cursor text DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_ahora timestamptz DEFAULT pg_catalog.now()
) RETURNS TABLE (
  id uuid, nombres text, apellidos text, ci text, sexo text, telefono text, fecha_nac date, edad integer,
  pediatrico boolean, con_alerta boolean, activo boolean, cursor text
)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_terminos text[] := app.terminos_busqueda(p_texto);
  v_patrones text[];
  v_principal text;
  v_filtro text := COALESCE(p_filtro, 'todos');
  v_activo boolean;
  v_bytes bytea;
  v_resto text[];
  v_desde_apellidos text COLLATE "C";
  v_desde_nombres text COLLATE "C";
  v_desde_id uuid;
BEGIN
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'El límite va de 1 a 1000.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'pacientes_limite';
  END IF;
  IF v_filtro NOT IN ('todos', 'pediatricos', 'con_alerta', 'inactivos') THEN
    RAISE EXCEPTION 'Filtro desconocido: %.', v_filtro
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'pacientes_filtro';
  END IF;
  v_activo := v_filtro <> 'inactivos';

  IF p_cursor IS NOT NULL THEN
    BEGIN
      IF pg_catalog.length(p_cursor) NOT BETWEEN 24 AND 2000 OR p_cursor !~ '^[A-Za-z0-9_-]+$' THEN
        RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_bytes := pg_catalog.decode(
        pg_catalog.translate(p_cursor, '-_', '+/')
          || pg_catalog.repeat('=', (4 - pg_catalog.length(p_cursor) % 4) % 4),
        'base64');
      IF pg_catalog.length(v_bytes) < 18 OR pg_catalog.get_byte(v_bytes, 0) <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_desde_id := pg_catalog.encode(pg_catalog.substring(v_bytes, 2, 16), 'hex')::uuid;
      v_resto := pg_catalog.string_to_array(
        pg_catalog.convert_from(pg_catalog.substring(v_bytes, 18), 'UTF8'), E'\x1f');
      IF pg_catalog.cardinality(v_resto) <> 2 THEN
        RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_desde_apellidos := v_resto[1];
      v_desde_nombres := v_resto[2];
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'El cursor no es válido: pedí la lista desde el principio.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cursor_invalido';
    END;
  END IF;

  IF pg_catalog.cardinality(v_terminos) > 0 THEN
    v_patrones := ARRAY(SELECT '%' || app.escapar_like(t) || '%' FROM pg_catalog.unnest(v_terminos) t);
    v_principal := (SELECT t FROM pg_catalog.unnest(v_terminos) t
                    ORDER BY pg_catalog.length(t) DESC LIMIT 1);
    PERFORM pg_catalog.set_config('app.busqueda_patron', '%' || app.escapar_like(v_principal) || '%', true);
  END IF;

  RETURN QUERY
    SELECT r.id, r.nombres, r.apellidos, r.ci, r.sexo, r.telefono, r.fecha_nac, r.edad,
           r.pediatrico, r.con_alerta, r.activo,
           app.cursor_paciente(r.orden_apellidos, r.orden_nombres, r.id)
    FROM app.resumen_pacientes(COALESCE(p_ahora, pg_catalog.now())) r
    WHERE r.activo = v_activo
      AND (v_patrones IS NULL OR EXISTS (
            SELECT 1 FROM app.paciente_busqueda b
            WHERE b.clinica_id = r.clinica_id AND b.id = r.id AND b.texto LIKE ALL (v_patrones)))
      AND (v_filtro <> 'pediatricos' OR r.pediatrico)
      AND (v_filtro <> 'con_alerta' OR r.con_alerta)
      AND (v_desde_id IS NULL
           OR (r.orden_apellidos COLLATE "C", r.orden_nombres COLLATE "C", r.id)
              > (v_desde_apellidos, v_desde_nombres, v_desde_id))
    ORDER BY r.orden_apellidos COLLATE "C", r.orden_nombres COLLATE "C", r.id
    LIMIT p_limite;
  PERFORM pg_catalog.set_config('app.busqueda_patron', '', true);
END
$$;
COMMENT ON FUNCTION app.listar_pacientes(text, text, text, integer, timestamptz) IS
  'Lista de pacientes por apellidos (o nombres, sin apellido), nombres e id, con filtro (todos, pediatricos, con_alerta, inactivos), búsqueda opcional y cursor opaco = columna cursor de la última fila de la página anterior.';

-- ---------------------------------------------------------------------------------------------
-- app.pacientes_con_ci
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.pacientes_con_ci(
  p_ci text,
  p_excluir_id uuid DEFAULT NULL,
  p_ahora timestamptz DEFAULT pg_catalog.now()
) RETURNS TABLE (
  id uuid, nombres text, apellidos text, ci text, sexo text, telefono text, fecha_nac date, edad integer,
  pediatrico boolean, con_alerta boolean, activo boolean
)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ci text := pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(COALESCE(p_ci, ''), '[[:space:].-]', '', 'g'), '^0+(?=[0-9])', '');
BEGIN
  IF v_ci = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.id, r.nombres, r.apellidos, r.ci, r.sexo, r.telefono, r.fecha_nac, r.edad,
           r.pediatrico, r.con_alerta, r.activo
    FROM app.resumen_pacientes(COALESCE(p_ahora, pg_catalog.now())) r
    WHERE r.ci = v_ci
      AND (p_excluir_id IS NULL OR r.id <> p_excluir_id)
    ORDER BY r.activo DESC, r.created_at, r.id;
END
$$;
COMMENT ON FUNCTION app.pacientes_con_ci(text, uuid, timestamptz) IS
  'Pacientes de la clínica con esa CI (normalizada), activos primero. Para avisar una CI repetida.';

GRANT EXECUTE ON FUNCTION app.edad_en(date, date) TO app_api;
GRANT EXECUTE ON FUNCTION app.resumen_pacientes(timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.cursor_paciente(text, text, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION app.listar_pacientes(text, text, text, integer, timestamptz) TO app_api;

CALL app.asegurar_permisos();
