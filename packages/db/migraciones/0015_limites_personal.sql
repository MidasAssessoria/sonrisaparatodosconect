-- 0015_limites_personal: límites de quien administra (revisión de seguridad del Sprint 2).
--
-- Contrato: packages/shared/src/contrato/personal.ts, «Límites de quien administra». Para cualquier
-- actor que no sea un dueño activo de la clínica (membresía activa con el rol de sistema dueno):
--
--   1. Nadie otorga lo que no tiene.
--      a. Un rol activo, después de cada sentencia que lo toca (alta, atributos o matriz), tiene que
--         quedar con permisos incluidos en los del rol del actor, y con todas_las_sedes solo si el
--         rol del actor la tiene. Lo controlan dos CONSTRAINT TRIGGER (rol_limite_actor y
--         rol_permiso_limite_actor) DEFERRABLE INITIALLY IMMEDIATE: miran el estado final al terminar
--         cada sentencia (no fila por fila), así reemplazar la matriz no falla por un estado
--         intermedio. Quien edita en varios pasos puede hacer `SET CONSTRAINTS app.rol_limite_actor,
--         app.rol_permiso_limite_actor DEFERRED` y el control corre al confirmar. Un rol inactivo no
--         se controla (no da nada: ninguna membresía activa o pendiente lo puede tener); reactivarlo,
--         sí. Errores: rol_permisos_ajenos, rol_todas_las_sedes_ajeno (42501).
--      b. Asignar un rol a una membresía (alta = invitar, cambio de rol_id, reactivar inactivo ->
--         activo) y reenviar una invitación: solo con un rol cuyos permisos estén incluidos en los del
--         actor, y con todas_las_sedes solo si el actor la tiene. Errores: asignacion_rol_superior,
--         asignacion_todas_las_sedes (42501). Desactivar, quitar sedes o bajar de rol a alguien con
--         más permisos sí se puede: no otorga nada.
--      c. Los roles de sistema (es_sistema) y su matriz solo los edita un dueño: rol_sistema_solo_dueno
--         (42501). El rol dueño sigue sin poder editarse (acceso_rol_dueno / acceso_propio).
--      d. Dueño/a y Administración exigen siempre doble factor: CHECK rol_mfa_obligatorio (23514),
--         para todos (también migraciones). Se corrigen antes los que alguien haya apagado.
--   2. Dimensión sede. Alcance de una membresía = las sedes NO dadas de baja de su usuario_sede activo
--      más su sede por defecto; si su rol tiene todas_las_sedes, «todas» (presentes y futuras). Quien
--      no tiene todas_las_sedes solo modifica (rol, sedes, sede por defecto, estado, reenviar, anular
--      la invitación, vincular un profesional) membresías cuyo alcance esté incluido en el suyo (una
--      con todas_las_sedes nunca lo está; una sin ninguna sede, siempre), y solo asigna o quita sedes
--      de su alcance. Error: acceso_fuera_de_sedes (42501). app.membresia_en_alcance(membresia) dice
--      lo mismo para el actor del contexto: listarPersonal filtra con ella.
--   3. Desactivar (activo -> inactivo, sin otro cambio) acepta personal:anular o personal:editar.
--   4. membresia.motivo_baja y rol.motivo_baja: el motivo de la baja vigente (lo muestra la auditoría,
--      que guarda la fila completa). La base lo normaliza (sin espacios alrededor) y lo borra al
--      reactivar. Para app_api, pasar a inactivo exige motivo: baja_sin_motivo (23514). Funciones:
--      app.desactivar_membresia(membresia, motivo) y app.desactivar_rol(rol, motivo).
--   5. Administración recibe configuracion:crear (en las clínicas existentes y en alta_clinica): carga
--      profesionales y el catálogo. Con la regla 1, igual solo crea roles con lo que ella tiene.
--   6. Invitaciones: vencen por defecto a las 72 horas (antes 7 días). Nada de la base asume que la
--      cuenta de Auth nace al aceptar: app.aceptar_invitacion crea la fila de app.usuario si falta y,
--      si existe, exige que sea la del mismo correo; app.consultar_invitacion.usuario_existe dice si
--      hay fila en app.usuario (no si hay cuenta en Supabase Auth: eso lo mira la API).
--   7. Profesional: vincular (o desvincular) una membresía a un profesional pasa por las mismas
--      reglas que tocar esa membresía: permiso personal, nunca la propia (salvo un dueño: el
--      dueño-odontólogo de una clínica chica no tiene a quién pedírselo y no hay nada que escalar),
--      la de un dueño solo un dueño, y alcance de sedes (app.proteger_profesional).
--   8. Una sede dada de baja no se asigna (usuario_sede ni sede por defecto) por app_api:
--      sede_dada_de_baja (22023). La limpieza de las filas que apuntan a una sede que se da de baja
--      (0016) pasa por app.proteger_acceso sin reglas de personal: solo desactiva usuario_sede de esa
--      sede o vacía la sede por defecto que la apunta, y eso no otorga nada.
--
-- Funciones nuevas que app_api puede ejecutar (todas SECURITY INVOKER: corren con RLS y las defensas):
-- app.permisos_de_rol, app.alcance_sedes, app.membresia_en_alcance, app.desactivar_membresia,
-- app.desactivar_rol. Se reemplazan (misma firma): app.proteger_acceso, app.proteger_invitacion,
-- app.reemplazar_permisos_rol (primero revoca, después agrega), app.crear_invitacion,
-- app.reenviar_invitacion, app.anular_invitacion (guarda el motivo en la membresía) y app.alta_clinica.

-- ---------------------------------------------------------------------------------------------
-- Ayudas (SECURITY INVOKER, con RLS: solo ven la clínica del contexto)
-- ---------------------------------------------------------------------------------------------

-- Permisos activos de un rol como 'modulo:accion', ordenados (vacío si no existe en la clínica).
CREATE OR REPLACE FUNCTION app.permisos_de_rol(p_clinica uuid, p_rol uuid) RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(pg_catalog.array_agg(p.modulo || ':' || p.accion ORDER BY p.modulo, p.accion),
                  '{}'::text[])
  FROM app.rol_permiso p
  WHERE p.clinica_id = p_clinica AND p.rol_id = p_rol AND p.activo
$$;
COMMENT ON FUNCTION app.permisos_de_rol(uuid, uuid) IS
  'Permisos activos del rol como modulo:accion, ordenados. Vacío si el rol no es de la clínica.';

