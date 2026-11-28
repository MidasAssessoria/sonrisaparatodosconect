-- 0028_anamnesis_catalogo: catálogo de preguntas de la anamnesis por clínica (módulo configuracion)
-- con sus reglas de alerta, y archivos de firma del paciente.
--
-- Contrato: packages/shared/src/contrato/anamnesis.ts (preguntaSchema, reglaAlertaSchema).
--
--   * archivo, categoría firma_paciente (CATEGORIAS_ARCHIVO del contrato): el trazo de la firma de
--     un paciente o de su tutor. Su módulo generado es ficha_clinica (quien no ve la ficha no ve
--     sus eventos de auditoría). Columna nueva archivo.paciente_id (FK compuesta a paciente,
--     archivo_paciente_fkey, 23503): obligatoria para firma_paciente (archivo_paciente_check,
--     23514) y fija (no cambia: fijar_auditoria_fila). Así la base puede exigir que la firma de una
--     anamnesis sea de ESE paciente (0029).
--   * anamnesis_pregunta: una fila por pregunta y clínica, con los campos de preguntaSchema.
--     codigo estable y único por clínica (anamnesis_pregunta_codigo_key, 23505); no cambia. Nada se
--     borra: una pregunta que sale del cuestionario queda activa = false (en auditoría, «anular»).
--     Decisión: opciones y reglas de alerta como jsonb con la forma del contrato (camelCase:
--     {valor, etiqueta, alerta} y {tipo, texto, gravedad, grupoAlergia}), validadas con CHECK por
--     funciones IMMUTABLE (app.regla_alerta_valida, app.opciones_pregunta_validas), y no como
--     tablas hijas. Motivos: el contrato las trata como parte de la pregunta (se reemplaza el
--     catálogo entero, nunca una opción suelta); la versión de la anamnesis copia lo que necesita
--     al guardarse (textos, etiquetas y las alertas ya calculadas, 0029), así que nada apunta a una
--     opción por id; y una tabla hija pediría su propia baja lógica, su auditoría y su RLS para un
--     dato que nunca se consulta solo. Los CHECK exigen la forma completa (todas las claves, sin
--     extras): opciones hasta 30, valor ^[a-z0-9_]{1,40}$ único en la pregunta, etiqueta 1..80;
--     regla con tipo alergia/condicion (TIPOS_ALERTA), texto 3..120, gravedad alta/media,
--     grupoAlergia ^[a-z_]{3,40}$ o null. Coherencia por tipo (anamnesis_pregunta_tipo_campos):
--     opciones solo y siempre (al menos una) en multiple, alertaSiSi solo en si_no, detalle solo en
--     si_no y multiple, unidad/mínimo/máximo solo en numero, mínimo <= máximo.
--   * app.reemplazar_preguntas_anamnesis(preguntas jsonb): PUT /anamnesis/preguntas. Recibe el
--     arreglo de preguntaSchema (1 a 500; los valores por defecto del contrato se completan acá),
--     crea o actualiza por codigo y deja inactivas las que faltan (se reactivan mandándolas de
--     nuevo). Devuelve cuántas quedaron activas. SECURITY DEFINER: app_api solo LEE la tabla, así
--     el catálogo cambia únicamente por acá. Exige configuracion:editar del actor
--     (configuracion_sin_permiso, 42501). Errores con el código de la pregunta en el campo COLUMN
--     del error («preguntas.<codigo>»): anamnesis_pregunta_repetida (22023), anamnesis_pregunta_invalida
--     (22023, no es un objeto o le falta el código) y cualquier CHECK de la tabla con su nombre
--     (23514/22P02…); sin pregunta o con más de 500: anamnesis_catalogo_invalido (22023, COLUMN
--     «preguntas»); si entre activas e inactivas la clínica pasaría de 500 preguntas (las
--     inactivas nunca se borran): anamnesis_catalogo_lleno (22023, COLUMN «preguntas»).
--     Dos reemplazos a la vez del mismo catálogo se esperan, y un guardado de anamnesis espera a un
--     reemplazo en curso (y al revés): bloqueo consultivo por clínica, exclusivo para reemplazar y
--     compartido para guardar (app.guardar_anamnesis, 0029).
--   * app.huella_catalogo(): huella del cuestionario ACTIVO de la clínica del contexto (SHA-256 en
--     hex del jsonb de las preguntas activas, ordenadas por código, con todo lo que la persona ve o
--     lo que cambia la validación y las alertas: sección, orden, texto, tipo, opciones con sus
--     alertas, alerta de «sí», detalle, unidad, rango, sexo y obligatoriedad). Cambia con cualquier
--     edición de esos datos o con activar/desactivar una pregunta; no cambia si un reemplazo no
--     cambia nada. La devuelve catalogoPreguntas y la exige app.guardar_anamnesis (la versión
--     firmada tiene que ser la del cuestionario que vio el paciente).
--   * app.proteger_anamnesis() (BEFORE INSERT OR UPDATE): defensa en la base, también dentro de
--     las funciones SECURITY DEFINER (mira la SESIÓN, como app.proteger_pacientes):
--     anamnesis_pregunta exige configuracion:editar; las tablas de 0029 (anamnesis,
--     anamnesis_respuesta, anamnesis_alerta, anamnesis_vigente), ficha_clinica:crear y ver.
--   * Semilla: app.sembrar_preguntas_anamnesis(clinica) carga el cuestionario de la maqueta
--     (referencia/maqueta/codigo/gestion/anam.js, ANQ y ALERTA): 5 secciones, 19 preguntas, con
--     las reglas de alerta: alergias (penicilina, anestésicos locales, látex, material dental,
--     otro medicamento, cada una con su grupoAlergia), anticoagulantes, diabetes, cardiopatía,
--     alteración de la coagulación y embarazo/lactancia (solo si el sexo no es M). Los signos
--     vitales (presión, pulso, peso) NO son preguntas: son columnas numéricas de la anamnesis
--     (0029). Los textos son los del cuestionario del cliente. No pisa nada: ON CONFLICT DO NOTHING.
--     La corre app.alta_clinica para cada clínica nueva y esta migración para las existentes.
--     No es ejecutable por app_api.

