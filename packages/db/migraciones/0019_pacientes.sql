-- 0019_pacientes: paciente (módulo pacientes), su índice de búsqueda y la defensa de permisos de
-- las tablas de pacientes.
--
-- Contrato: packages/shared/src/contrato/pacientes.ts. Valores por defecto de P4 y P6 (docs/plan.md
-- §7): la CI NO es única (una CI repetida se avisa, no se bloquea) y puede faltar (niños).
--
--   * paciente: un paciente es de la clínica, no de una sede. Nada se borra: se desactiva
--     (activo = false) con motivo_baja y se puede reactivar (el motivo se borra; el historial queda
--     en audit_log). origen es inmutable.
--     Normalización en la base (trigger paciente_validar, para todos), igual que
--     @conecta/shared/documentos.ts: espacios de más fuera; texto opcional vacío -> NULL; CI sin
--     puntos, guiones ni espacios y sin ceros a la izquierda; RUC en mayúsculas sin puntos ni
--     espacios y base sin ceros a la izquierda; teléfono paraguayo a E.164 (0981 123 456 ->
--     +595981123456; otro país solo con «+»); correo en minúsculas. Después, los CHECK validan el
--     formato: CI ^[1-9][0-9]{4,8}$, RUC base-dv (el dígito verificador lo valida la API), teléfono
--     E.164 (+595 con 7 a 9 dígitos), sexo F/M, idioma es/gn, origen recepcion/online, largos del
--     contrato. Fecha de nacimiento: desde 1900 y no futura en la zona de la clínica
--     (paciente_fecha_nac_futura, 23514). Desactivar sin motivo: baja_sin_motivo (23514), para todos.
--   * Orden de las listas: orden_apellidos y orden_nombres, columnas GENERADAS con COLLATE "C":
--     sin tildes ni mayúsculas y con la ñ como «n~» (ordena entre la n y la o, como en castellano).
--     Índice (clinica_id, activo, orden_apellidos, orden_nombres, id) para el cursor estable.
--   * Búsqueda: app.normalizar_busqueda(texto) hace lo mismo que normalizarBusqueda() de
--     @conecta/shared (minúsculas, sin tildes, la ñ se conserva, espacios colapsados). Sin unaccent
--     (no es IMMUTABLE: depende de un diccionario, ver 0012): NFD + quitar las marcas combinantes
--     (U+0300–U+036F), protegiendo la ñ. app.texto_busqueda_paciente() arma el texto buscable:
--     nombres y apellidos normalizados, la CI y el teléfono solo dígitos (E.164 sin «+» y, si es
--     paraguayo, también la forma local con 0 y sin 0: 0981123456, 981123456).
--   * paciente_busqueda: índice de búsqueda (una fila por paciente, id = paciente.id) con índice GIN
--     pg_trgm sobre el texto, y copias de activo y de las claves de orden (para ordenar los candidatos
--     sin volver a paciente por cada uno). Lo mantiene el trigger paciente_indexar (SECURITY DEFINER: app_api solo
--     lee). Por qué una tabla aparte y no una columna con GIN en paciente: con RLS, Postgres solo usa
--     un índice para una condición del usuario si su operador es LEAKPROOF, y LIKE (textlike) y los
--     operadores de pg_trgm no lo son (marcar LEAKPROOF exige superusuario). Como app_api, el GIN de
--     paciente nunca se usaría. Acá el patrón va DENTRO de la política de SELECT
--     (texto LIKE app.patron_busqueda()), que es parte de las condiciones de seguridad: ahí el
--     planificador sí usa el índice. app.patron_busqueda() lee app.busqueda_patron (lo fijan
--     app.buscar_pacientes y app.listar_pacientes con set_config local y lo vacían al terminar); sin
--     valor es '%' (todas las filas de la clínica). Solo ACHICA lo visible dentro de la clínica del
--     contexto: fijarlo a mano no da acceso a nada.
--     pg_trgm se instala en el schema extensions (como btree_gist en 0011); si ya estaba en otro
--     schema, se usa ese.
--   * app.tiene_permiso(modulo, accion): el permiso del usuario del contexto en la clínica del
--     contexto (membresía activa, rol activo, clínica activa, permiso activo). SECURITY INVOKER.
--   * app.proteger_pacientes() (BEFORE INSERT OR UPDATE, SECURITY INVOKER), defensa en la base además
--     de la API, para paciente, paciente_relacion (0020), paciente_alerta y paciente_nota (0021):
--       paciente: alta pacientes:crear (y nace activo: paciente_nace_activo, 22023); cambio de datos
--       pacientes:editar; desactivar, reactivar o cambiar el motivo de la baja pacientes:anular.
--       paciente_relacion: pacientes:editar. paciente_alerta y paciente_nota: ficha_clinica:editar.
--     Errores 42501 pacientes_sin_permiso / ficha_clinica_sin_permiso. Como app.proteger_acceso, solo
--     exceptúa a una SESIÓN del dueño de las tablas (migraciones, semilla, fábricas de prueba).
--   * Funciones (SECURITY INVOKER): app.desactivar_paciente(id, motivo), app.reactivar_paciente(id),
--     app.hoy_clinica(instante) (fecha en la zona de la clínica del contexto).

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------------------------
-- Normalización (IMMUTABLE, cuerpo SQL estándar: ligado al crearla)
-- ---------------------------------------------------------------------------------------------
-- Igual que normalizarBusqueda() de @conecta/shared: la ñ se reemplaza por un marcador antes de
-- descomponer (NFD la separa en n + tilde) y se repone al final. Los caracteres de control se
-- vuelven espacios (así el marcador \x01 no puede venir del texto).
CREATE OR REPLACE FUNCTION app.normalizar_busqueda(p_texto text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  RETURN pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.replace(
      pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.normalize(
          pg_catalog.replace(
            pg_catalog.replace(pg_catalog.regexp_replace(p_texto, '[[:cntrl:]]', ' ', 'g'), 'Ñ', 'ñ'),
            'ñ', E'\x01'),
          'NFD'),
        '[̀-ͯ]', '', 'g')),
      E'\x01', 'ñ'),
    '\s+', ' ', 'g'));