-- Alcance de sedes de una membresía: NULL si su rol tiene todas_las_sedes (todas, también las que
-- se creen) o si la membresía no existe en la clínica; si no, las sedes no dadas de baja de su
-- usuario_sede activo más su sede por defecto (array vacío = ninguna).
CREATE OR REPLACE FUNCTION app.alcance_sedes(p_clinica uuid, p_membresia uuid) RETURNS uuid[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN r.todas_las_sedes THEN NULL ELSE ARRAY(
           SELECT s.id FROM app.sede s
           WHERE s.clinica_id = m.clinica_id AND s.deleted_at IS NULL
             AND (s.id = m.sede_defecto_id OR EXISTS (
               SELECT 1 FROM app.usuario_sede us
               WHERE us.clinica_id = m.clinica_id AND us.membresia_id = m.id
                 AND us.sede_id = s.id AND us.activo))
           ORDER BY s.id) END
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  WHERE m.clinica_id = p_clinica AND m.id = p_membresia
$$;
COMMENT ON FUNCTION app.alcance_sedes(uuid, uuid) IS
  'Sedes vigentes de la membresía (usuario_sede activo + sede por defecto). NULL = todas (rol con todas_las_sedes) o membresía inexistente.';

-- ¿El usuario del contexto puede ver y modificar esa membresía por sede? true si su rol tiene
-- todas_las_sedes; si no, solo si el alcance de la membresía está incluido en el suyo (una membresía
-- con todas_las_sedes nunca; una sin sedes, siempre). false sin actor activo en la clínica.
CREATE OR REPLACE FUNCTION app.membresia_en_alcance(p_membresia uuid) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_membresia_actor uuid;
  v_alcance_actor uuid[];
  v_alcance uuid[];
BEGIN
  SELECT m.id INTO v_membresia_actor
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  JOIN app.clinica c ON c.id = m.clinica_id
  WHERE m.clinica_id = v_clinica AND m.usuario_id = app.usuario_actual() AND m.estado = 'activo'
    AND r.activo AND c.activo;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_alcance_actor := app.alcance_sedes(v_clinica, v_membresia_actor);
  IF v_alcance_actor IS NULL THEN
    RETURN true;
  END IF;
  v_alcance := app.alcance_sedes(v_clinica, p_membresia);
  RETURN v_alcance IS NOT NULL AND v_alcance OPERATOR(pg_catalog.<@) v_alcance_actor;
END
$$;
COMMENT ON FUNCTION app.membresia_en_alcance(uuid) IS
  'true si el actor del contexto ve todas las sedes o si las sedes de la membresía están todas entre las suyas.';

-- ---------------------------------------------------------------------------------------------
-- Motivo de baja de membresías y roles
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.membresia ADD COLUMN motivo_baja text
  CONSTRAINT membresia_motivo_baja_check
  CHECK (motivo_baja IS NULL OR (pg_catalog.btrim(motivo_baja) <> '' AND pg_catalog.length(motivo_baja) <= 500));
COMMENT ON COLUMN app.membresia.motivo_baja IS
  'Motivo de la baja vigente (estado inactivo). La base lo borra al reactivar; el historial queda en audit_log.';
ALTER TABLE app.rol ADD COLUMN motivo_baja text
  CONSTRAINT rol_motivo_baja_check
  CHECK (motivo_baja IS NULL OR (pg_catalog.btrim(motivo_baja) <> '' AND pg_catalog.length(motivo_baja) <= 500));
COMMENT ON COLUMN app.rol.motivo_baja IS
  'Motivo de la desactivación vigente. La base lo borra al reactivar; el historial queda en audit_log.';

-- Normaliza motivo_baja para todos: sin espacios alrededor, NULL si queda vacío, NULL si la fila
-- está activa (membresía no inactiva, rol activo).
CREATE OR REPLACE FUNCTION app.fijar_motivo_baja() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'membresia' THEN
    IF NEW.estado <> 'inactivo' THEN
      NEW.motivo_baja := NULL;
    ELSE
      NEW.motivo_baja := NULLIF(pg_catalog.btrim(NEW.motivo_baja), '');
    END IF;
  ELSIF TG_TABLE_NAME = 'rol' THEN
    IF NEW.activo THEN
      NEW.motivo_baja := NULL;
    ELSE
      NEW.motivo_baja := NULLIF(pg_catalog.btrim(NEW.motivo_baja), '');
    END IF;
  ELSE
    RAISE EXCEPTION 'app.fijar_motivo_baja() no está pensada para %.%.', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.fijar_motivo_baja() IS
  'BEFORE INSERT OR UPDATE de membresia y rol: motivo_baja sin espacios alrededor y NULL mientras la fila está activa.';

-- Nombre entre auditoria_fila y proteger: los BEFORE corren por orden alfabético, así la defensa ve
-- el motivo ya normalizado.
CREATE TRIGGER membresia_motivo_baja BEFORE INSERT OR UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.fijar_motivo_baja();
CREATE TRIGGER rol_motivo_baja BEFORE INSERT OR UPDATE ON app.rol
  FOR EACH ROW EXECUTE FUNCTION app.fijar_motivo_baja();

-- ---------------------------------------------------------------------------------------------
-- Datos: doble factor de Dueño/a y Administración, y configuracion:crear para Administración
-- ---------------------------------------------------------------------------------------------
-- Sin clínica en el contexto, rol y rol_permiso (RLS forzado también para su dueño) no muestran
-- nada: por un momento, dentro de esta transacción y con bloqueo exclusivo, se quita el FORCE (como
-- en 0008). Cada cambio queda auditado en su clínica como cambio del sistema (usuario NULL).
ALTER TABLE app.rol NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.rol_permiso NO FORCE ROW LEVEL SECURITY;

UPDATE app.rol SET exige_mfa = true
WHERE es_sistema AND codigo IN ('dueno', 'administracion') AND NOT exige_mfa;

-- Si la clínica ya tiene la fila (activa o revocada a propósito), no se toca.
INSERT INTO app.rol_permiso (clinica_id, rol_id, modulo, accion)
SELECT r.clinica_id, r.id, 'configuracion', 'crear'
FROM app.rol r
WHERE r.es_sistema AND r.codigo = 'administracion'
ON CONFLICT (clinica_id, rol_id, modulo, accion) DO NOTHING;

ALTER TABLE app.rol_permiso FORCE ROW LEVEL SECURITY;
ALTER TABLE app.rol FORCE ROW LEVEL SECURITY;

ALTER TABLE app.rol ADD CONSTRAINT rol_mfa_obligatorio
  CHECK (NOT es_sistema OR codigo NOT IN ('dueno', 'administracion') OR exige_mfa);
COMMENT ON CONSTRAINT rol_mfa_obligatorio ON app.rol IS
  'Dueño/a y Administración exigen siempre doble factor.';

-- ---------------------------------------------------------------------------------------------
-- app.proteger_acceso() (reemplaza la de 0010: mismas reglas más las de este archivo)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_acceso() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_clinica uuid := NEW.clinica_id;
  v_dueno_tablas oid;
  v_membresia_actor uuid;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_actor_todas boolean;
  v_rol_dueno uuid;
  v_permisos text[];
  v_objetivo_usuario uuid;
  v_objetivo_rol uuid;
  v_rol_activo boolean;
  v_rol_todas boolean;
  v_alcance_actor uuid[];
  v_alcance uuid[];
  v_faltan text[];
  v_solo_estado boolean;
  v_auditoria CONSTANT text[] := ARRAY['updated_at', 'updated_by'];
BEGIN
  -- (Cada referencia a columnas de una tabla va dentro del IF de esa tabla: PL/pgSQL resuelve los
  -- campos de NEW/OLD al evaluar la expresión, y las cuatro tablas tienen columnas distintas.)

  -- Integridad, para todos: sin el rol dueño activo la clínica se queda sin dueño.
  IF TG_TABLE_NAME = 'rol' AND TG_OP = 'UPDATE' THEN
    IF OLD.es_sistema AND OLD.codigo = 'dueno' AND NOT NEW.activo THEN
      RAISE EXCEPTION 'El rol Dueño/a no se puede desactivar: la clínica se quedaría sin dueño.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'rol_dueno_activo';
    END IF;
  END IF;

  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

  -- Excepción explícita: una SESIÓN del dueño de las tablas (migraciones, alta_clinica,
  -- administración). Una función SECURITY DEFINER llamada por app_api corre como el dueño pero su
  -- sesión es de app_api: no entra acá.
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NEW;
  END IF;

  -- Aceptación de una invitación: la membresía toma su usuario (una sola vez) y pasa a activa.
  IF TG_TABLE_NAME = 'membresia' AND TG_OP = 'UPDATE' THEN
    IF OLD.usuario_id IS NULL AND NEW.usuario_id IS NOT NULL THEN
      IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
         AND v_actor IS NOT NULL AND NEW.usuario_id = v_actor
         AND OLD.estado = 'pendiente' AND NEW.estado = 'activo'
         AND NEW.rol_id = OLD.rol_id
         AND NEW.sede_defecto_id IS NOT DISTINCT FROM OLD.sede_defecto_id
         AND EXISTS (
           SELECT 1 FROM app.invitacion i
           WHERE i.clinica_id = NEW.clinica_id AND i.membresia_id = NEW.id
             AND i.usada_por = v_actor AND i.usada_en = pg_catalog.now()
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Una membresía toma su usuario solo cuando la persona acepta la invitación con su enlace.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_por_invitacion';
    END IF;
  END IF;

  -- Limpieza de una sede dada de baja (ver 0016): desactivar el usuario_sede de esa sede o vaciar
  -- la sede por defecto que la apunta, sin ningún otro cambio. No otorga nada: sin reglas de personal.
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'usuario_sede' THEN
      IF OLD.activo AND NOT NEW.activo AND EXISTS (
        SELECT 1 FROM app.sede s
        WHERE s.clinica_id = NEW.clinica_id AND s.id = NEW.sede_id AND s.deleted_at IS NOT NULL
      ) THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'membresia' THEN
      IF OLD.sede_defecto_id IS NOT NULL AND NEW.sede_defecto_id IS NULL
         AND (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) (v_auditoria || 'sede_defecto_id'::text))
             = (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) (v_auditoria || 'sede_defecto_id'::text))
         AND EXISTS (
           SELECT 1 FROM app.sede s
           WHERE s.clinica_id = NEW.clinica_id AND s.id = OLD.sede_defecto_id
             AND s.deleted_at IS NOT NULL
         ) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto: los cambios de personal y de roles tienen autor.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_actor';
  END IF;

  -- a. Membresía activa del actor en la clínica de la fila, con rol activo y clínica activa.
  SELECT m.id, m.rol_id, (r.es_sistema AND r.codigo = 'dueno'), r.todas_las_sedes
    INTO v_membresia_actor, v_rol_actor, v_actor_dueno, v_actor_todas
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  JOIN app.clinica c ON c.id = m.clinica_id
  WHERE m.clinica_id = v_clinica AND m.usuario_id = v_actor AND m.estado = 'activo'
    AND r.activo AND c.activo
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Para cambiar personal o roles tenés que ser miembro activo de esta clínica.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_membresia';
  END IF;

  -- b. Permiso: alcanza con uno de la lista.
  IF TG_TABLE_NAME = 'membresia' THEN
    IF TG_OP = 'INSERT' THEN
      v_permisos := ARRAY['personal:crear'];
    ELSE
      -- Desactivar (o anular una invitación) sin tocar otra cosa: personal:editar o personal:anular.
      v_solo_estado := NEW.rol_id = OLD.rol_id
        AND NEW.sede_defecto_id IS NOT DISTINCT FROM OLD.sede_defecto_id
        AND NEW.usuario_id IS NOT DISTINCT FROM OLD.usuario_id;
      IF v_solo_estado AND OLD.estado <> 'inactivo' AND NEW.estado = 'inactivo' THEN
        v_permisos := ARRAY['personal:editar', 'personal:anular'];
      ELSE
        v_permisos := ARRAY['personal:editar'];
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'usuario_sede' THEN
    IF TG_OP = 'INSERT' THEN
      v_permisos := ARRAY['personal:crear', 'personal:editar'];
    ELSE
      v_permisos := ARRAY['personal:editar'];
    END IF;
  ELSIF TG_TABLE_NAME = 'rol' THEN
    IF TG_OP = 'INSERT' THEN
      v_permisos := ARRAY['configuracion:crear', 'configuracion:editar'];
    ELSIF OLD.activo AND NOT NEW.activo
          AND (pg_catalog.to_jsonb(NEW) OPERATOR(pg_catalog.-) (v_auditoria || ARRAY['activo', 'motivo_baja']))
              = (pg_catalog.to_jsonb(OLD) OPERATOR(pg_catalog.-) (v_auditoria || ARRAY['activo', 'motivo_baja'])) THEN
      v_permisos := ARRAY['configuracion:anular', 'configuracion:editar'];
    ELSE
      v_permisos := ARRAY['configuracion:editar'];
    END IF;
  ELSIF TG_TABLE_NAME = 'rol_permiso' THEN
    v_permisos := ARRAY['configuracion:editar'];
    -- La matriz inicial de un rol recién creado (en esta transacción, por el mismo actor).
    IF TG_OP = 'INSERT' AND EXISTS (
      SELECT 1 FROM app.rol r
      WHERE r.clinica_id = v_clinica AND r.id = NEW.rol_id
        AND r.created_by = v_actor AND r.created_at = pg_catalog.now()
    ) THEN
      v_permisos := v_permisos || 'configuracion:crear'::text;
    END IF;
  ELSE
    RAISE EXCEPTION 'app.proteger_acceso() no está pensada para %.%.', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  PERFORM 1 FROM app.rol_permiso p
  WHERE p.clinica_id = v_clinica AND p.rol_id = v_rol_actor AND p.activo
    AND (p.modulo || ':' || p.accion) = ANY (v_permisos)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para este cambio (%).',
      pg_catalog.array_to_string(v_permisos, ' o ')
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_permiso';
  END IF;

  SELECT r.id INTO v_rol_dueno
  FROM app.rol r WHERE r.clinica_id = v_clinica AND r.es_sistema AND r.codigo = 'dueno';

  IF TG_TABLE_NAME = 'membresia' THEN
    IF NEW.usuario_id = v_actor OR (TG_OP = 'UPDATE' AND OLD.usuario_id = v_actor) THEN
      RAISE EXCEPTION 'No podés cambiar tu propia membresía: pedíselo a otra persona con permiso.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_propio';
    END IF;
    IF NEW.rol_id = v_rol_dueno OR (TG_OP = 'UPDATE' AND OLD.rol_id = v_rol_dueno) THEN
      IF NOT v_actor_dueno THEN
        RAISE EXCEPTION 'Solo un dueño puede dar, quitar o cambiar la membresía de un dueño.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.estado <> 'pendiente' THEN
      RAISE EXCEPTION 'Una membresía nueva nace pendiente: la activa la persona al aceptar la invitación.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_nace_pendiente';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.usuario_id IS NOT NULL THEN
      RAISE EXCEPTION 'Una membresía nueva nace sin usuario: se lo pone la persona al aceptar la invitación.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_por_invitacion';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
      RAISE EXCEPTION 'El usuario de una membresía no se cambia.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_por_invitacion';
    END IF;
    -- Pendiente es el estado de alta: no se sale de él por la clínica (activo e inactivo dejan ver el
    -- perfil), salvo una pendiente SIN usuario que pasa a inactiva al anular su invitación. Tampoco
    -- se vuelve a pendiente. Reincorporar a quien fue miembro es inactivo -> activo.
    IF TG_OP = 'UPDATE' AND (OLD.estado = 'pendiente') <> (NEW.estado = 'pendiente') THEN
      IF OLD.estado = 'pendiente' AND NEW.estado = 'inactivo' AND OLD.usuario_id IS NULL THEN
        IF EXISTS (
          SELECT 1 FROM app.invitacion i
          WHERE i.clinica_id = NEW.clinica_id AND i.membresia_id = NEW.id
            AND i.usada_en IS NULL AND i.anulada_en IS NULL
        ) THEN
          RAISE EXCEPTION 'Esa invitación sigue abierta: anulala antes de dar de baja la membresía.'
            USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_invitacion_abierta';
        END IF;
      ELSE
        RAISE EXCEPTION 'Una membresía pendiente cambia solo cuando la persona acepta la invitación.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_nace_pendiente';
      END IF;
    END IF;
    -- Rol activo, con bloqueo compartido (una desactivación del rol espera a esta transacción).
    IF NEW.estado IN ('activo', 'pendiente')
       AND (TG_OP = 'INSERT' OR NEW.rol_id IS DISTINCT FROM OLD.rol_id
            OR NEW.estado IS DISTINCT FROM OLD.estado) THEN
      SELECT r.activo INTO v_rol_activo
      FROM app.rol r WHERE r.clinica_id = v_clinica AND r.id = NEW.rol_id
      FOR SHARE;
      -- Si no existe en esta clínica, lo rechaza el FK compuesto.
      IF v_rol_activo IS FALSE THEN
        RAISE EXCEPTION 'Ese rol está desactivado: elegí otro o reactivalo antes.'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'rol_inactivo';
      END IF;
    END IF;

    v_alcance_actor := app.alcance_sedes(v_clinica, v_membresia_actor);
    -- Sede por defecto nueva: vigente y (sin todas las sedes) del alcance del actor.
    IF NEW.sede_defecto_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.sede_defecto_id IS DISTINCT FROM OLD.sede_defecto_id) THEN
      IF EXISTS (
        SELECT 1 FROM app.sede s
        WHERE s.clinica_id = v_clinica AND s.id = NEW.sede_defecto_id AND s.deleted_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'Esa sede está dada de baja: elegí otra.'
          USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'sede_dada_de_baja';
      END IF;
      IF v_alcance_actor IS NOT NULL
         AND NOT (NEW.sede_defecto_id = ANY (v_alcance_actor)) THEN
        RAISE EXCEPTION 'Solo podés asignar sedes que vos ves.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_fuera_de_sedes';
      END IF;
    END IF;
    -- 2. Alcance: sin todas las sedes, solo membresías cuyas sedes estén todas entre las del actor.
    IF TG_OP = 'UPDATE' AND v_alcance_actor IS NOT NULL THEN
      v_alcance := app.alcance_sedes(v_clinica, OLD.id);
      IF v_alcance IS NULL OR NOT (v_alcance OPERATOR(pg_catalog.<@) v_alcance_actor) THEN
        RAISE EXCEPTION 'Esa persona trabaja en sedes que vos no ves: pedíselo a alguien que las vea todas.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_fuera_de_sedes';
      END IF;
    END IF;
    -- 1b. Asignar un rol (alta, cambio de rol, reactivar): solo uno que no dé más que el del actor.
    IF NOT v_actor_dueno
       AND (TG_OP = 'INSERT' OR NEW.rol_id IS DISTINCT FROM OLD.rol_id
            OR (OLD.estado = 'inactivo' AND NEW.estado = 'activo')) THEN
      SELECT r.todas_las_sedes INTO v_rol_todas
      FROM app.rol r WHERE r.clinica_id = v_clinica AND r.id = NEW.rol_id;
      IF v_rol_todas AND NOT v_actor_todas THEN
        RAISE EXCEPTION 'Ese rol ve todas las sedes y el tuyo no: no lo podés asignar.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'asignacion_todas_las_sedes';
      END IF;
      v_faltan := ARRAY(
        SELECT x FROM pg_catalog.unnest(app.permisos_de_rol(v_clinica, NEW.rol_id)) AS x
        EXCEPT
        SELECT y FROM pg_catalog.unnest(app.permisos_de_rol(v_clinica, v_rol_actor)) AS y
        ORDER BY 1);
      IF pg_catalog.cardinality(v_faltan) > 0 THEN
        RAISE EXCEPTION 'Ese rol tiene permisos que tu rol no tiene (%): no lo podés asignar.',
          pg_catalog.array_to_string(v_faltan, ', ')
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'asignacion_rol_superior';
      END IF;
    END IF;
    -- 4. Dar de baja exige motivo.
    IF TG_OP = 'UPDATE' AND OLD.estado <> 'inactivo' AND NEW.estado = 'inactivo'
       AND NEW.motivo_baja IS NULL THEN
      RAISE EXCEPTION 'Contanos el motivo de la baja.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'baja_sin_motivo';
    END IF;

  ELSIF TG_TABLE_NAME = 'usuario_sede' THEN
    SELECT m.usuario_id, m.rol_id INTO v_objetivo_usuario, v_objetivo_rol
    FROM app.membresia m WHERE m.clinica_id = v_clinica AND m.id = NEW.membresia_id;
    -- Si la membresía no existe en esta clínica, la rechaza el FK compuesto.
    IF v_objetivo_usuario = v_actor THEN
      RAISE EXCEPTION 'No podés cambiar tus propias sedes: pedíselo a otra persona con permiso.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_propio';
    END IF;
    IF v_objetivo_rol = v_rol_dueno AND NOT v_actor_dueno THEN
      RAISE EXCEPTION 'Solo un dueño puede cambiar las sedes de un dueño.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
    END IF;
    IF NEW.activo AND (TG_OP = 'INSERT' OR NOT OLD.activo) AND EXISTS (
      SELECT 1 FROM app.sede s
      WHERE s.clinica_id = v_clinica AND s.id = NEW.sede_id AND s.deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Esa sede está dada de baja: elegí otra.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'sede_dada_de_baja';
    END IF;
    v_alcance_actor := app.alcance_sedes(v_clinica, v_membresia_actor);
    IF v_alcance_actor IS NOT NULL THEN
      v_alcance := app.alcance_sedes(v_clinica, NEW.membresia_id);
      IF v_alcance IS NULL OR NOT (v_alcance OPERATOR(pg_catalog.<@) v_alcance_actor)
         OR NOT (NEW.sede_id = ANY (v_alcance_actor)) THEN
        RAISE EXCEPTION 'Solo podés cambiar sedes que vos ves, de personas que trabajan solo en ellas.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_fuera_de_sedes';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'rol' THEN
    IF NEW.id = v_rol_actor OR (TG_OP = 'UPDATE' AND OLD.id = v_rol_actor) THEN
      RAISE EXCEPTION 'No podés cambiar tu propio rol: pedíselo a otra persona con permiso.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_propio';
    END IF;
    IF NEW.id = v_rol_dueno OR (TG_OP = 'UPDATE' AND OLD.id = v_rol_dueno) THEN
      RAISE EXCEPTION 'El rol Dueño/a no se modifica: tiene todos los permisos por definición.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.es_sistema THEN
      RAISE EXCEPTION 'Los roles de sistema los crea el alta de la clínica: creá un rol propio.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'rol_sistema';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.es_sistema AND NOT v_actor_dueno THEN
      RAISE EXCEPTION 'Los roles de sistema los cambia solo un dueño.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'rol_sistema_solo_dueno';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.activo AND NOT NEW.activo AND EXISTS (
      SELECT 1 FROM app.membresia m
      WHERE m.clinica_id = v_clinica AND m.rol_id = NEW.id AND m.estado IN ('activo', 'pendiente')
    ) THEN
      RAISE EXCEPTION 'Ese rol lo usa alguien del equipo (o una invitación pendiente): cambiales el rol antes de desactivarlo.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'rol_en_uso';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.activo AND NOT NEW.activo AND NEW.motivo_baja IS NULL THEN
      RAISE EXCEPTION 'Contanos el motivo de la baja del rol.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'baja_sin_motivo';
    END IF;

  ELSIF TG_TABLE_NAME = 'rol_permiso' THEN
    IF NEW.rol_id = v_rol_actor OR (TG_OP = 'UPDATE' AND OLD.rol_id = v_rol_actor) THEN
      RAISE EXCEPTION 'No podés cambiar los permisos de tu propio rol: pedíselo a otra persona con permiso.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_propio';
    END IF;
    IF NEW.rol_id = v_rol_dueno OR (TG_OP = 'UPDATE' AND OLD.rol_id = v_rol_dueno) THEN
      RAISE EXCEPTION 'Los permisos del rol Dueño/a no se modifican: tiene todos por definición.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
    END IF;
    IF NOT v_actor_dueno AND EXISTS (
      SELECT 1 FROM app.rol r WHERE r.clinica_id = v_clinica AND r.id = NEW.rol_id AND r.es_sistema
    ) THEN
      RAISE EXCEPTION 'Los permisos de los roles de sistema los cambia solo un dueño.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'rol_sistema_solo_dueno';
    END IF;
  END IF;

  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_acceso() IS
  'Defensa de membresia, usuario_sede, rol y rol_permiso: permiso y alcance de sedes del actor, nada propio, rol dueño y roles de sistema protegidos, nadie asigna un rol que dé más que el suyo, membresía por invitación, roles en uso, baja con motivo. Exceptúa solo a una sesión del dueño de las tablas.';

-- ---------------------------------------------------------------------------------------------
-- 1a. Un rol activo no queda con más que el rol de quien lo cambia (al terminar cada sentencia)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.limitar_rol_al_actor() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_clinica uuid := NEW.clinica_id;
  v_dueno_tablas oid;
  v_rol uuid;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_actor_todas boolean;
  v_activo boolean;
  v_todas boolean;
  v_faltan text[];
BEGIN
  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'rol' THEN
    v_rol := NEW.id;
  ELSE
    v_rol := NEW.rol_id;
  END IF;

  -- El actor ya pasó app.proteger_acceso() en esta sentencia; si ya no es miembro activo, nada.
  SELECT m.rol_id, (r.es_sistema AND r.codigo = 'dueno'), r.todas_las_sedes
    INTO v_rol_actor, v_actor_dueno, v_actor_todas
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  JOIN app.clinica c ON c.id = m.clinica_id
  WHERE m.clinica_id = v_clinica AND m.usuario_id = v_actor AND m.estado = 'activo'
    AND r.activo AND c.activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Para cambiar roles tenés que ser miembro activo de esta clínica.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_membresia';
  END IF;
  IF v_actor_dueno THEN
    RETURN NULL;
  END IF;

  -- Estado final del rol (la sentencia ya terminó).
  SELECT r.activo, r.todas_las_sedes INTO v_activo, v_todas
  FROM app.rol r WHERE r.clinica_id = v_clinica AND r.id = v_rol;
  IF NOT FOUND OR NOT v_activo THEN
    RETURN NULL;
  END IF;
  IF v_todas AND NOT v_actor_todas THEN
    RAISE EXCEPTION 'Tu rol no ve todas las sedes: no podés dejar un rol que las vea.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'rol_todas_las_sedes_ajeno';
  END IF;
  v_faltan := ARRAY(
    SELECT x FROM pg_catalog.unnest(app.permisos_de_rol(v_clinica, v_rol)) AS x
    EXCEPT
    SELECT y FROM pg_catalog.unnest(app.permisos_de_rol(v_clinica, v_rol_actor)) AS y
    ORDER BY 1);
  IF pg_catalog.cardinality(v_faltan) > 0 THEN
    RAISE EXCEPTION 'Ese rol quedaría con permisos que tu rol no tiene (%): quitáselos o pedíselo a un dueño.',
      pg_catalog.array_to_string(v_faltan, ', ')
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'rol_permisos_ajenos';
  END IF;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.limitar_rol_al_actor() IS
  'CONSTRAINT TRIGGER de rol y rol_permiso: al terminar la sentencia, un rol activo tiene permisos incluidos en los del actor y todas_las_sedes solo si el actor la tiene. Exceptúa a un dueño y a una sesión del dueño de las tablas.';

CREATE CONSTRAINT TRIGGER rol_limite_actor AFTER INSERT OR UPDATE ON app.rol
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.limitar_rol_al_actor();
CREATE CONSTRAINT TRIGGER rol_permiso_limite_actor AFTER INSERT OR UPDATE ON app.rol_permiso
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION app.limitar_rol_al_actor();

-- ---------------------------------------------------------------------------------------------
-- app.reemplazar_permisos_rol(): igual que en 0010, pero primero revoca y después agrega. Así, al
-- terminar cada sentencia el rol tiene a lo sumo lo que tendrá al final (ver rol_permiso_limite_actor).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.reemplazar_permisos_rol(p_rol_id uuid, p_permisos text[])
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_permisos text[] := ARRAY(
    SELECT DISTINCT x FROM pg_catalog.unnest(COALESCE(p_permisos, '{}'::text[])) AS x);
  v_cantidad integer;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de cambiar un rol.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_permisos) AS x WHERE x IS NULL OR x !~ '^[a-z_]+:[a-z_]+$') THEN
    RAISE EXCEPTION 'Cada permiso va como modulo:accion (p. ej. agenda:ver).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM app.rol r WHERE r.clinica_id = v_clinica AND r.id = p_rol_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe ese rol en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'rol_no_encontrado';
  END IF;

  UPDATE app.rol_permiso p SET activo = false
  WHERE p.clinica_id = v_clinica AND p.rol_id = p_rol_id AND p.activo
    AND NOT ((p.modulo || ':' || p.accion) = ANY (v_permisos));

  INSERT INTO app.rol_permiso AS p (clinica_id, rol_id, modulo, accion)
  SELECT v_clinica, p_rol_id, pg_catalog.split_part(x, ':', 1), pg_catalog.split_part(x, ':', 2)
  FROM pg_catalog.unnest(v_permisos) AS x
  ON CONFLICT (clinica_id, rol_id, modulo, accion) DO UPDATE SET activo = true WHERE NOT p.activo;

  SELECT pg_catalog.count(*)::integer INTO v_cantidad
  FROM app.rol_permiso p WHERE p.clinica_id = v_clinica AND p.rol_id = p_rol_id AND p.activo;
  RETURN v_cantidad;