-- ---------------------------------------------------------------------------------------------
-- archivo: firma_paciente y paciente_id
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.archivo DROP CONSTRAINT archivo_categoria_check;
ALTER TABLE app.archivo ADD CONSTRAINT archivo_categoria_check
  CHECK (categoria IN ('firma_profesional', 'logo_clinica', 'firma_paciente'));
ALTER TABLE app.archivo ALTER COLUMN modulo SET EXPRESSION AS (
  CASE categoria
    WHEN 'firma_profesional' THEN 'personal'
    WHEN 'logo_clinica' THEN 'configuracion'
    WHEN 'firma_paciente' THEN 'ficha_clinica'
  END);

ALTER TABLE app.archivo ADD COLUMN paciente_id uuid;
ALTER TABLE app.archivo ADD CONSTRAINT archivo_paciente_fkey
  FOREIGN KEY (clinica_id, paciente_id) REFERENCES app.paciente (clinica_id, id);
ALTER TABLE app.archivo ADD CONSTRAINT archivo_paciente_check
  CHECK (categoria <> 'firma_paciente' OR paciente_id IS NOT NULL);
COMMENT ON COLUMN app.archivo.paciente_id IS
  'Paciente al que pertenece el archivo (obligatorio para firma_paciente). No cambia.';
CREATE INDEX archivo_paciente_idx ON app.archivo (clinica_id, paciente_id) WHERE paciente_id IS NOT NULL;

DROP TRIGGER archivo_auditoria_fila ON app.archivo;
CREATE TRIGGER archivo_auditoria_fila BEFORE INSERT OR UPDATE ON app.archivo
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'categoria', 'sede_id', 'almacen', 'bucket', 'ruta', 'nombre_original', 'tipo', 'bytes',
    'ancho', 'alto', 'sha256', 'subido_por', 'paciente_id');

-- ---------------------------------------------------------------------------------------------
-- Validación de reglas de alerta y opciones (IMMUTABLE, cuerpo SQL estándar)
-- ---------------------------------------------------------------------------------------------
-- CASE antes de jsonb_object_keys: sobre algo que no es un objeto, esa función falla.
CREATE OR REPLACE FUNCTION app.regla_alerta_valida(p_regla jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE WHEN pg_catalog.jsonb_typeof(p_regla) = 'object' THEN COALESCE(
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_regla) k) = 4
    AND p_regla ?& ARRAY['tipo', 'texto', 'gravedad', 'grupoAlergia']
    AND pg_catalog.jsonb_typeof(p_regla -> 'tipo') = 'string'
    AND (p_regla ->> 'tipo') IN ('alergia', 'condicion')
    AND pg_catalog.jsonb_typeof(p_regla -> 'texto') = 'string'
    AND pg_catalog.char_length(p_regla ->> 'texto') BETWEEN 3 AND 120
    AND (p_regla ->> 'texto') = pg_catalog.btrim(p_regla ->> 'texto')
    AND pg_catalog.jsonb_typeof(p_regla -> 'gravedad') = 'string'
    AND (p_regla ->> 'gravedad') IN ('alta', 'media')
    AND (pg_catalog.jsonb_typeof(p_regla -> 'grupoAlergia') = 'null'
         OR (pg_catalog.jsonb_typeof(p_regla -> 'grupoAlergia') = 'string'
             AND (p_regla ->> 'grupoAlergia') ~ '^[a-z_]{3,40}$')),
    false) ELSE false END;
COMMENT ON FUNCTION app.regla_alerta_valida(jsonb) IS
  'true si es una regla de alerta completa (reglaAlertaSchema): {tipo alergia|condicion, texto 3..120, gravedad alta|media, grupoAlergia ^[a-z_]{3,40}$ o null}, sin claves de más.';

CREATE OR REPLACE FUNCTION app.opcion_pregunta_valida(p_opcion jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE WHEN pg_catalog.jsonb_typeof(p_opcion) = 'object' THEN COALESCE(
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_opcion) k) = 3
    AND p_opcion ?& ARRAY['valor', 'etiqueta', 'alerta']
    AND pg_catalog.jsonb_typeof(p_opcion -> 'valor') = 'string'
    AND (p_opcion ->> 'valor') ~ '^[a-z0-9_]{1,40}$'
    AND pg_catalog.jsonb_typeof(p_opcion -> 'etiqueta') = 'string'
    AND pg_catalog.char_length(p_opcion ->> 'etiqueta') BETWEEN 1 AND 80
    AND (p_opcion ->> 'etiqueta') = pg_catalog.btrim(p_opcion ->> 'etiqueta')
    AND (pg_catalog.jsonb_typeof(p_opcion -> 'alerta') = 'null'
         OR app.regla_alerta_valida(p_opcion -> 'alerta')),
    false) ELSE false END;
COMMENT ON FUNCTION app.opcion_pregunta_valida(jsonb) IS
  'true si es una opción completa (opcionPreguntaSchema): {valor ^[a-z0-9_]{1,40}$, etiqueta 1..80, alerta regla o null}.';

CREATE OR REPLACE FUNCTION app.opciones_pregunta_validas(p_opciones jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE WHEN pg_catalog.jsonb_typeof(p_opciones) = 'array' THEN COALESCE(
    pg_catalog.jsonb_array_length(p_opciones) <= 30
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_opciones) o
                    WHERE NOT app.opcion_pregunta_valida(o))
    AND (SELECT pg_catalog.count(DISTINCT o ->> 'valor') FROM pg_catalog.jsonb_array_elements(p_opciones) o)
        = pg_catalog.jsonb_array_length(p_opciones),
    false) ELSE false END;