COMMENT ON FUNCTION app.normalizar_busqueda(text) IS
  'Minúsculas, sin tildes (la ñ se conserva), espacios colapsados. Igual que normalizarBusqueda() de @conecta/shared.';

-- Clave de orden: normalizada, con la ñ como «n~» (en COLLATE "C" queda entre la n y la o).
CREATE OR REPLACE FUNCTION app.clave_orden(p_texto text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN pg_catalog.replace(COALESCE(app.normalizar_busqueda(p_texto), ''), 'ñ', 'n~');
COMMENT ON FUNCTION app.clave_orden(text) IS
  'Clave para ordenar nombres con COLLATE "C": normalizada y con la ñ entre la n y la o.';

-- Texto buscable de un paciente.
CREATE OR REPLACE FUNCTION app.texto_busqueda_paciente(
  p_nombres text, p_apellidos text, p_ci text, p_telefono text
) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN pg_catalog.btrim(pg_catalog.regexp_replace(
    COALESCE(app.normalizar_busqueda(COALESCE(p_nombres, '') || ' ' || COALESCE(p_apellidos, '')), '')
    || ' ' || COALESCE(p_ci, '')
    || ' ' || COALESCE(pg_catalog.regexp_replace(p_telefono, '\D', '', 'g'), '')
    || ' ' || CASE WHEN p_telefono LIKE '+595%'
                   THEN '0' || pg_catalog.substr(p_telefono, 5) || ' ' || pg_catalog.substr(p_telefono, 5)
                   ELSE '' END,
    '\s+', ' ', 'g'));
COMMENT ON FUNCTION app.texto_busqueda_paciente(text, text, text, text) IS
  'Nombres y apellidos normalizados, CI y teléfono solo dígitos (E.164 y, si es de Paraguay, la forma local con 0 y sin 0).';

-- ---------------------------------------------------------------------------------------------
-- Ayudas de contexto
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tiene_permiso(p_modulo text, p_accion text) RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.membresia m
    JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id AND r.activo
    JOIN app.clinica c ON c.id = m.clinica_id AND c.activo
    JOIN app.rol_permiso p ON p.clinica_id = m.clinica_id AND p.rol_id = m.rol_id AND p.activo
    WHERE m.clinica_id = app.clinica_actual() AND m.usuario_id = app.usuario_actual()
      AND m.estado = 'activo' AND p.modulo = p_modulo AND p.accion = p_accion)
