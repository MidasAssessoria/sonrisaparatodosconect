-- 0014_cola: cola de trabajos en segundo plano (pg-boss) y el rol del worker.
--
--   * Schema «cola» (no app ni public): las tablas de pg-boss 12.38.2 (versión de esquema 46). El
--     SQL de abajo es el de `getConstructionPlans('cola', { createSchema: false })` de esa versión,
--     sin BEGIN/COMMIT, SET LOCAL ni el bloqueo consultivo (el ejecutor ya envuelve la migración en
--     una transacción y serializa las corridas). pg-boss NUNCA migra solo: la API y el worker lo
--     arrancan con `migrate: false` y fallan si la versión de esquema no es 46. Actualizar pg-boss
--     = una migración nueva con `getMigrationPlans('cola', 46)` de la versión nueva.
--   * El dueño de todo lo de «cola» es el rol de migraciones (como en app). Nadie más puede cambiar
--     su estructura: el worker y la API solo tienen privilegios de datos.
--   * app_worker: rol del worker. Sin LOGIN (se configura fuera, como app_api), sin BYPASSRLS, sin
--     ser dueño de nada. En «cola» puede leer y escribir los datos de pg-boss (tomar, completar,
--     reintentar y limpiar trabajos, registrar su instancia). En app solo puede LEER app.archivo,
--     y con RLS forzado: ve las filas de la clínica que fija en app.clinica_id dentro de su
--     transacción (la del trabajo), nada sin contexto. No escribe en app.
--   * app_api: encola trabajos en la misma transacción que el cambio de negocio (pg-boss `send` con
--     la conexión de la transacción). Por eso puede INSERTAR en cola.job_common (la tabla de las
--     colas sin partición propia), leer el id que devuelve el INSERT, leer cola.queue y cola.version
--     (pg-boss los consulta al arrancar) y ejecutar cola.job_now(). No puede leer los datos de los
--     trabajos, cambiarlos ni borrarlos.
--   * La cola archivo.verificar nace acá (la API puede encolar antes de que el worker arranque por
--     primera vez) con los reintentos del worker: hasta 5, con espera creciente desde 10 s y como
--     máximo 10 min entre intentos (`COLA_ARCHIVO_VERIFICAR` en @conecta/db/src/cola.ts).
--   * app.asegurar_permisos() ahora también limpia «cola»: nada para PUBLIC ni para los roles de la
--     API de datos de Supabase (anon, authenticated, service_role).

-- ---------------------------------------------------------------------------------------------
-- Rol del worker
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_rol pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_rol FROM pg_catalog.pg_roles WHERE rolname = 'app_worker';
  IF NOT FOUND THEN
    CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  ELSIF v_rol.rolsuper OR v_rol.rolbypassrls OR v_rol.rolcreaterole OR v_rol.rolcreatedb
        OR v_rol.rolreplication THEN
    RAISE EXCEPTION 'El rol app_worker ya existe con atributos que saltan el aislamiento entre clínicas '
                    '(SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB o REPLICATION). Quitáselos antes de migrar.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Schema cola y tablas de pg-boss 12.38.2 (esquema 46)
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA cola;
COMMENT ON SCHEMA cola IS
  'Cola de trabajos (pg-boss, versión de esquema 46). La estructura la cambian solo las migraciones.';
REVOKE ALL ON SCHEMA cola FROM PUBLIC;

-- Desde acá y hasta «Colas de la aplicación»: SQL de pg-boss 12.38.2, sin cambios salvo lo dicho arriba.
CREATE TYPE cola.job_state AS ENUM (
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed'
)
;

CREATE FUNCTION cola.job_now()
RETURNS timestamp with time zone AS
$$
  SELECT pg_catalog.now();
$$
LANGUAGE sql STABLE;
;

CREATE TABLE cola.version (
  version int primary key,
  cron_on timestamp with time zone,
  bam_on timestamp with time zone,
  flow_on timestamp with time zone,
  reindex_on timestamp with time zone,
  monitor_backoff_on timestamp with time zone
)
;

