-- 0029_anamnesis_versiones: versiones firmadas e inmutables de la anamnesis (módulo ficha_clinica) y
-- su alerta médica derivada.
--
-- Contrato: packages/shared/src/contrato/anamnesis.ts (crearAnamnesisSchema, anamnesisSchema).
--
--   * anamnesis: una fila por versión. version 1, 2, 3… por paciente, sin huecos
--     (anamnesis_version_key único por (clinica, paciente, version)). registrada_por = usuario del
--     contexto (lo fija la base); firmante (nombre, CI, es_tutor); firma_archivo_id: FK compuesta a
--     archivo (anamnesis_firma_fkey) y, además, el archivo tiene que ser de categoría firma_paciente
--     del MISMO paciente y no estar dado de baja (anamnesis_firma_invalida, 23514, trigger para
--     todos); una firma sirve para una sola versión (anamnesis_firma_key, 23505).
--     declaracion_veracidad tiene que ser true (anamnesis_sin_declaracion, 23514). Signos vitales
--     numéricos con los rangos del contrato: presión sistólica 50..260, diastólica 30..160, pulso
--     20..250, peso 1..400 kg. Un tutor firma con CI (anamnesis_tutor_sin_ci, 23514). La fecha de
--     la versión es created_at.
--   * anamnesis_respuesta: una por pregunta respondida, con COPIA del texto de la pregunta, su
--     sección, orden y tipo, y de las etiquetas de las opciones marcadas (y la unidad de un
--     número): una versión vieja se lee igual aunque el catálogo cambie.
--   * Inmutables: app.rechazar_edicion_inmutable() (BEFORE UPDATE, por sentencia) rechaza cualquier
--     UPDATE de anamnesis y anamnesis_respuesta (anamnesis_inmutable, 42501), también dentro de una
--     función SECURITY DEFINER llamada por app_api. Solo lo exceptúa una SESIÓN del dueño de las
--     tablas (migraciones, administración: una corrección de datos queda en auditoría). DELETE y
--     TRUNCATE los rechaza app.rechazar_borrado() para TODOS, dueño incluido (nada se borra
--     físicamente, CLAUDE.md). app_api, además, no tiene INSERT, UPDATE ni DELETE sobre ninguna de
--     estas tablas: las escribe solo app.guardar_anamnesis.
--   * Lectura: políticas RESTRICTIVAS. anamnesis y anamnesis_respuesta solo existen para quien
--     tiene ficha_clinica:ver (como la nota interna de 0023): ni SELECT directo, ni joins, ni
--     funciones INVOKER, ni su auditoría (audit_log_modulo, módulo ficha_clinica).
--   * anamnesis_alerta: la ALERTA MÉDICA DERIVADA de cada versión, calculada por la base al
--     guardar con las reglas del catálogo de ESE momento (y no con las de hoy): cambiar el
--     catálogo después no cambia la alerta de una versión ya firmada, que es lo que la persona
--     firmó. Por eso no hace falta copiar las reglas en cada respuesta. El texto es el de la regla
--     («Alergia a la penicilina»), SIN el detalle libre de la respuesta: ese detalle puede traer
--     cualquier dato de salud y no se copia en esta tabla. El detalle de una alerta es el de la
--     respuesta a su pregunta (anamnesis_respuesta.detalle, sin espacios ni puntos al final): lo
--     llevan todas las alertas de esa pregunta y lo arma app.alertas_medicas con un LEFT JOIN a
--     anamnesis_respuesta, que solo existe para quien tiene ficha_clinica:ver. Así el
--     enmascaramiento lo hace la base (RLS): para recepción el detalle es NULL consulte como
--     consulte, porque no hay ninguna columna con el detalle que la política de alertas vigentes
--     deje ver. Orden: sección, orden y código de la pregunta, y el orden de las opciones en el
--     catálogo.
--     vigente = true solo en las de la versión vigente (la última): al guardar una versión nueva,
--     las anteriores pasan a false en la misma transacción (es lo único que cambia de una fila;
--     app.proteger_alerta_derivada). Exposición: la política RESTRICTIVA anamnesis_alerta_ver deja
--     ver las filas vigentes a cualquiera de la clínica (el permiso pacientes:ver lo controla la
--     API, como con las alertas manuales activas) y todas a quien tiene ficha_clinica:ver. Así
--     recepción ve el texto de la alerta vigente y nada más: ni las respuestas, ni los signos
--     vitales, ni las alertas de versiones viejas, ni los detalles. Es un dato derivado (su
--     origen, la versión, sí se audita): no lleva app.auditar.
--   * anamnesis_vigente: una fila por paciente con anamnesis (la versión vigente, su id y
--     con_alerta = la vigente dejó alguna alerta). La mantiene app.guardar_anamnesis en la misma
--     transacción. Existe para el filtro «Con alerta» (0030): con muchas alertas derivadas, el
--     EXISTS sobre anamnesis_alerta terminaba en un Seq Scan de toda la tabla evaluando la política
--     por fila (319 ms con 20.000 pacientes y 48.000 alertas); una fila por paciente se une por
--     índice. La ve toda la clínica (no tiene nada clínico más allá de «tiene alerta», que recepción
--     ya ve). Dato derivado: sin app.auditar.
--   * archivo, defensa en profundidad de la firma: política RESTRICTIVA archivo_ficha_clinica_ver
--     (SELECT) y _editar (UPDATE): un archivo de módulo ficha_clinica (firma_paciente) solo existe
--     para quien tiene ficha_clinica:ver, salvo el worker (app_worker lee los archivos que verifica,
--     con la clínica del trabajo y sin usuario) y una sesión del dueño. Trigger
--     archivo_firma_en_uso (BEFORE UPDATE, para todos): un archivo que es la firma de una anamnesis
--     no se da de baja (archivo_firma_en_uso, 23514). paciente_id, ruta y sha256 ya no cambian para
--     nadie (archivo_auditoria_fila, 0013/0028).
--   * app.guardar_anamnesis(...): la única forma de guardar una versión. SECURITY DEFINER (app_api
--     no escribe estas tablas). En una transacción:
--       1. exige ficha_clinica:crear Y ficha_clinica:ver del actor (ficha_clinica_sin_permiso,
--          42501). Ver también: «Actualizar» parte de las respuestas vigentes y la versionBase solo
--          se puede comparar con lo que se ve (como la nota interna, 0023: no se escribe lo que no se
--          ve). La API igual devuelve la versión completa, que pide ver;
--       2. toma el bloqueo consultivo del cuestionario de la clínica en modo COMPARTIDO (el mismo que
--          app.reemplazar_preguntas_anamnesis toma exclusivo): un reemplazo en curso termina antes,
--          y uno que empiece después espera a que este guardado termine. Con el bloqueo tomado,
--          compara huellaCatalogo con app.huella_catalogo(): si no coincide,
--          anamnesis_conflicto_catalogo (40001, COLUMN huellaCatalogo) — el cuestionario cambió
--          mientras el paciente lo completaba. Con READ COMMITTED (el de la API) la comparación ve el
--          último reemplazo confirmado; con REPEATABLE READ la instantánea es la del primer pedido de
--          la transacción, así que la API no debe abrirla así para guardar;
--          después bloquea al paciente (FOR NO KEY UPDATE): dos guardados del mismo paciente se esperan.
--          El segundo ve la versión que dejó el primero y, con la misma versionBase, recibe
--          anamnesis_conflicto_version (40001, COLUMN versionBase). Nunca dos con el mismo número
--          ni huecos (un guardado que falla se revierte entero). Con REPEATABLE READ el segundo
--          choca con anamnesis_version_key y también responde anamnesis_conflicto_version;
--       3. versionBase tiene que ser la vigente (NULL si no hay ninguna), y la huella del
--          cuestionario la de ahora (paso 2);
--       4. valida contra el catálogo VIGENTE: pregunta activa de la clínica
--          (anamnesis_pregunta_desconocida, 22023), una respuesta por pregunta
--          (anamnesis_respuesta_repetida, 22023), los campos del tipo (anamnesis_respuesta_invalida,
--          22023: sí/no con «si» booleano; múltiple con «opciones», arreglo de valores; texto con
--          «texto» de hasta 1000; número con «numero»; «detalle» de hasta 300 solo si la pregunta lo
--          admite; ninguna clave de otro tipo), opciones existentes (anamnesis_opcion_desconocida,
--          22023; las repetidas cuentan una vez), número dentro del rango de la pregunta
--          (anamnesis_numero_fuera_de_rango, 22023), obligatorias respondidas
--          (anamnesis_obligatoria_sin_responder, 22023; un texto vacío cuenta como no respondido;
--          una de opción múltiple sin ninguna marcada sí cuenta), y la pregunta solo para sexo F
--          rechazada si el paciente es de sexo M (anamnesis_pregunta_no_aplica, 22023; sin sexo
--          cargado se acepta, como dice el contrato). Todas llevan en COLUMN «respuestas.<codigo>»;
--       5. firmante: nombre de 3 a 120 (anamnesis_firmante_nombre, 22023, COLUMN firmante.nombre),
--          CI normalizada como paciente.ci (anamnesis_firmante_ci, 22023, COLUMN firmante.ci);
--          tutor: si el paciente es menor de clinica.edad_tutor según su fecha de nacimiento y la
--          fecha de hoy EN LA ZONA DE LA CLÍNICA (app.requiere_tutor), tiene que firmar un tutor
--          (anamnesis_tutor_requerido, 22023, COLUMN firmante.esTutor) y un tutor siempre con CI
--          (anamnesis_tutor_sin_ci, 22023, COLUMN firmante.ci). Decisión: SIN fecha de nacimiento
--          no se exige tutor (pero se admite): el alta con solo el nombre es válida (P6) y frenar la
--          anamnesis de la primera consulta por un dato administrativo es peor; la API puede avisar
--          (requiereTutor = false) y quien firma declara la veracidad. Un adulto también puede
--          firmar con tutor (p. ej. curatela);
--       6. firma (anamnesis_sin_firma / anamnesis_firma_invalida, 22023, COLUMN firmaPng),
--          declaración (anamnesis_sin_declaracion, 22023, COLUMN declaracionVeracidad), signos
--          vitales (anamnesis_signos_vitales, 22023, COLUMN signosVitales.<campo>), paciente
--          inactivo (anamnesis_paciente_inactivo, 22023), paciente de otra clínica o inexistente
--          (paciente_no_encontrado, P0002);
--       7. copia los textos, guarda la versión, sus respuestas y sus alertas, deja vigentes solo
--          las nuevas y actualiza anamnesis_vigente. Devuelve (id, version).
--     Orden de los conflictos: primero versionBase, después huellaCatalogo.
--     El código de la pregunta (o el campo del contrato) que causó un error va en el campo COLUMN
--     del error de Postgres (`column` en node-postgres): la API no tiene que leer el mensaje.
--   * app.requiere_tutor(fecha_nac, ahora = now()): menor de clinica.edad_tutor a la fecha de
--     «ahora» en la zona de la clínica del contexto; false sin fecha de nacimiento.
--   * app.alertas_medicas(paciente, anamnesis = NULL): las alertas derivadas, en orden, con su
--     detalle solo para quien tiene ficha_clinica:ver (NULL para los demás, por RLS). Sin anamnesis,
--     las vigentes; con el id de una versión, las de esa versión (las de una versión vieja solo
--     existen con ficha_clinica:ver). SECURITY INVOKER.

