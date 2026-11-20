-- 0003_organizacion: clínica, sedes, sillones, usuarios, membresías, roles y permisos.
--
-- Convenciones (docs/plan.md §4.1 y CLAUDE.md):
--   * id uuid; clinica_id NOT NULL en toda tabla de negocio; UNIQUE (clinica_id, id) y FK compuestas
--     (clinica_id, x_id) para que una fila no pueda apuntar a otra clínica.
--   * created_at/created_by/updated_at/updated_by los fija app.fijar_auditoria_fila(); id y
--     clinica_id son inmutables, y cada trigger declara además sus columnas inmutables.
--   * Baja lógica: deleted_at/deleted_by/motivo_baja en datos editables (sede); activo en catálogos y
--     vínculos (sillon, sede_horario, rol, rol_permiso, usuario_sede); membresia usa su estado.
--   * Nada se borra: app_api no tiene DELETE y un trigger rechaza DELETE/TRUNCATE para todos.
--   * RLS habilitado y forzado. Las políticas son para todos los roles (no solo app_api): el dueño de
--     las tablas también necesita contexto, por eso las funciones de administración lo fijan.

-- ---------------------------------------------------------------------------------------------
-- usuario: identidad global (sin clinica_id). id = id del usuario en Supabase Auth.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.usuario (
  id uuid PRIMARY KEY,
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  email text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  telefono text,
  mfa_activo boolean NOT NULL DEFAULT false,
  ultimo_acceso timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id)
);
COMMENT ON TABLE app.usuario IS
  'Identidad global: una persona, una fila, aunque trabaje en varias clínicas (ver membresia). id = id de Supabase Auth, sin valor por defecto.';
CREATE UNIQUE INDEX usuario_email_unico ON app.usuario (lower(email));

CREATE TRIGGER usuario_auditoria_fila BEFORE INSERT OR UPDATE ON app.usuario
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();
-- ultimo_acceso cambia en cada ingreso: no genera fila de auditoría por sí solo.
CREATE TRIGGER usuario_auditar AFTER INSERT OR UPDATE OR DELETE ON app.usuario
  FOR EACH ROW EXECUTE FUNCTION app.auditar('ultimo_acceso');
CREATE TRIGGER usuario_sin_borrado BEFORE DELETE OR TRUNCATE ON app.usuario
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- clinica: raíz del tenant.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.clinica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  razon_social text,
  ruc text,
  zona_horaria text NOT NULL DEFAULT 'America/Asuncion' CHECK (btrim(zona_horaria) <> ''),
  edad_pediatrica smallint NOT NULL DEFAULT 12 CHECK (edad_pediatrica BETWEEN 0 AND 21),
  edad_tutor smallint NOT NULL DEFAULT 18 CHECK (edad_tutor BETWEEN 0 AND 21),
  tope_descuento_pct smallint NOT NULL DEFAULT 50 CHECK (tope_descuento_pct BETWEEN 0 AND 100),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id)
);
COMMENT ON TABLE app.clinica IS
  'Raíz del tenant. Se crea solo con app.alta_clinica(): app_api no tiene INSERT.';

CREATE TRIGGER clinica_auditoria_fila BEFORE INSERT OR UPDATE ON app.clinica
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();
CREATE TRIGGER clinica_auditar AFTER INSERT OR UPDATE OR DELETE ON app.clinica
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER clinica_sin_borrado BEFORE DELETE OR TRUNCATE ON app.clinica
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- sede, sede_horario, sillon
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.sede (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  direccion text,
  telefono text,
  estado text NOT NULL DEFAULT 'abierta'
    CONSTRAINT sede_estado_check CHECK (estado IN ('abierta', 'proxima', 'cerrada')),
  color text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app.usuario (id),
  motivo_baja text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT sede_clinica_id_id_key UNIQUE (clinica_id, id)
);
COMMENT ON TABLE app.sede IS 'Sedes de la clínica. No se borran: se dan de baja con deleted_at.';
CREATE UNIQUE INDEX sede_nombre_unico ON app.sede (clinica_id, lower(nombre)) WHERE deleted_at IS NULL;

