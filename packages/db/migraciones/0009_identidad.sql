-- 0009_identidad: identidad y escalada de privilegios.
--
--   1. usuario: app_api solo actualiza nombre, telefono y ultimo_acceso de la fila propia (GRANT por
--      columna + política). email y mfa_activo dejan de ser escribibles por app_api.
--   2. Doble factor por funciones SECURITY DEFINER sobre app.usuario_actual(): app.activar_mfa() y
--      app.desactivar_mfa(), que además guarda mfa_desactivado_en para ignorar tokens aal2 viejos.
--      Cada cambio queda auditado en todas las clínicas con membresía activa (app.auditar, 0007).
--   3. usuario_ver: una membresía pendiente ya no deja ver el perfil. Para que eso no se esquive,
--      una membresía nueva nace pendiente y solo la persona la activa (al aceptar la invitación,
--      función del Sprint 2) o la administración del sistema.
--   4. Restricciones únicas de rol_permiso y usuario_sede con clinica_id: con el UUID de un rol o una
--      membresía de otra clínica, la respuesta es siempre la del FK (no revela qué tiene).
--   5. Trigger de defensa app.proteger_acceso() en membresia, usuario_sede, rol y rol_permiso, y
--      app.proteger_ultimo_dueno(): una clínica no se queda sin dueño activo.
--
-- Reglas de app.proteger_acceso() (BEFORE INSERT OR UPDATE FOR EACH ROW, SECURITY INVOKER):
--   Para todos, también migraciones: el rol de sistema 'dueno' no se desactiva.
--   Excepción explícita: quien tiene los privilegios del dueño de la tabla (pg_has_role USAGE sobre
--   el relowner). Es el rol de migraciones y, por lo tanto, app.alta_clinica() y los scripts de
--   administración, que solo ese rol puede ejecutar. app_api no es miembro de ningún rol (lo verifica
--   una meta-prueba) y no hay ningún parámetro de contexto que cambie esto. Las funciones SECURITY
--   DEFINER corren como ese rol: por eso ninguna función que app_api pueda ejecutar escribe en estas
--   cuatro tablas (otra meta-prueba).
--   Para el resto (app_api), con el usuario del contexto como «actor»:
--     a. tiene que haber actor, con membresía activa, rol activo y clínica activa en la clínica de la
--        fila (su membresía queda con bloqueo compartido hasta el fin de la transacción);
--     b. permiso: membresia/usuario_sede -> personal:crear al dar de alta, personal:editar al
--        cambiar; rol/rol_permiso -> configuracion:editar;
--     c. nadie toca su propia membresía, sus propias sedes, su propio rol ni los permisos de su rol;
--     d. el rol de sistema 'dueno' y sus permisos no los cambia nadie más que migraciones (tiene todo
--        por definición); solo un dueño da, quita o cambia membresías y sedes de un dueño;
--     e. una membresía nueva nace pendiente, y una pendiente no pasa a activa ni a inactiva por la
--        clínica (las dos dejarían ver el perfil): solo cuando la persona acepta. Tampoco se vuelve
--        a pendiente (reincorporar a quien fue miembro es inactivo -> activo);
--     f. app_api no crea roles de sistema.
--   Los errores son 42501 con un nombre de regla en el campo «constraint» del error (ver
--   RESTRICCIONES_ACCESO en src/esquema.ts) para que la API elija el mensaje.

-- ---------------------------------------------------------------------------------------------
-- 1 y 2. usuario: escritura por columna y doble factor por función
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.usuario ADD COLUMN mfa_desactivado_en timestamptz;
COMMENT ON COLUMN app.usuario.mfa_desactivado_en IS
  'Última baja del doble factor: la API ignora tokens aal2 emitidos hasta ese momento.';

REVOKE UPDATE ON app.usuario FROM app_api;
GRANT UPDATE (nombre, telefono, ultimo_acceso) ON app.usuario TO app_api;