END
$$;
COMMENT ON FUNCTION app.reemplazar_permisos_rol(uuid, text[]) IS
  'Reemplaza la matriz de permisos de un rol (lo que falta queda activo = false; primero revoca, después agrega). Corre como app_api; app.proteger_acceso y rol_permiso_limite_actor deciden.';

-- ---------------------------------------------------------------------------------------------
-- Baja con motivo (SECURITY INVOKER: corren como app_api con todas las defensas)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.desactivar_membresia(p_membresia_id uuid, p_motivo text)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de dar de baja.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo IS NULL OR pg_catalog.btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Contanos el motivo de la baja.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'baja_sin_motivo';
  END IF;
  UPDATE app.membresia m SET estado = 'inactivo', motivo_baja = pg_catalog.btrim(p_motivo)
  WHERE m.clinica_id = v_clinica AND m.id = p_membresia_id AND m.estado = 'activo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ninguna persona activa con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'membresia_no_activa';
  END IF;
END
$$;
COMMENT ON FUNCTION app.desactivar_membresia(uuid, text) IS
  'Desactiva una membresía activa guardando el motivo (obligatorio). Corre como app_api: app.proteger_acceso decide (personal:anular o personal:editar).';

CREATE OR REPLACE FUNCTION app.desactivar_rol(p_rol_id uuid, p_motivo text)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de dar de baja.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo IS NULL OR pg_catalog.btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Contanos el motivo de la baja del rol.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'baja_sin_motivo';
  END IF;
  UPDATE app.rol r SET activo = false, motivo_baja = pg_catalog.btrim(p_motivo)
  WHERE r.clinica_id = v_clinica AND r.id = p_rol_id AND r.activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ningún rol activo con ese id en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'rol_no_encontrado';
  END IF;
