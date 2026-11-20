-- 0005_alta_clinica: alta de una clínica nueva con sus roles de sistema, permisos iniciales y dueño.
--
-- No es ejecutable por app_api (ni por PUBLIC): la usa el rol de migraciones o un script de
-- administración. Es SECURITY INVOKER: corre con los privilegios de quien la llama, y aunque alguien
-- la ejecutara como app_api, app_api no tiene INSERT sobre clinica.
--
-- Como las tablas tienen RLS forzado (también para su dueño), la función fija el contexto de la
-- clínica nueva con set_config(..., true) y al final devuelve el contexto que tenía quien la llamó.
-- La fila de usuario del dueño queda creada «por él mismo» (la política de usuario solo deja
-- insertar la identidad del contexto); el resto queda con created_by NULL = alta del sistema.
--
-- Matriz inicial de permisos: propuesta del doc 00 («Acceso, roles y permisos»), a validar con la
-- clínica. dueno: todo. administracion: facturación/caja, contabilidad, reportes, personal, sedes y
-- configuración, sin ficha clínica. odontologo: agenda, pacientes, ficha clínica completa y
-- presupuestos. asistente: agenda, ficha en lectura, inventario. recepcion: agenda, pacientes
-- (datos), cobros y caja, mensajes. «Agenda propia» y «por sede» los resuelve la API.

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

  INSERT INTO app.rol (clinica_id, nombre, codigo, es_sistema)
  VALUES
    (v_clinica, 'Dueño/a', 'dueno', true),
    (v_clinica, 'Administración', 'administracion', true),
    (v_clinica, 'Odontólogo/a', 'odontologo', true),
    (v_clinica, 'Asistente dental', 'asistente', true),
    (v_clinica, 'Recepción y caja', 'recepcion', true);

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
    ('administracion', 'configuracion', ARRAY['ver', 'editar']),

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
  'Crea una clínica con sus 5 roles de sistema, la matriz inicial de permisos y la membresía activa del dueño. No ejecutable por app_api.';

CALL app.asegurar_permisos();
