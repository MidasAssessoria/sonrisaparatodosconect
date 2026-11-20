-- 0010_invitaciones: invitaciones, membresía pendiente sin usuario y roles creados por la clínica.
--
-- 1. membresia.usuario_id es NULL mientras nadie aceptó la invitación. CHECK membresia_usuario_check:
--    sin usuario solo en estado pendiente o inactivo (inactivo sin usuario = invitación anulada antes
--    de aceptarse); una membresía activa siempre tiene usuario. Una vez puesto, usuario_id no cambia
--    (trigger membresia_usuario_fijo, para todos). La única (usuario_id, clinica_id) sigue igual: los
--    NULL no chocan entre sí. Las políticas que miran usuario_id (usuario_ver, membresia_ver,
--    clinica_ver) no ven nada con NULL.
-- 2. app_api ya no crea membresías con usuario (regla membresia_por_invitacion): solo pendientes sin
--    usuario, que reciben su usuario únicamente al aceptar la invitación. Así una clínica no puede
--    «reservar» la identidad de alguien que conoce por su UUID (el problema que 0009 cerró).
-- 3. invitacion: una por membresía pendiente, con el hash SHA-256 (hex) del token. La base nunca ve
--    el token. Índices únicos parciales: una sola invitación abierta (sin usar ni anular) por
--    membresía y por (clínica, correo). Una invitación vencida sigue «abierta» hasta que se reenvía o
--    se anula: así la membresía pendiente no queda duplicada.
-- 4. app.proteger_acceso() (reemplaza la de 0009, mismas reglas más):
--    * la excepción del dueño de las tablas exige que también la SESIÓN sea de ese rol
--      (session_user): una función SECURITY DEFINER llamada por app_api corre como el dueño, pero su
--      sesión sigue siendo app_api, y ahí se aplican todas las reglas con el usuario del contexto.
--      El único cambio permitido en ese caso sin membresía activa previa es la aceptación (abajo);
--    * aceptación: pendiente sin usuario -> activo con usuario = actor, sin tocar rol ni sede por
--      defecto, solo dentro de una función SECURITY DEFINER y solo si en esta misma transacción se
--      marcó usada una invitación de esa membresía por ese usuario (lo hace app.aceptar_invitacion);
--    * pendiente sin usuario -> inactivo (anular la invitación), si ya no tiene invitación abierta;
--    * permisos aceptados (cualquiera de la lista): membresia alta personal:crear; pendiente ->
--      inactivo personal:editar o personal:anular; otros cambios personal:editar; usuario_sede alta
--      personal:crear o personal:editar; rol alta configuracion:crear o configuracion:editar;
--      desactivar un rol configuracion:anular o configuracion:editar; rol_permiso
--      configuracion:editar, o configuracion:crear para un rol creado en esta transacción por el
--      mismo actor (crear un rol con su matriz);
--    * un rol no se desactiva si lo usa alguna membresía activa o pendiente (rol_en_uso), y una
--      membresía activa o pendiente no toma un rol desactivado (rol_inactivo). La membresía toma el
--      rol con bloqueo compartido: una desactivación simultánea espera y vuelve a mirar.
-- 5. Roles creados por la clínica: codigo deja de ser obligatorio para app_api (valor por defecto
--    'r' + 32 hex, nunca un código de sistema). La API muestra codigo solo si es_sistema.
--    Decisión (revisada): un rol puede otorgar permisos que quien lo edita no tiene. Restringirlo no
--    cierra la escalada real: quien tiene personal:crear ya puede invitar una segunda cuenta propia
--    con un rol de sistema que tiene más permisos (p. ej. odontologo, con ficha clínica). Lo que sí
--    queda cerrado: nadie edita su propio rol ni su membresía, y el rol dueño solo lo da un dueño.
--    El control de ese riesgo es la auditoría (cada alta de rol, permiso, invitación y aceptación).
-- 6. Funciones nuevas que app_api puede ejecutar:
--    * SECURITY INVOKER (corren como app_api: RLS, permisos y app.proteger_acceso completos):
--      app.crear_invitacion, app.reenviar_invitacion, app.anular_invitacion,
--      app.reemplazar_permisos_rol.
--    * SECURITY DEFINER, sin contexto de clínica: app.consultar_invitacion y app.aceptar_invitacion.
--
-- Límite de confianza de app.aceptar_invitacion(p_token_hash, p_usuario_id, p_email): la base confía
-- en que la API pasa un p_usuario_id y un p_email VERIFICADOS (el sub y el correo del JWT, o la
-- cuenta que la API acaba de crear con la Admin API de Supabase Auth para ese mismo correo). Con SQL
-- como app_api se podrían inventar, igual que se puede fijar cualquier clínica en el contexto. Lo
-- demás se defiende solo: la función solo activa la membresía de ESE token, con el rol y las sedes que
-- eligió la clínica (no recibe ni rol ni sedes), solo si el correo coincide con el de la invitación y,
-- si la persona ya tiene cuenta, solo con su mismo id; el token se usa una vez (bloqueo de fila: de
-- varias aceptaciones simultáneas gana una) y la activación pasa igual por app.proteger_acceso().
--
-- Búsquedas sin clínica dentro de las funciones SECURITY DEFINER: invitacion y usuario tienen RLS
-- forzado también para su dueño. Dos políticas de solo lectura, que valen únicamente cuando quien
-- consulta tiene los privilegios del dueño de las tablas (current_user; app_api nunca), dejan ver la
-- fila cuyo token_hash es app.invitacion_token_hash, o el usuario cuyo correo es
-- app.usuario_email_buscado. Las funciones fijan esos parámetros solo durante la búsqueda y
-- app.registrar_evento() los limpia al empezar.

