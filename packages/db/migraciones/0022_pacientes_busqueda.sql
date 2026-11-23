-- 0022_pacientes_busqueda: buscador, lista paginada y CI repetida (SECURITY INVOKER, con RLS).
--
--   * app.terminos_busqueda(texto): términos de una búsqueda. Normaliza como app.normalizar_busqueda;
--     si el texto no tiene letras es UN número (se quitan puntos, espacios, guiones, «+», paréntesis:
--     «4.123.456» -> 4123456, «+595 981 123-456» -> 595981123456); si tiene letras, cada palabra es
--     un término y las que no tienen letras quedan solo con sus dígitos. Un paciente coincide si su
--     texto de búsqueda contiene TODOS los términos (en cualquier orden, en cualquier parte).
--   * app.buscar_pacientes(texto, limite = 6, incluir_inactivos = false, ahora = now()): buscador de
--     la barra superior. Activos primero (los inactivos solo si se piden) y, dentro, por relevancia:
--     0 = el número es exactamente la CI o el teléfono (en cualquiera de sus formas); 1 = todos los
--     términos empiezan una palabra (nombre, apellido, CI o teléfono); 2 = el resto. Después,
--     apellidos, nombres, id. Sin términos, nada.
--   * app.listar_pacientes(texto, filtro, cursor, limite, ahora): lista ordenada por apellidos,
--     nombres e id (claves de orden de 0019), con cursor estable = id del último paciente de la
--     página anterior (la página siguiente empieza estrictamente después de su posición: sin
--     repetidos ni saltos aunque se agreguen pacientes en el medio). Filtros (FILTROS_PACIENTES):
--     todos, pediatricos (menores de clinica.edad_pediatrica años a la fecha de la clínica) y
--     con_alerta (alguna alerta manual activa), los tres sobre activos; inactivos. Con texto, además
--     tiene que coincidir con la búsqueda.
--   * app.pacientes_con_ci(ci, excluir): pacientes (activos o no) con esa CI, normalizada como la
--     guarda la base. Para el aviso de CI repetida (409 de la API).
--   Las tres devuelven las columnas de pacienteResumenSchema: id, nombres, apellidos, ci, sexo, telefono,
--   fecha_nac, edad (años cumplidos a la fecha de la clínica), pediatrico, con_alerta, activo.
--   «ahora» solo cambia la fecha con la que se calculan edad y pediátrico (para probar bordes).
--
-- Rendimiento: la búsqueda se resuelve con el índice GIN trigram de paciente_busqueda gracias al
-- patrón en su política (ver 0019): se fija app.busqueda_patron con el término más largo y se vacía
-- al terminar. Los demás términos se filtran sobre esas filas.
-- Errores: pacientes_limite (22023), pacientes_filtro (22023), cursor_invalido (22023).