CREATE TABLE cola.queue (
  name text NOT NULL,
  policy text NOT NULL,
  retry_limit int NOT NULL,
  retry_delay int NOT NULL,
  retry_backoff bool NOT NULL,
  retry_delay_max int,
  expire_seconds int NOT NULL,
  retention_seconds int NOT NULL,
  deletion_seconds int NOT NULL,
  dead_letter text REFERENCES cola.queue (name) CHECK (dead_letter IS DISTINCT FROM name),
  partition bool NOT NULL,
  table_name text NOT NULL,
  deferred_count int NOT NULL default 0,
  blocked_count int NOT NULL default 0,
  queued_count int NOT NULL default 0,
  ready_count int NOT NULL default 0,
  warning_queued int NOT NULL default 0,
  active_count int NOT NULL default 0,
  failed_count int NOT NULL default 0,
  total_count int NOT NULL default 0,
  retained_count int,
  retained_on timestamp with time zone,
  created_delta int NOT NULL default 0,
  completed_delta int NOT NULL default 0,
  failed_delta int NOT NULL default 0,
  delta_on timestamp with time zone,
  delta_seconds int,
  wait_bins int[],
  run_bins int[],
  ready_oldest_seconds int,
  ready_history int[] NOT NULL default '{}',
  heartbeat_seconds int,
  notify bool NOT NULL DEFAULT false,
  singletons_active text[],
  monitor_claim_on timestamp with time zone,
  monitor_on timestamp with time zone,
  maintain_on timestamp with time zone,
  created_on timestamp with time zone not null default now(),
  updated_on timestamp with time zone not null default now(),
  PRIMARY KEY (name)
)
;

CREATE TABLE cola.schedule (
  name text REFERENCES cola.queue ON DELETE CASCADE,
  key text not null DEFAULT '',
  kind text not null DEFAULT 'cron' CHECK (kind IN ('cron', 'rrule')),
  cron text not null,
  timezone text DEFAULT 'UTC',
  data jsonb,
  options jsonb,
  created_on timestamp with time zone not null default now(),
  updated_on timestamp with time zone not null default now(),
  last_job_id uuid,
  PRIMARY KEY (name, key)
)
;

CREATE TABLE cola.subscription (
  event text not null,
  name text not null REFERENCES cola.queue ON DELETE CASCADE,
  created_on timestamp with time zone not null default now(),
  updated_on timestamp with time zone not null default now(),
  PRIMARY KEY(event, name)
)
;

CREATE TABLE cola.bam (
  id uuid PRIMARY KEY default gen_random_uuid(),
  name text NOT NULL,
  version int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  queue text,
  table_name text NOT NULL,
  command text NOT NULL,
  error text,
  created_on timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  started_on timestamp with time zone,
  completed_on timestamp with time zone
)
;

CREATE FUNCTION cola.job_table_format(command text, table_name text)
RETURNS text AS
$$
  SELECT format(
    regexp_replace(
      regexp_replace(command, '\.job\y', '.%1$I', 'g'),
      '\yjob_i(\d+)', '%1$s_i\1', 'g'
    ),
    table_name
  );
$$
LANGUAGE sql IMMUTABLE;
;