CREATE TRIGGER sede_auditoria_fila BEFORE INSERT OR UPDATE ON app.sede
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();
CREATE TRIGGER sede_auditar AFTER INSERT OR UPDATE OR DELETE ON app.sede
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER sede_sin_borrado BEFORE DELETE OR TRUNCATE ON app.sede
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

CREATE TABLE app.sede_horario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  sede_id uuid NOT NULL,
  -- 0 = domingo … 6 = sábado (igual que extract(dow) y Date.getDay()).
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  intervalo_min smallint NOT NULL DEFAULT 30 CHECK (intervalo_min BETWEEN 5 AND 240),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT sede_horario_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT sede_horario_rango_check CHECK (hora_fin > hora_inicio),
  CONSTRAINT sede_horario_sede_fkey FOREIGN KEY (clinica_id, sede_id)
    REFERENCES app.sede (clinica_id, id)
);
COMMENT ON COLUMN app.sede_horario.dia_semana IS '0 = domingo … 6 = sábado.';
CREATE INDEX sede_horario_sede_idx ON app.sede_horario (clinica_id, sede_id, dia_semana);

CREATE TRIGGER sede_horario_auditoria_fila BEFORE INSERT OR UPDATE ON app.sede_horario
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('sede_id');
CREATE TRIGGER sede_horario_auditar AFTER INSERT OR UPDATE OR DELETE ON app.sede_horario
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER sede_horario_sin_borrado BEFORE DELETE OR TRUNCATE ON app.sede_horario
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

CREATE TABLE app.sillon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  sede_id uuid NOT NULL,
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT sillon_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT sillon_sede_fkey FOREIGN KEY (clinica_id, sede_id) REFERENCES app.sede (clinica_id, id)
);
CREATE UNIQUE INDEX sillon_nombre_unico ON app.sillon (clinica_id, sede_id, lower(nombre)) WHERE activo;

CREATE TRIGGER sillon_auditoria_fila BEFORE INSERT OR UPDATE ON app.sillon
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('sede_id');
CREATE TRIGGER sillon_auditar AFTER INSERT OR UPDATE OR DELETE ON app.sillon
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER sillon_sin_borrado BEFORE DELETE OR TRUNCATE ON app.sillon
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- rol y rol_permiso (por clínica)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.rol (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  nombre text NOT NULL CHECK (btrim(nombre) <> ''),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z][a-z0-9_]{1,39}$'),
  es_sistema boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT rol_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT rol_codigo_key UNIQUE (clinica_id, codigo)
);
COMMENT ON TABLE app.rol IS
  'Roles por clínica. Los 5 de sistema (dueno, administracion, odontologo, asistente, recepcion) los crea app.alta_clinica().';

CREATE TRIGGER rol_auditoria_fila BEFORE INSERT OR UPDATE ON app.rol
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('codigo', 'es_sistema');
CREATE TRIGGER rol_auditar AFTER INSERT OR UPDATE OR DELETE ON app.rol
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER rol_sin_borrado BEFORE DELETE OR TRUNCATE ON app.rol
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- Los valores de modulo y accion son los de packages/shared/src/permisos.ts (MODULOS y ACCIONES).
-- Una prueba verifica que los CHECK coincidan exactamente: agregar un módulo en shared exige una
-- migración que reemplace rol_permiso_modulo_check (y que otorgue el permiso nuevo a los roles).
CREATE TABLE app.rol_permiso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  rol_id uuid NOT NULL,
  modulo text NOT NULL
    CONSTRAINT rol_permiso_modulo_check CHECK (modulo IN (
      'inicio', 'agenda', 'pacientes', 'ficha_clinica', 'presupuestos', 'caja', 'contabilidad',
      'reportes', 'personal', 'inventario', 'mensajeria', 'sedes', 'auditoria', 'configuracion')),
  accion text NOT NULL
    CONSTRAINT rol_permiso_accion_check CHECK (accion IN ('ver', 'crear', 'editar', 'anular', 'exportar')),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT rol_permiso_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT rol_permiso_unico UNIQUE (rol_id, modulo, accion),
  CONSTRAINT rol_permiso_rol_fkey FOREIGN KEY (clinica_id, rol_id) REFERENCES app.rol (clinica_id, id)
);
COMMENT ON TABLE app.rol_permiso IS
  'Permiso módulo + acción de un rol. Se revoca con activo = false (no se borra).';