$$;
COMMENT ON FUNCTION app.tiene_permiso(text, text) IS
  'true si el usuario del contexto tiene modulo:accion en la clínica del contexto (membresía, rol, clínica y permiso activos).';

-- Fecha de hoy (o de p_instante) en la zona horaria de la clínica del contexto; sin clínica,
-- America/Asuncion.
CREATE OR REPLACE FUNCTION app.hoy_clinica(p_instante timestamptz DEFAULT pg_catalog.now())
  RETURNS date
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT (p_instante AT TIME ZONE COALESCE(
    (SELECT c.zona_horaria FROM app.clinica c WHERE c.id = app.clinica_actual()),
    'America/Asuncion'))::date
$$;
COMMENT ON FUNCTION app.hoy_clinica(timestamptz) IS
  'Fecha de p_instante (por defecto ahora) en la zona horaria de la clínica del contexto (America/Asuncion por defecto).';

-- ---------------------------------------------------------------------------------------------
-- paciente
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.paciente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  nombres text NOT NULL
    CONSTRAINT paciente_nombres_check CHECK (char_length(btrim(nombres)) BETWEEN 2 AND 80),
  apellidos text
    CONSTRAINT paciente_apellidos_check CHECK (btrim(apellidos) <> '' AND char_length(apellidos) <= 80),
  ci text CONSTRAINT paciente_ci_check CHECK (ci ~ '^[1-9][0-9]{4,8}$'),
  ruc text CONSTRAINT paciente_ruc_check CHECK (ruc ~ '^[1-9A-Z][0-9A-Z]{0,8}-[0-9]$'),
  fecha_nac date CONSTRAINT paciente_fecha_nac_check CHECK (fecha_nac >= DATE '1900-01-01'),
  sexo text CONSTRAINT paciente_sexo_check CHECK (sexo IN ('F', 'M')),
  telefono text CONSTRAINT paciente_telefono_check CHECK (
    telefono ~ '^\+[1-9][0-9]{7,14}$' AND (telefono !~ '^\+595' OR telefono ~ '^\+595[0-9]{7,9}$')),
  email text CONSTRAINT paciente_email_check CHECK (
    char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ciudad text CONSTRAINT paciente_ciudad_check CHECK (btrim(ciudad) <> '' AND char_length(ciudad) <= 80),
  direccion text
    CONSTRAINT paciente_direccion_check CHECK (btrim(direccion) <> '' AND char_length(direccion) <= 200),
  idioma text NOT NULL DEFAULT 'es' CONSTRAINT paciente_idioma_check CHECK (idioma IN ('es', 'gn')),
  acepta_whatsapp boolean NOT NULL DEFAULT false,
  origen text NOT NULL DEFAULT 'recepcion'
    CONSTRAINT paciente_origen_check CHECK (origen IN ('recepcion', 'online')),
  activo boolean NOT NULL DEFAULT true,
  motivo_baja text CONSTRAINT paciente_motivo_baja_check
    CHECK (btrim(motivo_baja) <> '' AND char_length(motivo_baja) <= 500),
  orden_apellidos text COLLATE "C" GENERATED ALWAYS AS (app.clave_orden(apellidos)) STORED,
  orden_nombres text COLLATE "C" GENERATED ALWAYS AS (app.clave_orden(nombres)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT paciente_clinica_id_id_key UNIQUE (clinica_id, id)
);
COMMENT ON TABLE app.paciente IS
  'Paciente de la clínica (lo ven todas sus sedes). Se desactiva con motivo, no se borra. La nota interna está en paciente_nota.';
COMMENT ON COLUMN app.paciente.ci IS 'Cédula: solo dígitos, sin ceros a la izquierda. NO es única (P6: se avisa).';
COMMENT ON COLUMN app.paciente.ruc IS 'RUC base-dv. El dígito verificador lo valida la API.';
COMMENT ON COLUMN app.paciente.telefono IS 'E.164 (+595981123456).';
COMMENT ON COLUMN app.paciente.motivo_baja IS 'Motivo de la baja vigente; la base lo borra al reactivar.';
COMMENT ON COLUMN app.paciente.orden_apellidos IS 'Generada: clave de orden (sin tildes, ñ entre n y o).';
COMMENT ON COLUMN app.paciente.orden_nombres IS 'Generada: clave de orden (sin tildes, ñ entre n y o).';

-- CI repetida: se avisa (la API busca por este índice), no se bloquea.
CREATE INDEX paciente_ci_idx ON app.paciente (clinica_id, ci) WHERE ci IS NOT NULL;
-- Lista ordenada por apellidos y nombres, con cursor estable.
CREATE INDEX paciente_orden_idx
  ON app.paciente (clinica_id, activo, orden_apellidos, orden_nombres, id);

-- Normaliza y valida (para todos). Corre después de app.proteger_pacientes (orden alfabético de
-- los BEFORE: auditoria_fila, proteger, validar).
CREATE OR REPLACE FUNCTION app.validar_paciente() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_texto text;
  v_digitos text;
BEGIN
  NEW.nombres := pg_catalog.btrim(pg_catalog.regexp_replace(NEW.nombres, '\s+', ' ', 'g'));
  NEW.apellidos := NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(NEW.apellidos, '\s+', ' ', 'g')), '');
  NEW.ciudad := NULLIF(pg_catalog.btrim(NEW.ciudad), '');
  NEW.direccion := NULLIF(pg_catalog.btrim(NEW.direccion), '');
  NEW.email := NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.email)), '');

  -- CI: «4.123.456» -> «4123456» (como normalizarCi).
  v_texto := NULLIF(pg_catalog.regexp_replace(NEW.ci, '[[:space:].-]', '', 'g'), '');
  IF v_texto ~ '^[0-9]+$' THEN
    v_texto := pg_catalog.regexp_replace(v_texto, '^0+(?=[0-9])', '');
  END IF;
  NEW.ci := v_texto;

  -- RUC: mayúsculas, sin puntos ni espacios, base sin ceros a la izquierda (como normalizarRuc).
  v_texto := NULLIF(pg_catalog.upper(pg_catalog.regexp_replace(NEW.ruc, '[[:space:].]', '', 'g')), '');
  IF v_texto ~ '^[0-9A-Z]+-[0-9]$' THEN
    v_texto := pg_catalog.regexp_replace(v_texto, '^0+(?=[0-9A-Z])', '');
  END IF;
  NEW.ruc := v_texto;

  -- Teléfono a E.164 (como normalizarTelefono): con «+», tal cual; 595…, +595…; 0…, +595 sin el 0;
  -- si no, se asume Paraguay.
  v_texto := NULLIF(pg_catalog.btrim(NEW.telefono), '');
  IF v_texto IS NOT NULL THEN
    v_digitos := pg_catalog.regexp_replace(v_texto, '\D', '', 'g');
    NEW.telefono := CASE
      WHEN pg_catalog.left(v_texto, 1) = '+' THEN '+' || v_digitos
      WHEN v_digitos LIKE '595%' THEN '+' || v_digitos
      WHEN v_digitos LIKE '0%' THEN '+595' || pg_catalog.substr(v_digitos, 2)
      ELSE '+595' || v_digitos
    END;
  ELSE
    NEW.telefono := NULL;
  END IF;

  IF NEW.fecha_nac IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.fecha_nac IS DISTINCT FROM OLD.fecha_nac)
     AND NEW.fecha_nac > app.hoy_clinica() THEN
    RAISE EXCEPTION 'La fecha de nacimiento no puede ser futura.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'paciente_fecha_nac_futura';
  END IF;

  -- Baja con motivo; al reactivar, el motivo se borra.
  IF NEW.activo THEN
    NEW.motivo_baja := NULL;
  ELSE
    NEW.motivo_baja := NULLIF(pg_catalog.btrim(NEW.motivo_baja), '');
    IF NEW.motivo_baja IS NULL THEN
      RAISE EXCEPTION 'Contanos el motivo para desactivar al paciente.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'baja_sin_motivo';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.validar_paciente() IS
  'BEFORE INSERT OR UPDATE de paciente: normaliza como @conecta/shared/documentos.ts, fecha de nacimiento no futura y baja con motivo.';