-- ---------------------------------------------------------------------------------------------
-- anamnesis
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.anamnesis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  paciente_id uuid NOT NULL,
  version integer NOT NULL CONSTRAINT anamnesis_version_check CHECK (version >= 1),
  registrada_por uuid REFERENCES app.usuario (id),
  firmante_nombre text NOT NULL CONSTRAINT anamnesis_firmante_nombre_check
    CHECK (char_length(firmante_nombre) BETWEEN 3 AND 120 AND firmante_nombre = btrim(firmante_nombre)),
  firmante_ci text CONSTRAINT anamnesis_firmante_ci_check CHECK (firmante_ci ~ '^[1-9][0-9]{4,8}$'),
  es_tutor boolean NOT NULL,
  firma_archivo_id uuid NOT NULL,
  declaracion_veracidad boolean NOT NULL CONSTRAINT anamnesis_sin_declaracion
    CHECK (declaracion_veracidad),
  presion_sistolica smallint CONSTRAINT anamnesis_presion_sistolica_check
    CHECK (presion_sistolica BETWEEN 50 AND 260),
  presion_diastolica smallint CONSTRAINT anamnesis_presion_diastolica_check
    CHECK (presion_diastolica BETWEEN 30 AND 160),
  pulso smallint CONSTRAINT anamnesis_pulso_check CHECK (pulso BETWEEN 20 AND 250),
  peso_kg numeric CONSTRAINT anamnesis_peso_kg_check CHECK (peso_kg BETWEEN 1 AND 400),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT anamnesis_clinica_id_id_key UNIQUE (clinica_id, id),
  -- Para que una alerta derivada apunte a la versión Y a su paciente.
  CONSTRAINT anamnesis_clinica_id_id_paciente_key UNIQUE (clinica_id, id, paciente_id),
  CONSTRAINT anamnesis_version_key UNIQUE (clinica_id, paciente_id, version),
  CONSTRAINT anamnesis_firma_key UNIQUE (clinica_id, firma_archivo_id),
  CONSTRAINT anamnesis_tutor_sin_ci CHECK (NOT es_tutor OR firmante_ci IS NOT NULL),
  CONSTRAINT anamnesis_paciente_fkey FOREIGN KEY (clinica_id, paciente_id)
    REFERENCES app.paciente (clinica_id, id),
  CONSTRAINT anamnesis_firma_fkey FOREIGN KEY (clinica_id, firma_archivo_id)
    REFERENCES app.archivo (clinica_id, id)
);
COMMENT ON TABLE app.anamnesis IS
  'Versión firmada de la anamnesis (ficha_clinica). Inmutable. Solo la ve quien tiene ficha_clinica:ver (RLS). La escribe app.guardar_anamnesis.';
