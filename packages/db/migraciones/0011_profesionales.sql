-- 0011_profesionales: profesional, profesional_disponibilidad y profesional_bloqueo (módulo personal).
--
--   * profesional: quien atiende y aparece en la agenda. membresia_id es opcional (un especialista
--     que viene una vez por mes puede no tener usuario); si está, es de la misma clínica (FK
--     compuesta) y una membresía tiene a lo sumo un profesional (única (clinica_id, membresia_id); los
--     NULL no chocan). Nunca se borra: se desactiva (activo = false).
--   * profesional_disponibilidad: tramo semanal en una sede. 0 = domingo … 6 = sábado. El sillón es
--     opcional y tiene que ser de ESA sede: FK (clinica_id, sede_id, sillon_id) -> sillon. Un tramo no
--     se edita: se desactiva y se crea otro (reemplazar la disponibilidad = desactivar los activos e
--     insertar los nuevos, en una transacción).
--     Restricción de exclusión profesional_disponibilidad_superpuesta (btree_gist): un profesional no
--     tiene dos tramos ACTIVOS que se pisen el mismo día de la semana, aunque sean en sedes distintas
--     (una persona no está en dos lugares). Rangos [inicio, fin): 08-12 y 12-14 no se pisan. Con dos
--     transacciones simultáneas, la segunda espera a la primera y falla con 23P01 si se pisan.
--     Que el tramo caiga dentro del horario de la sede lo valida la API (el horario puede cambiar).
--   * profesional_bloqueo: vacaciones, congresos. desde < hasta. Se da de baja con deleted_at y
--     motivo_baja; no se edita.
--
-- btree_gist se instala en el schema extensions (el de Supabase; se crea si no existe). Es «trusted»:
-- no hace falta superusuario. Si ya estaba instalada en otro schema, se usa esa.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Para la FK compuesta tramo -> sillón de esa sede.
ALTER TABLE app.sillon ADD CONSTRAINT sillon_clinica_sede_id_key UNIQUE (clinica_id, sede_id, id);

-- ---------------------------------------------------------------------------------------------
-- profesional
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.profesional (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  membresia_id uuid,
  nombre text NOT NULL CONSTRAINT profesional_nombre_check CHECK (btrim(nombre) <> ''),
  especialidad text,
  color text NOT NULL CONSTRAINT profesional_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  registro_prof text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT profesional_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT profesional_membresia_key UNIQUE (clinica_id, membresia_id),
  CONSTRAINT profesional_membresia_fkey FOREIGN KEY (clinica_id, membresia_id)
    REFERENCES app.membresia (clinica_id, id)
);
COMMENT ON TABLE app.profesional IS
  'Quien atiende pacientes y aparece en la agenda. Con o sin membresía (a lo sumo un profesional por membresía). Se desactiva, no se borra.';
COMMENT ON COLUMN app.profesional.registro_prof IS 'Registro profesional: sale en recetas y consentimientos.';

CREATE TRIGGER profesional_auditoria_fila BEFORE INSERT OR UPDATE ON app.profesional
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();
CREATE TRIGGER profesional_auditar AFTER INSERT OR UPDATE OR DELETE ON app.profesional
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal');
CREATE TRIGGER profesional_sin_borrado BEFORE DELETE OR TRUNCATE ON app.profesional
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- profesional_disponibilidad
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.profesional_disponibilidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  profesional_id uuid NOT NULL,
  sede_id uuid NOT NULL,
  -- 0 = domingo … 6 = sábado (igual que extract(dow) y Date.getDay()).
  dia_semana smallint NOT NULL
    CONSTRAINT profesional_disponibilidad_dia_check CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  sillon_id uuid,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT profesional_disponibilidad_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT profesional_disponibilidad_rango_check CHECK (hora_fin > hora_inicio),
  CONSTRAINT profesional_disponibilidad_profesional_fkey FOREIGN KEY (clinica_id, profesional_id)
    REFERENCES app.profesional (clinica_id, id),
  CONSTRAINT profesional_disponibilidad_sede_fkey FOREIGN KEY (clinica_id, sede_id)
    REFERENCES app.sede (clinica_id, id),
  -- Sillón de esa misma sede (si sillon_id es NULL, no se controla).
  CONSTRAINT profesional_disponibilidad_sillon_fkey FOREIGN KEY (clinica_id, sede_id, sillon_id)
    REFERENCES app.sillon (clinica_id, sede_id, id),
  CONSTRAINT profesional_disponibilidad_superpuesta EXCLUDE USING gist (
    clinica_id WITH =,
    profesional_id WITH =,
    dia_semana WITH =,
    tsrange(DATE '2000-01-01' + hora_inicio, DATE '2000-01-01' + hora_fin) WITH &&
  ) WHERE (activo)
);
COMMENT ON TABLE app.profesional_disponibilidad IS
  'Tramos semanales de atención por sede. Sin superposición de tramos activos del mismo profesional el mismo día (en cualquier sede). No se editan: se desactivan.';