CREATE FUNCTION cola.job_table_run(command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
RETURNS VOID AS
$$
DECLARE
  tbl RECORD;
BEGIN
  IF queue_name IS NOT NULL THEN
    SELECT table_name INTO tbl_name FROM cola.queue WHERE name = queue_name;
  END IF;

  IF tbl_name IS NOT NULL THEN
    EXECUTE cola.job_table_format(command, tbl_name);
    RETURN;
  END IF;

  EXECUTE cola.job_table_format(command, 'job_common');

  FOR tbl IN SELECT table_name FROM cola.queue WHERE partition = true
  LOOP
    EXECUTE cola.job_table_format(command, tbl.table_name);
  END LOOP;
END;
$$
LANGUAGE plpgsql;
;

CREATE FUNCTION cola.job_table_run_async(command_name text, version int, command text, tbl_name text DEFAULT NULL, queue_name text DEFAULT NULL)
RETURNS VOID AS
$$
BEGIN
  IF queue_name IS NOT NULL THEN
    SELECT table_name INTO tbl_name FROM cola.queue WHERE name = queue_name;
  END IF;

  IF tbl_name IS NOT NULL THEN
    INSERT INTO cola.bam (name, version, status, queue, table_name, command)
    VALUES (
      command_name,
      version,
      'pending',
      queue_name,
      tbl_name,
      cola.job_table_format(command, tbl_name)
    );
    RETURN;
  END IF;

  INSERT INTO cola.bam (name, version, status, queue, table_name, command)
  SELECT
    command_name,
    version,
    'pending',
    NULL,
    'job_common',
    cola.job_table_format(command, 'job_common')
  UNION ALL
  SELECT
    command_name,
    version,
    'pending',
    queue.name,
    queue.table_name,
    cola.job_table_format(command, queue.table_name)
  FROM cola.queue
  WHERE partition = true;
END;
$$
LANGUAGE plpgsql;
;

CREATE TABLE cola.job (
  id uuid not null default gen_random_uuid(),
  name text not null,
  priority integer not null default(0),
  data jsonb,
  state cola.job_state not null default 'created',
  retry_limit integer not null default 2,
  retry_count integer not null default 0,
  retry_delay integer not null default 0,
  retry_backoff boolean not null default false,
  retry_delay_max integer,
  expire_seconds int not null default 900,
  deletion_seconds int not null default 604800,
  singleton_key text,
  singleton_on timestamp without time zone,
  group_id text,
  group_tier text,
  start_after timestamp with time zone not null default now(),
  created_on timestamp with time zone not null default now(),
  started_on timestamp with time zone,
  completed_on timestamp with time zone,
  keep_until timestamp with time zone NOT NULL default now() + interval '1209600',
  output jsonb,
  dead_letter text,
  policy text,
  heartbeat_on timestamp with time zone,
  heartbeat_seconds int,
  blocked boolean not null default false,
  blocking boolean not null default false,
  pending_dependencies int not null default 0,
  source_name text,
  source_id uuid,
  source_created_on timestamp with time zone,
  source_retry_count int,
  source_output jsonb,
  source_root_id uuid,
  trace_context jsonb,
  upsert_by_key bool
) PARTITION BY LIST (name)
;
ALTER TABLE cola.job ADD PRIMARY KEY (name, id);

CREATE TABLE cola.job_common (LIKE cola.job INCLUDING GENERATED INCLUDING DEFAULTS);

SELECT cola.job_table_run($cmd$ALTER TABLE cola.job ADD PRIMARY KEY (name, id)$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$ALTER TABLE cola.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES cola.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$ALTER TABLE cola.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES cola.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i1 ON cola.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i2 ON cola.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i3 ON cola.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i6 ON cola.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i8 ON cola.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i10 ON cola.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$ALTER TABLE cola.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i4 ON cola.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i11 ON cola.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i7 ON cola.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i9 ON cola.job (name, id) WHERE blocking AND state = 'completed'$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i12 ON cola.job (source_root_id) WHERE source_root_id IS NOT NULL$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE UNIQUE INDEX job_i13 ON cola.job (name, singleton_key) WHERE state = 'created' AND upsert_by_key$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i14 ON cola.job (name, state, blocked, start_after) WHERE state IN ('created', 'retry', 'active', 'failed')$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i15 ON cola.job (name, created_on)$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i16 ON cola.job (name, completed_on) WHERE completed_on IS NOT NULL$cmd$, 'job_common');
SELECT cola.job_table_run($cmd$CREATE INDEX job_i17 ON cola.job (name, singleton_key, created_on) WHERE state < 'active' AND singleton_key IS NOT NULL$cmd$, 'job_common');

ALTER TABLE cola.job ATTACH PARTITION cola.job_common DEFAULT;
;

CREATE TABLE cola.warning (
  id uuid PRIMARY KEY default gen_random_uuid(),
  type text NOT NULL,
  message text NOT NULL,
  data jsonb,
  created_on timestamp with time zone NOT NULL DEFAULT now()
)
;
CREATE INDEX warning_i1 ON cola.warning (created_on DESC);

CREATE TABLE cola.queue_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  deferred_count int NOT NULL DEFAULT 0,
  queued_count   int NOT NULL DEFAULT 0,
  ready_count    int NOT NULL DEFAULT 0,
  active_count   int NOT NULL DEFAULT 0,
  failed_count   int NOT NULL DEFAULT 0,
  total_count    int NOT NULL DEFAULT 0,
  created_delta   int,
  completed_delta int,
  failed_delta    int,
  delta_seconds   int,
  delta_on        timestamptz,
  wait_bins       int[],
  run_bins        int[],
  ready_oldest_seconds int,
  captured_on timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, captured_on)
) PARTITION BY RANGE (captured_on)
;
CREATE INDEX queue_stats_i1 ON cola.queue_stats (name, captured_on DESC) INCLUDE (deferred_count, queued_count, ready_count, active_count, failed_count, total_count);
;

DO $$
DECLARE
  d date;
  i int;
  part_name text;