COMMENT ON COLUMN app.anamnesis.version IS '1, 2, 3… por paciente, sin huecos. La vigente es la mayor.';
COMMENT ON COLUMN app.anamnesis.registrada_por IS 'Usuario del contexto al guardar (lo fija la base).';
COMMENT ON COLUMN app.anamnesis.firma_archivo_id IS 'Archivo firma_paciente de este paciente (PNG del trazo).';

-- Firma del mismo paciente y registrada_por del contexto (para todos, también el dueño).
CREATE OR REPLACE FUNCTION app.validar_anamnesis() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.registrada_por := app.usuario_actual();
  IF NOT EXISTS (
       SELECT 1 FROM app.archivo f
       WHERE f.clinica_id = NEW.clinica_id AND f.id = NEW.firma_archivo_id
         AND f.categoria = 'firma_paciente' AND f.paciente_id = NEW.paciente_id
         AND f.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'La firma tiene que ser un trazo guardado para este paciente.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'anamnesis_firma_invalida', COLUMN = 'firmaPng';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.validar_anamnesis() IS
  'BEFORE INSERT de anamnesis: registrada_por del contexto y firma = archivo firma_paciente del mismo paciente, no dado de baja.';

-- ---------------------------------------------------------------------------------------------
-- anamnesis_respuesta
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.anamnesis_respuesta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  anamnesis_id uuid NOT NULL,
  pregunta_codigo text NOT NULL CONSTRAINT anamnesis_respuesta_codigo_check
    CHECK (pregunta_codigo ~ '^[a-z0-9_]{2,40}$'),
  -- Copias de la pregunta al guardar.
  seccion smallint NOT NULL CONSTRAINT anamnesis_respuesta_seccion_check CHECK (seccion BETWEEN 1 AND 5),
  orden smallint NOT NULL CONSTRAINT anamnesis_respuesta_orden_check CHECK (orden BETWEEN 0 AND 999),
  pregunta_texto text NOT NULL CONSTRAINT anamnesis_respuesta_pregunta_texto_check
    CHECK (char_length(pregunta_texto) BETWEEN 3 AND 200),
  tipo text NOT NULL CONSTRAINT anamnesis_respuesta_tipo_check
    CHECK (tipo IN ('si_no', 'multiple', 'texto', 'numero')),
  unidad text CONSTRAINT anamnesis_respuesta_unidad_check CHECK (char_length(unidad) BETWEEN 1 AND 20),
  -- La respuesta (solo los campos de su tipo).
  respuesta_si boolean,
  opciones text[],
  etiquetas text[],
  texto text CONSTRAINT anamnesis_respuesta_texto_check CHECK (char_length(texto) BETWEEN 1 AND 1000),
  numero numeric,
  detalle text CONSTRAINT anamnesis_respuesta_detalle_check CHECK (char_length(detalle) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT anamnesis_respuesta_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT anamnesis_respuesta_pregunta_key UNIQUE (clinica_id, anamnesis_id, pregunta_codigo),
  CONSTRAINT anamnesis_respuesta_anamnesis_fkey FOREIGN KEY (clinica_id, anamnesis_id)
    REFERENCES app.anamnesis (clinica_id, id),
  CONSTRAINT anamnesis_respuesta_tipo_campos CHECK (CASE tipo
    WHEN 'si_no' THEN respuesta_si IS NOT NULL AND opciones IS NULL AND etiquetas IS NULL
                      AND texto IS NULL AND numero IS NULL AND unidad IS NULL
    WHEN 'multiple' THEN respuesta_si IS NULL AND opciones IS NOT NULL AND etiquetas IS NOT NULL
                         AND pg_catalog.cardinality(opciones) = pg_catalog.cardinality(etiquetas)
                         AND texto IS NULL AND numero IS NULL AND unidad IS NULL
    WHEN 'texto' THEN texto IS NOT NULL AND respuesta_si IS NULL AND opciones IS NULL
                      AND etiquetas IS NULL AND numero IS NULL AND unidad IS NULL AND detalle IS NULL
    WHEN 'numero' THEN numero IS NOT NULL AND respuesta_si IS NULL AND opciones IS NULL
                       AND etiquetas IS NULL AND texto IS NULL AND detalle IS NULL
    ELSE false END)
);
COMMENT ON TABLE app.anamnesis_respuesta IS
  'Respuesta de una versión de la anamnesis, con copia del texto, sección, orden y tipo de la pregunta y de las etiquetas marcadas. Inmutable. Solo con ficha_clinica:ver (RLS).';

-- ---------------------------------------------------------------------------------------------
-- anamnesis_alerta (alerta médica derivada)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.anamnesis_alerta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  anamnesis_id uuid NOT NULL,
  paciente_id uuid NOT NULL,
  orden smallint NOT NULL CONSTRAINT anamnesis_alerta_orden_check CHECK (orden >= 0),
  pregunta_codigo text NOT NULL CONSTRAINT anamnesis_alerta_codigo_check
    CHECK (pregunta_codigo ~ '^[a-z0-9_]{2,40}$'),
  tipo text NOT NULL CONSTRAINT anamnesis_alerta_tipo_check CHECK (tipo IN ('alergia', 'condicion')),
  texto text NOT NULL CONSTRAINT anamnesis_alerta_texto_check CHECK (char_length(texto) BETWEEN 3 AND 500),
  gravedad text NOT NULL CONSTRAINT anamnesis_alerta_gravedad_check CHECK (gravedad IN ('alta', 'media')),
  grupo_alergia text CONSTRAINT anamnesis_alerta_grupo_alergia_check CHECK (grupo_alergia ~ '^[a-z_]{3,40}$'),
  vigente boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT anamnesis_alerta_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT anamnesis_alerta_orden_key UNIQUE (clinica_id, anamnesis_id, orden),
  CONSTRAINT anamnesis_alerta_anamnesis_fkey FOREIGN KEY (clinica_id, anamnesis_id, paciente_id)
    REFERENCES app.anamnesis (clinica_id, id, paciente_id)
);
COMMENT ON TABLE app.anamnesis_alerta IS
  'Alerta médica derivada de una versión de la anamnesis, calculada al guardar con las reglas del catálogo de ese momento. Las vigentes las ve toda la clínica; el resto, solo con ficha_clinica:ver.';