CREATE TRIGGER rol_permiso_auditoria_fila BEFORE INSERT OR UPDATE ON app.rol_permiso
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('rol_id', 'modulo', 'accion');
CREATE TRIGGER rol_permiso_auditar AFTER INSERT OR UPDATE OR DELETE ON app.rol_permiso
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER rol_permiso_sin_borrado BEFORE DELETE OR TRUNCATE ON app.rol_permiso
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- membresia (usuario <-> clínica, con rol) y usuario_sede (sedes que puede ver)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.membresia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  usuario_id uuid NOT NULL REFERENCES app.usuario (id),
  rol_id uuid NOT NULL,
  sede_defecto_id uuid,
  estado text NOT NULL DEFAULT 'pendiente'
    CONSTRAINT membresia_estado_check CHECK (estado IN ('pendiente', 'activo', 'inactivo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT membresia_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT membresia_usuario_clinica_key UNIQUE (usuario_id, clinica_id),
  CONSTRAINT membresia_rol_fkey FOREIGN KEY (clinica_id, rol_id) REFERENCES app.rol (clinica_id, id),
  CONSTRAINT membresia_sede_defecto_fkey FOREIGN KEY (clinica_id, sede_defecto_id)
    REFERENCES app.sede (clinica_id, id)
);
COMMENT ON TABLE app.membresia IS
  'Pertenencia de un usuario a una clínica con un rol. Desactivar = estado inactivo (no se borra).';

CREATE TRIGGER membresia_auditoria_fila BEFORE INSERT OR UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('usuario_id');
CREATE TRIGGER membresia_auditar AFTER INSERT OR UPDATE OR DELETE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER membresia_sin_borrado BEFORE DELETE OR TRUNCATE ON app.membresia
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

CREATE TABLE app.usuario_sede (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  membresia_id uuid NOT NULL,
  sede_id uuid NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT usuario_sede_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT usuario_sede_unico UNIQUE (membresia_id, sede_id),
  CONSTRAINT usuario_sede_membresia_fkey FOREIGN KEY (clinica_id, membresia_id)
    REFERENCES app.membresia (clinica_id, id),
  CONSTRAINT usuario_sede_sede_fkey FOREIGN KEY (clinica_id, sede_id) REFERENCES app.sede (clinica_id, id)
);
COMMENT ON TABLE app.usuario_sede IS 'Sedes que puede ver una membresía. Se quita con activo = false.';
CREATE INDEX usuario_sede_sede_idx ON app.usuario_sede (clinica_id, sede_id);

CREATE TRIGGER usuario_sede_auditoria_fila BEFORE INSERT OR UPDATE ON app.usuario_sede
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('membresia_id', 'sede_id');
CREATE TRIGGER usuario_sede_auditar AFTER INSERT OR UPDATE OR DELETE ON app.usuario_sede
  FOR EACH ROW EXECUTE FUNCTION app.auditar();
CREATE TRIGGER usuario_sede_sin_borrado BEFORE DELETE OR TRUNCATE ON app.usuario_sede
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

-- ---------------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------------
-- Dependencias entre políticas (sin ciclos, así no hay recursión):
--   usuario  -> membresia (subconsulta)     clinica -> membresia (subconsulta)
--   membresia -> solo funciones de contexto
ALTER TABLE app.usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usuario FORCE ROW LEVEL SECURITY;
ALTER TABLE app.clinica ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinica FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sede ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sede FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sede_horario ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sede_horario FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sillon ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sillon FORCE ROW LEVEL SECURITY;
ALTER TABLE app.rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rol FORCE ROW LEVEL SECURITY;
ALTER TABLE app.rol_permiso ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rol_permiso FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membresia ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membresia FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_sede ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_sede FORCE ROW LEVEL SECURITY;

-- usuario: se ve la fila propia y las de quienes tienen membresía (en cualquier estado) en la
-- clínica del contexto; solo se edita la propia. El alta es por función privilegiada
-- (app.alta_clinica; las invitaciones llegan en el Sprint 2): app_api no tiene INSERT, y la política
-- solo deja insertar la identidad del propio contexto.
CREATE POLICY usuario_ver ON app.usuario
  FOR SELECT
  USING (
    id = app.usuario_actual()
    OR EXISTS (
      SELECT 1 FROM app.membresia m
      WHERE m.usuario_id = usuario.id AND m.clinica_id = app.clinica_actual()
    )
  );
CREATE POLICY usuario_insertar ON app.usuario
  FOR INSERT
  WITH CHECK (id = app.usuario_actual());
CREATE POLICY usuario_editar ON app.usuario
  FOR UPDATE
  USING (id = app.usuario_actual())
  WITH CHECK (id = app.usuario_actual());

-- clinica: se ve la del contexto y las que tienen una membresía activa del usuario (para «mis
-- clínicas» en el login). Solo se edita la del contexto. El INSERT lo usa app.alta_clinica() (que
-- fija el contexto a la clínica nueva); app_api no tiene el privilegio.
CREATE POLICY clinica_ver ON app.clinica
  FOR SELECT
  USING (
    id = app.clinica_actual()
    OR EXISTS (
      SELECT 1 FROM app.membresia m
      WHERE m.clinica_id = clinica.id AND m.usuario_id = app.usuario_actual() AND m.estado = 'activo'
    )
  );
CREATE POLICY clinica_insertar ON app.clinica
  FOR INSERT
  WITH CHECK (id = app.clinica_actual());
CREATE POLICY clinica_editar ON app.clinica
  FOR UPDATE
  USING (id = app.clinica_actual())
  WITH CHECK (id = app.clinica_actual());

-- membresia: se ven las propias (de cualquier clínica, para listar «mis clínicas» antes de elegir
-- contexto) y las de la clínica del contexto; solo se escriben las de la clínica del contexto.
CREATE POLICY membresia_ver ON app.membresia
  FOR SELECT
  USING (usuario_id = app.usuario_actual() OR clinica_id = app.clinica_actual());
CREATE POLICY membresia_insertar ON app.membresia
  FOR INSERT
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY membresia_editar ON app.membresia
  FOR UPDATE
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

-- Tablas de negocio: todo acotado a la clínica del contexto.
CREATE POLICY sede_aislamiento ON app.sede
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY sede_horario_aislamiento ON app.sede_horario
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY sillon_aislamiento ON app.sillon
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY rol_aislamiento ON app.rol
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY rol_permiso_aislamiento ON app.rol_permiso
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
CREATE POLICY usuario_sede_aislamiento ON app.usuario_sede
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

-- ---------------------------------------------------------------------------------------------
-- Permisos de app_api: solo DML necesario. Sin DELETE, TRUNCATE, REFERENCES ni TRIGGER.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, UPDATE ON app.usuario TO app_api;
GRANT SELECT, UPDATE ON app.clinica TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.sede TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.sede_horario TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.sillon TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.rol TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.rol_permiso TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.membresia TO app_api;
GRANT SELECT, INSERT, UPDATE ON app.usuario_sede TO app_api;

CALL app.asegurar_permisos();
