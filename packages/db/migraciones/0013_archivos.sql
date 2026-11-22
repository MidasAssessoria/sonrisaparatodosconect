-- 0013_archivos: metadatos de archivos privados y módulo de auditoría por fila.
--
--   * archivo: un archivo guardado en un almacenamiento privado (local en desarrollo y pruebas,
--     supabase en los entornos reales). categoria con los valores de CATEGORIAS_ARCHIVO de
--     @conecta/shared; modulo es una columna GENERADA a partir de la categoría (el cliente no la
--     escribe), con el mismo mapa que el contrato (una meta-prueba lo compara). Los metadatos son
--     inmutables; solo se da de baja (deleted_at + motivo_baja).
--     ruta: única por (almacen, bucket); empieza con «<clinica_id>/» y no tiene segmentos «.» ni «..»
--     (una clínica no puede registrar un archivo que apunte a la carpeta de otra). subido_por lo fija
--     la base con el usuario del contexto.
--   * Módulo de auditoría por fila: app.auditar() sigue tomando el módulo del primer argumento del
--     trigger, salvo que la tabla tenga una columna «modulo» GENERADA (attgenerated = 's'): ahí usa
--     la de la fila. Solo una columna generada cuenta (la define la migración, no el cliente), y el
--     valor igual tiene que pasar audit_log_modulo_check. rol_permiso tiene una columna modulo
--     normal (el permiso, no el evento): no cambia nada para ella. app.registrar_evento() hace lo
--     mismo con el registro (entidad_id), y para esas tablas exige entidad_id (un evento sobre un
--     conjunto no tiene un módulo único). Además limpia los parámetros de búsqueda de 0010.

-- ---------------------------------------------------------------------------------------------
-- archivo
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.archivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  categoria text NOT NULL
    CONSTRAINT archivo_categoria_check CHECK (categoria IN ('firma_profesional', 'logo_clinica')),
  modulo text GENERATED ALWAYS AS (
    CASE categoria
      WHEN 'firma_profesional' THEN 'personal'
      WHEN 'logo_clinica' THEN 'configuracion'
    END
  ) STORED CONSTRAINT archivo_modulo_check CHECK (modulo IS NOT NULL),
  sede_id uuid,
  almacen text NOT NULL CONSTRAINT archivo_almacen_check CHECK (almacen IN ('local', 'supabase')),
  bucket text NOT NULL CONSTRAINT archivo_bucket_check CHECK (bucket ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
  ruta text NOT NULL,
  nombre_original text NOT NULL
    CONSTRAINT archivo_nombre_original_check CHECK (btrim(nombre_original) <> '' AND length(nombre_original) <= 255),
  tipo text NOT NULL CONSTRAINT archivo_tipo_check CHECK (tipo ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  bytes bigint NOT NULL CONSTRAINT archivo_bytes_check CHECK (bytes > 0),
  ancho integer CONSTRAINT archivo_ancho_check CHECK (ancho > 0),
  alto integer CONSTRAINT archivo_alto_check CHECK (alto > 0),
  sha256 text NOT NULL CONSTRAINT archivo_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  subido_por uuid REFERENCES app.usuario (id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app.usuario (id),
  motivo_baja text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT archivo_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT archivo_ruta_key UNIQUE (almacen, bucket, ruta),
  CONSTRAINT archivo_ruta_check CHECK (
    pg_catalog.starts_with(ruta, clinica_id::text || '/')
    AND ruta ~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]+$'
    AND length(ruta) <= 512
    AND ruta !~ '(^|/)\.{1,2}(/|$)'
    AND ruta !~ '//'),
  CONSTRAINT archivo_baja_check CHECK (deleted_at IS NULL OR btrim(coalesce(motivo_baja, '')) <> ''),
  CONSTRAINT archivo_sede_fkey FOREIGN KEY (clinica_id, sede_id) REFERENCES app.sede (clinica_id, id)
);
COMMENT ON TABLE app.archivo IS
  'Metadatos de un archivo privado (nunca con URL pública). Inmutable salvo la baja. El módulo (y el permiso para verlo) sale de la categoría.';
COMMENT ON COLUMN app.archivo.modulo IS
  'Generada desde categoria (CATEGORIAS_ARCHIVO de @conecta/shared). Módulo del permiso y de la auditoría de este archivo.';
COMMENT ON COLUMN app.archivo.ruta IS 'Ruta dentro del bucket. Empieza con <clinica_id>/.';
CREATE INDEX archivo_categoria_idx ON app.archivo (clinica_id, categoria, created_at DESC)
  WHERE deleted_at IS NULL;

-- subido_por = usuario del contexto, lo mande o no el cliente.
CREATE OR REPLACE FUNCTION app.fijar_subido_por() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.subido_por := app.usuario_actual();
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.fijar_subido_por() IS 'BEFORE INSERT: subido_por sale del contexto (app.usuario_id).';

CREATE TRIGGER archivo_subido_por BEFORE INSERT ON app.archivo
  FOR EACH ROW EXECUTE FUNCTION app.fijar_subido_por();
CREATE TRIGGER archivo_auditoria_fila BEFORE INSERT OR UPDATE ON app.archivo
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'categoria', 'sede_id', 'almacen', 'bucket', 'ruta', 'nombre_original', 'tipo', 'bytes',
    'ancho', 'alto', 'sha256', 'subido_por');