BEGIN
  FOR i IN 0..1 LOOP
    d := (cola.job_now() AT TIME ZONE 'UTC')::date + i;
    part_name := 'queue_stats_' || to_char(d, 'YYYYMMDD');
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'cola' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE cola.%I PARTITION OF cola.queue_stats FOR VALUES FROM (%L) TO (%L)',
        part_name,
        to_char(d, 'YYYY-MM-DD') || ' 00:00:00+00',
        to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00'
      );
    END IF;
  END LOOP;
END;
$$
;

CREATE TABLE cola.job_dependency (
  child_name text NOT NULL,
  child_id uuid NOT NULL,
  parent_name text NOT NULL,
  parent_id uuid NOT NULL,
  PRIMARY KEY (child_name, child_id, parent_name, parent_id)
)
;
CREATE INDEX IF NOT EXISTS job_dep_parent_idx ON cola.job_dependency (parent_name, parent_id);

CREATE TABLE cola.instance (
  id uuid PRIMARY KEY,
  name text,
  host text NOT NULL,
  pid int NOT NULL,
  version text NOT NULL,
  node_version text NOT NULL,
  application_name text,
  heartbeat_seconds int NOT NULL,
  supervise bool NOT NULL,
  schedule bool NOT NULL,
  migrate bool NOT NULL,
  persist_queue_stats bool NOT NULL,
  persist_warnings bool NOT NULL,
  pool_max int,
  pool_total int,
  pool_idle int,
  pool_waiting int,
  workers jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  crash_restarts int NOT NULL DEFAULT 0,
  crash_restarts_since timestamptz,
  started_on timestamptz NOT NULL DEFAULT now(),
  heartbeat_on timestamptz NOT NULL DEFAULT now(),
  stopped_on timestamptz
)
;

CREATE FUNCTION cola.create_queue(queue_name text, options jsonb)
RETURNS VOID AS
$$
DECLARE
  tablename varchar := CASE WHEN options->>'partition' = 'true'
                        THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                        ELSE 'job_common'
                        END;
  queue_created_on timestamptz;
