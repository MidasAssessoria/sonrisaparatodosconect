-- 0012_catalogos: catálogo de tratamientos (módulo configuracion) y configuración de agenda por sede
-- (módulo sedes).
--
--   * tratamiento: precio en guaraníes enteros (bigint, IVA incluido, >= 0), iva 10/5/0 (TASAS_IVA de
--     @conecta/shared), duracion_min múltiplo de 5 entre 5 y 480. Se desactiva, no se borra.
--     Cambiar un precio no toca nada ya emitido: los presupuestos copiarán nombre, precio e IVA.
--     Nombre único entre los ACTIVOS de la clínica sin distinguir mayúsculas, tildes ni espacios de
--     más. Decisión: sin la extensión unaccent. unaccent() no es IMMUTABLE (depende de un
--     diccionario que se puede cambiar) y un índice sobre una envoltura «inmutable» se corrompería si
--     el diccionario cambia. La normalización es una expresión fija (lower + translate de las vocales
--     con tilde, diéresis o acento grave + espacios colapsados). La ñ se conserva: es otra letra
--     («año» y «ano» son nombres distintos).
--   * agenda_config: una fila por sede (única (clinica_id, sede_id)); anticipacion_min 0..2880,
--     dias_adelante 1..90, reserva_online_activa. Sin fila, la API usa 120 / 14 / apagada. Se
--     reemplaza con INSERT … ON CONFLICT (clinica_id, sede_id) DO UPDATE. No tiene baja: es la
--     configuración de una sede que existe.

-- ---------------------------------------------------------------------------------------------
-- tratamiento
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.tratamiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  nombre text NOT NULL CONSTRAINT tratamiento_nombre_check CHECK (btrim(nombre) <> ''),
  categoria text,
  precio bigint NOT NULL CONSTRAINT tratamiento_precio_check CHECK (precio >= 0),
  iva smallint NOT NULL DEFAULT 10 CONSTRAINT tratamiento_iva_check CHECK (iva IN (10, 5, 0)),
  duracion_min smallint NOT NULL DEFAULT 30
    CONSTRAINT tratamiento_duracion_check CHECK (duracion_min BETWEEN 5 AND 480 AND duracion_min % 5 = 0),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT tratamiento_clinica_id_id_key UNIQUE (clinica_id, id)
);
COMMENT ON TABLE app.tratamiento IS
  'Catálogo de tratamientos de la clínica. Precio en guaraníes enteros con IVA incluido. Se desactiva, no se borra.';
COMMENT ON COLUMN app.tratamiento.precio IS 'Guaraníes enteros, IVA incluido.';
COMMENT ON COLUMN app.tratamiento.iva IS 'Tasa de IVA: 10, 5 o 0 (exento).';

-- Nombre único entre los activos: sin distinguir mayúsculas, tildes (á é í ó ú, ü, à…) ni espacios.
CREATE UNIQUE INDEX tratamiento_nombre_unico ON app.tratamiento (
  clinica_id,
  lower(translate(
    regexp_replace(btrim(nombre), '\s+', ' ', 'g'),
    'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüû',
    'AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuu'))
) WHERE activo;
CREATE INDEX tratamiento_activo_idx ON app.tratamiento (clinica_id, nombre) WHERE activo;

CREATE TRIGGER tratamiento_auditoria_fila BEFORE INSERT OR UPDATE ON app.tratamiento
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();
CREATE TRIGGER tratamiento_auditar AFTER INSERT OR UPDATE OR DELETE ON app.tratamiento
  FOR EACH ROW EXECUTE FUNCTION app.auditar('configuracion');
CREATE TRIGGER tratamiento_sin_borrado BEFORE DELETE OR TRUNCATE ON app.tratamiento
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- agenda_config
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.agenda_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  sede_id uuid NOT NULL,
  anticipacion_min integer NOT NULL DEFAULT 120
    CONSTRAINT agenda_config_anticipacion_check CHECK (anticipacion_min BETWEEN 0 AND 2880),
  dias_adelante integer NOT NULL DEFAULT 14
    CONSTRAINT agenda_config_dias_adelante_check CHECK (dias_adelante BETWEEN 1 AND 90),
  reserva_online_activa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT agenda_config_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT agenda_config_sede_key UNIQUE (clinica_id, sede_id),
  CONSTRAINT agenda_config_sede_fkey FOREIGN KEY (clinica_id, sede_id) REFERENCES app.sede (clinica_id, id)
);
COMMENT ON TABLE app.agenda_config IS
  'Configuración de agenda y reserva online de una sede (una fila por sede; sin fila valen 120 min, 14 días, reserva apagada).';
COMMENT ON COLUMN app.agenda_config.anticipacion_min IS 'No se reserva online para dentro de menos de estos minutos.';
COMMENT ON COLUMN app.agenda_config.dias_adelante IS 'Hasta cuántos días adelante se puede reservar online.';

CREATE TRIGGER agenda_config_auditoria_fila BEFORE INSERT OR UPDATE ON app.agenda_config
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('sede_id');
CREATE TRIGGER agenda_config_auditar AFTER INSERT OR UPDATE OR DELETE ON app.agenda_config
  FOR EACH ROW EXECUTE FUNCTION app.auditar('sedes');
CREATE TRIGGER agenda_config_sin_borrado BEFORE DELETE OR TRUNCATE ON app.agenda_config
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.tratamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tratamiento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.agenda_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agenda_config FORCE ROW LEVEL SECURITY;

CREATE POLICY tratamiento_aislamiento ON app.tratamiento
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY agenda_config_aislamiento ON app.agenda_config
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT, INSERT, UPDATE ON app.tratamiento TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.agenda_config TO app_api;

CALL app.asegurar_permisos();
