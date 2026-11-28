-- 0024_pacientes_busqueda_normalizada: búsqueda igual a la nueva normalizarBusqueda() de
-- @conecta/shared, patrón de búsqueda que no sirve de oráculo y orden con apellido vacío.
--
--   * app.normalizar_busqueda(texto), igual que normalizarBusqueda() (documentos.ts):
--       1. NFC (una ñ pegada como n + U+0303 pasa a ser ñ) y minúsculas;
--       2. NFD y fuera las marcas combinantes, salvo la tilde de la ñ (la ñ es otra letra);
--       3. grupos de dígitos separados por punto, guion o espacio se unen («4.123.456» -> 4123456);
--       4. apóstrofos (' ’ ` ´) y guiones se pegan («O'Higgins» -> ohiggins, «D’Andrea» -> dandrea);
--       5. cualquier otro carácter que no sea letra, dígito o espacio separa palabras
--          («Giménez, Ana» -> gimenez ana);
--       6. ceros a la izquierda fuera en los números («04123456» -> 4123456);
--       7. espacios colapsados y recortados.
--     Las clases de caracteres (letra, minúscula) se evalúan con la intercalación pg_c_utf8 (Unicode,
--     independiente del locale de la base: PostgreSQL 17). Diferencias conocidas con el JS, solo en
--     caracteres exóticos: dígitos que no son ASCII (salvo ² ³ ¹ ¼ ½ ¾) separan palabras en vez de
--     quedar, y solo se quitan las marcas combinantes de los bloques U+0300–036F, 1AB0–1AFF,
--     1DC0–1DFF, 20D0–20FF y FE20–FE2F (las de escrituras no latinas quedan).
--     Como app.clave_orden() y app.texto_busqueda_paciente() la usan, se recalculan las columnas de
--     orden de paciente (ALTER … SET EXPRESSION reescribe la tabla) y el texto de paciente_busqueda.
--   * app.terminos_busqueda(texto): igual que en 0022, con la normalización nueva; un número sin
--     letras se une entero y pierde los ceros a la izquierda («(0981) 123-456» -> 981123456);
--     términos vacíos fuera.
--   * app.patron_busqueda() (corrige 0019, que decía que fijar app.busqueda_patron a mano «solo
--     achica lo visible»): el índice GIN trigram es de todas las clínicas y Postgres rechequea el
--     patrón sobre las filas candidatas ANTES de filtrar por clínica. Un patrón malformado (p. ej.
--     terminado en «\») daba error solo si OTRA clínica tenía la coincidencia: un oráculo entre
--     clínicas. Ahora solo acepta un patrón bien formado: «%» (sin búsqueda) o «%…%» con \, % y _
--     escapados por dentro, como los arma app.escapar_like. Cualquier otro valor devuelve NULL: la
--     política compara con NULL y no ve ninguna fila (y el GIN, con una clave nula, no devuelve nada).
--     Lo que queda es solo de tiempo (cuántos candidatos trae el índice); el valor de las filas de
--     otra clínica nunca se ve ni produce errores.
--   * Orden de la lista (corrige 0019: «clave_orden(NULL) = ''» ponía arriba a los pacientes sin
--     apellido): orden_apellidos pasa a ser la clave de los apellidos o, si no hay, de los nombres.
--     Un paciente sin apellido («Mateo») queda entre los apellidos que empiezan con M, y después
--     por nombres e id como siempre. paciente_busqueda copia la clave nueva.