-- ---------------------------------------------------------------------------------------------
-- 1. membresia
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.membresia ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE app.membresia ADD CONSTRAINT membresia_usuario_check
  CHECK (usuario_id IS NOT NULL OR estado IN ('pendiente', 'inactivo'));
COMMENT ON COLUMN app.membresia.usuario_id IS
  'NULL mientras la invitación no se aceptó (pendiente) o si se anuló antes (inactivo). Se fija una sola vez, al aceptar.';

-- usuario_id deja de ser inmutable sin más: pasa de NULL a un valor una vez (al aceptar).
DROP TRIGGER membresia_auditoria_fila ON app.membresia;
CREATE TRIGGER membresia_auditoria_fila BEFORE INSERT OR UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila();

CREATE OR REPLACE FUNCTION app.fijar_usuario_membresia() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.usuario_id IS NOT NULL AND NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
    RAISE EXCEPTION 'La columna usuario_id de app.membresia no se puede cambiar: creá un registro nuevo.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.fijar_usuario_membresia() IS
  'El usuario de una membresía se fija una sola vez (de NULL a un valor) y después no cambia. Para todos los roles.';

CREATE TRIGGER membresia_usuario_fijo BEFORE UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.fijar_usuario_membresia();

-- ---------------------------------------------------------------------------------------------
-- 2. rol: código por defecto para los roles de la clínica
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.rol
  ALTER COLUMN codigo SET DEFAULT ('r' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''));
COMMENT ON COLUMN app.rol.codigo IS
  'Código estable. Roles de sistema: dueno, administracion, odontologo, asistente, recepcion. Roles de la clínica: r + 32 hex (interno; la API muestra null).';