END
$$;
COMMENT ON FUNCTION app.desactivar_rol(uuid, text) IS
  'Desactiva un rol activo guardando el motivo (obligatorio). Corre como app_api: app.proteger_acceso decide (configuracion:anular o configuracion:editar, rol_en_uso).';

-- ---------------------------------------------------------------------------------------------
-- app.proteger_invitacion(): igual que en 0010, más alcance de sedes (alta, reenvío y anulación) y
-- rol asignable (alta y reenvío).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_invitacion() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_dueno_tablas oid;
  v_membresia_actor uuid;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_actor_todas boolean;
  v_rol_dueno uuid;
  v_hay_membresia boolean;
  v_estado text;
  v_usuario uuid;
  v_rol uuid;
  v_rol_todas boolean;
  v_email_previo text;
  v_alcance_actor uuid[];
  v_alcance uuid[];
  v_faltan text[];
BEGIN
  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE') THEN
    IF pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND v_actor IS NOT NULL
       AND OLD.usada_en IS NULL AND OLD.anulada_en IS NULL
       AND NEW.usada_en IS NOT NULL AND NEW.usada_por = v_actor
       AND NEW.anulada_en IS NULL AND NEW.motivo_anulacion IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Una invitación solo se marca como usada al aceptarla.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_no_vigente';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto: las invitaciones tienen autor.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_actor';
  END IF;

  SELECT m.id, m.rol_id, (r.es_sistema AND r.codigo = 'dueno'), r.todas_las_sedes
    INTO v_membresia_actor, v_rol_actor, v_actor_dueno, v_actor_todas
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  JOIN app.clinica c ON c.id = m.clinica_id
  WHERE m.clinica_id = NEW.clinica_id AND m.usuario_id = v_actor AND m.estado = 'activo'
    AND r.activo AND c.activo
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Para invitar tenés que ser miembro activo de esta clínica.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_membresia';
  END IF;

  PERFORM 1 FROM app.rol_permiso p
  WHERE p.clinica_id = NEW.clinica_id AND p.rol_id = v_rol_actor AND p.activo
    AND (p.modulo || ':' || p.accion) = ANY (
      CASE WHEN TG_OP = 'INSERT' THEN ARRAY['personal:crear']
           ELSE ARRAY['personal:crear', 'personal:anular'] END)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para invitar o anular invitaciones.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_permiso';
  END IF;

  SELECT m.estado, m.usuario_id, m.rol_id INTO v_estado, v_usuario, v_rol
  FROM app.membresia m WHERE m.clinica_id = NEW.clinica_id AND m.id = NEW.membresia_id
  FOR SHARE;
  -- Si la membresía no existe en esta clínica, lo rechaza el FK compuesto.
  v_hay_membresia := FOUND;
  SELECT r.id INTO v_rol_dueno
  FROM app.rol r WHERE r.clinica_id = NEW.clinica_id AND r.es_sistema AND r.codigo = 'dueno';
  IF v_hay_membresia AND v_rol = v_rol_dueno AND NOT v_actor_dueno THEN
    RAISE EXCEPTION 'Solo un dueño puede invitar a alguien como dueño o anular esa invitación.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
  END IF;

  IF v_hay_membresia THEN
    -- 2. Alcance de sedes (alta, reenvío y anulación).
    v_alcance_actor := app.alcance_sedes(NEW.clinica_id, v_membresia_actor);
    IF v_alcance_actor IS NOT NULL THEN
      v_alcance := app.alcance_sedes(NEW.clinica_id, NEW.membresia_id);
      IF v_alcance IS NULL OR NOT (v_alcance OPERATOR(pg_catalog.<@) v_alcance_actor) THEN
        RAISE EXCEPTION 'Esa invitación es para sedes que vos no ves: pedíselo a alguien que las vea todas.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_fuera_de_sedes';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.usada_en IS NOT NULL OR NEW.usada_por IS NOT NULL
       OR NEW.anulada_en IS NOT NULL OR NEW.motivo_anulacion IS NOT NULL THEN
      RAISE EXCEPTION 'Una invitación nace sin usar y sin anular.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_no_vigente';
    END IF;
    IF v_hay_membresia AND (v_estado <> 'pendiente' OR v_usuario IS NOT NULL) THEN
      RAISE EXCEPTION 'Solo se invita a una membresía pendiente que todavía no tiene usuario.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_membresia';
    END IF;
    -- 1b. Alta y reenvío: un rol que no dé más que el del actor (reenviar es volver a darlo).
    IF v_hay_membresia AND NOT v_actor_dueno THEN
      SELECT r.todas_las_sedes INTO v_rol_todas
      FROM app.rol r WHERE r.clinica_id = NEW.clinica_id AND r.id = v_rol;
      IF v_rol_todas AND NOT v_actor_todas THEN
        RAISE EXCEPTION 'Ese rol ve todas las sedes y el tuyo no: no podés invitar con él.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'asignacion_todas_las_sedes';
      END IF;
      v_faltan := ARRAY(
        SELECT x FROM pg_catalog.unnest(app.permisos_de_rol(NEW.clinica_id, v_rol)) AS x
        EXCEPT
        SELECT y FROM pg_catalog.unnest(app.permisos_de_rol(NEW.clinica_id, v_rol_actor)) AS y
        ORDER BY 1);
      IF pg_catalog.cardinality(v_faltan) > 0 THEN
        RAISE EXCEPTION 'Ese rol tiene permisos que tu rol no tiene (%): no podés invitar con él.',
          pg_catalog.array_to_string(v_faltan, ', ')
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'asignacion_rol_superior';
      END IF;
    END IF;
    IF NEW.vence_en IS NULL OR NEW.vence_en <= pg_catalog.now()
       OR NEW.vence_en > pg_catalog.now() + interval '30 days' THEN
      RAISE EXCEPTION 'El enlace tiene que vencer entre ahora y 30 días.'
        USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'invitacion_vencimiento';
    END IF;
    NEW.invitada_por := v_actor;
    SELECT i.email INTO v_email_previo
    FROM app.invitacion i
    WHERE i.clinica_id = NEW.clinica_id AND i.membresia_id = NEW.membresia_id
    ORDER BY i.created_at, i.id
    LIMIT 1;
    IF FOUND AND v_email_previo IS DISTINCT FROM NEW.email THEN
      RAISE EXCEPTION 'Una invitación reenviada va al mismo correo: para otra persona, creá otra invitación.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_otro_correo';
    END IF;
    -- Un correo, una persona por clínica: se serializa con otras invitaciones y aceptaciones del
    -- mismo correo (app.aceptar_invitacion toma el mismo bloqueo).
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'app.invitacion:' || NEW.clinica_id::text || ':' || NEW.email, 0));
    IF EXISTS (
      SELECT 1 FROM app.membresia m JOIN app.usuario u ON u.id = m.usuario_id
      WHERE m.clinica_id = NEW.clinica_id AND m.estado IN ('activo', 'inactivo')
        AND pg_catalog.lower(u.email) = NEW.email
    ) THEN
      RAISE EXCEPTION 'Esa persona ya es o fue parte del equipo: si está inactiva, reactivala en vez de invitarla.'
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'invitacion_ya_es_miembro';
    END IF;
  ELSE
    IF NEW.usada_en IS DISTINCT FROM OLD.usada_en OR NEW.usada_por IS DISTINCT FROM OLD.usada_por THEN
      RAISE EXCEPTION 'Una invitación solo se marca como usada al aceptarla.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_no_vigente';
    END IF;
    IF (NEW.anulada_en IS DISTINCT FROM OLD.anulada_en
        OR NEW.motivo_anulacion IS DISTINCT FROM OLD.motivo_anulacion)
       AND (OLD.usada_en IS NOT NULL OR OLD.anulada_en IS NOT NULL) THEN
      RAISE EXCEPTION 'Esa invitación ya fue usada o anulada.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_no_vigente';
    END IF;
    IF NEW.anulada_en IS NOT NULL AND OLD.anulada_en IS NULL THEN
      NEW.anulada_en := pg_catalog.now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_invitacion() IS
  'Defensa de invitacion: permiso y alcance de sedes del actor, rol asignable al invitar o reenviar, membresía pendiente sin usuario, mismo correo al reenviar, nadie que ya sea miembro, uso solo por app.aceptar_invitacion.';