COMMENT ON COLUMN app.anamnesis_alerta.vigente IS
  'true solo en las alertas de la versión vigente. Lo único que cambia (true -> false al guardar una versión nueva).';

CREATE INDEX anamnesis_alerta_vigente_idx ON app.anamnesis_alerta (clinica_id, paciente_id, orden)
  WHERE vigente;

-- ---------------------------------------------------------------------------------------------
-- anamnesis_vigente (una fila por paciente con anamnesis)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.anamnesis_vigente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  paciente_id uuid NOT NULL,
  anamnesis_id uuid NOT NULL,
  version integer NOT NULL CONSTRAINT anamnesis_vigente_version_check CHECK (version >= 1),
  con_alerta boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT anamnesis_vigente_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT anamnesis_vigente_paciente_key UNIQUE (clinica_id, paciente_id),
  CONSTRAINT anamnesis_vigente_anamnesis_fkey FOREIGN KEY (clinica_id, anamnesis_id, paciente_id)
    REFERENCES app.anamnesis (clinica_id, id, paciente_id)
);
COMMENT ON TABLE app.anamnesis_vigente IS
  'Versión vigente de la anamnesis de cada paciente y si dejó alguna alerta médica (dato derivado, lo mantiene app.guardar_anamnesis). Para «Con alerta».';

-- ---------------------------------------------------------------------------------------------
-- Inmutabilidad
-- ---------------------------------------------------------------------------------------------
-- Por sentencia: rechaza también un UPDATE que no alcanzaría ninguna fila.
CREATE OR REPLACE FUNCTION app.rechazar_edicion_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_dueno_tablas oid;
BEGIN
  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  -- Solo una SESIÓN del dueño de las tablas (una corrección de datos de administración, que queda
  -- en auditoría). Una función SECURITY DEFINER llamada por app_api no cuenta.
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Una anamnesis firmada no se cambia: guardá una versión nueva (%.%).',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anamnesis_inmutable';
END
$$;
COMMENT ON FUNCTION app.rechazar_edicion_inmutable() IS
  'BEFORE UPDATE por sentencia de anamnesis y anamnesis_respuesta: rechaza todo cambio salvo en una sesión del dueño de las tablas.';

-- anamnesis_alerta: lo único que cambia es vigente, de true a false.
CREATE OR REPLACE FUNCTION app.proteger_alerta_derivada() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF app.sesion_del_dueno() THEN
    RETURN NEW;
  END IF;
  IF NEW.vigente AND NOT OLD.vigente THEN
    RAISE EXCEPTION 'Una alerta de una versión anterior no vuelve a estar vigente: guardá una versión nueva.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'anamnesis_inmutable';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_alerta_derivada() IS
  'BEFORE UPDATE de anamnesis_alerta: solo vigente true -> false (el resto lo fija app.fijar_auditoria_fila).';

CREATE TRIGGER anamnesis_auditoria_fila BEFORE INSERT OR UPDATE ON app.anamnesis
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'paciente_id', 'version', 'registrada_por', 'firmante_nombre', 'firmante_ci', 'es_tutor',
    'firma_archivo_id', 'declaracion_veracidad', 'presion_sistolica', 'presion_diastolica',
    'pulso', 'peso_kg');
CREATE TRIGGER anamnesis_proteger BEFORE INSERT OR UPDATE ON app.anamnesis
  FOR EACH ROW EXECUTE FUNCTION app.proteger_anamnesis();
CREATE TRIGGER anamnesis_validar BEFORE INSERT ON app.anamnesis
  FOR EACH ROW EXECUTE FUNCTION app.validar_anamnesis();
CREATE TRIGGER anamnesis_inmutable BEFORE UPDATE ON app.anamnesis
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_edicion_inmutable();
CREATE TRIGGER anamnesis_auditar AFTER INSERT OR UPDATE OR DELETE ON app.anamnesis
  FOR EACH ROW EXECUTE FUNCTION app.auditar('ficha_clinica');
CREATE TRIGGER anamnesis_sin_borrado BEFORE DELETE OR TRUNCATE ON app.anamnesis
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

CREATE TRIGGER anamnesis_respuesta_auditoria_fila BEFORE INSERT OR UPDATE ON app.anamnesis_respuesta
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'anamnesis_id', 'pregunta_codigo', 'seccion', 'orden', 'pregunta_texto', 'tipo', 'unidad',
    'respuesta_si', 'opciones', 'etiquetas', 'texto', 'numero', 'detalle');
CREATE TRIGGER anamnesis_respuesta_proteger BEFORE INSERT OR UPDATE ON app.anamnesis_respuesta
  FOR EACH ROW EXECUTE FUNCTION app.proteger_anamnesis();
CREATE TRIGGER anamnesis_respuesta_inmutable BEFORE UPDATE ON app.anamnesis_respuesta
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_edicion_inmutable();
CREATE TRIGGER anamnesis_respuesta_auditar AFTER INSERT OR UPDATE OR DELETE ON app.anamnesis_respuesta
  FOR EACH ROW EXECUTE FUNCTION app.auditar('ficha_clinica');
CREATE TRIGGER anamnesis_respuesta_sin_borrado BEFORE DELETE OR TRUNCATE ON app.anamnesis_respuesta
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

CREATE TRIGGER anamnesis_alerta_auditoria_fila BEFORE INSERT OR UPDATE ON app.anamnesis_alerta
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'anamnesis_id', 'paciente_id', 'orden', 'pregunta_codigo', 'tipo', 'texto', 'gravedad',
    'grupo_alergia');
CREATE TRIGGER anamnesis_alerta_proteger BEFORE INSERT OR UPDATE ON app.anamnesis_alerta
  FOR EACH ROW EXECUTE FUNCTION app.proteger_anamnesis();
CREATE TRIGGER anamnesis_alerta_solo_vigencia BEFORE UPDATE ON app.anamnesis_alerta
  FOR EACH ROW EXECUTE FUNCTION app.proteger_alerta_derivada();