-- ---------------------------------------------------------------------------------------------
-- 3. invitacion
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.invitacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  membresia_id uuid NOT NULL,
  email text NOT NULL
    CONSTRAINT invitacion_email_check CHECK (
      email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND length(email) <= 254),
  nombre text NOT NULL
    CONSTRAINT invitacion_nombre_check CHECK (btrim(nombre) <> '' AND length(nombre) <= 120),
  token_hash text NOT NULL
    CONSTRAINT invitacion_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  vence_en timestamptz NOT NULL,
  usada_en timestamptz,
  usada_por uuid REFERENCES app.usuario (id),
  anulada_en timestamptz,
  motivo_anulacion text,
  invitada_por uuid REFERENCES app.usuario (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT invitacion_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT invitacion_token_hash_key UNIQUE (token_hash),
  CONSTRAINT invitacion_membresia_fkey FOREIGN KEY (clinica_id, membresia_id)
    REFERENCES app.membresia (clinica_id, id),
  CONSTRAINT invitacion_uso_check CHECK ((usada_en IS NULL) = (usada_por IS NULL)),
  CONSTRAINT invitacion_anulacion_check CHECK (
    (anulada_en IS NULL) = (motivo_anulacion IS NULL)
    AND (motivo_anulacion IS NULL OR btrim(motivo_anulacion) <> '')),
  CONSTRAINT invitacion_usada_o_anulada_check CHECK (usada_en IS NULL OR anulada_en IS NULL)
);
COMMENT ON TABLE app.invitacion IS
  'Invitación a una membresía pendiente. Guarda solo el SHA-256 (hex) del token. Se usa una vez, vence (vence_en) y se anula al reenviar o anular. Se escribe con app.crear_invitacion/reenviar_invitacion/anular_invitacion; se acepta con app.aceptar_invitacion.';
COMMENT ON COLUMN app.invitacion.email IS 'Correo invitado, en minúsculas. Igual en todas las invitaciones de una membresía.';
COMMENT ON COLUMN app.invitacion.nombre IS 'Nombre de la persona invitada: es el nombre de su usuario si no tenía cuenta.';

-- Una sola invitación abierta (sin usar ni anular) por membresía y por correo en cada clínica.
CREATE UNIQUE INDEX invitacion_abierta_membresia ON app.invitacion (clinica_id, membresia_id)
  WHERE usada_en IS NULL AND anulada_en IS NULL;
CREATE UNIQUE INDEX invitacion_abierta_email ON app.invitacion (clinica_id, email)
  WHERE usada_en IS NULL AND anulada_en IS NULL;
CREATE INDEX invitacion_membresia_idx ON app.invitacion (clinica_id, membresia_id, created_at DESC);

CREATE TRIGGER invitacion_auditoria_fila BEFORE INSERT OR UPDATE ON app.invitacion
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila(
    'membresia_id', 'email', 'nombre', 'token_hash', 'vence_en', 'invitada_por');
CREATE TRIGGER invitacion_auditar AFTER INSERT OR UPDATE OR DELETE ON app.invitacion
  FOR EACH ROW EXECUTE FUNCTION app.auditar('personal');
CREATE TRIGGER invitacion_sin_borrado BEFORE DELETE OR TRUNCATE ON app.invitacion
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

ALTER TABLE app.invitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitacion FORCE ROW LEVEL SECURITY;
CREATE POLICY invitacion_aislamiento ON app.invitacion
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());
-- Búsqueda por token sin clínica: solo con los privilegios del dueño de las tablas (las funciones
-- SECURITY DEFINER de invitación). app_api no la puede usar aunque fije el parámetro.
CREATE POLICY invitacion_por_token ON app.invitacion
  FOR SELECT
  USING (
    token_hash = pg_catalog.current_setting('app.invitacion_token_hash', true)
    AND pg_catalog.pg_has_role(
      CURRENT_USER,
      (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'app.invitacion'::pg_catalog.regclass),
      'USAGE')
  );

-- app_api: lee, crea (sin elegir id, uso, anulación ni autor) y solo anula. El uso lo marca
-- app.aceptar_invitacion.
GRANT SELECT ON app.invitacion TO app_api;
GRANT INSERT (clinica_id, membresia_id, email, nombre, token_hash, vence_en) ON app.invitacion TO app_api;
GRANT UPDATE (anulada_en, motivo_anulacion) ON app.invitacion TO app_api;

-- usuario: búsqueda por correo sin clínica, solo para el dueño de las tablas (consultar y aceptar).
CREATE POLICY usuario_por_correo ON app.usuario
  FOR SELECT
  USING (
    pg_catalog.lower(email) = pg_catalog.current_setting('app.usuario_email_buscado', true)
    AND pg_catalog.pg_has_role(
      CURRENT_USER,
      (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'app.usuario'::pg_catalog.regclass),
      'USAGE')
  );