CREATE OR REPLACE FUNCTION app.terminos_busqueda(p_texto text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN (
    WITH n AS (SELECT COALESCE(app.normalizar_busqueda(p_texto), '') AS t)
    SELECT CASE
      WHEN n.t !~ '[a-zñ]' THEN
        CASE WHEN pg_catalog.regexp_replace(n.t, '\D', '', 'g') = '' THEN '{}'::text[]
             ELSE ARRAY[pg_catalog.regexp_replace(n.t, '\D', '', 'g')] END
      ELSE ARRAY(
        SELECT CASE WHEN s.x ~ '[a-zñ]' THEN s.x ELSE pg_catalog.regexp_replace(s.x, '\D', '', 'g') END
        FROM pg_catalog.regexp_split_to_table(n.t, ' ') WITH ORDINALITY AS s(x, i)
        WHERE s.x ~ '[a-zñ0-9]'
        ORDER BY s.i)
    END
    FROM n);
COMMENT ON FUNCTION app.terminos_busqueda(text) IS
  'Términos de búsqueda normalizados: un número (sin puntos ni separadores) o las palabras del texto.';

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
  v_hoy date := app.hoy_clinica(COALESCE(p_ahora, pg_catalog.now()));
  v_edad_pediatrica integer;
BEGIN
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'El límite va de 1 a 1000.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'pacientes_limite';
  END IF;
  IF pg_catalog.cardinality(v_terminos) = 0 THEN
    RETURN;
  END IF;
  SELECT c.edad_pediatrica INTO v_edad_pediatrica FROM app.clinica c WHERE c.id = app.clinica_actual();
  v_patrones := ARRAY(SELECT '%' || app.escapar_like(t) || '%' FROM pg_catalog.unnest(v_terminos) t);
  v_iniciales := ARRAY(SELECT '% ' || app.escapar_like(t) || '%' FROM pg_catalog.unnest(v_terminos) t);
  v_principal := (SELECT t FROM pg_catalog.unnest(v_terminos) t
                  ORDER BY pg_catalog.length(t) DESC LIMIT 1);
  IF pg_catalog.cardinality(v_terminos) = 1 AND v_terminos[1] ~ '^[0-9]+$' THEN
    v_numero := v_terminos[1];
  END IF;

  PERFORM pg_catalog.set_config('app.busqueda_patron', '%' || app.escapar_like(v_principal) || '%', true);
  -- Los candidatos se ordenan y se cortan en paciente_busqueda (tiene activo y las claves de orden);
  -- recién después se lee paciente, solo para los que se devuelven.
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
    SELECT p.id, p.nombres, p.apellidos, p.ci, p.sexo, p.telefono, p.fecha_nac,
           CASE WHEN p.fecha_nac IS NOT NULL
                THEN pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac))::integer END,
           COALESCE(pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac)) < v_edad_pediatrica, false),
           EXISTS (SELECT 1 FROM app.paciente_alerta a
                   WHERE a.clinica_id = p.clinica_id AND a.paciente_id = p.id AND a.activa),
           p.activo
    FROM candidatos k
    JOIN app.paciente p ON p.clinica_id = app.clinica_actual() AND p.id = k.id
    ORDER BY k.activo DESC, k.relevancia, k.orden_apellidos, k.orden_nombres, k.id;
  PERFORM pg_catalog.set_config('app.busqueda_patron', '', true);
END
$$;
COMMENT ON FUNCTION app.buscar_pacientes(text, integer, boolean, timestamptz) IS
  'Buscador de pacientes por nombre, CI o teléfono (sin tildes, puntos ni formato), por relevancia. Usa el GIN trigram de paciente_busqueda.';