CREATE TRIGGER anamnesis_alerta_sin_borrado BEFORE DELETE OR TRUNCATE ON app.anamnesis_alerta
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

CREATE TRIGGER anamnesis_vigente_auditoria_fila BEFORE INSERT OR UPDATE ON app.anamnesis_vigente
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('paciente_id');
CREATE TRIGGER anamnesis_vigente_proteger BEFORE INSERT OR UPDATE ON app.anamnesis_vigente
  FOR EACH ROW EXECUTE FUNCTION app.proteger_anamnesis();
CREATE TRIGGER anamnesis_vigente_sin_borrado BEFORE DELETE OR TRUNCATE ON app.anamnesis_vigente
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.anamnesis ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis FORCE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_respuesta ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_respuesta FORCE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_alerta ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_alerta FORCE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_vigente ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.anamnesis_vigente FORCE ROW LEVEL SECURITY;

CREATE POLICY anamnesis_aislamiento ON app.anamnesis
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY anamnesis_respuesta_aislamiento ON app.anamnesis_respuesta
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY anamnesis_alerta_aislamiento ON app.anamnesis_alerta
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY anamnesis_vigente_aislamiento ON app.anamnesis_vigente
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

-- (SELECT …): se evalúa una vez por consulta, no por fila.
CREATE POLICY anamnesis_ver ON app.anamnesis
  AS RESTRICTIVE
  FOR SELECT
  USING ((SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno()));
CREATE POLICY anamnesis_respuesta_ver ON app.anamnesis_respuesta
  AS RESTRICTIVE
  FOR SELECT
  USING ((SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno()));
CREATE POLICY anamnesis_alerta_ver ON app.anamnesis_alerta
  AS RESTRICTIVE
  FOR SELECT
  USING (vigente OR (SELECT app.tiene_permiso('ficha_clinica', 'ver')) OR (SELECT app.sesion_del_dueno()));

GRANT SELECT ON app.anamnesis TO app_api;
GRANT SELECT ON app.anamnesis_respuesta TO app_api;
GRANT SELECT ON app.anamnesis_alerta TO app_api;
GRANT SELECT ON app.anamnesis_vigente TO app_api;

-- ---------------------------------------------------------------------------------------------
-- archivo: la firma del paciente, solo con ficha_clinica:ver, y no se da de baja si está en uso
-- ---------------------------------------------------------------------------------------------
-- El worker (app_worker) lee los archivos que verifica con la clínica del trabajo y sin usuario:
-- pasa sin el permiso (solo tiene SELECT). Va antes en el OR: las demás funciones no se evalúan.
CREATE POLICY archivo_ficha_clinica_ver ON app.archivo
  AS RESTRICTIVE
  FOR SELECT
  USING (modulo IS DISTINCT FROM 'ficha_clinica' OR CURRENT_USER = 'app_worker'
         OR (SELECT app.sesion_del_dueno()) OR (SELECT app.tiene_permiso('ficha_clinica', 'ver')));
CREATE POLICY archivo_ficha_clinica_editar ON app.archivo
  AS RESTRICTIVE
  FOR UPDATE
  USING (modulo IS DISTINCT FROM 'ficha_clinica'
         OR (SELECT app.sesion_del_dueno()) OR (SELECT app.tiene_permiso('ficha_clinica', 'ver')))
  WITH CHECK (clinica_id = app.clinica_actual());
GRANT EXECUTE ON FUNCTION app.sesion_del_dueno() TO app_worker;
GRANT EXECUTE ON FUNCTION app.tiene_permiso(text, text) TO app_worker;

CREATE OR REPLACE FUNCTION app.proteger_firma_en_uso() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.categoria = 'firma_paciente'
     AND EXISTS (SELECT 1 FROM app.anamnesis a
                 WHERE a.clinica_id = OLD.clinica_id AND a.firma_archivo_id = OLD.id) THEN
    RAISE EXCEPTION 'Esa firma es parte de una anamnesis firmada: no se da de baja.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'archivo_firma_en_uso';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_firma_en_uso() IS
  'BEFORE UPDATE de archivo: la firma de una anamnesis no se da de baja (paciente_id, ruta y sha256 ya son fijos por archivo_auditoria_fila).';

-- Quien llega a la fila de una firma tiene ficha_clinica:ver (política de arriba) y ve las
-- anamnesis; una sesión del dueño también.
CREATE TRIGGER archivo_firma_en_uso BEFORE UPDATE ON app.archivo
  FOR EACH ROW EXECUTE FUNCTION app.proteger_firma_en_uso();

-- ---------------------------------------------------------------------------------------------
-- app.requiere_tutor y app.alertas_medicas
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.requiere_tutor(
  p_fecha_nac date,
  p_ahora timestamptz DEFAULT pg_catalog.now()
) RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT app.edad_en(p_fecha_nac, app.hoy_clinica(COALESCE(p_ahora, pg_catalog.now()))) < c.edad_tutor
     FROM app.clinica c WHERE c.id = app.clinica_actual()),
    false)
$$;
COMMENT ON FUNCTION app.requiere_tutor(date, timestamptz) IS
  'true si con esa fecha de nacimiento el paciente es menor de clinica.edad_tutor a la fecha de p_ahora en la zona de la clínica del contexto. false sin fecha de nacimiento.';

CREATE OR REPLACE FUNCTION app.alertas_medicas(p_paciente_id uuid, p_anamnesis_id uuid DEFAULT NULL)
  RETURNS TABLE (
    codigo text, tipo text, texto text, detalle text, gravedad text, grupo_alergia text, orden integer
  )
  LANGUAGE sql
  STABLE
BEGIN ATOMIC
  SELECT a.pregunta_codigo, a.tipo, a.texto,
         NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(r.detalle, '[.\s]+$', '')), ''),
         a.gravedad, a.grupo_alergia, a.orden::integer
  FROM app.anamnesis_alerta a
  -- El detalle es el de la respuesta: sin ficha_clinica:ver la fila no existe (RLS) y queda NULL.
  LEFT JOIN app.anamnesis_respuesta r
    ON r.clinica_id = a.clinica_id AND r.anamnesis_id = a.anamnesis_id
   AND r.pregunta_codigo = a.pregunta_codigo
  WHERE a.clinica_id = app.clinica_actual() AND a.paciente_id = p_paciente_id
    AND (CASE WHEN p_anamnesis_id IS NULL THEN a.vigente ELSE a.anamnesis_id = p_anamnesis_id END)
  ORDER BY a.orden;