-- ---------------------------------------------------------------------------------------------
-- 4. app.proteger_acceso() (ver el encabezado y 0009)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_acceso() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_clinica uuid := NEW.clinica_id;
  v_dueno_tablas oid;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_rol_dueno uuid;
  v_permisos text[];
  v_objetivo_usuario uuid;
  v_objetivo_rol uuid;
  v_rol_activo boolean;
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

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto: los cambios de personal y de roles tienen autor.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_sin_actor';
  END IF;

  -- a. Membresía activa del actor en la clínica de la fila, con rol activo y clínica activa.
  SELECT m.rol_id, (r.es_sistema AND r.codigo = 'dueno')
    INTO v_rol_actor, v_actor_dueno
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
    ELSIF OLD.estado = 'pendiente' AND NEW.estado = 'inactivo' THEN
      v_permisos := ARRAY['personal:editar', 'personal:anular'];
    ELSE
      v_permisos := ARRAY['personal:editar'];
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
    ELSIF OLD.activo AND NOT NEW.activo THEN
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
    IF TG_OP = 'UPDATE' AND OLD.activo AND NOT NEW.activo AND EXISTS (
      SELECT 1 FROM app.membresia m
      WHERE m.clinica_id = v_clinica AND m.rol_id = NEW.id AND m.estado IN ('activo', 'pendiente')
    ) THEN
      RAISE EXCEPTION 'Ese rol lo usa alguien del equipo (o una invitación pendiente): cambiales el rol antes de desactivarlo.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'rol_en_uso';
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
  END IF;

  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_acceso() IS
  'Defensa de membresia, usuario_sede, rol y rol_permiso: permiso del actor, nada propio, rol dueño protegido, membresía por invitación, roles en uso. Exceptúa solo a una sesión del dueño de las tablas.';

-- ---------------------------------------------------------------------------------------------
-- 5. app.proteger_invitacion(): defensa de invitacion (BEFORE INSERT OR UPDATE, SECURITY INVOKER)
-- ---------------------------------------------------------------------------------------------
--   * Sesión del dueño de las tablas (migraciones, fábricas de prueba): sin reglas.
--   * Dentro de una función SECURITY DEFINER llamada por app_api: solo marcar usada una invitación
--     abierta por el usuario del contexto (app.aceptar_invitacion).
--   * app_api: actor con membresía activa; alta con personal:crear, anulación con personal:crear
--     (reenviar) o personal:anular. La membresía tiene que estar pendiente y sin usuario, y ser de un
--     dueño solo si quien invita es dueño. El correo es el mismo de las invitaciones anteriores de esa
--     membresía (reenviar no cambia a quién se invita) y no puede ser el de alguien que ya es o fue
--     miembro de la clínica. vence_en entre ahora y 30 días. invitada_por y anulada_en los fija la base.
CREATE OR REPLACE FUNCTION app.proteger_invitacion() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_dueno_tablas oid;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_rol_dueno uuid;
  v_hay_membresia boolean;
  v_estado text;
  v_usuario uuid;
  v_rol uuid;
  v_email_previo text;
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

  SELECT m.rol_id, (r.es_sistema AND r.codigo = 'dueno')
    INTO v_rol_actor, v_actor_dueno
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
  'Defensa de invitacion: permiso del actor, membresía pendiente sin usuario, mismo correo al reenviar, nadie que ya sea miembro, uso solo por app.aceptar_invitacion.';

CREATE TRIGGER invitacion_proteger BEFORE INSERT OR UPDATE ON app.invitacion
  FOR EACH ROW EXECUTE FUNCTION app.proteger_invitacion();

-- ---------------------------------------------------------------------------------------------
-- 6. Funciones de invitación para la clínica (SECURITY INVOKER: corren como app_api)
-- ---------------------------------------------------------------------------------------------

-- Alta: membresía pendiente sin usuario (rol, sede por defecto y sedes) y su invitación.
-- p_token_hash: SHA-256 hex del token (la API genera el token y lo devuelve una sola vez).
-- p_vence_en: por defecto, dentro de 7 días; entre ahora y 30 días.
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
  v_vence timestamptz := COALESCE(p_vence_en, pg_catalog.now() + interval '7 days');
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
  'Crea la membresía pendiente (sin usuario) con rol, sedes y sede por defecto, y su invitación. Corre como app_api.';