-- ---------------------------------------------------------------------------------------------
-- app.listar_pacientes
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.listar_pacientes(
  p_texto text DEFAULT NULL,
  p_filtro text DEFAULT 'todos',
  p_cursor text DEFAULT NULL,
  p_limite integer DEFAULT 50,
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
  v_principal text;
  v_filtro text := COALESCE(p_filtro, 'todos');
  v_activo boolean;
  v_hoy date := app.hoy_clinica(COALESCE(p_ahora, pg_catalog.now()));
  v_edad_pediatrica integer;
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
  SELECT c.edad_pediatrica INTO v_edad_pediatrica FROM app.clinica c WHERE c.id = app.clinica_actual();

  IF p_cursor IS NOT NULL THEN
    IF p_cursor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'El cursor no es válido: pedí la lista desde el principio.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cursor_invalido';
    END IF;
    SELECT p.orden_apellidos, p.orden_nombres, p.id
      INTO v_desde_apellidos, v_desde_nombres, v_desde_id
    FROM app.paciente p WHERE p.id = p_cursor::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El cursor no corresponde a ningún paciente de esta clínica: pedí la lista desde el principio.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'cursor_invalido';
    END IF;
  END IF;

  IF pg_catalog.cardinality(v_terminos) > 0 THEN
    v_patrones := ARRAY(SELECT '%' || app.escapar_like(t) || '%' FROM pg_catalog.unnest(v_terminos) t);
    v_principal := (SELECT t FROM pg_catalog.unnest(v_terminos) t
                    ORDER BY pg_catalog.length(t) DESC LIMIT 1);
    PERFORM pg_catalog.set_config('app.busqueda_patron', '%' || app.escapar_like(v_principal) || '%', true);
  END IF;

  RETURN QUERY
    SELECT p.id, p.nombres, p.apellidos, p.ci, p.sexo, p.telefono, p.fecha_nac,
           CASE WHEN p.fecha_nac IS NOT NULL
                THEN pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac))::integer END,
           COALESCE(pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac)) < v_edad_pediatrica, false),
           EXISTS (SELECT 1 FROM app.paciente_alerta a
                   WHERE a.clinica_id = p.clinica_id AND a.paciente_id = p.id AND a.activa),
           p.activo
    FROM app.paciente p
    WHERE p.clinica_id = app.clinica_actual()
      AND p.activo = v_activo
      AND (v_patrones IS NULL OR EXISTS (
            SELECT 1 FROM app.paciente_busqueda b
            WHERE b.clinica_id = p.clinica_id AND b.id = p.id AND b.texto LIKE ALL (v_patrones)))
      AND (v_filtro <> 'pediatricos'
           OR pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac)) < v_edad_pediatrica)
      AND (v_filtro <> 'con_alerta' OR EXISTS (
            SELECT 1 FROM app.paciente_alerta a
            WHERE a.clinica_id = p.clinica_id AND a.paciente_id = p.id AND a.activa))
      AND (v_desde_id IS NULL
           OR (p.orden_apellidos, p.orden_nombres, p.id) > (v_desde_apellidos, v_desde_nombres, v_desde_id))
    ORDER BY p.orden_apellidos, p.orden_nombres, p.id
    LIMIT p_limite;
  PERFORM pg_catalog.set_config('app.busqueda_patron', '', true);
END
$$;
COMMENT ON FUNCTION app.listar_pacientes(text, text, text, integer, timestamptz) IS
  'Lista de pacientes por apellidos, nombres e id, con filtro (todos, pediatricos, con_alerta, inactivos), búsqueda opcional y cursor = id del último de la página anterior.';

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
  v_hoy date := app.hoy_clinica(COALESCE(p_ahora, pg_catalog.now()));
  v_edad_pediatrica integer;
BEGIN
  IF v_ci = '' THEN
    RETURN;
  END IF;
  SELECT c.edad_pediatrica INTO v_edad_pediatrica FROM app.clinica c WHERE c.id = app.clinica_actual();
  RETURN QUERY
    SELECT p.id, p.nombres, p.apellidos, p.ci, p.sexo, p.telefono, p.fecha_nac,
           CASE WHEN p.fecha_nac IS NOT NULL
                THEN pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac))::integer END,
           COALESCE(pg_catalog.date_part('year', pg_catalog.age(v_hoy, p.fecha_nac)) < v_edad_pediatrica, false),
           EXISTS (SELECT 1 FROM app.paciente_alerta a
                   WHERE a.clinica_id = p.clinica_id AND a.paciente_id = p.id AND a.activa),
           p.activo
    FROM app.paciente p
    WHERE p.clinica_id = app.clinica_actual() AND p.ci = v_ci
      AND (p_excluir_id IS NULL OR p.id <> p_excluir_id)
    ORDER BY p.activo DESC, p.created_at, p.id;
END
$$;
COMMENT ON FUNCTION app.pacientes_con_ci(text, uuid, timestamptz) IS
  'Pacientes de la clínica con esa CI (normalizada), activos primero. Para avisar una CI repetida.';

GRANT EXECUTE ON FUNCTION app.terminos_busqueda(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.buscar_pacientes(text, integer, boolean, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.listar_pacientes(text, text, text, integer, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.pacientes_con_ci(text, uuid, timestamptz) TO app_api;

CALL app.asegurar_permisos();