BEGIN

  WITH q as (
    INSERT INTO cola.queue (
      name,
      policy,
      retry_limit,
      retry_delay,
      retry_backoff,
      retry_delay_max,
      expire_seconds,
      retention_seconds,
      deletion_seconds,
      warning_queued,
      dead_letter,
      partition,
      table_name,
      heartbeat_seconds,
      notify,
      created_on,
      updated_on
    )
    VALUES (
      queue_name,
      options->>'policy',
      COALESCE((options->>'retryLimit')::int, 2),
      COALESCE((options->>'retryDelay')::int, 0),
      COALESCE((options->>'retryBackoff')::bool, false),
      (options->>'retryDelayMax')::int,
      COALESCE((options->>'expireInSeconds')::int, 900),
      COALESCE((options->>'retentionSeconds')::int, 1209600),
      COALESCE((options->>'deleteAfterSeconds')::int, 604800),
      COALESCE((options->>'warningQueueSize')::int, 0),
      options->>'deadLetter',
      COALESCE((options->>'partition')::bool, false),
      tablename,
      (options->>'heartbeatSeconds')::int,
      COALESCE((options->>'notify')::bool, false),
      cola.job_now(),
      cola.job_now()
    )
    ON CONFLICT DO NOTHING
    RETURNING created_on
  )
  SELECT created_on into queue_created_on from q;

  IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
    RETURN;
  END IF;

  EXECUTE format('CREATE TABLE cola.%I (LIKE cola.job INCLUDING DEFAULTS)', tablename);

  EXECUTE cola.job_table_format($cmd$ALTER TABLE cola.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$ALTER TABLE cola.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES cola.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$ALTER TABLE cola.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES cola.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i11 ON cola.job (name, priority DESC, created_on, start_after) WHERE state < 'active' AND NOT blocked$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i4 ON cola.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i7 ON cola.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i9 ON cola.job (name, id) WHERE blocking AND state = 'completed'$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i12 ON cola.job (source_root_id) WHERE source_root_id IS NOT NULL$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i13 ON cola.job (name, singleton_key) WHERE state = 'created' AND upsert_by_key$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i14 ON cola.job (name, state, blocked, start_after) WHERE state IN ('created', 'retry', 'active', 'failed')$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i15 ON cola.job (name, created_on)$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i16 ON cola.job (name, completed_on) WHERE completed_on IS NOT NULL$cmd$, tablename);
  EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i17 ON cola.job (name, singleton_key, created_on) WHERE state < 'active' AND singleton_key IS NOT NULL$cmd$, tablename);

  IF options->>'policy' = 'short' THEN
    EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i1 ON cola.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
  ELSIF options->>'policy' = 'singleton' THEN
    EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i2 ON cola.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
  ELSIF options->>'policy' = 'stately' THEN
    EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i3 ON cola.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
  ELSIF options->>'policy' = 'exclusive' THEN
    EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i6 ON cola.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
  ELSIF options->>'policy' = 'key_strict_fifo' THEN
    EXECUTE cola.job_table_format($cmd$CREATE UNIQUE INDEX job_i8 ON cola.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
    EXECUTE cola.job_table_format($cmd$CREATE INDEX job_i10 ON cola.job (name, singleton_key, state DESC, created_on, id) INCLUDE (start_after) WHERE state < 'active' AND NOT blocked AND policy = 'key_strict_fifo'$cmd$, tablename);
    EXECUTE cola.job_table_format($cmd$ALTER TABLE cola.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
  END IF;

  EXECUTE format('ALTER TABLE cola.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
  EXECUTE format('ALTER TABLE cola.job ATTACH PARTITION cola.%I FOR VALUES IN (%L)', tablename, queue_name);
END;
$$
LANGUAGE plpgsql;
;

CREATE FUNCTION cola.delete_queue(queue_name text)
RETURNS VOID AS
$$
DECLARE
  v_table varchar;
  v_partition bool;
BEGIN

  SELECT table_name, partition
  FROM cola.queue
  WHERE name = queue_name
  INTO v_table, v_partition;

  IF v_partition THEN
    EXECUTE format('DROP TABLE IF EXISTS cola.%I', v_table);
  ELSE
    EXECUTE format('DELETE FROM cola.%I WHERE name = %L', v_table, queue_name);
  END IF;

  DELETE FROM cola.queue WHERE name = queue_name;
END;
$$
LANGUAGE plpgsql;
;
INSERT INTO cola.version(version) VALUES ('46');

-- ---------------------------------------------------------------------------------------------
-- Colas de la aplicación
-- ---------------------------------------------------------------------------------------------
-- archivo.verificar: el worker relee un archivo recién subido y recalcula su SHA-256.
SELECT cola.create_queue('archivo.verificar',
  '{"policy": "standard", "retryLimit": 5, "retryDelay": 10, "retryBackoff": true,
    "retryDelayMax": 600, "expireInSeconds": 300}'::jsonb);

-- ---------------------------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------------------------
-- app_worker: los datos de pg-boss (no su estructura).
GRANT USAGE ON SCHEMA cola TO app_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cola TO app_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cola TO app_worker;

-- app_worker en app: solo leer archivo, con RLS (la política llama a app.clinica_actual()).
GRANT USAGE ON SCHEMA app TO app_worker;
GRANT EXECUTE ON FUNCTION app.clinica_actual() TO app_worker;
GRANT SELECT ON app.archivo TO app_worker;

-- app_api: encolar dentro de su transacción (y lo que pg-boss lee al arrancar).
GRANT USAGE ON SCHEMA cola TO app_api;
GRANT SELECT ON cola.version, cola.queue TO app_api;
GRANT INSERT ON cola.job_common TO app_api;
GRANT SELECT (id) ON cola.job_common TO app_api;
GRANT EXECUTE ON FUNCTION cola.job_now() TO app_api;

-- ---------------------------------------------------------------------------------------------
-- app.asegurar_permisos(): igual que en 0001, y además limpia el schema cola si existe.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE app.asegurar_permisos()
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_rol text;
  v_schema text;
BEGIN
  FOREACH v_schema IN ARRAY ARRAY['app', 'cola'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = v_schema);
    EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', v_schema);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC', v_schema);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC', v_schema);
    EXECUTE pg_catalog.format('REVOKE ALL ON ALL ROUTINES IN SCHEMA %I FROM PUBLIC', v_schema);
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_rol) THEN
        EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA %I FROM %I', v_schema, v_rol);
        EXECUTE pg_catalog.format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', v_schema, v_rol);
        EXECUTE pg_catalog.format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', v_schema, v_rol);
        EXECUTE pg_catalog.format('REVOKE ALL ON ALL ROUTINES IN SCHEMA %I FROM %I', v_schema, v_rol);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
COMMENT ON PROCEDURE app.asegurar_permisos() IS
  'Quita todo privilegio de PUBLIC/anon/authenticated/service_role en los schemas app y cola. Va al final de cada migración.';

CALL app.asegurar_permisos();