-- Reenvío: anula la invitación abierta (si hay) y crea otra para el mismo correo y nombre.
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
  v_vence timestamptz := COALESCE(p_vence_en, pg_catalog.now() + interval '7 days');
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
  'Anula la invitación abierta de una membresía pendiente y crea otra (mismo correo y nombre) con un token nuevo. Corre como app_api.';

-- Anulación: anula la invitación abierta (si hay) y deja la membresía pendiente sin usuario inactiva.
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

  UPDATE app.membresia m SET estado = 'inactivo'
  WHERE m.clinica_id = v_clinica AND m.id = p_membresia_id
    AND m.estado = 'pendiente' AND m.usuario_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay ninguna invitación pendiente para esa persona en esta clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'invitacion_no_encontrada';
  END IF;
END
$$;
COMMENT ON FUNCTION app.anular_invitacion(uuid, text) IS
  'Anula la invitación abierta y deja inactiva la membresía pendiente sin usuario. Corre como app_api.';

-- ---------------------------------------------------------------------------------------------
-- 7. Funciones públicas de invitación (SECURITY DEFINER, sin contexto de clínica)
-- ---------------------------------------------------------------------------------------------

-- Lo que ve quien abre el enlace. Sin fila si el hash no existe, venció, se usó, se anuló, la
-- membresía ya no está pendiente o la clínica está de baja (no distingue el caso). Solo datos de esa
-- invitación; usuario_existe = ya hay una cuenta con ese correo (hay que ingresar antes de aceptar).
CREATE OR REPLACE FUNCTION app.consultar_invitacion(p_token_hash text)
  RETURNS TABLE (
    clinica text,
    rol text,
    nombre text,
    email text,
    vence_en timestamptz,
    usuario_existe boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_ctx_clinica text := pg_catalog.current_setting('app.clinica_id', true);
  v_ctx_usuario text := pg_catalog.current_setting('app.usuario_id', true);
  v_id uuid;
  v_clinica uuid;
  v_fila record;
  v_encontrada boolean := false;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.invitacion_token_hash', p_token_hash, true);
  SELECT i.id, i.clinica_id INTO v_id, v_clinica FROM app.invitacion i WHERE i.token_hash = p_token_hash;
  PERFORM pg_catalog.set_config('app.invitacion_token_hash', '', true);
  IF v_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.clinica_id', v_clinica::text, true);
  PERFORM pg_catalog.set_config('app.usuario_id', '', true);
  SELECT c.nombre AS clinica_nombre, r.nombre AS rol_nombre, i.nombre AS persona, i.email AS correo,
         i.vence_en AS vence
    INTO v_fila
  FROM app.invitacion i
  JOIN app.membresia m ON m.clinica_id = i.clinica_id AND m.id = i.membresia_id
  JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
  JOIN app.clinica c ON c.id = i.clinica_id
  WHERE i.id = v_id
    AND i.usada_en IS NULL AND i.anulada_en IS NULL AND i.vence_en > pg_catalog.now()
    AND m.estado = 'pendiente' AND m.usuario_id IS NULL
    AND c.activo AND r.activo;
  IF FOUND THEN
    v_encontrada := true;
    clinica := v_fila.clinica_nombre;
    rol := v_fila.rol_nombre;
    nombre := v_fila.persona;
    email := v_fila.correo;
    vence_en := v_fila.vence;
    PERFORM pg_catalog.set_config('app.usuario_email_buscado', v_fila.correo, true);
    usuario_existe := EXISTS (
      SELECT 1 FROM app.usuario u WHERE pg_catalog.lower(u.email) = v_fila.correo);
    PERFORM pg_catalog.set_config('app.usuario_email_buscado', '', true);
  END IF;

  PERFORM pg_catalog.set_config('app.clinica_id', COALESCE(v_ctx_clinica, ''), true);
  PERFORM pg_catalog.set_config('app.usuario_id', COALESCE(v_ctx_usuario, ''), true);
  IF v_encontrada THEN
    RETURN NEXT;
  END IF;
END
$$;
COMMENT ON FUNCTION app.consultar_invitacion(text) IS
  'Datos públicos de una invitación vigente por el SHA-256 de su token (sin fila si no sirve, sin decir por qué). Ejecutable por app_api sin contexto.';

-- Aceptación. Ver el límite de confianza en el encabezado. Devuelve la clínica.
-- Errores (campo constraint): invitacion_no_vigente (P0002: hash inexistente, vencido, usado,
-- anulado, membresía no pendiente o clínica de baja, sin distinguir), invitacion_otro_correo
-- (42501: p_email no es el de la invitación), invitacion_otra_cuenta (42501: ese correo ya es de
-- otra cuenta, o la cuenta p_usuario_id tiene otro correo), membresia_usuario_clinica_key (23505:
-- la persona ya tiene una membresía en esa clínica).
CREATE OR REPLACE FUNCTION app.aceptar_invitacion(p_token_hash text, p_usuario_id uuid, p_email text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ctx_clinica text := pg_catalog.current_setting('app.clinica_id', true);
  v_ctx_usuario text := pg_catalog.current_setting('app.usuario_id', true);
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_clinica uuid;
  v_correo text;
  v_inv record;
  v_correo_cuenta text;
  v_otra boolean;
BEGIN
  IF p_usuario_id IS NULL OR v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Faltan el usuario y el correo verificados de quien acepta.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Ese enlace de invitación no sirve: pedí uno nuevo a la clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'invitacion_no_vigente';
  END IF;

  -- 1. Clínica y correo de la invitación (búsqueda por token, sin clínica).
  PERFORM pg_catalog.set_config('app.invitacion_token_hash', p_token_hash, true);
  SELECT i.clinica_id, i.email INTO v_clinica, v_correo FROM app.invitacion i WHERE i.token_hash = p_token_hash;
  PERFORM pg_catalog.set_config('app.invitacion_token_hash', '', true);
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Ese enlace de invitación no sirve: pedí uno nuevo a la clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'invitacion_no_vigente';
  END IF;

  -- 2. Mismo bloqueo que app.proteger_invitacion(): un correo, una persona por clínica.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'app.invitacion:' || v_clinica::text || ':' || v_correo, 0));

  -- 3. Con la clínica de la invitación y la persona como contexto: bloquear la invitación y revisar
  --    que siga vigente (de varias aceptaciones simultáneas, las demás la ven usada).
  PERFORM pg_catalog.set_config('app.clinica_id', v_clinica::text, true);
  PERFORM pg_catalog.set_config('app.usuario_id', p_usuario_id::text, true);
  SELECT i.id, i.membresia_id, i.email, i.nombre, i.usada_en, i.anulada_en, i.vence_en
    INTO v_inv
  FROM app.invitacion i
  WHERE i.clinica_id = v_clinica AND i.token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND OR v_inv.usada_en IS NOT NULL OR v_inv.anulada_en IS NOT NULL
     OR v_inv.vence_en <= pg_catalog.now()
     OR NOT EXISTS (
       SELECT 1 FROM app.membresia m
       JOIN app.rol r ON r.clinica_id = m.clinica_id AND r.id = m.rol_id
       JOIN app.clinica c ON c.id = m.clinica_id
       WHERE m.clinica_id = v_clinica AND m.id = v_inv.membresia_id
         AND m.estado = 'pendiente' AND m.usuario_id IS NULL AND c.activo AND r.activo) THEN
    RAISE EXCEPTION 'Ese enlace de invitación no sirve: pedí uno nuevo a la clínica.'
      USING ERRCODE = 'no_data_found', CONSTRAINT = 'invitacion_no_vigente';
  END IF;

  -- 4. El correo verificado por la API tiene que ser el de la invitación.
  IF v_email <> v_inv.email THEN
    RAISE EXCEPTION 'Esta invitación es para otro correo: ingresá con la cuenta del correo invitado.'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_otro_correo';
  END IF;

  -- 5. Identidad: la cuenta existente (fila propia) tiene que ser la de ese correo; si no existe, se
  --    crea con el nombre de la invitación, salvo que el correo ya sea de otra cuenta.
  SELECT pg_catalog.lower(u.email) INTO v_correo_cuenta FROM app.usuario u WHERE u.id = p_usuario_id;
  IF FOUND THEN
    IF v_correo_cuenta <> v_inv.email THEN
      RAISE EXCEPTION 'Esa cuenta tiene otro correo: ingresá con la cuenta del correo invitado.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_otra_cuenta';
    END IF;
  ELSE
    PERFORM pg_catalog.set_config('app.usuario_email_buscado', v_inv.email, true);
    v_otra := EXISTS (SELECT 1 FROM app.usuario u WHERE pg_catalog.lower(u.email) = v_inv.email);
    PERFORM pg_catalog.set_config('app.usuario_email_buscado', '', true);
    IF v_otra THEN
      RAISE EXCEPTION 'Ese correo ya tiene una cuenta: ingresá con ella para aceptar la invitación.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'invitacion_otra_cuenta';
    END IF;
    INSERT INTO app.usuario (id, nombre, email) VALUES (p_usuario_id, v_inv.nombre, v_inv.email);
  END IF;

  -- 6. Invitación usada y membresía activa (pasa por app.proteger_invitacion y app.proteger_acceso).
  UPDATE app.invitacion SET usada_en = pg_catalog.now(), usada_por = p_usuario_id
  WHERE clinica_id = v_clinica AND id = v_inv.id;
  UPDATE app.membresia SET usuario_id = p_usuario_id, estado = 'activo'
  WHERE clinica_id = v_clinica AND id = v_inv.membresia_id;

  PERFORM pg_catalog.set_config('app.clinica_id', COALESCE(v_ctx_clinica, ''), true);
  PERFORM pg_catalog.set_config('app.usuario_id', COALESCE(v_ctx_usuario, ''), true);
  RETURN v_clinica;