-- ---------------------------------------------------------------------------------------------
-- Defensa de permisos de las tablas de pacientes
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_pacientes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_dueno_tablas oid;
  v_permisos text[] := '{}'::text[];
  v_permiso text;
  v_ignorar CONSTANT text[] := ARRAY['updated_at', 'updated_by', 'activo', 'motivo_baja',
                                     'orden_apellidos', 'orden_nombres'];
BEGIN
  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

  -- Excepción explícita: una SESIÓN del dueño de las tablas (migraciones, semilla, fábricas). Una
  -- función SECURITY DEFINER llamada por app_api corre como el dueño, pero su sesión es de app_api.
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NEW;
  END IF;

  -- (Las referencias a columnas van dentro del IF de cada tabla: tienen columnas distintas.)
  IF TG_TABLE_NAME = 'paciente' THEN
    IF TG_OP = 'INSERT' THEN
      v_permisos := ARRAY['pacientes:crear'];
      IF NOT NEW.activo THEN
        RAISE EXCEPTION 'Un paciente nuevo nace activo.'
          USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'paciente_nace_activo';
      END IF;
    ELSE
      IF (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) v_ignorar)
         IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) v_ignorar) THEN
        v_permisos := v_permisos || 'pacientes:editar'::text;
      END IF;
      IF NEW.activo IS DISTINCT FROM OLD.activo
         OR NEW.motivo_baja IS DISTINCT FROM OLD.motivo_baja THEN
        v_permisos := v_permisos || 'pacientes:anular'::text;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'paciente_relacion' THEN
    v_permisos := ARRAY['pacientes:editar'];
  ELSIF TG_TABLE_NAME IN ('paciente_alerta', 'paciente_nota') THEN
    v_permisos := ARRAY['ficha_clinica:editar'];
  ELSE
    RAISE EXCEPTION 'app.proteger_pacientes() no está pensada para %.%.', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  FOREACH v_permiso IN ARRAY v_permisos LOOP
    IF NOT app.tiene_permiso(pg_catalog.split_part(v_permiso, ':', 1),
                             pg_catalog.split_part(v_permiso, ':', 2)) THEN
      RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para este cambio (%).', v_permiso
        USING ERRCODE = 'insufficient_privilege',
              CONSTRAINT = CASE WHEN v_permiso LIKE 'ficha_clinica:%' THEN 'ficha_clinica_sin_permiso'
                                ELSE 'pacientes_sin_permiso' END;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_pacientes() IS
  'Defensa de paciente, paciente_relacion, paciente_alerta y paciente_nota: permiso del actor (pacientes:crear/editar/anular, ficha_clinica:editar). Exceptúa solo a una sesión del dueño de las tablas.';

