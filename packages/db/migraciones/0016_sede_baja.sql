-- 0016_sede_baja: dar de baja una sede limpia lo que la apunta.
--
-- Antes, al dar de baja una sede (deleted_at) quedaban activos sus usuario_sede, la sede por defecto
-- de las membresías que la apuntaban, sus tramos de disponibilidad y sus sillones. La persona quedaba
-- «asignada» a una sede que no existe y no se la podía editar (la API no deja asignar ni quitar una
-- sede de baja).
--
--   * Trigger sede_baja_en_cascada (AFTER UPDATE de app.sede, cuando deleted_at pasa de NULL a un
--     valor), SECURITY INVOKER: en la misma transacción desactiva los usuario_sede de esa sede, vacía
--     la sede por defecto que la apunta y desactiva sus tramos de disponibilidad y sus sillones. Corre
--     como quien da de baja la sede (con RLS de su clínica) y cada cambio queda auditado con esa
--     persona como autora. Las filas de personal pasan por app.proteger_acceso, que deja pasar esta
--     limpieza sin reglas de personal (ver 0015): quien da de baja una sede no necesita permisos de
--     personal ni alcance sobre esas personas, y la limpieza no otorga nada.
--   * Triggers *_sede_vigente (BEFORE INSERT OR UPDATE, para todos): no se ACTIVA nada en una sede
--     dada de baja: usuario_sede, sede por defecto de una membresía, tramo de disponibilidad o
--     sillón. Error sede_dada_de_baja (22023). Lo ya activo en una sede vigente no se toca.
--   * Arreglo de datos: lo mismo para las sedes que ya estaban dadas de baja.
--
-- La API (listarPersonal) además no muestra sedes dadas de baja (ver src/funciones.ts).

-- ---------------------------------------------------------------------------------------------
-- Arreglo de los datos existentes
-- ---------------------------------------------------------------------------------------------
-- Sin clínica en el contexto las tablas (RLS forzado también para su dueño) no muestran nada: por
-- un momento, dentro de esta transacción y con bloqueo exclusivo, se quita el FORCE (como en 0008).
-- Cada cambio queda auditado en su clínica como cambio del sistema (usuario NULL).
ALTER TABLE app.sede NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_sede NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membresia NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.profesional_disponibilidad NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sillon NO FORCE ROW LEVEL SECURITY;

UPDATE app.usuario_sede us SET activo = false
FROM app.sede s
WHERE s.clinica_id = us.clinica_id AND s.id = us.sede_id AND s.deleted_at IS NOT NULL AND us.activo;

UPDATE app.membresia m SET sede_defecto_id = NULL
FROM app.sede s
WHERE s.clinica_id = m.clinica_id AND s.id = m.sede_defecto_id AND s.deleted_at IS NOT NULL;

UPDATE app.profesional_disponibilidad d SET activo = false
FROM app.sede s
WHERE s.clinica_id = d.clinica_id AND s.id = d.sede_id AND s.deleted_at IS NOT NULL AND d.activo;

UPDATE app.sillon x SET activo = false
FROM app.sede s
WHERE s.clinica_id = x.clinica_id AND s.id = x.sede_id AND s.deleted_at IS NOT NULL AND x.activo;

ALTER TABLE app.sillon FORCE ROW LEVEL SECURITY;
ALTER TABLE app.profesional_disponibilidad FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membresia FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_sede FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sede FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- Cascada al dar de baja una sede
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.dar_de_baja_sede_en_cascada() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE app.usuario_sede us SET activo = false
  WHERE us.clinica_id = NEW.clinica_id AND us.sede_id = NEW.id AND us.activo;
  UPDATE app.membresia m SET sede_defecto_id = NULL
  WHERE m.clinica_id = NEW.clinica_id AND m.sede_defecto_id = NEW.id;
  UPDATE app.profesional_disponibilidad d SET activo = false
  WHERE d.clinica_id = NEW.clinica_id AND d.sede_id = NEW.id AND d.activo;
  UPDATE app.sillon x SET activo = false
  WHERE x.clinica_id = NEW.clinica_id AND x.sede_id = NEW.id AND x.activo;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION app.dar_de_baja_sede_en_cascada() IS
  'AFTER UPDATE de sede (baja): desactiva sus usuario_sede, tramos y sillones y vacía la sede por defecto que la apunta. SECURITY INVOKER.';

CREATE TRIGGER sede_baja_en_cascada AFTER UPDATE ON app.sede
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION app.dar_de_baja_sede_en_cascada();

-- ---------------------------------------------------------------------------------------------
-- Nada se activa en una sede dada de baja
-- ---------------------------------------------------------------------------------------------
-- Genérica sobre la fila como jsonb: membresia mira sede_defecto_id (cuando cambia a un valor);
-- usuario_sede, profesional_disponibilidad y sillon miran sede_id cuando la fila nace activa o pasa
-- de inactiva a activa.
CREATE OR REPLACE FUNCTION app.exigir_sede_vigente() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_nueva jsonb := pg_catalog.to_jsonb(NEW);
  v_vieja jsonb;
  v_sede uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_vieja := pg_catalog.to_jsonb(OLD);
  END IF;
  IF TG_TABLE_NAME = 'membresia' THEN
    v_sede := (v_nueva ->> 'sede_defecto_id')::uuid;
    IF v_sede IS NULL OR v_sede IS NOT DISTINCT FROM (v_vieja ->> 'sede_defecto_id')::uuid THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NOT (v_nueva ->> 'activo')::boolean
       OR COALESCE((v_vieja ->> 'activo')::boolean, false) THEN
      RETURN NEW;
    END IF;
    v_sede := (v_nueva ->> 'sede_id')::uuid;
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.sede s
    WHERE s.clinica_id = (v_nueva ->> 'clinica_id')::uuid AND s.id = v_sede
      AND s.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Esa sede está dada de baja: elegí otra.'
      USING ERRCODE = 'invalid_parameter_value', CONSTRAINT = 'sede_dada_de_baja';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION app.exigir_sede_vigente() IS
  'BEFORE INSERT OR UPDATE: no se activa un usuario_sede, una sede por defecto, un tramo ni un sillón en una sede dada de baja (sede_dada_de_baja).';

CREATE TRIGGER membresia_sede_vigente BEFORE INSERT OR UPDATE ON app.membresia
  FOR EACH ROW EXECUTE FUNCTION app.exigir_sede_vigente();
CREATE TRIGGER usuario_sede_sede_vigente BEFORE INSERT OR UPDATE ON app.usuario_sede
  FOR EACH ROW EXECUTE FUNCTION app.exigir_sede_vigente();
CREATE TRIGGER profesional_disponibilidad_sede_vigente
  BEFORE INSERT OR UPDATE ON app.profesional_disponibilidad
  FOR EACH ROW EXECUTE FUNCTION app.exigir_sede_vigente();
CREATE TRIGGER sillon_sede_vigente BEFORE INSERT OR UPDATE ON app.sillon
  FOR EACH ROW EXECUTE FUNCTION app.exigir_sede_vigente();

CALL app.asegurar_permisos();