END
$$;
COMMENT ON FUNCTION app.aceptar_invitacion(text, uuid, text) IS
  'Acepta una invitación vigente: crea el usuario si no existe, le pone el usuario a la membresía, la activa y marca la invitación usada. Confía en p_usuario_id y p_email (verificados por la API). Ejecutable por app_api sin contexto.';

-- ---------------------------------------------------------------------------------------------
-- 8. Matriz de permisos de un rol (SECURITY INVOKER)
-- ---------------------------------------------------------------------------------------------
-- p_permisos: 'modulo:accion'. Lo que falta se revoca con activo = false (no se borra); lo que
-- vuelve se reactiva. Bloquea el rol mientras tanto (dos reemplazos simultáneos no se mezclan).
-- Devuelve cuántos permisos activos quedan.
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

  INSERT INTO app.rol_permiso AS p (clinica_id, rol_id, modulo, accion)
  SELECT v_clinica, p_rol_id, pg_catalog.split_part(x, ':', 1), pg_catalog.split_part(x, ':', 2)
  FROM pg_catalog.unnest(v_permisos) AS x
  ON CONFLICT (clinica_id, rol_id, modulo, accion) DO UPDATE SET activo = true WHERE NOT p.activo;

  UPDATE app.rol_permiso p SET activo = false
  WHERE p.clinica_id = v_clinica AND p.rol_id = p_rol_id AND p.activo
    AND NOT ((p.modulo || ':' || p.accion) = ANY (v_permisos));

  SELECT pg_catalog.count(*)::integer INTO v_cantidad
  FROM app.rol_permiso p WHERE p.clinica_id = v_clinica AND p.rol_id = p_rol_id AND p.activo;
  RETURN v_cantidad;
END
$$;
COMMENT ON FUNCTION app.reemplazar_permisos_rol(uuid, text[]) IS
  'Reemplaza la matriz de permisos de un rol (lo que falta queda activo = false). Corre como app_api; app.proteger_acceso decide.';

GRANT EXECUTE ON FUNCTION app.crear_invitacion(text, text, uuid, uuid[], uuid, text, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.reenviar_invitacion(uuid, text, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.anular_invitacion(uuid, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.consultar_invitacion(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.aceptar_invitacion(text, uuid, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.reemplazar_permisos_rol(uuid, text[]) TO app_api;

CALL app.asegurar_permisos();
