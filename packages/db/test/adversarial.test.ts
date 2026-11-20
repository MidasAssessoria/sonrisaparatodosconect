/**
 * Pasada adversarial: un atacante con SQL arbitrario como app_api y un contexto legítimo de la
 * clínica A intenta leer o modificar datos de la clínica B por caminos indirectos.
 *
 * Lo que la base NO puede impedir (y por eso es responsabilidad de la API): app_api puede fijar
 * cualquier clínica con set_config. La última prueba lo deja documentado.
 */
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { conContexto, crearPool, sede } from '../src/index.js';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';
import { poblarClinica, type DatosClinica } from './escenario.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 6);

let a: DatosClinica;
let b: DatosClinica;
let nombreSedeB: string;
let correosDeB: string[];

beforeAll(async () => {
  [a, b] = await Promise.all([poblarClinica(admin), poblarClinica(admin)]);
  nombreSedeB = await enTransaccion(admin, { clinica: b.clinicaId, usuario: b.duenoId }, (c) =>
    valor<string>(c, 'select nombre from app.sede where id = $1', [b.sedeId]),
  );
  correosDeB = await enTransaccion(admin, { clinica: b.clinicaId, usuario: b.duenoId }, async (c) =>
    (await c.query<{ email: string }>('select email from app.usuario')).rows.map((f) => f.email),
  );
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, fn);

async function sedeDeBIntacta(): Promise<void> {
  const fila = await enTransaccion(
    admin,
    { clinica: b.clinicaId, usuario: b.duenoId },
    async (c) => {
      const { rows } = await c.query<{
        nombre: string;
        deleted_at: Date | null;
        updated_at: Date | null;
      }>('select nombre, deleted_at, updated_at from app.sede where id = $1', [b.sedeId]);
      return rows[0];
    },
  );
  expect(fila).toEqual({ nombre: nombreSedeB, deleted_at: null, updated_at: null });
}

describe('lecturas indirectas', () => {
  it('subconsultas, EXISTS, joins, agregados y ventanas no ven filas de B', async () => {
    await comoA(async (c) => {
      expect(
        await valor(c, 'select (select nombre from app.sede where id = $1)', [b.sedeId]),
      ).toBeNull();
      expect(
        await valor(c, 'select exists (select 1 from app.sede where clinica_id = $1)', [
          b.clinicaId,
        ]),
      ).toBe(false);
      expect(
        await valor(
          c,
          `select count(*)::int from app.usuario u join app.membresia m on m.usuario_id = u.id
           where m.clinica_id = $1`,
          [b.clinicaId],
        ),
      ).toBe(0);
      expect(
        await valor(
          c,
          `select count(*)::int from app.sillon s join app.sede d on d.id = s.sede_id where d.clinica_id = $1`,
          [b.clinicaId],
        ),
      ).toBe(0);
      expect(
        await valor(c, 'select max(count) from (select count(*) over () from app.sede) t'),
      ).toBe('1');
      expect(
        await valor(c, 'select count(*)::int from app.audit_log where entidad_id = any($1)', [
          [b.sedeId, b.sillonId, b.clinicaId, b.duenoId],
        ]),
      ).toBe(0);
    });
  });

  it('CTE, CTE recursiva y UNION no ven filas de B', async () => {
    await comoA(async (c) => {
      expect(
        await valor(
          c,
          'with x as (select * from app.sede) select count(*)::int from x where clinica_id = $1',
          [b.clinicaId],
        ),
      ).toBe(0);
      expect(
        await valor(
          c,
          `with recursive r(id, n) as (select id, 1 from app.sede union all select id, n + 1 from r where n < 3)
           select count(*)::int from r where id = $1`,
          [b.sedeId],
        ),
      ).toBe(0);
      expect(
        await valor(
          c,
          `select count(*)::int from (select id from app.sede union select id from app.sillon) t
           where id = any($1)`,
          [[b.sedeId, b.sillonId]],
        ),
      ).toBe(0);
    });
  });

  it('una función con efectos (leaky) en el WHERE no ve filas de B', async () => {
    const vistos: string[] = [];
    await comoA(async (c) => {
      c.on('notice', (aviso) => vistos.push(aviso.message ?? ''));
      // pg_temp: app_api puede crear funciones temporales (privilegio TEMP de PUBLIC).
      await c.query(`create function pg_temp.espiar(texto text) returns boolean
                     language plpgsql cost 0.0000001 as $$
                     begin raise notice 'visto:%', texto; return true; end $$`);
      await c.query('select id from app.sede where pg_temp.espiar(nombre)');
      await c.query('select id from app.sede where pg_temp.espiar(nombre) and clinica_id = $1', [
        b.clinicaId,
      ]);
      await c.query('select id from app.usuario where pg_temp.espiar(email)');
      await c.query('select id from app.sede order by pg_temp.espiar(nombre)');
      c.removeAllListeners('notice');
    });
    expect(vistos.length).toBeGreaterThan(0);
    expect(vistos.some((v) => v.includes(nombreSedeB))).toBe(false);
    expect(correosDeB.length).toBe(2);
    expect(vistos.some((v) => correosDeB.some((correo) => v.includes(correo)))).toBe(false);
  });

  it('una vista temporal corre con los permisos de app_api: tampoco ve B', async () => {
    await comoA(async (c) => {
      await c.query('create temp view todas_las_sedes as select * from app.sede');
      expect(
        await valor(c, 'select count(*)::int from todas_las_sedes where clinica_id = $1', [
          b.clinicaId,
        ]),
      ).toBe(0);
      expect(await valor(c, 'select count(*)::int from todas_las_sedes')).toBe(1);
    });
  });

  it('las estadísticas del planificador (pg_stats) no muestran valores de tablas con RLS', async () => {
    await enTransaccion(admin, {}, (c) => c.query('analyze app.sede, app.usuario'), {
      confirmar: true,
    });
    await comoA(async (c) => {
      // La vista del sistema oculta las estadísticas de tablas con RLS activo para quien consulta.
      expect(
        await valor(
          c,
          "select pg_get_viewdef('pg_catalog.pg_stats'::regclass) ~ 'row_security_active'",
        ),
      ).toBe(true);
      expect(
        await valor(c, "select reltuples > 0 from pg_class where oid = 'app.sede'::regclass"),
      ).toBe(true);
      expect(
        await valor(
          c,
          "select count(*)::int from pg_stats where schemaname = 'app' and tablename in ('sede', 'usuario')",
        ),
      ).toBe(0);
    });
  });

  it('pg_stat_activity no muestra los valores de otras sesiones (todo va por parámetros)', async () => {
    const secreto = `secreto-${b.clinicaId}`;
    const otra = await api.connect();
    try {
      await otra.query('BEGIN');
      await otra.query("select set_config('app.clinica_id', $1, true)", [b.clinicaId]);
      const consulta = otra.query('select pg_sleep(1.5), $1::text', [secreto]);
      let textos: string[] = [];
      await comoA(async (c) => {
        for (let i = 0; i < 30 && !textos.some((t) => t.includes('pg_sleep')); i++) {
          const { rows } = await c.query<{ query: string }>(
            "select query from pg_stat_activity where usename = 'app_api' and pid <> pg_backend_pid()",
          );
          textos = rows.map((f) => f.query);
          await new Promise((r) => setTimeout(r, 50));
        }
      });
      await consulta;
      await otra.query('ROLLBACK');
      expect(textos.some((t) => t.includes('pg_sleep(1.5), $1::text'))).toBe(true);
      expect(textos.some((t) => t.includes(secreto) || t.includes(b.clinicaId))).toBe(false);
    } finally {
      otra.release();
    }
  });
});

describe('escrituras indirectas', () => {
  it('CTE con UPDATE/INSERT y RETURNING no tocan B ni la filtran', async () => {
    await comoA(async (c) => {
      expect(
        await valor(
          c,
          "with u as (update app.sede set nombre = 'x' where clinica_id = $1 returning *) select count(*)::int from u",
          [b.clinicaId],
        ),
      ).toBe(0);
      expect(
        await intentar(
          c,
          "with i as (insert into app.sede (clinica_id, nombre) values ($1, 'x') returning *) select * from i",
          [b.clinicaId],
        ),
      ).toMatchObject({ ok: false, codigo: '42501' });
      // RETURNING con una subconsulta sobre B: la subconsulta también pasa por RLS.
      const r = await c.query<{ ajenas: number }>(
        `update app.sede set telefono = telefono where id = $1
         returning (select count(*)::int from app.sede s2 where s2.clinica_id = $2) as ajenas`,
        [a.sedeId, b.clinicaId],
      );
      expect(r.rows[0]?.ajenas).toBe(0);
    });
    await sedeDeBIntacta();
  });

  it('MERGE no encuentra filas de B ni inserta en B', async () => {
    await comoA(async (c) => {
      const r = await intentar(
        c,
        `merge into app.sede s using (select $1::uuid as id) v on s.id = v.id
         when matched then update set nombre = 'tomada'`,
        [b.sedeId],
      );
      expect(r).toMatchObject({ ok: true, cantidad: 0 });
      expect(
        await intentar(
          c,
          `merge into app.sede s using (select $1::uuid as clinica_id) v on false
           when not matched then insert (clinica_id, nombre) values (v.clinica_id, 'pirata')`,
          [b.clinicaId],
        ),
      ).toMatchObject({ ok: false, codigo: '42501' });
    });
    await sedeDeBIntacta();
  });

  it('INSERT … ON CONFLICT DO UPDATE contra una fila de B falla y no la modifica', async () => {
    const permisoB = await enTransaccion(
      admin,
      { clinica: b.clinicaId, usuario: b.duenoId },
      async (c) => {
        const { rows } = await c.query<{ modulo: string; accion: string; activo: boolean }>(
          'select modulo, accion, activo from app.rol_permiso where id = $1',
          [b.rolPermisoId],
        );
        return rows[0]!;
      },
    );
    await comoA(async (c) => {
      const r = await intentar(
        c,
        `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, $3, $4)
         on conflict (rol_id, modulo, accion) do update set activo = false`,
        [a.clinicaId, b.rolId, permisoB.modulo, permisoB.accion],
      );
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
    });
    const despues = await enTransaccion(admin, { clinica: b.clinicaId, usuario: b.duenoId }, (c) =>
      valor<boolean>(c, 'select activo from app.rol_permiso where id = $1', [b.rolPermisoId]),
    );
    expect(despues).toBe(permisoB.activo);
  });

  it('SELECT … FOR UPDATE no puede bloquear filas de B', async () => {
    await comoA(async (c) => {
      expect(
        await valor(
          c,
          'select count(*)::int from (select 1 from app.sede where id = $1 for update) t',
          [b.sedeId],
        ),
      ).toBe(0);
      // Mientras A «tiene» el bloqueo, B edita su fila sin esperar.
      await enTransaccion(api, { clinica: b.clinicaId, usuario: b.duenoId }, async (otra) => {
        await otra.query("set local lock_timeout = '300ms'");
        expect(
          await intentar(otra, 'update app.sede set telefono = telefono where id = $1', [b.sedeId]),
        ).toMatchObject({
          ok: true,
          cantidad: 1,
        });
      });
    });
  });

  it('las funciones SECURITY DEFINER no se dejan engañar con tablas temporales del mismo nombre', async () => {
    await comoA(async (c) => {
      for (const tabla of ['audit_log', 'membresia', 'numerador', 'clinica', 'usuario']) {
        await c.query(`create temp table ${tabla} (like app.${tabla})`);
      }
      await c.query('set local search_path = pg_temp, app, public');
      const evento = await valor<string>(c, "select app.registrar_evento('ver', 'sede', $1)", [
        a.sedeId,
      ]);
      expect(
        await valor(c, 'select count(*)::int from app.audit_log where id = $1', [evento]),
      ).toBe(1);
      expect(await valor(c, 'select count(*)::int from pg_temp.audit_log')).toBe(0);
      const antes = Number(
        await valor<string>(c, "select ultimo from app.numerador where tipo = 'recibo'"),
      );
      const n = Number(await valor<string>(c, "select app.siguiente_numero('recibo')"));
      expect(n).toBe(antes + 1);
      expect(await valor(c, 'select count(*)::int from pg_temp.numerador')).toBe(0);
      // El trigger de auditoría (SECURITY DEFINER) escribe en app.audit_log, no en la temporal.
      await c.query("update app.sede set telefono = '021 111 111' where id = $1", [a.sedeId]);
      expect(await valor(c, 'select count(*)::int from pg_temp.audit_log')).toBe(0);
    });
  });

  it('una función temporal llamada current_setting no cambia la clínica del contexto', async () => {
    await comoA(async (c) => {
      await c.query(
        `create function pg_temp.current_setting(text, boolean) returns text language sql
         as $$ select '${b.clinicaId}'::text $$`,
      );
      await c.query('set local search_path = pg_temp, pg_catalog, app');
      expect(await valor(c, 'select app.clinica_actual()')).toBe(a.clinicaId);
      expect(
        await valor(c, 'select count(*)::int from app.sede where clinica_id = $1', [b.clinicaId]),
      ).toBe(0);
    });
  });
});

describe('conexiones reutilizadas del pool', () => {
  it('un plan preparado no congela la clínica: al cambiar el contexto, cambia lo que se ve', async () => {
    const cliente = await api.connect();
    try {
      await cliente.query("set plan_cache_mode = 'force_generic_plan'");
      await cliente.query('prepare sedes as select clinica_id from app.sede');
      for (const d of [a, b, a]) {
        await cliente.query('begin');
        await cliente.query("select set_config('app.clinica_id', $1, true)", [d.clinicaId]);
        const { rows } = await cliente.query<{ clinica_id: string }>('execute sedes');
        await cliente.query('commit');
        expect(new Set(rows.map((f) => f.clinica_id))).toEqual(new Set([d.clinicaId]));
      }
      await cliente.query('begin');
      expect((await cliente.query('execute sedes')).rowCount).toBe(0);
      await cliente.query('commit');
    } finally {
      await cliente.query('deallocate all').catch(() => undefined);
      await cliente.query('reset plan_cache_mode').catch(() => undefined);
      cliente.release();
    }
  });

  it('conContexto pisa un contexto de sesión «pegado» a la conexión por error', async () => {
    const pool = crearPool(urls().urlApi, { max: 1 });
    try {
      const cliente = await pool.connect();
      // Error de programación simulado: set_config de sesión (is_local = false) con la clínica B.
      await cliente.query("select set_config('app.clinica_id', $1, false)", [b.clinicaId]);
      cliente.release();
      const vistas = await conContexto(
        pool,
        { clinicaId: a.clinicaId, usuarioId: a.duenoId },
        (tx) => tx.select({ clinicaId: sede.clinicaId }).from(sede),
      );
      expect(new Set(vistas.map((f) => f.clinicaId))).toEqual(new Set([a.clinicaId]));
    } finally {
      await pool.end();
    }
  });
});

describe('lo que la base no puede impedir', () => {
  it('app_api puede fijar otra clínica con set_config: la API tiene que fijar el contexto solo desde una membresía verificada', async () => {
    await comoA(async (c) => {
      expect(await valor(c, 'select count(*)::int from app.sede where id = $1', [b.sedeId])).toBe(
        0,
      );
      await c.query("select set_config('app.clinica_id', $1, true)", [b.clinicaId]);
      // Con el contexto de B se ve B: así funciona el aislamiento por contexto. No es una fuga de la
      // base sino la frontera de confianza. Se mitiga en la API: el contexto sale del JWT + membresía.
      expect(await valor(c, 'select count(*)::int from app.sede where id = $1', [b.sedeId])).toBe(
        1,
      );
      // Aun así, no puede mezclar: con el contexto B no ve A.
      expect(await valor(c, 'select count(*)::int from app.sede where id = $1', [a.sedeId])).toBe(
        0,
      );
    });
  });

  it('con un UUID de B ya conocido, una violación de unicidad revela que existe (no su contenido)', async () => {
    await comoA(async (c) => {
      const r = await intentar(
        c,
        "insert into app.sede (id, clinica_id, nombre) values ($1, $2, 'x')",
        [b.sedeId, a.clinicaId],
      );
      // Riesgo residual documentado: hace falta conocer el UUID (aleatorio, 122 bits) y solo revela
      // existencia. La API nunca acepta ids elegidos por el cliente para filas nuevas.
      expect(r).toMatchObject({ ok: false, codigo: '23505' });
    });
    await sedeDeBIntacta();
  });
});