-- ---------------------------------------------------------------------------------------------
-- 7. Profesional: vincular una membresía, con las reglas de tocar esa membresía
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_profesional() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_dueno_tablas oid;
  v_vinculos uuid[];
  v_membresia_actor uuid;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_rol_dueno uuid;
  v_alcance_actor uuid[];
  v_alcance uuid[];
  v_membresia uuid;
  v_usuario uuid;
  v_rol uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.membresia_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_vinculos := ARRAY[NEW.membresia_id];
  ELSE
    IF NEW.membresia_id IS NOT DISTINCT FROM OLD.membresia_id THEN
      RETURN NEW;
    END IF;
    v_vinculos := pg_catalog.array_remove(ARRAY[OLD.membresia_id, NEW.membresia_id], NULL);
  END IF;

  SELECT c.relowner INTO v_dueno_tablas FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF pg_catalog.pg_has_role(current_user, v_dueno_tablas, 'USAGE')
     AND pg_catalog.pg_has_role(session_user, v_dueno_tablas, 'USAGE') THEN
    RETURN NEW;
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto: vincular a una persona con un profesional tiene autor.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_actor';
  END IF;
  SELECT m.id, m.rol_id, (r.es_sistema AND r.codigo = 'dueno')
    INTO v_membresia_actor, v_rol_actor, v_actor_dueno
  FROM app.membresia m
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  JOIN app.clinica c ON c.id = m.clinica_id
  WHERE m.clinica_id = NEW.clinica_id AND m.usuario_id = v_actor AND m.estado = 'activo'
    AND r.activo AND c.activo
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Para vincular a una persona con un profesional tenés que ser miembro activo de esta clínica.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_membresia';
  END IF;
  PERFORM 1 FROM app.rol_permiso p
  WHERE p.clinica_id = NEW.clinica_id AND p.rol_id = v_rol_actor AND p.activo
    AND (p.modulo || ':' || p.accion) = ANY (
      CASE WHEN TG_OP = 'INSERT' THEN ARRAY['personal:crear', 'personal:editar']
           ELSE ARRAY['personal:editar'] END)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu rol no tiene el permiso que hace falta para vincular a una persona con un profesional.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_permiso';
  END IF;

  SELECT r.id INTO v_rol_dueno
  FROM app.rol r WHERE r.clinica_id = NEW.clinica_id AND r.es_sistema AND r.codigo = 'dueno';
  v_alcance_actor := app.alcance_sedes(NEW.clinica_id, v_membresia_actor);
  FOREACH v_membresia IN ARRAY v_vinculos LOOP
    SELECT m.usuario_id, m.rol_id INTO v_usuario, v_rol
    FROM app.membresia m WHERE m.clinica_id = NEW.clinica_id AND m.id = v_membresia;
    -- Si la membresía no existe en esta clínica, lo rechaza el FK compuesto.
    CONTINUE WHEN NOT FOUND;
    IF v_usuario = v_actor AND NOT v_actor_dueno THEN
      RAISE EXCEPTION 'No podés vincularte ni desvincularte de un profesional: pedíselo a otra persona con permiso.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_propio';
    END IF;
    IF v_rol = v_rol_dueno AND NOT v_actor_dueno THEN
      RAISE EXCEPTION 'Solo un dueño puede vincular o desvincular a un dueño de un profesional.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
    END IF;
    IF v_alcance_actor IS NOT NULL THEN
      v_alcance := app.alcance_sedes(NEW.clinica_id, v_membresia);
      IF v_alcance IS NULL OR NOT (v_alcance OPERATOR(pg_catalog.<@) v_alcance_actor) THEN
        RAISE EXCEPTION 'Esa persona trabaja en sedes que vos no ves: pedíselo a alguien que las vea todas.'
          USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_fuera_de_sedes';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_profesional() IS
  'Defensa de profesional.membresia_id: permiso personal, nunca la propia (salvo un dueño), la de un dueño solo un dueño, alcance de sedes. Exceptúa solo a una sesión del dueño de las tablas.';