END;
COMMENT ON FUNCTION app.alertas_medicas(uuid, uuid) IS
  'Alertas médicas derivadas del paciente (las vigentes, o las de la versión p_anamnesis_id), en orden. detalle solo con ficha_clinica:ver (NULL para los demás, por RLS).';

-- ---------------------------------------------------------------------------------------------
-- app.guardar_anamnesis
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.guardar_anamnesis(
  p_paciente_id uuid,
  p_version_base integer,
  p_huella_catalogo text,
  p_respuestas jsonb,
  p_firmante_nombre text,
  p_firmante_ci text,
  p_es_tutor boolean,
  p_firma_archivo_id uuid,
  p_declaracion_veracidad boolean,
  p_presion_sistolica integer DEFAULT NULL,
  p_presion_diastolica integer DEFAULT NULL,
  p_pulso integer DEFAULT NULL,
  p_peso_kg numeric DEFAULT NULL
) RETURNS TABLE (id uuid, version integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_sexo text;
  v_fecha_nac date;
  v_activo boolean;
  v_vigente integer;
  v_version integer;
  v_id uuid := gen_random_uuid();
  v_nombre text;
  v_ci text;
  v_es_tutor boolean := COALESCE(p_es_tutor, false);
  v_r jsonb;
  v_q app.anamnesis_pregunta%ROWTYPE;
  v_codigo text;
  v_campo text;
  v_codigos text[] := '{}'::text[];
  v_respondidas text[] := '{}'::text[];
  v_detalle text;
  v_texto text;
  v_numero numeric;
  v_si boolean;
  v_elegidas text[];
  v_opciones text[];
  v_etiquetas text[];
  v_desconocida text;
  v_lista jsonb;
  v_alertas jsonb := '[]'::jsonb;
  v_largo integer;
  v_omitir boolean;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de guardar la anamnesis.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app.sesion_del_dueno()
     AND NOT (app.tiene_permiso('ficha_clinica', 'crear') AND app.tiene_permiso('ficha_clinica', 'ver')) THEN
    RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para este cambio (ficha_clinica:crear y ficha_clinica:ver).'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'ficha_clinica_sin_permiso';
  END IF;

  -- 1. El cuestionario (compartido: un reemplazo espera, y este espera a uno en curso) y el
  --    paciente, bloqueados: dos guardados del mismo paciente se esperan.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('conecta:anamnesis_pregunta:' || v_clinica::text, 0));
  SELECT p.sexo, p.fecha_nac, p.activo INTO v_sexo, v_fecha_nac, v_activo
  FROM app.paciente p
  WHERE p.clinica_id = v_clinica AND p.id = p_paciente_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ningún paciente con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'paciente_no_encontrado';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El paciente está dado de baja: reactivalo antes de actualizar su anamnesis.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_paciente_inactivo';
  END IF;

  -- 2. Versión base contra la vigente.
  SELECT COALESCE(pg_catalog.max(a.version), 0) INTO v_vigente
  FROM app.anamnesis a WHERE a.clinica_id = v_clinica AND a.paciente_id = p_paciente_id;
  IF p_version_base IS DISTINCT FROM NULLIF(v_vigente, 0) THEN
    RAISE EXCEPTION 'Otra persona actualizó la anamnesis mientras la completabas (va por la versión %): abrila de nuevo y revisá los cambios.', v_vigente
      USING ERRCODE = 'serialization_failure', CONSTRAINT = 'anamnesis_conflicto_version',
            COLUMN = 'versionBase';
  END IF;
  v_version := v_vigente + 1;

  -- El cuestionario con el que se armó el formulario tiene que ser el de ahora.
  IF p_huella_catalogo IS DISTINCT FROM app.huella_catalogo() THEN
    RAISE EXCEPTION 'El cuestionario cambió mientras se completaba la anamnesis: abrilo de nuevo y revisá las respuestas.'
      USING ERRCODE = 'serialization_failure', CONSTRAINT = 'anamnesis_conflicto_catalogo',
            COLUMN = 'huellaCatalogo';
  END IF;

  -- 3. Firmante, firma, declaración y signos vitales.
  v_nombre := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_firmante_nombre, ''), '\s+', ' ', 'g'));
  IF pg_catalog.char_length(v_nombre) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Escribí el nombre de quien firma (3 a 120 letras).'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_firmante_nombre',
            COLUMN = 'firmante.nombre';
  END IF;
  v_ci := NULLIF(pg_catalog.regexp_replace(COALESCE(p_firmante_ci, ''), '[[:space:].-]', '', 'g'), '');
  IF v_ci ~ '^[0-9]+$' THEN
    v_ci := pg_catalog.regexp_replace(v_ci, '^0+(?=[0-9])', '');
  END IF;
  IF v_ci IS NOT NULL AND v_ci !~ '^[1-9][0-9]{4,8}$' THEN
    RAISE EXCEPTION 'La cédula de quien firma va con 5 a 9 números.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_firmante_ci',
            COLUMN = 'firmante.ci';
  END IF;
  IF app.requiere_tutor(v_fecha_nac) AND NOT v_es_tutor THEN
    RAISE EXCEPTION 'El paciente es menor de edad: tiene que firmar su tutor o tutora.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_tutor_requerido',
            COLUMN = 'firmante.esTutor';
  END IF;
  IF v_es_tutor AND v_ci IS NULL THEN
    RAISE EXCEPTION 'Escribí la cédula del tutor o tutora.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_tutor_sin_ci',
            COLUMN = 'firmante.ci';
  END IF;
  IF p_firma_archivo_id IS NULL THEN
    RAISE EXCEPTION 'Falta la firma.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_sin_firma', COLUMN = 'firmaPng';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM app.archivo f
       WHERE f.clinica_id = v_clinica AND f.id = p_firma_archivo_id
         AND f.categoria = 'firma_paciente' AND f.paciente_id = p_paciente_id AND f.deleted_at IS NULL)
     OR EXISTS (
       SELECT 1 FROM app.anamnesis a
       WHERE a.clinica_id = v_clinica AND a.firma_archivo_id = p_firma_archivo_id) THEN
    RAISE EXCEPTION 'La firma no es válida para esta anamnesis: firmá de nuevo.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_firma_invalida',
            COLUMN = 'firmaPng';
  END IF;
  IF p_declaracion_veracidad IS NOT TRUE THEN
    RAISE EXCEPTION 'Marcá «Declaro que la información es verdadera».'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_sin_declaracion',
            COLUMN = 'declaracionVeracidad';
  END IF;
  v_campo := CASE
    WHEN p_presion_sistolica NOT BETWEEN 50 AND 260 THEN 'signosVitales.presionSistolica'
    WHEN p_presion_diastolica NOT BETWEEN 30 AND 160 THEN 'signosVitales.presionDiastolica'
    WHEN p_pulso NOT BETWEEN 20 AND 250 THEN 'signosVitales.pulso'
    WHEN p_peso_kg NOT BETWEEN 1 AND 400 THEN 'signosVitales.pesoKg'
  END;
  IF v_campo IS NOT NULL THEN
    RAISE EXCEPTION 'Revisá los signos vitales: hay un valor fuera de rango.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_signos_vitales',
            COLUMN = v_campo;
  END IF;

  INSERT INTO app.anamnesis (id, clinica_id, paciente_id, version, firmante_nombre, firmante_ci,
                             es_tutor, firma_archivo_id, declaracion_veracidad, presion_sistolica,
                             presion_diastolica, pulso, peso_kg)
  VALUES (v_id, v_clinica, p_paciente_id, v_version, v_nombre, v_ci, v_es_tutor, p_firma_archivo_id,
          true, p_presion_sistolica, p_presion_diastolica, p_pulso, p_peso_kg);

  -- 4. Respuestas contra el catálogo vigente.
  IF p_respuestas IS NULL OR pg_catalog.jsonb_typeof(p_respuestas) = 'null' THEN
    p_respuestas := '[]'::jsonb;
  END IF;
  IF pg_catalog.jsonb_typeof(p_respuestas) <> 'array' OR pg_catalog.jsonb_array_length(p_respuestas) > 200 THEN
    RAISE EXCEPTION 'Las respuestas van en una lista de hasta 200.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
            COLUMN = 'respuestas';
  END IF;

  FOR v_r IN SELECT e FROM pg_catalog.jsonb_array_elements(p_respuestas) e LOOP
    IF pg_catalog.jsonb_typeof(v_r) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_r -> 'codigo') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Cada respuesta va con el código de su pregunta.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
              COLUMN = 'respuestas';
    END IF;
    v_codigo := v_r ->> 'codigo';
    v_campo := 'respuestas.' || v_codigo;
    IF v_codigo = ANY (v_codigos) THEN
      RAISE EXCEPTION 'La pregunta % está respondida dos veces.', v_codigo
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_repetida',
              COLUMN = v_campo;
    END IF;
    v_codigos := v_codigos || v_codigo;

    SELECT q.* INTO v_q FROM app.anamnesis_pregunta q
    WHERE q.clinica_id = v_clinica AND q.codigo = v_codigo AND q.activa;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La pregunta % no está en el cuestionario vigente: abrilo de nuevo.', v_codigo
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_pregunta_desconocida',
              COLUMN = v_campo;
    END IF;
    IF v_q.solo_sexo = 'F' AND v_sexo = 'M' THEN
      RAISE EXCEPTION 'La pregunta % no corresponde al sexo del paciente.', v_codigo
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_pregunta_no_aplica',
              COLUMN = v_campo;
    END IF;

    -- Claves: solo las del contrato; las de otro tipo, ausentes o null.
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_r) k
               WHERE k NOT IN ('codigo', 'si', 'opciones', 'texto', 'numero', 'detalle'))
       OR (v_q.tipo <> 'si_no' AND COALESCE(pg_catalog.jsonb_typeof(v_r -> 'si'), 'null') <> 'null')
       OR (v_q.tipo <> 'multiple' AND COALESCE(pg_catalog.jsonb_typeof(v_r -> 'opciones'), 'null') <> 'null')
       OR (v_q.tipo <> 'texto' AND COALESCE(pg_catalog.jsonb_typeof(v_r -> 'texto'), 'null') <> 'null')
       OR (v_q.tipo <> 'numero' AND COALESCE(pg_catalog.jsonb_typeof(v_r -> 'numero'), 'null') <> 'null')
       OR COALESCE(pg_catalog.jsonb_typeof(v_r -> 'detalle'), 'null') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'La respuesta a % no tiene la forma de una pregunta de tipo %.', v_codigo, v_q.tipo
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
              COLUMN = v_campo;
    END IF;
    v_detalle := NULLIF(pg_catalog.btrim(v_r ->> 'detalle'), '');
    IF v_detalle IS NOT NULL AND (NOT v_q.con_detalle OR pg_catalog.char_length(v_detalle) > 300) THEN
      RAISE EXCEPTION 'El detalle de % no corresponde o es demasiado largo (hasta 300).', v_codigo
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
              COLUMN = v_campo;
    END IF;

    v_si := NULL; v_opciones := NULL; v_etiquetas := NULL; v_texto := NULL; v_numero := NULL;
    v_omitir := false;
    v_lista := '[]'::jsonb;
    CASE v_q.tipo
      WHEN 'si_no' THEN
        IF pg_catalog.jsonb_typeof(v_r -> 'si') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'Respondé sí o no a %.', v_codigo
            USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
                  COLUMN = v_campo;
        END IF;
        v_si := (v_r ->> 'si')::boolean;
        IF v_si AND v_q.alerta_si IS NOT NULL THEN
          v_lista := pg_catalog.jsonb_build_array(v_q.alerta_si);
        END IF;
      WHEN 'multiple' THEN
        IF pg_catalog.jsonb_typeof(v_r -> 'opciones') IS DISTINCT FROM 'array'
           OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_r -> 'opciones') o
                      WHERE pg_catalog.jsonb_typeof(o) <> 'string')
           OR pg_catalog.jsonb_array_length(v_r -> 'opciones') > 30 THEN
          RAISE EXCEPTION 'Las opciones de % van en una lista.', v_codigo
            USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
                  COLUMN = v_campo;
        END IF;
        v_elegidas := ARRAY(SELECT pg_catalog.jsonb_array_elements_text(v_r -> 'opciones'));
        SELECT x INTO v_desconocida FROM pg_catalog.unnest(v_elegidas) x
        WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_q.opciones) o
                          WHERE o ->> 'valor' = x)
        LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION 'La opción % no existe en la pregunta %.', v_desconocida, v_codigo
            USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_opcion_desconocida',
                  COLUMN = v_campo;
        END IF;
        -- En el orden del catálogo, cada una una vez, con su etiqueta y su alerta.
        SELECT COALESCE(pg_catalog.array_agg(o ->> 'valor' ORDER BY n), '{}'::text[]),
               COALESCE(pg_catalog.array_agg(o ->> 'etiqueta' ORDER BY n), '{}'::text[]),
               COALESCE(pg_catalog.jsonb_agg(o -> 'alerta' ORDER BY n)
                          FILTER (WHERE pg_catalog.jsonb_typeof(o -> 'alerta') = 'object'), '[]'::jsonb)
          INTO v_opciones, v_etiquetas, v_lista
        FROM pg_catalog.jsonb_array_elements(v_q.opciones) WITH ORDINALITY AS t(o, n)
        WHERE (o ->> 'valor') = ANY (v_elegidas);
      WHEN 'texto' THEN
        IF pg_catalog.jsonb_typeof(v_r -> 'texto') IS DISTINCT FROM 'string'
           OR pg_catalog.char_length(pg_catalog.btrim(v_r ->> 'texto')) > 1000 THEN
          RAISE EXCEPTION 'La respuesta a % va en texto (hasta 1000).', v_codigo
            USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
                  COLUMN = v_campo;
        END IF;
        v_texto := NULLIF(pg_catalog.btrim(v_r ->> 'texto'), '');
        v_omitir := v_texto IS NULL;
      WHEN 'numero' THEN
        IF pg_catalog.jsonb_typeof(v_r -> 'numero') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'La respuesta a % va en número.', v_codigo
            USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_respuesta_invalida',
                  COLUMN = v_campo;
        END IF;
        v_numero := (v_r ->> 'numero')::numeric;
        IF v_numero < v_q.minimo OR v_numero > v_q.maximo THEN
          RAISE EXCEPTION 'La respuesta a % está fuera del rango aceptado.', v_codigo
            USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_numero_fuera_de_rango',
                  COLUMN = v_campo;
        END IF;
    END CASE;

    CONTINUE WHEN v_omitir;
    v_respondidas := v_respondidas || v_codigo;
    INSERT INTO app.anamnesis_respuesta
      (clinica_id, anamnesis_id, pregunta_codigo, seccion, orden, pregunta_texto, tipo, unidad,
       respuesta_si, opciones, etiquetas, texto, numero, detalle)
    VALUES (v_clinica, v_id, v_codigo, v_q.seccion, v_q.orden, v_q.texto, v_q.tipo,
            CASE WHEN v_q.tipo = 'numero' THEN v_q.unidad END,
            v_si, v_opciones, v_etiquetas, v_texto, v_numero,
            CASE WHEN v_q.tipo IN ('si_no', 'multiple') THEN v_detalle END);

    -- Alertas de esta pregunta (reglas del catálogo de este momento). El detalle NO se copia:
    -- queda en la respuesta (ver app.alertas_medicas).
    v_largo := pg_catalog.jsonb_array_length(v_lista);
    IF v_largo > 0 THEN
      v_alertas := v_alertas || (
        SELECT pg_catalog.jsonb_agg(a || pg_catalog.jsonb_build_object(
                 'codigo', v_codigo, 'seccion', v_q.seccion, 'ordenPregunta', v_q.orden, 'n', n)
                 ORDER BY n)
        FROM pg_catalog.jsonb_array_elements(v_lista) WITH ORDINALITY AS t(a, n));
    END IF;
  END LOOP;

  -- Obligatorias (las que aplican al sexo del paciente).
  SELECT q.codigo INTO v_codigo FROM app.anamnesis_pregunta q
  WHERE q.clinica_id = v_clinica AND q.activa AND q.obligatoria
    AND NOT (q.solo_sexo = 'F' AND v_sexo IS NOT DISTINCT FROM 'M')
    AND NOT (q.codigo = ANY (v_respondidas))
  ORDER BY q.seccion, q.orden, q.codigo
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Falta responder la pregunta %.', v_codigo
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_obligatoria_sin_responder',
            COLUMN = 'respuestas.' || v_codigo;
  END IF;

  -- 5. Alerta médica: la de esta versión pasa a ser la vigente.
  UPDATE app.anamnesis_alerta a SET vigente = false
  WHERE a.clinica_id = v_clinica AND a.paciente_id = p_paciente_id AND a.vigente;
  INSERT INTO app.anamnesis_alerta
    (clinica_id, anamnesis_id, paciente_id, orden, pregunta_codigo, tipo, texto, gravedad, grupo_alergia)
  SELECT v_clinica, v_id, p_paciente_id,
         (pg_catalog.row_number() OVER (ORDER BY (e ->> 'seccion')::integer, (e ->> 'ordenPregunta')::integer,
                                                 e ->> 'codigo', (e ->> 'n')::integer) - 1)::smallint,
         e ->> 'codigo', e ->> 'tipo', e ->> 'texto', e ->> 'gravedad', e ->> 'grupoAlergia'
  FROM pg_catalog.jsonb_array_elements(v_alertas) e;
  INSERT INTO app.anamnesis_vigente AS v (clinica_id, paciente_id, anamnesis_id, version, con_alerta)
  VALUES (v_clinica, p_paciente_id, v_id, v_version, pg_catalog.jsonb_array_length(v_alertas) > 0)
  ON CONFLICT (clinica_id, paciente_id) DO UPDATE
    SET anamnesis_id = EXCLUDED.anamnesis_id, version = EXCLUDED.version,
        con_alerta = EXCLUDED.con_alerta;

  RETURN QUERY SELECT v_id, v_version;