CREATE TRIGGER paciente_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('origen');
CREATE TRIGGER paciente_proteger BEFORE INSERT OR UPDATE ON app.paciente
  FOR EACH ROW EXECUTE FUNCTION app.proteger_pacientes();
CREATE TRIGGER paciente_validar BEFORE INSERT OR UPDATE ON app.paciente
  FOR EACH ROW EXECUTE FUNCTION app.validar_paciente();
CREATE TRIGGER paciente_auditar AFTER INSERT OR UPDATE OR DELETE ON app.paciente
  FOR EACH ROW EXECUTE FUNCTION app.auditar('pacientes', '-orden_apellidos', '-orden_nombres');
CREATE TRIGGER paciente_sin_borrado BEFORE DELETE OR TRUNCATE ON app.paciente
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- paciente_busqueda: índice de búsqueda (ver el encabezado)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.paciente_busqueda (
  -- = paciente.id
  id uuid PRIMARY KEY,
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  texto text NOT NULL,
  -- Copias de paciente para ordenar y filtrar sin volver a la tabla del paciente por cada candidato.
  activo boolean NOT NULL,
  orden_apellidos text COLLATE "C" NOT NULL,
  orden_nombres text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT paciente_busqueda_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT paciente_busqueda_paciente_fkey FOREIGN KEY (clinica_id, id)
    REFERENCES app.paciente (clinica_id, id)
);
COMMENT ON TABLE app.paciente_busqueda IS
  'Índice de búsqueda de pacientes (dato derivado, lo mantiene paciente_indexar). La política de SELECT lleva el patrón de app.patron_busqueda() para que el GIN trigram se use con RLS.';