CREATE TRIGGER profesional_proteger BEFORE INSERT OR UPDATE ON app.profesional
  FOR EACH ROW EXECUTE FUNCTION app.proteger_profesional();

-- ---------------------------------------------------------------------------------------------
-- Invitaciones: 72 horas por defecto; anular guarda el motivo en la membresía
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.crear_invitacion(
  p_nombre text,
  p_email text,
  p_rol_id uuid,
  p_sede_ids uuid[],
  p_sede_defecto_id uuid,
  p_token_hash text,
  p_vence_en timestamptz DEFAULT NULL
) RETURNS TABLE (membresia_id uuid, invitacion_id uuid, vence_en timestamptz)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_sedes uuid[] := COALESCE(p_sede_ids, '{}'::uuid[]);
  v_vence timestamptz := COALESCE(p_vence_en, pg_catalog.now() + interval '72 hours');
  v_membresia uuid;
  v_invitacion uuid;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de invitar.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sede_defecto_id IS NOT NULL AND NOT (p_sede_defecto_id = ANY (v_sedes)) THEN
    RAISE EXCEPTION 'La sede por defecto tiene que estar entre las sedes elegidas.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'invitacion_sede_defecto';
  END IF;
  IF EXISTS (SELECT 1 FROM app.sede s WHERE s.id = ANY (v_sedes) AND s.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Alguna de las sedes elegidas está dada de baja.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'sede_dada_de_baja';
  END IF;

  INSERT INTO app.membresia (clinica_id, rol_id, sede_defecto_id)
  VALUES (v_clinica, p_rol_id, p_sede_defecto_id)
  RETURNING id INTO v_membresia;

  INSERT INTO app.usuario_sede (clinica_id, membresia_id, sede_id)
  SELECT DISTINCT v_clinica, v_membresia, s FROM pg_catalog.unnest(v_sedes) AS s;

  INSERT INTO app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
  VALUES (v_clinica, v_membresia, pg_catalog.lower(pg_catalog.btrim(p_email)), pg_catalog.btrim(p_nombre),
          p_token_hash, v_vence)
  RETURNING id INTO v_invitacion;

  RETURN QUERY SELECT v_membresia, v_invitacion, v_vence;
END
$$;
COMMENT ON FUNCTION app.crear_invitacion(text, text, uuid, uuid[], uuid, text, timestamptz) IS
  'Crea la membresía pendiente (sin usuario) con rol, sedes y sede por defecto, y su invitación (vence a las 72 horas si no se indica). Corre como app_api.';

CREATE OR REPLACE FUNCTION app.reenviar_invitacion(
  p_membresia_id uuid,
  p_token_hash text,
  p_vence_en timestamptz DEFAULT NULL
) RETURNS TABLE (invitacion_id uuid, vence_en timestamptz)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_vence timestamptz := COALESCE(p_vence_en, pg_catalog.now() + interval '72 hours');
  v_email text;
  v_nombre text;
  v_invitacion uuid;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de reenviar.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT i.email, i.nombre INTO v_email, v_nombre
  FROM app.invitacion i
  WHERE i.clinica_id = v_clinica AND i.membresia_id = p_membresia_id
  ORDER BY i.created_at DESC, i.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ninguna invitación para esa persona en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'invitacion_no_encontrada';
  END IF;

  UPDATE app.invitacion i
  SET anulada_en = pg_catalog.now(), motivo_anulacion = 'Reenviada: se generó un enlace nuevo.'
  WHERE i.clinica_id = v_clinica AND i.membresia_id = p_membresia_id
    AND i.usada_en IS NULL AND i.anulada_en IS NULL;

  INSERT INTO app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
  VALUES (v_clinica, p_membresia_id, v_email, v_nombre, p_token_hash, v_vence)
  RETURNING id INTO v_invitacion;

  RETURN QUERY SELECT v_invitacion, v_vence;
END
$$;
COMMENT ON FUNCTION app.reenviar_invitacion(uuid, text, timestamptz) IS
  'Anula la invitación abierta de una membresía pendiente y crea otra (mismo correo y nombre, vence a las 72 horas si no se indica) con un token nuevo. Corre como app_api.';

CREATE OR REPLACE FUNCTION app.anular_invitacion(p_membresia_id uuid, p_motivo text)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de anular.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_motivo IS NULL OR pg_catalog.btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Contanos el motivo de la anulación.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'invitacion_anulacion_check';
  END IF;

  UPDATE app.invitacion i
  SET anulada_en = pg_catalog.now(), motivo_anulacion = pg_catalog.btrim(p_motivo)
  WHERE i.clinica_id = v_clinica AND i.membresia_id = p_membresia_id
    AND i.usada_en IS NULL AND i.anulada_en IS NULL;

  UPDATE app.membresia m SET estado = 'inactivo', motivo_baja = pg_catalog.btrim(p_motivo)
  WHERE m.clinica_id = v_clinica AND m.id = p_membresia_id
    AND m.estado = 'pendiente' AND m.usuario_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ninguna invitación pendiente para esa persona en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'invitacion_no_encontrada';
  END IF;
END
$$;
COMMENT ON FUNCTION app.anular_invitacion(uuid, text) IS
  'Anula la invitación abierta y deja inactiva la membresía pendiente sin usuario, con el motivo como motivo de baja. Corre como app_api.';

-- ---------------------------------------------------------------------------------------------
-- alta_clinica: igual que en 0008, con configuracion:crear para Administración
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

  -- 4. Devolver el contexto de quien llamó.
  PERFORM set_config('app.clinica_id', COALESCE(v_contexto_clinica, ''), true);
  PERFORM set_config('app.usuario_id', COALESCE(v_contexto_usuario, ''), true);
  RETURN v_clinica;
END
$$;
COMMENT ON FUNCTION app.alta_clinica(text, uuid, text, text, text, text, uuid) IS
  'Crea una clínica con sus 5 roles de sistema (con todas_las_sedes, exige_mfa e inactividad_min), la matriz inicial de permisos (Administración con configuracion:crear desde 0015) y la membresía activa del dueño. No ejecutable por app_api.';

GRANT EXECUTE ON FUNCTION app.permisos_de_rol(uuid, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION app.alcance_sedes(uuid, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION app.membresia_en_alcance(uuid) TO app_api;
GRANT EXECUTE ON FUNCTION app.desactivar_membresia(uuid, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.desactivar_rol(uuid, text) TO app_api;

CALL app.asegurar_permisos();