-- 'configuracion' es el módulo de la tabla para app.modulo_de_entidad(); cada evento usa el de su
-- fila (columna generada modulo).
CREATE TRIGGER archivo_auditar AFTER INSERT OR UPDATE OR DELETE ON app.archivo
  FOR EACH ROW EXECUTE FUNCTION app.auditar('configuracion');
CREATE TRIGGER archivo_sin_borrado BEFORE DELETE OR TRUNCATE ON app.archivo
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

ALTER TABLE app.archivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.archivo FORCE ROW LEVEL SECURITY;
CREATE POLICY archivo_aislamiento ON app.archivo
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT, INSERT, UPDATE ON app.archivo TO app_api;

-- ---------------------------------------------------------------------------------------------
-- ¿La tabla tiene una columna «modulo» generada? (para app.auditar y app.registrar_evento)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tiene_modulo_generado(p_tabla oid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = p_tabla AND a.attname = 'modulo' AND a.attgenerated = 's'
      AND NOT a.attisdropped AND a.atttypid = 'text'::pg_catalog.regtype)
$$;
COMMENT ON FUNCTION app.tiene_modulo_generado(oid) IS
  'true si la tabla tiene una columna text «modulo» GENERADA: el módulo de auditoría de cada fila.';

-- ---------------------------------------------------------------------------------------------
-- app.auditar(modulo, columnas_a_ignorar...): igual que en 0007, con el módulo por fila.
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- app.registrar_evento(): igual que en 0007, con el módulo por fila y los parámetros de búsqueda
-- de 0010 limpios.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.registrar_evento(
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
  v_modulo_fila text;
  v_por_fila boolean;
  v_sede uuid;
  v_columna_sede text;
  v_filas integer;
  v_nombre text;
  v_id uuid;
BEGIN
  -- Las búsquedas sin clínica de 0010 no se pueden colar en las lecturas de esta función.
  PERFORM pg_catalog.set_config('app.invitacion_token_hash', '', true);
  PERFORM pg_catalog.set_config('app.usuario_email_buscado', '', true);

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
    v_por_fila := app.tiene_modulo_generado(pg_catalog.to_regclass('app.' || pg_catalog.quote_ident(p_entidad)));
    IF v_por_fila AND p_entidad_id IS NULL THEN
      RAISE EXCEPTION 'Los eventos de % van con el id del registro: el módulo depende de cada uno.', p_entidad
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
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
        'SELECT %s, %s FROM app.%I t WHERE t.id = $1',
        CASE WHEN v_columna_sede IS NULL THEN 'NULL::uuid'
             ELSE 't.' || pg_catalog.quote_ident(v_columna_sede) END,
        CASE WHEN v_por_fila THEN 't.modulo' ELSE 'NULL::text' END,
        p_entidad)
        INTO v_sede, v_modulo_fila USING p_entidad_id;
      GET DIAGNOSTICS v_filas = ROW_COUNT;
      IF v_filas = 0 THEN
        RAISE EXCEPTION 'No existe ese registro de % en esta clínica.', p_entidad
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF v_por_fila THEN
        v_modulo := v_modulo_fila;
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
  'Registra ver/exportar/enviar/ingresar con clínica, usuario, nombre, IP y módulo salidos de la base (el de la fila si la tabla tiene modulo generado). Valida entidad, registro, sede y detalle.';

CALL app.asegurar_permisos();