-- Marca el doble factor como activo para el usuario del contexto. p_token_emitido_en es el iat del
-- token aal2 que lo prueba: si es anterior o igual a la última baja, no activa nada y devuelve false
-- (es un token de antes de quitar el factor). Devuelve true si mfa_activo queda en true.
CREATE OR REPLACE FUNCTION app.activar_mfa(p_token_emitido_en timestamptz) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := app.usuario_actual();
  v_activo boolean;
  v_baja timestamptz;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_token_emitido_en IS NULL OR p_token_emitido_en > pg_catalog.now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Falta la fecha de emisión del token (iat) o está en el futuro.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT u.mfa_activo, u.mfa_desactivado_en INTO v_activo, v_baja
  FROM app.usuario u WHERE u.id = v_usuario
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario del contexto no existe.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_activo THEN
    RETURN true;
  END IF;
  IF v_baja IS NOT NULL AND p_token_emitido_en <= v_baja THEN
    RETURN false;
  END IF;
  UPDATE app.usuario SET mfa_activo = true WHERE id = v_usuario;
  RETURN true;
END
$$;
COMMENT ON FUNCTION app.activar_mfa(timestamptz) IS
  'Marca mfa_activo del usuario del contexto si el token (iat) es posterior a la última baja. true si queda activo.';

-- Baja del doble factor del usuario del contexto (la API la llama con un token aal2, justo después de
-- quitar el factor en Supabase). Devuelve mfa_desactivado_en: los tokens aal2 emitidos hasta ese
-- momento ya no cuentan.
CREATE OR REPLACE FUNCTION app.desactivar_mfa() RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := app.usuario_actual();
  v_baja timestamptz;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario del contexto.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE app.usuario SET mfa_activo = false, mfa_desactivado_en = pg_catalog.now()
  WHERE id = v_usuario
  RETURNING mfa_desactivado_en INTO v_baja;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario del contexto no existe.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_baja;
END
$$;
COMMENT ON FUNCTION app.desactivar_mfa() IS
  'Desactiva el doble factor del usuario del contexto y guarda mfa_desactivado_en (que devuelve).';