COMMENT ON COLUMN app.profesional_disponibilidad.dia_semana IS '0 = domingo … 6 = sábado.';
CREATE INDEX profesional_disponibilidad_sede_idx
  ON app.profesional_disponibilidad (clinica_id, sede_id, dia_semana) WHERE activo;

CREATE TRIGGER profesional_disponibilidad_auditoria_fila
  BEFORE INSERT OR UPDATE ON app.profesional_disponibilidad
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'profesional_id', 'sede_id', 'dia_semana', 'hora_inicio', 'hora_fin', 'sillon_id');
CREATE TRIGGER profesional_disponibilidad_auditar
  AFTER INSERT OR UPDATE OR DELETE ON app.profesional_disponibilidad
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal');
CREATE TRIGGER profesional_disponibilidad_sin_borrado
  BEFORE DELETE OR TRUNCATE ON app.profesional_disponibilidad
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- profesional_bloqueo
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.profesional_bloqueo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  profesional_id uuid NOT NULL,
  desde timestamptz NOT NULL,
  hasta timestamptz NOT NULL,
  motivo text NOT NULL CONSTRAINT profesional_bloqueo_motivo_check CHECK (btrim(motivo) <> ''),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app.usuario (id),
  motivo_baja text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT profesional_bloqueo_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT profesional_bloqueo_rango_check CHECK (hasta > desde),
  CONSTRAINT profesional_bloqueo_baja_check CHECK (
    deleted_at IS NULL OR btrim(coalesce(motivo_baja, '')) <> ''),
  CONSTRAINT profesional_bloqueo_profesional_fkey FOREIGN KEY (clinica_id, profesional_id)
    REFERENCES app.profesional (clinica_id, id)
);
COMMENT ON TABLE app.profesional_bloqueo IS
  'Bloqueos de agenda de un profesional (vacaciones, congresos). No se editan: se dan de baja con motivo.';
CREATE INDEX profesional_bloqueo_profesional_idx
  ON app.profesional_bloqueo (clinica_id, profesional_id, hasta) WHERE deleted_at IS NULL;

CREATE TRIGGER profesional_bloqueo_auditoria_fila BEFORE INSERT OR UPDATE ON app.profesional_bloqueo
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('profesional_id', 'desde', 'hasta', 'motivo');
CREATE TRIGGER profesional_bloqueo_auditar AFTER INSERT OR UPDATE OR DELETE ON app.profesional_bloqueo
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal');
CREATE TRIGGER profesional_bloqueo_sin_borrado BEFORE DELETE OR TRUNCATE ON app.profesional_bloqueo
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.profesional ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profesional FORCE ROW LEVEL SECURITY;
ALTER TABLE app.profesional_disponibilidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profesional_disponibilidad FORCE ROW LEVEL SECURITY;
ALTER TABLE app.profesional_bloqueo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profesional_bloqueo FORCE ROW LEVEL SECURITY;

CREATE POLICY profesional_aislamiento ON app.profesional
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY profesional_disponibilidad_aislamiento ON app.profesional_disponibilidad
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY profesional_bloqueo_aislamiento ON app.profesional_bloqueo
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT, INSERT, UPDATE ON app.profesional TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.profesional_disponibilidad TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.profesional_bloqueo TO app_api;

CALL app.asegurar_permisos();