EXCEPTION
  WHEN unique_violation THEN
    -- Con REPEATABLE READ, el segundo de dos guardados simultáneos llega acá.
    DECLARE
      v_restriccion text;
    BEGIN
      GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
      IF v_restriccion = 'anamnesis_version_key' THEN
        RAISE EXCEPTION 'Otra persona actualizó la anamnesis mientras la completabas: abrila de nuevo y revisá los cambios.'
          USING ERRCODE = 'serialization_failure', CONSTRAINT = 'anamnesis_conflicto_version',
                COLUMN = 'versionBase';
      ELSIF v_restriccion = 'anamnesis_firma_key' THEN
        RAISE EXCEPTION 'La firma no es válida para esta anamnesis: firmá de nuevo.'
          USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'anamnesis_firma_invalida',
                COLUMN = 'firmaPng';
      END IF;
      RAISE;
    END;
END
$$;
COMMENT ON FUNCTION app.guardar_anamnesis(uuid, integer, text, jsonb, text, text, boolean, uuid, boolean, integer, integer, integer, numeric) IS
  'Guarda la versión siguiente de la anamnesis del paciente (ver 0029): valida contra el catálogo vigente, exige tutor según la edad en la zona de la clínica, compara versionBase, copia los textos y calcula la alerta médica. Exige ficha_clinica:crear y ver. Devuelve (id, version).';

GRANT EXECUTE ON FUNCTION app.requiere_tutor(date, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.alertas_medicas(uuid, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION app.guardar_anamnesis(uuid, integer, text, jsonb, text, text, boolean, uuid, boolean, integer, integer, integer, numeric) TO app_api;

CALL app.asegurar_permisos();