GRANT EXECUTE ON FUNCTION app.activar_mfa(timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.desactivar_mfa() TO app_api;

-- ---------------------------------------------------------------------------------------------
-- 3. usuario_ver sin membresías pendientes
-- ---------------------------------------------------------------------------------------------
-- Se ve la fila propia y las de quienes son o fueron miembros (activo o inactivo) de la clínica
-- del contexto. Una invitación pendiente no muestra nada de la persona.
DROP POLICY usuario_ver ON app.usuario;
CREATE POLICY usuario_ver ON app.usuario
  FOR SELECT
  USING (
    id = app.usuario_actual()
    OR EXISTS (
      SELECT 1 FROM app.membresia m
      WHERE m.usuario_id = usuario.id AND m.clinica_id = app.clinica_actual()
        AND m.estado IN ('activo', 'inactivo')
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 4. Únicas con clinica_id
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.rol_permiso DROP CONSTRAINT rol_permiso_unico;
ALTER TABLE app.rol_permiso
  ADD CONSTRAINT rol_permiso_unico UNIQUE (clinica_id, rol_id, modulo, accion);
ALTER TABLE app.usuario_sede DROP CONSTRAINT usuario_sede_unico;
ALTER TABLE app.usuario_sede
  ADD CONSTRAINT usuario_sede_unico UNIQUE (clinica_id, membresia_id, sede_id);

-- ---------------------------------------------------------------------------------------------
-- 5. Trigger de defensa
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_acceso() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actor uuid := app.usuario_actual();
  v_clinica uuid := NEW.clinica_id;
  v_rol_actor uuid;
  v_actor_dueno boolean;
  v_rol_dueno uuid;
  v_modulo text;
  v_accion text;
  v_objetivo_usuario uuid;
  v_objetivo_rol uuid;
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

  -- Excepción explícita: el rol dueño de la tabla (migraciones, alta_clinica, administración).
  IF pg_catalog.pg_has_role(
       current_user,
       (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID),
       'USAGE') THEN
    RETURN NEW;
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

  -- b. Permiso del módulo.
  IF TG_TABLE_NAME IN ('membresia', 'usuario_sede') THEN
    v_modulo := 'personal';
    v_accion := CASE WHEN TG_OP = 'INSERT' THEN 'crear' ELSE 'editar' END;
  ELSE
    v_modulo := 'configuracion';
    v_accion := 'editar';
  END IF;
  PERFORM 1 FROM app.rol_permiso p
  WHERE p.clinica_id = v_clinica AND p.rol_id = v_rol_actor
    AND p.modulo = v_modulo AND p.accion = v_accion AND p.activo
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu rol no tiene el permiso %:% que hace falta para este cambio.', v_modulo, v_accion
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
    -- Pendiente es solo el estado de alta: no se sale de él (ni a activo ni a inactivo, que dejan
    -- ver el perfil) ni se vuelve a él. Reincorporar a alguien que fue miembro es inactivo -> activo.
    IF TG_OP = 'UPDATE' AND (OLD.estado = 'pendiente') <> (NEW.estado = 'pendiente') THEN
      RAISE EXCEPTION 'Una membresía pendiente cambia solo cuando la persona acepta la invitación.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'membresia_nace_pendiente';
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

  ELSIF TG_TABLE_NAME = 'rol_permiso' THEN
    IF NEW.rol_id = v_rol_actor OR (TG_OP = 'UPDATE' AND OLD.rol_id = v_rol_actor) THEN
      RAISE EXCEPTION 'No podés cambiar los permisos de tu propio rol: pedíselo a otra persona con permiso.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_propio';
    END IF;
    IF NEW.rol_id = v_rol_dueno OR (TG_OP = 'UPDATE' AND OLD.rol_id = v_rol_dueno) THEN
      RAISE EXCEPTION 'Los permisos del rol Dueño/a no se modifican: tiene todos por definición.'
        USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'acceso_rol_dueno';
    END IF;

  ELSE
    RAISE EXCEPTION 'app.proteger_acceso() no está pensada para %.%.', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.proteger_acceso() IS
  'Defensa de membresia, usuario_sede, rol y rol_permiso: permiso del actor, nada propio, rol dueño protegido. Exceptúa al dueño de las tablas.';

CREATE TRIGGER membresia_proteger BEFORE INSERT OR UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.proteger_acceso();
CREATE TRIGGER usuario_sede_proteger BEFORE INSERT OR UPDATE ON app.usuario_sede
  FOR EACH ROW EXECUTE FUNCTION app.proteger_acceso();
CREATE TRIGGER rol_proteger BEFORE INSERT OR UPDATE ON app.rol
  FOR EACH ROW EXECUTE FUNCTION app.proteger_acceso();
CREATE TRIGGER rol_permiso_proteger BEFORE INSERT OR UPDATE ON app.rol_permiso
  FOR EACH ROW EXECUTE FUNCTION app.proteger_acceso();

-- Último dueño (para todos, también migraciones): si una membresía deja de ser de un dueño activo
-- (cambia de estado o de rol), tiene que quedar otro dueño activo en la clínica. Los otros dueños
-- quedan con bloqueo compartido hasta el fin de la transacción: dos bajas simultáneas de los dos
-- últimos dueños no pueden pasar las dos (una espera y falla, o el detector de bloqueos aborta una).
CREATE OR REPLACE FUNCTION app.proteger_ultimo_dueno() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_rol_dueno uuid;
BEGIN
  SELECT r.id INTO v_rol_dueno
  FROM app.rol r WHERE r.clinica_id = OLD.clinica_id AND r.es_sistema AND r.codigo = 'dueno';
  IF v_rol_dueno IS NULL OR OLD.estado <> 'activo' OR OLD.rol_id <> v_rol_dueno THEN
    RETURN NULL;
  END IF;
  IF NEW.estado = 'activo' AND NEW.rol_id = v_rol_dueno THEN
    RETURN NULL;
  END IF;
  PERFORM 1 FROM app.membresia m
  WHERE m.clinica_id = OLD.clinica_id AND m.rol_id = v_rol_dueno AND m.estado = 'activo'
    AND m.id <> OLD.id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clínica no puede quedarse sin dueño: dale el rol Dueño/a a otra persona antes.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'membresia_ultimo_dueno';
  END IF;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.proteger_ultimo_dueno() IS
  'Una clínica no se queda sin ningún dueño activo (membresía activa con el rol de sistema dueno).';

CREATE TRIGGER membresia_ultimo_dueno AFTER UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.proteger_ultimo_dueno();

CALL app.asegurar_permisos();
