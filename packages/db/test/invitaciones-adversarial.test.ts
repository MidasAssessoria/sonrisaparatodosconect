/**
 * Pasada adversarial sobre las invitaciones (0010), como app_api con SQL arbitrario: escribir el uso
 * o el autor a mano, reabrir o redirigir una invitación, usar las búsquedas sin clínica, engañar a las
 * funciones SECURITY DEFINER con tablas temporales, activar otra membresía que la del token y saltarse
 * la defensa desde una función SECURITY DEFINER. Al final, lo que la base no puede impedir.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashTokenInvitacion, migrar } from '../src/index.js';
import {
  crearBaseVacia,
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 6);

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;
let administraA: UsuarioDePrueba;
let deB: UsuarioDePrueba;

beforeAll(async () => {
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
  [administraA, deB] = await Promise.all([
    crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId, rol: 'administracion' }),
    crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId, nombre: 'Persona de B' }),
  ]);
});

const hash = (): string => hashTokenInvitacion(randomBytes(32).toString('base64url'));
const correo = (): string => `x-${randomUUID().slice(0, 8)}@prueba.test`;

const comoAdministraA = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: A.clinicaId, usuario: administraA.usuarioId }, fn);

const SQL_ACEPTAR = 'select app.aceptar_invitacion($1, $2, $3) as clinica';

describe('escrituras directas sobre invitacion', () => {
  it('app_api no escribe el uso, el autor, el id ni los datos de una invitación', async () => {
    const inv = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    const otra = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    await comoAdministraA(async (c) => {
      for (const set of [
        'usada_en = now()',
        `usada_por = '${administraA.usuarioId}'`,
        `invitada_por = '${A.duenoId}'`,
        `membresia_id = '${otra.membresiaId}'`,
        `email = 'otro@prueba.test'`,
        `token_hash = '${hash()}'`,
        "vence_en = now() + interval '20 days'",
        'clinica_id = clinica_id',
      ]) {
        const r = await intentar(c, `update app.invitacion set ${set} where id = $1`, [
          inv.invitacionId,
        ]);
        expect({ set, r }).toMatchObject({ set, r: rechazo('42501') });
      }
      // Al crear: ni id elegido, ni ya usada, ni autor falso (sin privilegio sobre esas columnas).
      for (const [columna, valorColumna] of [
        ['id', randomUUID()],
        ['usada_en', new Date().toISOString()],
        ['usada_por', administraA.usuarioId],
        ['invitada_por', A.duenoId],
        ['anulada_en', new Date().toISOString()],
      ] as const) {
        const libre = await valor<string>(
          c,
          'insert into app.membresia (clinica_id, rol_id) values ($1, $2) returning id',
          [A.clinicaId, A.roles.recepcion],
        );
        const r = await intentar(
          c,
          `insert into app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en, ${columna})
           values ($1, $2, $3, 'X', $4, now() + interval '1 day', $5)`,
          [A.clinicaId, libre, correo(), hash(), valorColumna],
        );
        expect({ columna, r }).toMatchObject({ columna, r: rechazo('42501') });
      }
    });
  });

  it('no reabre una invitación anulada ni anula una usada', async () => {
    const anulada = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    const usada = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    await enTransaccion(
      api,
      {},
      (c) => c.query(SQL_ACEPTAR, [usada.tokenHash, randomUUID(), usada.email]),
      { confirmar: true },
    );
    await comoAdministraA(async (c) => {
      await c.query(
        "update app.invitacion set anulada_en = now(), motivo_anulacion = 'Prueba' where id = $1",
        [anulada.invitacionId],
      );
      expect(
        await intentar(
          c,
          'update app.invitacion set anulada_en = null, motivo_anulacion = null where id = $1',
          [anulada.invitacionId],
        ),
      ).toMatchObject(rechazo('42501', 'invitacion_no_vigente'));
      expect(
        await intentar(
          c,
          "update app.invitacion set anulada_en = now(), motivo_anulacion = 'Tarde' where id = $1",
          [usada.invitacionId],
        ),
      ).toMatchObject(rechazo('42501', 'invitacion_no_vigente'));
      // La fecha de anulación la pone la base, no el cliente.
      const otra = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
      const { rows } = await c.query<{ ok: boolean }>(
        `update app.invitacion set anulada_en = '2000-01-01', motivo_anulacion = 'Fecha falsa'
         where id = $1 returning anulada_en = now() as ok`,
        [otra.invitacionId],
      );
      expect(rows[0]?.ok).toBe(true);
    });
  });

  it('no invita a una membresía activa ni redirige un reenvío a otro correo', async () => {
    const pendiente = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    await comoAdministraA(async (c) => {
      const recepcion = await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId });
      const insertar = `insert into app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
         values ($1, $2, $3, 'X', $4, now() + interval '1 day')`;
      expect(
        await intentar(c, insertar, [A.clinicaId, recepcion.membresiaId, correo(), hash()]),
      ).toMatchObject(rechazo('42501', 'invitacion_membresia'));
      // Reenviar «a mano» a mi propio correo para quedarme con la membresía: no.
      await c.query(
        "update app.invitacion set anulada_en = now(), motivo_anulacion = 'Reenvío' where id = $1",
        [pendiente.invitacionId],
      );
      expect(
        await intentar(c, insertar, [A.clinicaId, pendiente.membresiaId, correo(), hash()]),
      ).toMatchObject(rechazo('42501', 'invitacion_otro_correo'));
      // Con el mismo correo, sí.
      expect(
        await intentar(c, insertar, [A.clinicaId, pendiente.membresiaId, pendiente.email, hash()]),
      ).toMatchObject({ ok: true });
      // Dar de baja la membresía con la invitación abierta, tampoco (primero se anula la invitación).
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [
          pendiente.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'membresia_invitacion_abierta'));
    });
  });

  it('una clínica no anula ni reenvía invitaciones de otra', async () => {
    const deA = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    await enTransaccion(api, { clinica: B.clinicaId, usuario: B.duenoId }, async (c) => {
      expect(
        await intentar(c, "select app.anular_invitacion($1, 'ajena')", [deA.membresiaId]),
      ).toMatchObject(rechazo('P0002', 'invitacion_no_encontrada'));
      expect(
        await intentar(c, 'select * from app.reenviar_invitacion($1, $2)', [
          deA.membresiaId,
          hash(),
        ]),
      ).toMatchObject(rechazo('P0002', 'invitacion_no_encontrada'));
      expect(
        await intentar(
          c,
          "update app.invitacion set anulada_en = now(), motivo_anulacion = 'x' where id = $1",
          [deA.invitacionId],
        ),
      ).toMatchObject({ ok: true, cantidad: 0 });
    });
  });
});

describe('búsquedas sin clínica', () => {
  it('app_api no las puede usar aunque fije los parámetros', async () => {
    const deBInv = await crearInvitacionDePrueba(admin, { clinicaId: B.clinicaId });
    for (const contexto of [{}, { clinica: A.clinicaId, usuario: A.duenoId }]) {
      await enTransaccion(api, contexto, async (c) => {
        await c.query("select set_config('app.invitacion_token_hash', $1, true)", [
          deBInv.tokenHash,
        ]);
        await c.query("select set_config('app.usuario_email_buscado', $1, true)", [deB.email]);
        expect(
          await valor(c, 'select count(*)::int from app.invitacion where token_hash = $1', [
            deBInv.tokenHash,
          ]),
        ).toBe(0);
        expect(
          await valor(c, 'select count(*)::int from app.usuario where lower(email) = $1', [
            deB.email,
          ]),
        ).toBe(0);
      });
    }
  });

  it('registrar_evento las limpia: no sirve para probar si un usuario de otra clínica tiene tal correo', async () => {
    await enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, async (c) => {
      await c.query("select set_config('app.usuario_email_buscado', $1, true)", [deB.email]);
      expect(
        await intentar(c, "select app.registrar_evento('ver', 'usuario', $1)", [deB.usuarioId]),
      ).toMatchObject(rechazo('22023'));
    });
  });

  it('consultar_invitacion devuelve solo seis datos de esa invitación', async () => {
    const resultado = await enTransaccion(admin, {}, (c) =>
      valor<string>(
        c,
        "select pg_get_function_result('app.consultar_invitacion(text)'::regprocedure)",
      ),
    );
    expect(resultado).toBe(
      'TABLE(clinica text, rol text, nombre text, email text, vence_en timestamp with time zone, usuario_existe boolean)',
    );
  });
});

describe('las funciones públicas no se dejan engañar', () => {
  it('con tablas temporales del mismo nombre y search_path manipulado', async () => {
    const inv = await crearInvitacionDePrueba(admin, {
      clinicaId: A.clinicaId,
      nombre: 'Nombre Real',
    });
    await enTransaccion(api, {}, async (c) => {
      for (const tabla of ['invitacion', 'usuario', 'membresia', 'clinica', 'rol', 'audit_log']) {
        await c.query(`create temp table ${tabla} (like app.${tabla})`);
      }
      await c.query(
        `insert into pg_temp.invitacion (id, clinica_id, membresia_id, email, nombre, token_hash, vence_en, created_at)
         values (gen_random_uuid(), $1, $2, $3, 'Nombre falso', $4, now() + interval '1 day', now())`,
        [A.clinicaId, inv.membresiaId, inv.email, inv.tokenHash],
      );
      await c.query('set local search_path = pg_temp, app, public');
      const { rows } = await c.query('select nombre from app.consultar_invitacion($1)', [
        inv.tokenHash,
      ]);
      expect(rows).toEqual([{ nombre: 'Nombre Real' }]);
      const usuario = randomUUID();
      expect(await valor(c, SQL_ACEPTAR, [inv.tokenHash, usuario, inv.email])).toBe(A.clinicaId);
      expect(await valor(c, 'select count(*)::int from pg_temp.usuario')).toBe(0);
      expect(await valor(c, 'select count(*)::int from pg_temp.audit_log')).toBe(0);
    });
  });

  it('aceptar con otra clínica en el contexto: activa la membresía del token, audita en su clínica y devuelve el contexto', async () => {
    const inv = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    const usuario = randomUUID();
    await enTransaccion(
      api,
      { clinica: B.clinicaId, usuario: B.duenoId },
      async (c) => {
        expect(await valor(c, SQL_ACEPTAR, [inv.tokenHash, usuario, inv.email])).toBe(A.clinicaId);
        expect(
          await valor(
            c,
            "select current_setting('app.clinica_id') || '|' || current_setting('app.usuario_id')",
          ),
        ).toBe(`${B.clinicaId}|${B.duenoId}`);
      },
      { confirmar: true },
    );
    await enTransaccion(admin, { clinica: A.clinicaId }, async (c) => {
      const autores = await c.query<{ usuario_id: string }>(
        'select distinct usuario_id from app.audit_log where entidad_id = any($1)',
        [[inv.membresiaId, inv.invitacionId, usuario]],
      );
      expect(autores.rows.map((f) => f.usuario_id).filter((u) => u !== null)).toEqual([usuario]);
    });
    // Nada quedó en B.
    await enTransaccion(admin, { clinica: B.clinicaId }, async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.audit_log where usuario_id = $1', [usuario]),
      ).toBe(0);
    });
  });

  it('el token activa solo su membresía: otra pendiente de la misma clínica no cambia', async () => {
    const una = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId, rol: 'asistente' });
    const otra = await crearInvitacionDePrueba(admin, {
      clinicaId: A.clinicaId,
      rol: 'administracion',
    });
    await enTransaccion(
      api,
      {},
      (c) => c.query(SQL_ACEPTAR, [una.tokenHash, randomUUID(), una.email]),
      {
        confirmar: true,
      },
    );
    await enTransaccion(admin, { clinica: A.clinicaId }, async (c) => {
      const { rows } = await c.query<{
        id: string;
        estado: string;
        usuario_id: string | null;
        rol_id: string;
      }>('select id, estado, usuario_id, rol_id from app.membresia where id = any($1)', [
        [una.membresiaId, otra.membresiaId],
      ]);
      const porId = Object.fromEntries(rows.map((f) => [f.id, f]));
      expect(porId[una.membresiaId]).toMatchObject({ estado: 'activo', rol_id: A.roles.asistente });
      expect(porId[otra.membresiaId]).toMatchObject({ estado: 'pendiente', usuario_id: null });
    });
  });

  it('aceptar con la identidad de una cuenta existente exige su mismo correo (no se toma una cuenta ajena)', async () => {
    const inv = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId });
    await enTransaccion(api, {}, async (c) => {
      // El id del dueño de A con el correo de la invitación: la cuenta tiene otro correo.
      expect(await intentar(c, SQL_ACEPTAR, [inv.tokenHash, A.duenoId, inv.email])).toMatchObject(
        rechazo('42501', 'invitacion_otra_cuenta'),
      );
      // Parámetros vacíos o nulos.
      for (const parametros of [
        [inv.tokenHash, null, inv.email],
        [inv.tokenHash, randomUUID(), null],
        [inv.tokenHash, randomUUID(), '   '],
      ]) {
        expect(await intentar(c, SQL_ACEPTAR, parametros)).toMatchObject(rechazo('22023'));
      }
    });
  });
});

describe('la defensa también vale dentro de una función SECURITY DEFINER llamada por app_api', () => {
  it('una función del dueño de las tablas que escribe membresías no exceptúa las reglas (base aparte)', async () => {
    // Base aparte: la función de prueba no puede aparecer en las meta-pruebas de la base compartida.
    const base = await crearBaseVacia(urls());
    const adminTmp = new pg.Pool({ connectionString: base.urlAdmin, max: 2 });
    const apiTmp = new pg.Pool({ connectionString: base.urlApi, max: 2 });
    try {
      await migrar(base.urlAdmin);
      const clinica = await crearClinicaDePrueba(adminTmp);
      const recepcion = await crearUsuarioDePrueba(adminTmp, { clinicaId: clinica.clinicaId });
      const otra = await crearUsuarioDePrueba(adminTmp, {
        clinicaId: clinica.clinicaId,
        rol: 'asistente',
      });
      const pendiente = await crearInvitacionDePrueba(adminTmp, { clinicaId: clinica.clinicaId });
      await enTransaccion(
        adminTmp,
        {},
        async (c) => {
          await c.query(`
            create function app.prueba_escalar(p_membresia uuid, p_rol uuid, p_usuario uuid)
              returns void language plpgsql security definer set search_path = pg_catalog, pg_temp
            as $$
            begin
              update app.membresia set rol_id = coalesce(p_rol, rol_id),
                     usuario_id = coalesce(p_usuario, usuario_id),
                     estado = case when p_usuario is null then estado else 'activo' end
              where id = p_membresia;
            end $$`);
          await c.query(
            'grant execute on function app.prueba_escalar(uuid, uuid, uuid) to app_api',
          );
        },
        { confirmar: true },
      );
      const llamar = (contexto: { clinica?: string; usuario?: string }, parametros: unknown[]) =>
        enTransaccion(apiTmp, contexto, (c) =>
          intentar(c, 'select app.prueba_escalar($1, $2, $3)', parametros),
        );
      const ctxRecepcion = { clinica: clinica.clinicaId, usuario: recepcion.usuarioId };
      // Darse el rol de dueño: la función corre como el dueño de las tablas, pero la sesión es app_api.
      expect(
        await llamar(ctxRecepcion, [recepcion.membresiaId, clinica.roles.dueno, null]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
      // Sin usuario en el contexto, a otra persona.
      expect(
        await llamar({ clinica: clinica.clinicaId }, [otra.membresiaId, clinica.roles.dueno, null]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_actor'));
      // Activar una membresía pendiente sin haber aceptado su invitación.
      expect(
        await llamar(ctxRecepcion, [pendiente.membresiaId, null, recepcion.usuarioId]),
      ).toMatchObject(rechazo('42501', 'membresia_por_invitacion'));
      // Prueba de la prueba: la misma función desde una sesión del dueño de las tablas sí pasa.
      expect(
        await enTransaccion(adminTmp, { clinica: clinica.clinicaId, usuario: '' }, (c) =>
          intentar(c, 'select app.prueba_escalar($1, $2, null)', [
            otra.membresiaId,
            clinica.roles.recepcion,
          ]),
        ),
      ).toMatchObject({ ok: true });
    } finally {
      await apiTmp.end();
      await adminTmp.end();
      await base.eliminar();
    }
  });
});

describe('lo que la base no puede impedir', () => {
  it('con SQL como app_api se puede aceptar con el usuario y el correo de otra persona: la API tiene que verificarlos', async () => {
    // Límite de confianza documentado en 0010: p_usuario_id y p_email salen del JWT verificado (o de
    // la cuenta recién creada con la Admin API). Una clínica que invitó a un correo ajeno y llama a la
    // función con el id de esa persona la activa sin su consentimiento. Lo mitiga la API, que nunca
    // toma esos datos del cuerpo del pedido.
    const inv = await crearInvitacionDePrueba(admin, { clinicaId: A.clinicaId, email: deB.email });
    await enTransaccion(api, {}, async (c) => {
      expect(await valor(c, SQL_ACEPTAR, [inv.tokenHash, deB.usuarioId, deB.email])).toBe(
        A.clinicaId,
      );
    });
  });
});