-- ---------------------------------------------------------------------------------------------
-- Normalización
-- ---------------------------------------------------------------------------------------------
-- Espacios (los de \s de JavaScript): ' \t\n\v\f\r', U+00A0, U+1680, U+2000–200A, U+2028, U+2029,
-- U+202F, U+205F, U+3000, U+FEFF.
CREATE OR REPLACE FUNCTION app.normalizar_busqueda(p_texto text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  RETURN pg_catalog.btrim(
    pg_catalog.regexp_replace(
      -- 6. ceros a la izquierda (inicio de número: después de algo que no es [a-z0-9])
      pg_catalog.regexp_replace(
        -- 5. el resto de la puntuación separa
        pg_catalog.regexp_replace(
          -- 4. apóstrofos y guiones se pegan
          pg_catalog.regexp_replace(
            -- 3. grupos de dígitos
            pg_catalog.regexp_replace(
              -- 2. sin marcas combinantes (la ñ ya está compuesta)
              pg_catalog.regexp_replace(
                pg_catalog.replace(
                  pg_catalog.normalize(
                    pg_catalog.lower(pg_catalog.normalize(p_texto, 'NFC') COLLATE pg_catalog.pg_c_utf8),
                    'NFD'),
                  E'ñ', E'ñ'),
                E'[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]', '', 'g'),
              E'([0-9])[. \t\n\u000b\f\r   -     　﻿-]+(?=[0-9])',
              E'\\1', 'g'),
            E'[\'’`´-]', '', 'g') COLLATE pg_catalog.pg_c_utf8,
          E'[^[:alpha:]0-9²³¹¼-¾ \t\n\u000b\f\r   -     　﻿]',
          ' ', 'g'),
        '(^|[^a-z0-9])0+([0-9])', E'\\1\\2', 'g'),
      E'[ \t\n\u000b\f\r   -     　﻿]+', ' ', 'g'),
    ' ');
COMMENT ON FUNCTION app.normalizar_busqueda(text) IS
  'Igual que normalizarBusqueda() de @conecta/shared: NFC, minúsculas, sin tildes (la ñ se conserva), sin puntuación (apóstrofos y guiones pegan), grupos de dígitos unidos, sin ceros a la izquierda, espacios colapsados.';

CREATE OR REPLACE FUNCTION app.terminos_busqueda(p_texto text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN (
    WITH n AS (
      SELECT COALESCE(app.normalizar_busqueda(p_texto), '') COLLATE pg_catalog.pg_c_utf8 AS t)
    SELECT CASE
      WHEN n.t !~ '[[:alpha:]]' THEN (
        SELECT CASE WHEN d.x = '' THEN '{}'::text[] ELSE ARRAY[d.x] END
        FROM (SELECT pg_catalog.regexp_replace(
                       pg_catalog.regexp_replace(n.t, '[^0-9]', '', 'g'), '^0+(?=[0-9])', '') AS x) d)
      ELSE ARRAY(
        SELECT w.termino
        FROM (
          SELECT s.i,
                 CASE WHEN s.x ~ '[[:alpha:]]' THEN s.x
                      ELSE pg_catalog.regexp_replace(
                             pg_catalog.regexp_replace(s.x, '[^0-9]', '', 'g'), '^0+(?=[0-9])', '')
                 END AS termino
          FROM pg_catalog.regexp_split_to_table(n.t, ' ') WITH ORDINALITY AS s(x, i)) w
        WHERE w.termino <> ''
        ORDER BY w.i)
    END
    FROM n);
COMMENT ON FUNCTION app.terminos_busqueda(text) IS
  'Términos de búsqueda normalizados: un número (sin separadores ni ceros a la izquierda) o las palabras del texto.';

-- ---------------------------------------------------------------------------------------------
-- Patrón de búsqueda: solo bien formado
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.patron_busqueda() RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN s.v IS NULL OR s.v IN ('', '%') THEN '%'
    WHEN s.v ~ E'^%([^%_\\\\]|\\\\[%_\\\\])*%$' THEN s.v
  END
  FROM (SELECT pg_catalog.current_setting('app.busqueda_patron', true) AS v) s
$$;
COMMENT ON FUNCTION app.patron_busqueda() IS
  'Patrón LIKE de la búsqueda en curso (app.busqueda_patron, local a la transacción): % si no hay; «%…%» escapado si está bien formado; si no, NULL (no coincide nada). Ver 0024: el índice es de todas las clínicas.';

COMMENT ON TABLE app.paciente_busqueda IS
  'Índice de búsqueda de pacientes (dato derivado, lo mantiene paciente_indexar). La política de SELECT lleva el patrón de app.patron_busqueda() para que el GIN trigram se use con RLS; un patrón malformado no ve nada.';

-- ---------------------------------------------------------------------------------------------
-- Orden: apellidos o, si no hay, nombres. Reescribe paciente con la normalización nueva.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE app.paciente
  ALTER COLUMN orden_apellidos SET EXPRESSION AS (app.clave_orden(COALESCE(apellidos, nombres))),
  ALTER COLUMN orden_nombres SET EXPRESSION AS (app.clave_orden(nombres));
COMMENT ON COLUMN app.paciente.orden_apellidos IS
  'Generada: clave de orden de los apellidos o, si no hay, de los nombres (sin tildes, ñ entre n y o).';

-- paciente_busqueda con el texto y las claves nuevas. Es una sola transacción con bloqueo exclusivo
-- de las dos tablas: nadie las ve sin RLS forzado.
ALTER TABLE app.paciente NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_busqueda NO FORCE ROW LEVEL SECURITY;
UPDATE app.paciente_busqueda b
SET texto = app.texto_busqueda_paciente(p.nombres, p.apellidos, p.ci, p.telefono),
    orden_apellidos = p.orden_apellidos,
    orden_nombres = p.orden_nombres
FROM app.paciente p
WHERE p.clinica_id = b.clinica_id AND p.id = b.id
  AND (b.texto, b.orden_apellidos, b.orden_nombres)
      IS DISTINCT FROM (app.texto_busqueda_paciente(p.nombres, p.apellidos, p.ci, p.telefono),
                        p.orden_apellidos, p.orden_nombres);
ALTER TABLE app.paciente FORCE ROW LEVEL SECURITY;
ALTER TABLE app.paciente_busqueda FORCE ROW LEVEL SECURITY;

CALL app.asegurar_permisos();
