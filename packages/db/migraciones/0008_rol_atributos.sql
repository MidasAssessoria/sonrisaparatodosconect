-- 0008_rol_atributos: lo que la API decidía por código de rol pasa a ser dato del rol.
--
--   * todas_las_sedes: el rol ve todas las sedes de la clínica (también las que se creen después);
--     si no, ve las de usuario_sede más su sede por defecto.
--   * exige_mfa: el rol obliga a usar doble factor.
--   * inactividad_min: minutos sin pedidos tras los que la sesión vence (app.tocar_sesion, 0006).
--     Entre 5 y 240: menos de 5 no deja trabajar; más de 4 horas deja una ficha de salud abierta
--     en una computadora compartida.
--
-- Valores de los roles de sistema (doc 00 y docs/plan.md): dueño y administración ven todas las
-- sedes y exigen doble factor; inactividad 15 minutos para recepción (mostrador compartido) y 30
-- para el resto. Los roles que cree cada clínica nacen con los valores por defecto (sin todas las
-- sedes, sin doble factor obligatorio, 30 minutos).

ALTER TABLE app.rol
  ADD COLUMN todas_las_sedes boolean NOT NULL DEFAULT false,
  ADD COLUMN exige_mfa boolean NOT NULL DEFAULT false,
  ADD COLUMN inactividad_min integer NOT NULL DEFAULT 30
    CONSTRAINT rol_inactividad_min_check CHECK (inactividad_min BETWEEN 5 AND 240);
COMMENT ON COLUMN app.rol.todas_las_sedes IS 'Ve todas las sedes de la clínica (si no, las de usuario_sede y su sede por defecto).';
COMMENT ON COLUMN app.rol.exige_mfa IS 'Obliga a usar doble factor (token aal2).';
COMMENT ON COLUMN app.rol.inactividad_min IS 'Minutos sin actividad tras los que la sesión vence.';

-- Roles de sistema que ya existen. rol tiene RLS forzado también para su dueño: sin una clínica en
-- el contexto no se ve ninguna fila, así que por un momento (dentro de esta transacción, con bloqueo
-- exclusivo) se quita el FORCE. Cada cambio queda auditado en su clínica como edición del sistema
-- (usuario NULL): app.auditar() fija la clínica de cada fila.
ALTER TABLE app.rol NO FORCE ROW LEVEL SECURITY;
UPDATE app.rol SET
  todas_las_sedes = codigo IN ('dueno', 'administracion'),
  exige_mfa = codigo IN ('dueno', 'administracion'),
  inactividad_min = CASE WHEN codigo = 'recepcion' THEN 15 ELSE 30 END
WHERE es_sistema AND codigo IN ('dueno', 'administracion', 'recepcion');
ALTER TABLE app.rol FORCE ROW LEVEL SECURITY;

-- alta_clinica: igual que en 0005, con los atributos nuevos de los roles de sistema.
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
  'Crea una clínica con sus 5 roles de sistema (con todas_las_sedes, exige_mfa e inactividad_min), la matriz inicial de permisos y la membresía activa del dueño. No ejecutable por app_api.';

CALL app.asegurar_permisos();