COMMENT ON FUNCTION app.opciones_pregunta_validas(jsonb) IS
  'true si es un arreglo de hasta 30 opciones válidas con valores distintos.';

-- Completa los valores por defecto del contrato (gravedad alta, grupoAlergia null) y recorta el
-- texto. Lo que no tiene la forma esperada se devuelve tal cual: lo rechaza el CHECK.
CREATE OR REPLACE FUNCTION app.normalizar_regla_alerta(p_regla jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE
    WHEN p_regla IS NULL OR pg_catalog.jsonb_typeof(p_regla) = 'null' THEN NULL
    WHEN pg_catalog.jsonb_typeof(p_regla) <> 'object' THEN p_regla
    ELSE p_regla
      || pg_catalog.jsonb_build_object(
           'gravedad', COALESCE(NULLIF(p_regla -> 'gravedad', 'null'::jsonb), '"alta"'::jsonb),
           'grupoAlergia', COALESCE(p_regla -> 'grupoAlergia', 'null'::jsonb))
      || CASE WHEN pg_catalog.jsonb_typeof(p_regla -> 'texto') = 'string'
              THEN pg_catalog.jsonb_build_object('texto', pg_catalog.btrim(p_regla ->> 'texto'))
              ELSE '{}'::jsonb END
  END;
COMMENT ON FUNCTION app.normalizar_regla_alerta(jsonb) IS
  'Regla de alerta con los valores por defecto del contrato (gravedad alta, grupoAlergia null) y el texto recortado.';

CREATE OR REPLACE FUNCTION app.normalizar_opciones_pregunta(p_opciones jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE
    WHEN p_opciones IS NULL OR pg_catalog.jsonb_typeof(p_opciones) = 'null' THEN '[]'::jsonb
    WHEN pg_catalog.jsonb_typeof(p_opciones) <> 'array' THEN p_opciones
    ELSE COALESCE((
      SELECT pg_catalog.jsonb_agg(
               CASE WHEN pg_catalog.jsonb_typeof(o) = 'object' THEN
                 o || pg_catalog.jsonb_build_object(
                        'alerta', COALESCE(app.normalizar_regla_alerta(o -> 'alerta'), 'null'::jsonb))
                   || CASE WHEN pg_catalog.jsonb_typeof(o -> 'etiqueta') = 'string'
                           THEN pg_catalog.jsonb_build_object('etiqueta', pg_catalog.btrim(o ->> 'etiqueta'))
                           ELSE '{}'::jsonb END
               ELSE o END
               ORDER BY n)
      FROM pg_catalog.jsonb_array_elements(p_opciones) WITH ORDINALITY AS t(o, n)), '[]'::jsonb)
  END;
COMMENT ON FUNCTION app.normalizar_opciones_pregunta(jsonb) IS
  'Opciones con alerta null por defecto, etiquetas recortadas y cada regla normalizada.';

-- ---------------------------------------------------------------------------------------------
-- anamnesis_pregunta
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.anamnesis_pregunta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  codigo text NOT NULL CONSTRAINT anamnesis_pregunta_codigo_check CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  seccion smallint NOT NULL CONSTRAINT anamnesis_pregunta_seccion_check CHECK (seccion BETWEEN 1 AND 5),
  orden smallint NOT NULL CONSTRAINT anamnesis_pregunta_orden_check CHECK (orden BETWEEN 0 AND 999),
  texto text NOT NULL CONSTRAINT anamnesis_pregunta_texto_check
    CHECK (char_length(texto) BETWEEN 3 AND 200 AND texto = btrim(texto)),
  tipo text NOT NULL CONSTRAINT anamnesis_pregunta_tipo_check
    CHECK (tipo IN ('si_no', 'multiple', 'texto', 'numero')),
  opciones jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT anamnesis_pregunta_opciones_check
    CHECK (app.opciones_pregunta_validas(opciones)),
  alerta_si jsonb CONSTRAINT anamnesis_pregunta_alerta_si_check
    CHECK (alerta_si IS NULL OR app.regla_alerta_valida(alerta_si)),
  con_detalle boolean NOT NULL DEFAULT false,
  unidad text CONSTRAINT anamnesis_pregunta_unidad_check
    CHECK (char_length(unidad) BETWEEN 1 AND 20 AND unidad = btrim(unidad)),
  minimo numeric,
  maximo numeric,
  solo_sexo text CONSTRAINT anamnesis_pregunta_solo_sexo_check CHECK (solo_sexo = 'F'),
  obligatoria boolean NOT NULL DEFAULT false,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT anamnesis_pregunta_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT anamnesis_pregunta_codigo_key UNIQUE (clinica_id, codigo),
  CONSTRAINT anamnesis_pregunta_tipo_campos CHECK (
    (tipo = 'multiple') = (CASE WHEN pg_catalog.jsonb_typeof(opciones) = 'array'
                                THEN pg_catalog.jsonb_array_length(opciones) > 0 ELSE false END)
    AND (tipo = 'si_no' OR alerta_si IS NULL)
    AND (tipo IN ('si_no', 'multiple') OR NOT con_detalle)
    AND (tipo = 'numero' OR (unidad IS NULL AND minimo IS NULL AND maximo IS NULL))
    AND (minimo IS NULL OR maximo IS NULL OR minimo <= maximo))
);
COMMENT ON TABLE app.anamnesis_pregunta IS
  'Cuestionario de la anamnesis de la clínica (configuracion). Las reglas de alerta van en la pregunta (alerta_si) o en cada opción (opciones[].alerta). No se borra: activa = false.';
COMMENT ON COLUMN app.anamnesis_pregunta.codigo IS 'Estable: identifica la pregunta en las respuestas. No cambia.';
COMMENT ON COLUMN app.anamnesis_pregunta.opciones IS
  'Solo multiple: [{valor, etiqueta, alerta}] con la forma de opcionPreguntaSchema (alerta = regla o null).';
COMMENT ON COLUMN app.anamnesis_pregunta.alerta_si IS
  'Solo si_no: alerta que genera responder «sí» ({tipo, texto, gravedad, grupoAlergia}) o NULL.';
COMMENT ON COLUMN app.anamnesis_pregunta.solo_sexo IS
  '''F'': la pregunta solo aplica si el sexo del paciente no es M.';

CREATE INDEX anamnesis_pregunta_orden_idx
  ON app.anamnesis_pregunta (clinica_id, seccion, orden, codigo) WHERE activa;

-- ---------------------------------------------------------------------------------------------
-- Defensa de permisos de las tablas de anamnesis (también dentro de SECURITY DEFINER)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_anamnesis() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_dueno_tablas oid;
  v_permisos text[];
  v_permiso text;
BEGIN
  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

  -- Excepción explícita: una SESIÓN del dueño de las tablas (migraciones, semilla, fábricas). Una
  -- función SECURITY DEFINER llamada por app_api corre como el dueño, pero su sesión es de app_api.
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'anamnesis_pregunta' THEN
    v_permisos := ARRAY['configuracion:editar'];
  ELSIF TG_TABLE_NAME IN ('anamnesis', 'anamnesis_respuesta', 'anamnesis_alerta', 'anamnesis_vigente') THEN
    v_permisos := ARRAY['ficha_clinica:crear', 'ficha_clinica:ver'];
  ELSE
    RAISE EXCEPTION 'app.proteger_anamnesis() no está pensada para %.%.', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  FOREACH v_permiso IN ARRAY v_permisos LOOP
    IF NOT app.tiene_permiso(pg_catalog.split_part(v_permiso, ':', 1),
                             pg_catalog.split_part(v_permiso, ':', 2)) THEN
      RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para este cambio (%).', v_permiso
        USING ERRCODE = 'insufficient_privilege',
              CONSTRAINT = CASE WHEN v_permiso LIKE 'ficha_clinica:%' THEN 'ficha_clinica_sin_permiso'
                                ELSE 'configuracion_sin_permiso' END;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_anamnesis() IS
  'Defensa de anamnesis_pregunta (configuracion:editar) y de anamnesis, anamnesis_respuesta y anamnesis_alerta (ficha_clinica:crear y ver). Exceptúa solo a una sesión del dueño de las tablas.';

CREATE TRIGGER anamnesis_pregunta_auditoria_fila BEFORE INSERT OR UPDATE ON app.anamnesis_pregunta
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('codigo');
CREATE TRIGGER anamnesis_pregunta_proteger BEFORE INSERT OR UPDATE ON app.anamnesis_pregunta
  FOR EACH ROW EXECUTE FUNCTION app.proteger_anamnesis();
CREATE TRIGGER anamnesis_pregunta_auditar AFTER INSERT OR UPDATE OR DELETE ON app.anamnesis_pregunta
  FOR EACH ROW EXECUTE FUNCTION app.auditar('configuracion');
CREATE TRIGGER anamnesis_pregunta_sin_borrado BEFORE DELETE OR TRUNCATE ON app.anamnesis_pregunta
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

ALTER TABLE app.anamnesis_pregunta ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_pregunta FORCE ROW LEVEL SECURITY;
CREATE POLICY anamnesis_pregunta_aislamiento ON app.anamnesis_pregunta
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT ON app.anamnesis_pregunta TO app_api;

-- ---------------------------------------------------------------------------------------------
-- app.reemplazar_preguntas_anamnesis
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.reemplazar_preguntas_anamnesis(p_preguntas jsonb) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_p jsonb;
  v_codigo text;
  v_codigos text[] := '{}'::text[];
  v_restriccion text;
  v_estado text;
  v_activas integer;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de cambiar el cuestionario.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (app.sesion_del_dueno() OR app.tiene_permiso('configuracion', 'editar')) THEN
    RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para este cambio (configuracion:editar).'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'configuracion_sin_permiso';
  END IF;
  IF p_preguntas IS NULL OR pg_catalog.jsonb_typeof(p_preguntas) <> 'array'
     OR pg_catalog.jsonb_array_length(p_preguntas) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'El cuestionario va con 1 a 500 preguntas.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_catalogo_invalido',
            COLUMN = 'preguntas';
  END IF;

  -- Dos reemplazos del mismo catálogo a la vez: el segundo espera al primero.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('conecta:anamnesis_pregunta:' || v_clinica::text, 0));

  FOR v_p IN SELECT e FROM pg_catalog.jsonb_array_elements(p_preguntas) e LOOP
    IF pg_catalog.jsonb_typeof(v_p) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_p -> 'codigo') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Cada pregunta va con su código.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_pregunta_invalida',
              COLUMN = 'preguntas';
    END IF;
    v_codigo := v_p ->> 'codigo';
    IF v_codigo = ANY (v_codigos) THEN
      RAISE EXCEPTION 'La pregunta % está dos veces en el cuestionario.', v_codigo
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_pregunta_repetida',
              COLUMN = 'preguntas.' || v_codigo;
    END IF;
    v_codigos := v_codigos || v_codigo;
    BEGIN
      INSERT INTO app.anamnesis_pregunta AS q
        (clinica_id, codigo, seccion, orden, texto, tipo, opciones, alerta_si, con_detalle, unidad,
         minimo, maximo, solo_sexo, obligatoria, activa)
      VALUES (
        v_clinica, v_codigo,
        (v_p ->> 'seccion')::smallint,
        (v_p ->> 'orden')::smallint,
        pg_catalog.btrim(v_p ->> 'texto'),
        v_p ->> 'tipo',
        app.normalizar_opciones_pregunta(v_p -> 'opciones'),
        app.normalizar_regla_alerta(v_p -> 'alertaSiSi'),
        COALESCE((v_p ->> 'conDetalle')::boolean, false),
        NULLIF(pg_catalog.btrim(v_p ->> 'unidad'), ''),
        (v_p ->> 'minimo')::numeric,
        (v_p ->> 'maximo')::numeric,
        v_p ->> 'soloSexo',
        COALESCE((v_p ->> 'obligatoria')::boolean, false),
        COALESCE((v_p ->> 'activa')::boolean, true))
      ON CONFLICT (clinica_id, codigo) DO UPDATE SET
        seccion = EXCLUDED.seccion, orden = EXCLUDED.orden, texto = EXCLUDED.texto,
        tipo = EXCLUDED.tipo, opciones = EXCLUDED.opciones, alerta_si = EXCLUDED.alerta_si,
        con_detalle = EXCLUDED.con_detalle, unidad = EXCLUDED.unidad, minimo = EXCLUDED.minimo,
        maximo = EXCLUDED.maximo, solo_sexo = EXCLUDED.solo_sexo,
        obligatoria = EXCLUDED.obligatoria, activa = EXCLUDED.activa
      WHERE (q.seccion, q.orden, q.texto, q.tipo, q.opciones, q.alerta_si, q.con_detalle, q.unidad,
             q.minimo, q.maximo, q.solo_sexo, q.obligatoria, q.activa)
            IS DISTINCT FROM
            (EXCLUDED.seccion, EXCLUDED.orden, EXCLUDED.texto, EXCLUDED.tipo, EXCLUDED.opciones,
             EXCLUDED.alerta_si, EXCLUDED.con_detalle, EXCLUDED.unidad, EXCLUDED.minimo,
             EXCLUDED.maximo, EXCLUDED.solo_sexo, EXCLUDED.obligatoria, EXCLUDED.activa);
    EXCEPTION
      WHEN check_violation OR not_null_violation OR invalid_text_representation
           OR numeric_value_out_of_range OR datatype_mismatch OR string_data_right_truncation THEN
        GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME, v_estado = RETURNED_SQLSTATE;
        RAISE EXCEPTION 'La pregunta % no es válida: revisá sus datos.', v_codigo
          USING ERRCODE = v_estado,
                CONSTRAINT = COALESCE(NULLIF(v_restriccion, ''), 'anamnesis_pregunta_invalida'),
                COLUMN = 'preguntas.' || v_codigo;
    END;
  END LOOP;

  UPDATE app.anamnesis_pregunta q SET activa = false
  WHERE q.clinica_id = v_clinica AND q.activa AND NOT (q.codigo = ANY (v_codigos));

  -- Activas e inactivas: las inactivas no se borran nunca.
  IF (SELECT pg_catalog.count(*) FROM app.anamnesis_pregunta q WHERE q.clinica_id = v_clinica) > 500 THEN
    RAISE EXCEPTION 'El cuestionario no puede pasar de 500 preguntas entre activas e inactivas: reutilizá los códigos de las que ya no usás.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_catalogo_lleno',
            COLUMN = 'preguntas';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_activas
  FROM app.anamnesis_pregunta q WHERE q.clinica_id = v_clinica AND q.activa;
  RETURN v_activas;
END
$$;
COMMENT ON FUNCTION app.reemplazar_preguntas_anamnesis(jsonb) IS
  'Reemplaza el cuestionario de la clínica del contexto (arreglo de preguntaSchema): crea o actualiza por código y deja inactivas las que faltan. Devuelve cuántas quedan activas. Exige configuracion:editar.';

GRANT EXECUTE ON FUNCTION app.reemplazar_preguntas_anamnesis(jsonb) TO app_api;

-- ---------------------------------------------------------------------------------------------
-- app.huella_catalogo
-- ---------------------------------------------------------------------------------------------
-- STABLE: dentro de una sentencia usa la misma instantánea que la consulta que la llama (así
-- catalogoPreguntas devuelve las preguntas y su huella coherentes). Orden con COLLATE "C": la
-- huella no depende de la intercalación de la base.
CREATE OR REPLACE FUNCTION app.huella_catalogo() RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
              q.codigo, q.seccion, q.orden, q.texto, q.tipo, q.opciones, q.alerta_si, q.con_detalle,
              q.unidad, q.minimo, q.maximo, q.solo_sexo, q.obligatoria)
            ORDER BY q.codigo COLLATE "C")
     FROM app.anamnesis_pregunta q
     WHERE q.clinica_id = app.clinica_actual() AND q.activa),
    '[]'::jsonb)::text, 'UTF8')), 'hex')
$$;
COMMENT ON FUNCTION app.huella_catalogo() IS
  'Huella (SHA-256 hex) del cuestionario activo de la clínica del contexto. Cambia con cualquier edición o activación que cambie lo que se pregunta o cómo se valida.';

GRANT EXECUTE ON FUNCTION app.huella_catalogo() TO app_api;

-- ---------------------------------------------------------------------------------------------
-- Semilla: el cuestionario de la maqueta
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.sembrar_preguntas_anamnesis(p_clinica_id uuid) RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_contexto text := pg_catalog.current_setting('app.clinica_id', true);
  v_filas integer;
BEGIN
  IF p_clinica_id IS NULL THEN
    RAISE EXCEPTION 'Falta la clínica.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_catalog.set_config('app.clinica_id', p_clinica_id::text, true);
  INSERT INTO app.anamnesis_pregunta
    (clinica_id, codigo, seccion, orden, texto, tipo, opciones, alerta_si, con_detalle, solo_sexo)
  SELECT p_clinica_id, s.codigo, s.seccion, s.orden, s.texto, s.tipo, s.opciones::jsonb,
         s.alerta_si::jsonb, s.con_detalle, s.solo_sexo
  FROM (VALUES
    -- 1. Motivo de consulta y síntomas
    ('motivo', 1, 10, '¿Cuál es el motivo principal de su visita hoy?', 'texto', '[]', NULL::text, false, NULL::text),
    ('sintoma', 1, 20, '¿Qué molestia, dolor o cambio nota y desde cuándo comenzó?', 'texto', '[]', NULL, false, NULL),
    ('desencadenantes', 1, 30, '¿Qué empeora o alivia la molestia (frío, calor, dulce, masticar)?', 'multiple',
     '[{"valor":"frio","etiqueta":"Frío","alerta":null},{"valor":"calor","etiqueta":"Calor","alerta":null},{"valor":"dulce","etiqueta":"Dulce","alerta":null},{"valor":"masticar","etiqueta":"Masticar","alerta":null}]',
     NULL, true, NULL),
    ('encias', 1, 40, '¿Ha notado sangrado de encías, inflamación, movilidad dental o mal aliento?', 'multiple',
     '[{"valor":"sangrado_encias","etiqueta":"Sangrado de encías","alerta":null},{"valor":"inflamacion","etiqueta":"Inflamación","alerta":null},{"valor":"movilidad_dental","etiqueta":"Movilidad dental","alerta":null},{"valor":"mal_aliento","etiqueta":"Mal aliento","alerta":null}]',
     NULL, true, NULL),
    -- 2. Antecedentes odontológicos
    ('ultima_consulta', 2, 10, '¿Cuándo fue su última consulta o limpieza dental?', 'texto', '[]', NULL, false, NULL),
    ('tratamientos_previos', 2, 20, '¿Ha tenido tratamientos previos (caries, endodoncias, extracciones, coronas, implantes u ortodoncia)?', 'multiple',
     '[{"valor":"caries","etiqueta":"Caries","alerta":null},{"valor":"endodoncias","etiqueta":"Endodoncias","alerta":null},{"valor":"extracciones","etiqueta":"Extracciones","alerta":null},{"valor":"coronas","etiqueta":"Coronas","alerta":null},{"valor":"implantes","etiqueta":"Implantes","alerta":null},{"valor":"ortodoncia","etiqueta":"Ortodoncia","alerta":null}]',
     NULL, true, NULL),
    ('protesis', 2, 30, '¿Usa prótesis removibles o retenedores?', 'si_no', '[]', NULL, true, NULL),
    ('experiencia_previa', 2, 40, '¿Ha tenido alguna experiencia desagradable, dolorosa o ansiedad al acudir al dentista?', 'si_no', '[]', NULL, true, NULL),
    ('atm', 2, 50, '¿Nota chasquidos, dolor o tensión en la mandíbula o al abrir la boca?', 'si_no', '[]', NULL, true, NULL),
    -- 3. Hábitos
    ('cepillado', 3, 10, '¿Con qué frecuencia cepilla sus dientes y qué tipo de cepillo o pasta utiliza?', 'texto', '[]', NULL, false, NULL),
    ('higiene_auxiliar', 3, 20, '¿Usa hilo dental, cepillos interdentales o enjuague bucal?', 'multiple',
     '[{"valor":"hilo_dental","etiqueta":"Hilo dental","alerta":null},{"valor":"cepillos_interdentales","etiqueta":"Cepillos interdentales","alerta":null},{"valor":"enjuague_bucal","etiqueta":"Enjuague bucal","alerta":null}]',
     NULL, true, NULL),
    ('parafunciones', 3, 30, '¿Aprieta o rechina los dientes (bruxismo), se muerde las uñas o respira por la boca?', 'multiple',
     '[{"valor":"bruxismo","etiqueta":"Bruxismo","alerta":null},{"valor":"muerde_unas","etiqueta":"Se muerde las uñas","alerta":null},{"valor":"respira_boca","etiqueta":"Respira por la boca","alerta":null}]',
     NULL, true, NULL),
    ('sustancias', 3, 40, '¿Consume tabaco, alcohol u otras sustancias?', 'multiple',
     '[{"valor":"tabaco","etiqueta":"Tabaco","alerta":null},{"valor":"alcohol","etiqueta":"Alcohol","alerta":null},{"valor":"otras_sustancias","etiqueta":"Otras sustancias","alerta":null}]',
     NULL, true, NULL),
    -- 4. Antecedentes médicos
    ('enfermedades', 4, 10, '¿Padece alguna enfermedad sistémica (diabetes, hipertensión, problemas cardíacos, asma, alteraciones de coagulación o tiroides)?', 'multiple',
     '[{"valor":"diabetes","etiqueta":"Diabetes","alerta":{"tipo":"condicion","texto":"Diabetes","gravedad":"media","grupoAlergia":null}},{"valor":"hipertension","etiqueta":"Hipertensión","alerta":null},{"valor":"problemas_cardiacos","etiqueta":"Problemas cardíacos","alerta":{"tipo":"condicion","texto":"Cardiopatía","gravedad":"alta","grupoAlergia":null}},{"valor":"asma","etiqueta":"Asma","alerta":null},{"valor":"alteraciones_coagulacion","etiqueta":"Alteraciones de coagulación","alerta":{"tipo":"condicion","texto":"Alteración de la coagulación","gravedad":"alta","grupoAlergia":null}},{"valor":"tiroides","etiqueta":"Problemas de tiroides","alerta":null}]',
     NULL, true, NULL),
    ('medicacion', 4, 20, '¿Toma actualmente algún medicamento (en especial anticoagulantes, bifosfonatos, antiinflamatorios o antidiabéticos)?', 'multiple',
     '[{"valor":"anticoagulantes","etiqueta":"Anticoagulantes","alerta":{"tipo":"condicion","texto":"Anticoagulantes","gravedad":"alta","grupoAlergia":null}},{"valor":"bifosfonatos","etiqueta":"Bifosfonatos","alerta":null},{"valor":"antiinflamatorios","etiqueta":"Antiinflamatorios","alerta":null},{"valor":"antidiabeticos","etiqueta":"Antidiabéticos","alerta":null},{"valor":"otros_medicamentos","etiqueta":"Otros medicamentos","alerta":null}]',
     NULL, true, NULL),
    ('alergias', 4, 30, '¿Es alérgico a algún medicamento (como penicilina o anestésicos locales), látex o material dental?', 'multiple',
     '[{"valor":"penicilina","etiqueta":"Penicilina","alerta":{"tipo":"alergia","texto":"Alergia a la penicilina","gravedad":"alta","grupoAlergia":"penicilina"}},{"valor":"anestesicos_locales","etiqueta":"Anestésicos locales","alerta":{"tipo":"alergia","texto":"Alergia a anestésicos locales","gravedad":"alta","grupoAlergia":"anestesicos_locales"}},{"valor":"latex","etiqueta":"Látex","alerta":{"tipo":"alergia","texto":"Alergia al látex","gravedad":"alta","grupoAlergia":"latex"}},{"valor":"material_dental","etiqueta":"Material dental","alerta":{"tipo":"alergia","texto":"Alergia a material dental","gravedad":"alta","grupoAlergia":"material_dental"}},{"valor":"otro_medicamento","etiqueta":"Otro medicamento","alerta":{"tipo":"alergia","texto":"Alergia a medicamentos","gravedad":"alta","grupoAlergia":"otro_medicamento"}}]',
     NULL, true, NULL),
    ('cirugias', 4, 40, '¿Ha tenido cirugías o internaciones recientes?', 'si_no', '[]', NULL, true, NULL),
    ('embarazo', 4, 50, '¿Está embarazada o en período de lactancia?', 'si_no', '[]',
     '{"tipo":"condicion","texto":"Embarazo / lactancia","gravedad":"alta","grupoAlergia":null}', true, 'F'),
    -- 5. Datos complementarios (los signos vitales son columnas de la anamnesis, no preguntas)
    ('otras_condiciones', 5, 10, '¿Tiene o tuvo alguna de estas condiciones?', 'multiple',
     '[{"valor":"hepatitis","etiqueta":"Hepatitis","alerta":null},{"valor":"vih","etiqueta":"VIH","alerta":null},{"valor":"epilepsia","etiqueta":"Epilepsia","alerta":null},{"valor":"enfermedad_renal","etiqueta":"Enfermedad renal","alerta":null},{"valor":"cancer_radioterapia","etiqueta":"Cáncer / radioterapia","alerta":null}]',
     NULL, true, NULL)
  ) AS s(codigo, seccion, orden, texto, tipo, opciones, alerta_si, con_detalle, solo_sexo)
  ON CONFLICT (clinica_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  PERFORM pg_catalog.set_config('app.clinica_id', COALESCE(v_contexto, ''), true);
  RETURN v_filas;
END
$$;
COMMENT ON FUNCTION app.sembrar_preguntas_anamnesis(uuid) IS
  'Carga en la clínica el cuestionario de la maqueta (5 secciones, 19 preguntas, reglas de alerta). No pisa preguntas existentes. Devuelve cuántas agregó. No ejecutable por app_api.';

-- ---------------------------------------------------------------------------------------------
-- alta_clinica: igual que en 0015, más el cuestionario de la anamnesis
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.alta_clinica(
  p_nombre text,
  p_dueno_id uuid,
  p_dueno_nombre text,
  p_dueno_email text,
  p_razon_social text DEFAULT NULL,
  p_ruc text DEFAULT NULL,
  p_clinica_id uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := COALESCE(p_clinica_id, gen_random_uuid());
  v_contexto_clinica text := current_setting('app.clinica_id', true);
  v_contexto_usuario text := current_setting('app.usuario_id', true);
  v_rol_dueno uuid;
BEGIN
  IF p_nombre IS NULL OR btrim(p_nombre) = '' THEN
    RAISE EXCEPTION 'Falta el nombre de la clínica.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_dueno_id IS NULL THEN
    RAISE EXCEPTION 'Falta el id de Auth del dueño.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 1. Identidad del dueño (se reutiliza si ya existe: una persona puede tener varias clínicas).
  PERFORM set_config('app.clinica_id', v_clinica::text, true);
  PERFORM set_config('app.usuario_id', p_dueno_id::text, true);
  IF NOT EXISTS (SELECT 1 FROM app.usuario WHERE id = p_dueno_id) THEN
    IF p_dueno_nombre IS NULL OR btrim(p_dueno_nombre) = ''
       OR p_dueno_email IS NULL OR btrim(p_dueno_email) = '' THEN
      RAISE EXCEPTION 'Faltan el nombre y el correo del dueño.' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    INSERT INTO app.usuario (id, nombre, email) VALUES (p_dueno_id, p_dueno_nombre, p_dueno_email);
  END IF;

  -- 2. El resto, como alta del sistema (sin usuario en el contexto).
  PERFORM set_config('app.usuario_id', '', true);

  INSERT INTO app.clinica (id, nombre, razon_social, ruc)
  VALUES (v_clinica, p_nombre, p_razon_social, p_ruc);

  INSERT INTO app.rol (clinica_id, nombre, codigo, es_sistema, todas_las_sedes, exige_mfa, inactividad_min)
  VALUES
    (v_clinica, 'Dueño/a', 'dueno', true, true, true, 30),
    (v_clinica, 'Administración', 'administracion', true, true, true, 30),
    (v_clinica, 'Odontólogo/a', 'odontologo', true, false, false, 30),
    (v_clinica, 'Asistente dental', 'asistente', true, false, false, 30),
    (v_clinica, 'Recepción y caja', 'recepcion', true, false, false, 15);

  SELECT id INTO STRICT v_rol_dueno FROM app.rol WHERE clinica_id = v_clinica AND codigo = 'dueno';

  -- dueno: todos los módulos y todas las acciones.
  INSERT INTO app.rol_permiso (clinica_id, rol_id, modulo, accion)
  SELECT v_clinica, v_rol_dueno, m.modulo, a.accion
  FROM unnest(ARRAY[
         'inicio', 'agenda', 'pacientes', 'ficha_clinica', 'presupuestos', 'caja', 'contabilidad',
         'reportes', 'personal', 'inventario', 'mensajeria', 'sedes', 'auditoria', 'configuracion'
       ]) AS m(modulo)
  CROSS JOIN unnest(ARRAY['ver', 'crear', 'editar', 'anular', 'exportar']) AS a(accion);

  INSERT INTO app.rol_permiso (clinica_id, rol_id, modulo, accion)
  SELECT v_clinica, r.id, p.modulo, a.accion
  FROM (VALUES
    ('administracion', 'inicio',        ARRAY['ver']),
    ('administracion', 'agenda',        ARRAY['ver']),
    ('administracion', 'pacientes',     ARRAY['ver']),
    ('administracion', 'presupuestos',  ARRAY['ver']),
    ('administracion', 'caja',          ARRAY['ver', 'anular', 'exportar']),
    ('administracion', 'contabilidad',  ARRAY['ver', 'crear', 'editar', 'anular', 'exportar']),
    ('administracion', 'reportes',      ARRAY['ver', 'exportar']),
    ('administracion', 'personal',      ARRAY['ver', 'crear', 'editar', 'anular']),
    ('administracion', 'inventario',    ARRAY['ver', 'exportar']),
    ('administracion', 'mensajeria',    ARRAY['ver', 'editar']),
    ('administracion', 'sedes',         ARRAY['ver', 'crear', 'editar', 'anular']),
    ('administracion', 'auditoria',     ARRAY['ver']),
    ('administracion', 'configuracion', ARRAY['ver', 'crear', 'editar']),

    ('odontologo', 'inicio',        ARRAY['ver']),
    ('odontologo', 'agenda',        ARRAY['ver', 'crear', 'editar']),
    ('odontologo', 'pacientes',     ARRAY['ver', 'crear', 'editar']),
    ('odontologo', 'ficha_clinica', ARRAY['ver', 'crear', 'editar', 'anular']),
    ('odontologo', 'presupuestos',  ARRAY['ver', 'crear', 'editar', 'anular']),
    ('odontologo', 'reportes',      ARRAY['ver']),

    ('asistente', 'inicio',        ARRAY['ver']),
    ('asistente', 'agenda',        ARRAY['ver', 'crear', 'editar']),
    ('asistente', 'pacientes',     ARRAY['ver']),
    ('asistente', 'ficha_clinica', ARRAY['ver']),
    ('asistente', 'inventario',    ARRAY['ver', 'crear', 'editar']),

    ('recepcion', 'inicio',       ARRAY['ver']),
    ('recepcion', 'agenda',       ARRAY['ver', 'crear', 'editar', 'anular']),
    ('recepcion', 'pacientes',    ARRAY['ver', 'crear', 'editar']),
    ('recepcion', 'presupuestos', ARRAY['ver']),
    ('recepcion', 'caja',         ARRAY['ver', 'crear', 'editar']),
    ('recepcion', 'mensajeria',   ARRAY['ver', 'crear'])
  ) AS p(codigo, modulo, acciones)
  CROSS JOIN LATERAL unnest(p.acciones) AS a(accion)
  JOIN app.rol r ON r.clinica_id = v_clinica AND r.codigo = p.codigo;

  -- 3. Membresía activa del dueño.
  INSERT INTO app.membresia (clinica_id, usuario_id, rol_id, estado)
  VALUES (v_clinica, p_dueno_id, v_rol_dueno, 'activo');

  -- 4. Cuestionario de la anamnesis (0028).
  PERFORM app.sembrar_preguntas_anamnesis(v_clinica);

  -- 5. Devolver el contexto de quien llamó.
  PERFORM set_config('app.clinica_id', COALESCE(v_contexto_clinica, ''), true);
  PERFORM set_config('app.usuario_id', COALESCE(v_contexto_usuario, ''), true);
  RETURN v_clinica;
END
$$;
COMMENT ON FUNCTION app.alta_clinica(text, uuid, text, text, text, text, uuid) IS
  'Crea una clínica con sus 5 roles de sistema (con todas_las_sedes, exige_mfa e inactividad_min), la matriz inicial de permisos (Administración con configuracion:crear desde 0015), la membresía activa del dueño y, desde 0028, el cuestionario de la anamnesis. No ejecutable por app_api.';

-- ---------------------------------------------------------------------------------------------
-- Cuestionario para las clínicas que ya existen
-- ---------------------------------------------------------------------------------------------
-- Sin clínica en el contexto, clinica no muestra nada (RLS forzado también para su dueño): por un
-- momento, dentro de esta transacción y con bloqueo exclusivo, se quita el FORCE (como en 0016).
-- Cada pregunta queda auditada en su clínica como alta del sistema (usuario NULL).
ALTER TABLE app.clinica NO FORCE ROW LEVEL SECURITY;
DO $$
DECLARE
  v_clinica uuid;
BEGIN
  PERFORM pg_catalog.set_config('app.usuario_id', '', true);
  FOR v_clinica IN SELECT c.id FROM app.clinica c ORDER BY c.id LOOP
    PERFORM app.sembrar_preguntas_anamnesis(v_clinica);
  END LOOP;
  PERFORM pg_catalog.set_config('app.clinica_id', '', true);
END
$$;
ALTER TABLE app.clinica FORCE ROW LEVEL SECURITY;

CALL app.asegurar_permisos();