-- Patrón LIKE de la búsqueda en curso; '%' si no hay ninguna. Función opaca a propósito (con SET, el
-- planificador no la expande): al planificar la evalúa con el patrón real y estima bien cuántas
-- filas trae el índice; expandida, la estimación cambia y deja de elegir el GIN.
CREATE OR REPLACE FUNCTION app.patron_busqueda() RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.busqueda_patron', true), ''), '%')
$$;
COMMENT ON FUNCTION app.patron_busqueda() IS
  'Patrón LIKE de la búsqueda en curso (app.busqueda_patron, local a la transacción); % si no hay.';

-- Escapa los comodines de LIKE de un término de búsqueda.
CREATE OR REPLACE FUNCTION app.escapar_like(p_texto text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p_texto, '\', '\\'), '%', '\%'), '_', '\_');
COMMENT ON FUNCTION app.escapar_like(text) IS 'Escapa \, % y _ para usar el texto dentro de un patrón LIKE.';

DO $$
DECLARE
  v_esquema text;
BEGIN
  SELECT n.nspname INTO STRICT v_esquema
  FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';
  EXECUTE pg_catalog.format(
    'CREATE INDEX paciente_busqueda_texto_idx ON app.paciente_busqueda USING gin (texto %I.gin_trgm_ops)',
    v_esquema);
END
$$;

CREATE TRIGGER paciente_busqueda_auditoria_fila BEFORE INSERT OR UPDATE ON app.paciente_busqueda
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();
CREATE TRIGGER paciente_busqueda_sin_borrado BEFORE DELETE OR TRUNCATE ON app.paciente_busqueda
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- Mantiene el índice. SECURITY DEFINER: app_api no escribe paciente_busqueda. Solo escribe el texto
-- derivado de la fila del paciente (que ya pasó RLS y las defensas), en la clínica del contexto.
CREATE OR REPLACE FUNCTION app.indexar_paciente() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_patron text := pg_catalog.current_setting('app.busqueda_patron', true);
BEGIN
  -- Sin patrón, la política de SELECT deja ver la fila existente (ON CONFLICT la necesita).
  PERFORM pg_catalog.set_config('app.busqueda_patron', '', true);
  INSERT INTO app.paciente_busqueda AS b (id, clinica_id, texto, activo, orden_apellidos, orden_nombres)
  VALUES (NEW.id, NEW.clinica_id,
          app.texto_busqueda_paciente(NEW.nombres, NEW.apellidos, NEW.ci, NEW.telefono),
          NEW.activo, NEW.orden_apellidos, NEW.orden_nombres)
  ON CONFLICT (id) DO UPDATE SET texto = EXCLUDED.texto, activo = EXCLUDED.activo,
    orden_apellidos = EXCLUDED.orden_apellidos, orden_nombres = EXCLUDED.orden_nombres
    WHERE (b.texto, b.activo, b.orden_apellidos, b.orden_nombres)
          IS DISTINCT FROM (EXCLUDED.texto, EXCLUDED.activo, EXCLUDED.orden_apellidos, EXCLUDED.orden_nombres);
  PERFORM pg_catalog.set_config('app.busqueda_patron', COALESCE(v_patron, ''), true);
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.indexar_paciente() IS
  'AFTER INSERT/UPDATE de paciente: mantiene paciente_busqueda (texto, activo y claves de orden).';

CREATE TRIGGER paciente_indexar AFTER INSERT OR UPDATE OF nombres, apellidos, ci, telefono, activo
  ON app.paciente
  FOR EACH ROW EXECUTE FUNCTION app.indexar_paciente();

-- ---------------------------------------------------------------------------------------------
-- Baja y reactivación (SECURITY INVOKER: corren como app_api con RLS y las defensas)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.desactivar_paciente(p_paciente_id uuid, p_motivo text)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_activo boolean;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de dar de baja.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo IS NULL OR pg_catalog.btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Contanos el motivo para desactivar al paciente.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'baja_sin_motivo';
  END IF;
  SELECT p.activo INTO v_activo FROM app.paciente p
  WHERE p.clinica_id = v_clinica AND p.id = p_paciente_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ningún paciente con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'paciente_no_encontrado';
  END IF;
  IF NOT v_activo THEN
    RETURN false;
  END IF;
  UPDATE app.paciente p SET activo = false, motivo_baja = pg_catalog.btrim(p_motivo)
  WHERE p.clinica_id = v_clinica AND p.id = p_paciente_id;
  RETURN true;
END
$$;
COMMENT ON FUNCTION app.desactivar_paciente(uuid, text) IS
  'Desactiva un paciente con motivo (obligatorio). false si ya estaba inactivo. Corre como app_api: app.proteger_pacientes exige pacientes:anular.';

CREATE OR REPLACE FUNCTION app.reactivar_paciente(p_paciente_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_activo boolean;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de reactivar.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.activo INTO v_activo FROM app.paciente p
  WHERE p.clinica_id = v_clinica AND p.id = p_paciente_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ningún paciente con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'paciente_no_encontrado';
  END IF;
  IF v_activo THEN
    RETURN false;
  END IF;
  UPDATE app.paciente p SET activo = true
  WHERE p.clinica_id = v_clinica AND p.id = p_paciente_id;
  RETURN true;
END
$$;
COMMENT ON FUNCTION app.reactivar_paciente(uuid) IS
  'Reactiva un paciente (borra el motivo de baja). false si ya estaba activo. Corre como app_api: app.proteger_pacientes exige pacientes:anular.';

-- ---------------------------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.paciente FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_busqueda ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_busqueda FORCE ROW LEVEL SECURITY;

CREATE POLICY paciente_aislamiento ON app.paciente
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

CREATE POLICY paciente_busqueda_ver ON app.paciente_busqueda
  FOR SELECT
  USING (clinica_id = app.clinica_actual() AND texto LIKE app.patron_busqueda());
CREATE POLICY paciente_busqueda_insertar ON app.paciente_busqueda
  FOR INSERT
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY paciente_busqueda_editar ON app.paciente_busqueda
  FOR UPDATE
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT, INSERT, UPDATE ON app.paciente TO app_api;
GRANT SELECT ON app.paciente_busqueda TO app_api;

GRANT EXECUTE ON FUNCTION app.normalizar_busqueda(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.clave_orden(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.escapar_like(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.tiene_permiso(text, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.hoy_clinica(timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.patron_busqueda() TO app_api;
GRANT EXECUTE ON FUNCTION app.desactivar_paciente(uuid, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.reactivar_paciente(uuid) TO app_api;

CALL app.asegurar_permisos();
