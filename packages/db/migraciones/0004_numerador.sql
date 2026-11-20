-- 0004_numerador: correlativos sin huecos por clínica, tipo y (opcionalmente) sede.
--
-- app.siguiente_numero() toma la fila con bloqueo de fila hasta el final de la transacción (el
-- INSERT … ON CONFLICT DO UPDATE bloquea igual que SELECT … FOR UPDATE, y además resuelve sin
-- carreras la primera vez que se pide un tipo). Si la transacción se revierte, el número vuelve:
-- no quedan huecos. Mientras tanto, otra transacción que pida el mismo correlativo espera.
--
-- app_api solo puede leer la tabla: los números salen únicamente de la función, así nadie puede
-- retroceder un contador. La tabla no se audita fila por fila (cada documento numerado ya genera
-- su propia fila de auditoría y un «editar numerador» por documento solo agrega ruido).

CREATE TABLE app.numerador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES app.clinica (id),
  tipo text NOT NULL
    CONSTRAINT numerador_tipo_check CHECK (tipo IN (
      'presupuesto', 'receta', 'certificado', 'indicaciones', 'consentimiento', 'recibo')),
  sede_id uuid,
  ultimo bigint NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app.usuario (id),
  updated_at timestamptz,
  updated_by uuid REFERENCES app.usuario (id),
  CONSTRAINT numerador_clinica_id_id_key UNIQUE (clinica_id, id),
  -- NULLS NOT DISTINCT: el correlativo de toda la clínica (sede_id NULL) también es único.
  CONSTRAINT numerador_clave UNIQUE NULLS NOT DISTINCT (clinica_id, tipo, sede_id),
  CONSTRAINT numerador_sede_fkey FOREIGN KEY (clinica_id, sede_id) REFERENCES app.sede (clinica_id, id)
);
COMMENT ON TABLE app.numerador IS
  'Último número entregado por clínica, tipo y sede (NULL = toda la clínica). Solo se modifica con app.siguiente_numero().';

CREATE TRIGGER numerador_auditoria_fila BEFORE INSERT OR UPDATE ON app.numerador
  FOR EACH ROW EXECUTE FUNCTION app.fijar_auditoria_fila('tipo', 'sede_id');
CREATE TRIGGER numerador_sin_borrado BEFORE DELETE OR TRUNCATE ON app.numerador
  FOR EACH STATEMENT EXECUTE FUNCTION app.rechazar_borrado();

ALTER TABLE app.numerador ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.numerador FORCE ROW LEVEL SECURITY;
CREATE POLICY numerador_aislamiento ON app.numerador
  USING (clinica_id = app.clinica_actual())
  WITH CHECK (clinica_id = app.clinica_actual());

GRANT SELECT ON app.numerador TO app_api;

CREATE OR REPLACE FUNCTION app.siguiente_numero(p_tipo text, p_sede_id uuid DEFAULT NULL)
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_clinica uuid := app.clinica_actual();
  v_numero bigint;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'Falta el contexto de clínica: la API tiene que fijarlo antes de pedir un número.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO app.numerador AS n (clinica_id, tipo, sede_id, ultimo)
  VALUES (v_clinica, p_tipo, p_sede_id, 1)
  ON CONFLICT ON CONSTRAINT numerador_clave DO UPDATE SET ultimo = n.ultimo + 1
  RETURNING n.ultimo INTO v_numero;

  RETURN v_numero;
END
$$;
COMMENT ON FUNCTION app.siguiente_numero(text, uuid) IS
  'Siguiente correlativo de la clínica del contexto. Bloquea la fila hasta el fin de la transacción: sin huecos ni repetidos.';

GRANT EXECUTE ON FUNCTION app.siguiente_numero(text, uuid) TO app_api;

CALL app.asegurar_permisos();
