/**
 * Defensa de membresia, usuario_sede, rol y rol_permiso (app.proteger_acceso) y último dueño
 * (app.proteger_ultimo_dueno), con app_api y un contexto legítimo. Incluye la pasada adversarial:
 * escalar el propio rol, tomar el de dueño, dejar la clínica sin dueño, ver un perfil ajeno con una
 * invitación, y saltarse las reglas con trucos de sesión.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  crearClinicaDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin, 6);
const api = nuevoPool(urls().urlApi, 8);

interface Plantel extends ClinicaDePrueba {
  sedeId: string;
  dueno2: UsuarioDePrueba;
  administra: UsuarioDePrueba;
  recepcion: UsuarioDePrueba;
  odontologo: UsuarioDePrueba;
  pendiente: UsuarioDePrueba;
  inactivo: UsuarioDePrueba;
  /** Dueño de otra clínica: no tiene nada en esta. */
  ajeno: string;
}

async function prepararPlantel(): Promise<Plantel> {
  const clinica = await crearClinicaDePrueba(admin);
  const otra = await crearClinicaDePrueba(admin);
  const id = clinica.clinicaId;
  const [{ sedeId }, dueno2, administra, recepcion, odontologo, pendiente, inactivo] =
    await Promise.all([
      crearSedeDePrueba(admin, id),
      crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'dueno' }),
      crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'administracion' }),
      crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'recepcion' }),
      crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'odontologo' }),
      crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'asistente', estado: 'pendiente' }),
      crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'asistente', estado: 'inactivo' }),
    ]);
  return {
    ...clinica,
    sedeId,
    dueno2,
    administra,
    recepcion,
    odontologo,
    pendiente,
    inactivo,
    ajeno: otra.duenoId,
  };
}

let K: Plantel;

beforeAll(async () => {
  K = await prepararPlantel();
});

/** Transacción de app_api con la clínica de `p` y el usuario dado (se revierte al final). */
const como = <T>(
  p: Plantel,
  usuario: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
  opciones: { confirmar?: boolean } = {},
): Promise<T> => enTransaccion(api, { clinica: p.clinicaId, usuario }, fn, opciones);

const SQL = {
  altaMembresia: (estado = 'pendiente') =>
    `insert into app.membresia (clinica_id, usuario_id, rol_id, estado) values ($1, $2, $3, '${estado}')`,
  altaSede: 'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
  altaRol:
    "insert into app.rol (clinica_id, nombre, codigo) values ($1, 'Cobranzas', $2) returning id",
  altaPermiso:
    'insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, $3, $4)',
};

describe('permisos que exige la base', () => {
  it('recepción y odontología no cambian personal ni roles (acceso_sin_permiso)', async () => {
    for (const quien of [K.recepcion, K.odontologo]) {
      await como(K, quien.usuarioId, async (c) => {
        const intentos: [string, unknown[]][] = [
          [SQL.altaMembresia(), [K.clinicaId, K.ajeno, K.roles.asistente]],
          [
            "update app.membresia set estado = 'inactivo' where id = $1",
            [K.administra.membresiaId],
          ],
          [SQL.altaSede, [K.clinicaId, K.administra.membresiaId, K.sedeId]],
          [SQL.altaRol, [K.clinicaId, 'rol_x']],
          ["update app.rol set nombre = 'X' where id = $1", [K.roles.asistente]],
          [SQL.altaPermiso, [K.clinicaId, K.roles.asistente, 'caja', 'ver']],
          ['update app.rol_permiso set activo = false where rol_id = $1', [K.roles.asistente]],
        ];
        for (const [texto, parametros] of intentos) {
          expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
            texto,
            r: rechazo('42501', 'acceso_sin_permiso'),
          });
        }
      });
    }
  });

  it('administración (personal:crear/editar, configuracion:editar) gestiona personal y roles ajenos', async () => {
    await como(K, K.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, SQL.altaMembresia(), [K.clinicaId, K.ajeno, K.roles.asistente]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [
          K.recepcion.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      // Reincorporar a quien fue miembro.
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [
          K.inactivo.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, SQL.altaSede, [K.clinicaId, K.odontologo.membresiaId, K.sedeId]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      const rol = await valor<string>(c, SQL.altaRol, [K.clinicaId, 'cobranzas']);
      expect(await intentar(c, SQL.altaPermiso, [K.clinicaId, rol, 'caja', 'ver'])).toMatchObject({
        ok: true,
      });
      expect(
        await intentar(
          c,
          'update app.rol set exige_mfa = true, inactividad_min = 10 where id = $1',
          [K.roles.odontologo],
        ),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, 'update app.rol_permiso set activo = false where rol_id = $1', [
          K.roles.recepcion,
        ]),
      ).toMatchObject({ ok: true });
    });
  });

  it('el permiso puntual cuenta: sin personal:crear no da de alta; con el rol desactivado no hace nada', async () => {
    const p = await prepararPlantel();
    await como(
      p,
      p.duenoId,
      (c) =>
        c.query(
          `update app.rol_permiso set activo = false
           where rol_id = $1 and modulo = 'personal' and accion = 'crear'`,
          [p.roles.administracion],
        ),
      { confirmar: true },
    );
    await como(p, p.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, SQL.altaMembresia(), [p.clinicaId, p.ajeno, p.roles.asistente]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [
          p.recepcion.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
    await como(
      p,
      p.duenoId,
      (c) => c.query('update app.rol set activo = false where id = $1', [p.roles.administracion]),
      { confirmar: true },
    );
    await como(p, p.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [
          p.recepcion.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_membresia'));
    });
  });

  it('sin usuario en el contexto, o sin membresía activa en esa clínica, no se cambia nada', async () => {
    const casos: [string, string | null, string][] = [
      ['sin usuario', null, 'acceso_sin_actor'],
      ['usuario inválido', 'no-es-uuid', 'acceso_sin_actor'],
      ['dueño de otra clínica', K.ajeno, 'acceso_sin_membresia'],
      ['invitación pendiente', K.pendiente.usuarioId, 'acceso_sin_membresia'],
      ['membresía inactiva', K.inactivo.usuarioId, 'acceso_sin_membresia'],
      ['usuario inexistente', randomUUID(), 'acceso_sin_membresia'],
    ];
    for (const [nombre, usuario, regla] of casos) {
      await como(K, usuario, async (c) => {
        const r = await intentar(c, 'update app.rol set nombre = nombre where id = $1', [
          K.roles.asistente,
        ]);
        expect({ nombre, r }).toMatchObject({ nombre, r: rechazo('42501', regla) });
      });
    }
    // Clínica dada de baja: ni su dueño.
    const p = await prepararPlantel();
    await enTransaccion(
      admin,
      { clinica: p.clinicaId, usuario: p.duenoId },
      (c) => c.query('update app.clinica set activo = false where id = $1', [p.clinicaId]),
      { confirmar: true },
    );
    await como(p, p.duenoId, async (c) => {
      expect(
        await intentar(c, 'update app.rol set nombre = nombre where id = $1', [p.roles.asistente]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_membresia'));
    });
  });

  it('el rol de migraciones (dueño de las tablas) está exceptuado: así funcionan alta_clinica y la semilla', async () => {
    await enTransaccion(admin, { clinica: K.clinicaId, usuario: '' }, async (c) => {
      expect(
        await intentar(c, SQL.altaMembresia('activo'), [K.clinicaId, K.ajeno, K.roles.recepcion]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, 'update app.rol_permiso set activo = false where rol_id = $1', [
          K.roles.dueno,
        ]),
      ).toMatchObject({ ok: true });
    });
  });
});

describe('nadie toca lo propio', () => {
  it('administración no cambia su membresía, sus sedes, su rol ni los permisos de su rol', async () => {
    await como(K, K.administra.usuarioId, async (c) => {
      const intentos: [string, unknown[]][] = [
        ["update app.membresia set estado = 'inactivo' where id = $1", [K.administra.membresiaId]],
        [
          'update app.membresia set rol_id = $1 where id = $2',
          [K.roles.dueno, K.administra.membresiaId],
        ],
        [
          'update app.membresia set sede_defecto_id = $1 where id = $2',
          [K.sedeId, K.administra.membresiaId],
        ],
        [SQL.altaSede, [K.clinicaId, K.administra.membresiaId, K.sedeId]],
        [
          "update app.rol set nombre = 'Administración total' where id = $1",
          [K.roles.administracion],
        ],
        ['update app.rol set exige_mfa = false where id = $1', [K.roles.administracion]],
        [SQL.altaPermiso, [K.clinicaId, K.roles.administracion, 'ficha_clinica', 'ver']],
        [
          `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, 'ficha_clinica', 'ver')
           on conflict (clinica_id, rol_id, modulo, accion) do update set activo = true`,
          [K.clinicaId, K.roles.administracion],
        ],
        [
          `merge into app.rol_permiso p using (select $1::uuid as clinica_id, $2::uuid as rol_id) v
           on false when not matched then
             insert (clinica_id, rol_id, modulo, accion) values (v.clinica_id, v.rol_id, 'ficha_clinica', 'editar')`,
          [K.clinicaId, K.roles.administracion],
        ],
        ['update app.rol_permiso set activo = false where rol_id = $1', [K.roles.administracion]],
        // Una segunda membresía propia en la misma clínica, tampoco.
        [SQL.altaMembresia(), [K.clinicaId, K.administra.usuarioId, K.roles.odontologo]],
      ];
      for (const [texto, parametros] of intentos) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: rechazo('42501', 'acceso_propio'),
        });
      }
    });
  });

  it('el dueño tampoco cambia su propia membresía', async () => {
    await como(K, K.duenoId, async (c) => {
      expect(
        await intentar(c, 'update app.membresia set sede_defecto_id = $1 where id = $2', [
          K.sedeId,
          K.membresiaDuenoId,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_propio'));
    });
  });

  it('escalada por un rol nuevo: se puede crear con todo, pero no asignárselo a uno mismo', async () => {
    await como(K, K.administra.usuarioId, async (c) => {
      const rol = await valor<string>(c, SQL.altaRol, [K.clinicaId, 'todopoderoso']);
      await c.query(
        `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion)
         select $1, $2, m, a from unnest(array['ficha_clinica', 'personal', 'configuracion']) m
         cross join unnest(array['ver', 'crear', 'editar']) a`,
        [K.clinicaId, rol],
      );
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          rol,
          K.administra.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_propio'));
    });
  });
});

describe('el rol dueño', () => {
  it('administración no da, quita ni toca membresías, sedes, rol ni permisos de dueño', async () => {
    await como(K, K.administra.usuarioId, async (c) => {
      const intentos: [string, unknown[]][] = [
        [
          'update app.membresia set rol_id = $1 where id = $2',
          [K.roles.dueno, K.recepcion.membresiaId],
        ],
        ["update app.membresia set estado = 'inactivo' where id = $1", [K.dueno2.membresiaId]],
        [
          'update app.membresia set rol_id = $1 where id = $2',
          [K.roles.recepcion, K.dueno2.membresiaId],
        ],
        [SQL.altaMembresia(), [K.clinicaId, K.ajeno, K.roles.dueno]],
        [SQL.altaSede, [K.clinicaId, K.dueno2.membresiaId, K.sedeId]],
        ["update app.rol set nombre = 'Dueño (editado)' where id = $1", [K.roles.dueno]],
        ['update app.rol set exige_mfa = false where id = $1', [K.roles.dueno]],
        ['update app.rol_permiso set activo = false where rol_id = $1', [K.roles.dueno]],
      ];
      for (const [texto, parametros] of intentos) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: rechazo('42501', 'acceso_rol_dueno'),
        });
      }
    });
  });

  it('un dueño sí da el rol de dueño y da de baja a otro dueño (si queda alguno)', async () => {
    await como(K, K.duenoId, async (c) => {
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.roles.dueno,
          K.odontologo.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [
          K.dueno2.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      // El rol dueño y sus permisos: ni el dueño (es su propio rol).
      expect(
        await intentar(c, 'update app.rol_permiso set activo = false where rol_id = $1', [
          K.roles.dueno,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_propio'));
    });
  });

  it('app_api no crea roles de sistema', async () => {
    await como(K, K.duenoId, async (c) => {
      expect(
        await intentar(
          c,
          "insert into app.rol (clinica_id, nombre, codigo, es_sistema) values ($1, 'Otro dueño', 'dueno_2', true)",
          [K.clinicaId],
        ),
      ).toMatchObject(rechazo('42501', 'rol_sistema'));
    });
  });

  it('el rol dueño no se desactiva, ni siquiera el rol de migraciones', async () => {
    await enTransaccion(admin, { clinica: K.clinicaId, usuario: '' }, async (c) => {
      expect(
        await intentar(c, 'update app.rol set activo = false where id = $1', [K.roles.dueno]),
      ).toMatchObject(rechazo('23514', 'rol_dueno_activo'));
    });
  });
});

describe('una clínica no se queda sin dueño', () => {
  it('el último dueño activo no se da de baja, no se pasa a otro rol, ni con el rol de migraciones', async () => {
    const p = await crearClinicaDePrueba(admin);
    await enTransaccion(admin, { clinica: p.clinicaId, usuario: '' }, async (c) => {
      for (const set of [
        "estado = 'inactivo'",
        "estado = 'pendiente'",
        `rol_id = '${p.roles.administracion}'`,
      ]) {
        const r = await intentar(c, `update app.membresia set ${set} where id = $1`, [
          p.membresiaDuenoId,
        ]);
        expect({ set, r }).toMatchObject({ set, r: rechazo('23514', 'membresia_ultimo_dueno') });
      }
      // Cambios que no le quitan el rol: sí.
      expect(
        await intentar(c, 'update app.membresia set sede_defecto_id = null where id = $1', [
          p.membresiaDuenoId,
        ]),
      ).toMatchObject({ ok: true });
    });
  });

  it('con dos dueños, uno da de baja al otro; después el que queda ya no se puede dar de baja', async () => {
    const p = await prepararPlantel();
    await como(
      p,
      p.duenoId,
      (c) =>
        c.query("update app.membresia set estado = 'inactivo' where id = $1", [
          p.dueno2.membresiaId,
        ]),
      { confirmar: true },
    );
    await enTransaccion(admin, { clinica: p.clinicaId, usuario: '' }, async (c) => {
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where id = $1", [
          p.membresiaDuenoId,
        ]),
      ).toMatchObject(rechazo('23514', 'membresia_ultimo_dueno'));
      // Un UPDATE que da de baja a todos los dueños a la vez, tampoco.
      expect(
        await intentar(c, "update app.membresia set estado = 'inactivo' where rol_id = $1", [
          p.roles.dueno,
        ]),
      ).toMatchObject(rechazo('23514', 'membresia_ultimo_dueno'));
    });
  });

  it('dos bajas simultáneas de los dos últimos dueños: pasa una sola', async () => {
    const p = await prepararPlantel();
    const ctx = { clinica: p.clinicaId, usuario: '' };
    const uno = await admin.connect();
    const dos = await admin.connect();
    try {
      for (const cliente of [uno, dos]) {
        await cliente.query('BEGIN');
        await cliente.query("select set_config('app.clinica_id', $1, true)", [ctx.clinica]);
        await cliente.query("select set_config('app.usuario_id', '', true)");
      }
      await uno.query("update app.membresia set estado = 'inactivo' where id = $1", [
        p.membresiaDuenoId,
      ]);
      // La segunda espera: la primera dejó a este dueño con bloqueo compartido.
      const segunda = dos
        .query("update app.membresia set estado = 'inactivo' where id = $1", [p.dueno2.membresiaId])
        .then(
          () => null,
          (error: unknown) => error as { code?: string; constraint?: string },
        );
      await new Promise((r) => setTimeout(r, 300));
      await uno.query('COMMIT');
      const error = await segunda;
      expect(error).toMatchObject({ code: '23514', constraint: 'membresia_ultimo_dueno' });
      await dos.query('ROLLBACK');
    } finally {
      await uno.query('ROLLBACK').catch(() => undefined);
      await dos.query('ROLLBACK').catch(() => undefined);
      uno.release();
      dos.release();
    }
    const activos = await enTransaccion(admin, { clinica: p.clinicaId, usuario: '' }, (c) =>
      valor<number>(
        c,
        "select count(*)::int from app.membresia where rol_id = $1 and estado = 'activo'",
        [p.roles.dueno],
      ),
    );
    expect(activos).toBe(1);
  });

  it('dos dueños que se dan de baja mutuamente a la vez (por la API): queda uno', async () => {
    const p = await prepararPlantel();
    const uno = await api.connect();
    const dos = await api.connect();
    const fijar = async (cliente: pg.PoolClient, usuario: string): Promise<void> => {
      await cliente.query('BEGIN');
      // Si una termina antes de que la otra pida el bloqueo, la otra esperaría a un COMMIT que
      // esta prueba hace después: con lock_timeout falla en vez de colgarse.
      await cliente.query("set local lock_timeout = '2s'");
      await cliente.query(
        "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
        [p.clinicaId, usuario],
      );
    };
    try {
      await fijar(uno, p.duenoId);
      await fijar(dos, p.dueno2.usuarioId);
      const resultados = await Promise.allSettled([
        uno.query("update app.membresia set estado = 'inactivo' where id = $1", [
          p.dueno2.membresiaId,
        ]),
        dos.query("update app.membresia set estado = 'inactivo' where id = $1", [
          p.membresiaDuenoId,
        ]),
      ]);
      // Una se bloquea con la otra: o el detector de interbloqueos aborta una, o la segunda falla
      // al ver que ya no es dueña / que no queda otro dueño. Nunca pasan las dos.
      const pasaron = resultados.filter((r) => r.status === 'fulfilled');
      expect(pasaron.length).toBeLessThanOrEqual(1);
      for (const [i, r] of resultados.entries()) {
        const cliente = i === 0 ? uno : dos;
        await cliente.query(r.status === 'fulfilled' ? 'COMMIT' : 'ROLLBACK');
      }
    } finally {
      await uno.query('ROLLBACK').catch(() => undefined);
      await dos.query('ROLLBACK').catch(() => undefined);
      uno.release();
      dos.release();
    }
    const activos = await enTransaccion(admin, { clinica: p.clinicaId, usuario: '' }, (c) =>
      valor<number>(
        c,
        "select count(*)::int from app.membresia where rol_id = $1 and estado = 'activo'",
        [p.roles.dueno],
      ),
    );
    expect(activos).toBeGreaterThanOrEqual(1);
  });
});

describe('invitación pendiente: no da acceso al perfil de la persona', () => {
  it('una clínica crea una membresía pendiente para alguien de otra clínica y no ve nada de su perfil', async () => {
    await como(K, K.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, SQL.altaMembresia(), [K.clinicaId, K.ajeno, K.roles.asistente]),
      ).toMatchObject({ ok: true });
      expect(await valor(c, 'select count(*)::int from app.usuario where id = $1', [K.ajeno])).toBe(
        0,
      );
      // Ni activándola, ni pasándola a inactiva (las inactivas se ven), ni creándola así.
      for (const estado of ['activo', 'inactivo']) {
        expect(
          await intentar(
            c,
            'update app.membresia set estado = $3 where clinica_id = $1 and usuario_id = $2',
            [K.clinicaId, K.ajeno, estado],
          ),
        ).toMatchObject(rechazo('42501', 'membresia_nace_pendiente'));
      }
    });
    await como(K, K.administra.usuarioId, async (c) => {
      for (const estado of ['activo', 'inactivo']) {
        expect(
          await intentar(c, SQL.altaMembresia(estado), [K.clinicaId, K.ajeno, K.roles.asistente]),
        ).toMatchObject(rechazo('42501', 'membresia_nace_pendiente'));
      }
      // Y una activa no vuelve a pendiente.
      expect(
        await intentar(c, "update app.membresia set estado = 'pendiente' where id = $1", [
          K.recepcion.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'membresia_nace_pendiente'));
    });
  });
});

describe('rol: inactividad razonable', () => {
  it('inactividad_min entre 5 y 240', async () => {
    await como(K, K.duenoId, async (c) => {
      for (const minutos of [4, 241, 0, -1]) {
        expect(
          await intentar(c, 'update app.rol set inactividad_min = $2 where id = $1', [
            K.roles.asistente,
            minutos,
          ]),
        ).toMatchObject(rechazo('23514', 'rol_inactividad_min_check'));
      }
      for (const minutos of [5, 240]) {
        expect(
          await intentar(c, 'update app.rol set inactividad_min = $2 where id = $1', [
            K.roles.asistente,
            minutos,
          ]),
        ).toMatchObject({ ok: true, cantidad: 1 });
      }
    });
  });
});

describe('trucos de sesión para saltarse la defensa (app_api)', () => {
  it('una función temporal pg_has_role que siempre dice que sí no exceptúa a nadie', async () => {
    await como(K, K.recepcion.usuarioId, async (c) => {
      await c.query(
        'create function pg_temp.pg_has_role(name, oid, text) returns boolean language sql as $$ select true $$',
      );
      await c.query('set local search_path = pg_temp, pg_catalog, app');
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.roles.dueno,
          K.recepcion.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501'));
    });
  });

  it('no puede apagar los triggers: ni session_replication_role ni ALTER TABLE', async () => {
    await como(K, K.recepcion.usuarioId, async (c) => {
      for (const texto of [
        'set local session_replication_role = replica',
        'set session_replication_role = replica',
        'alter table app.membresia disable trigger membresia_proteger',
        'alter table app.membresia disable trigger all',
        'alter table app.membresia disable trigger membresia_ultimo_dueno',
        'drop trigger rol_permiso_proteger on app.rol_permiso',
        'create or replace function app.proteger_acceso() returns trigger language plpgsql as $$ begin return new; end $$',
      ]) {
        expect({ texto, r: await intentar(c, texto) }).toMatchObject({
          texto,
          r: rechazo('42501'),
        });
      }
    });
  });

  it('lo que la base no puede impedir: con SQL como app_api se puede fijar el usuario de otra persona', async () => {
    // Misma frontera de confianza que la clínica del contexto: el usuario sale del JWT verificado
    // por la API. Con el usuario del dueño fijado a mano, la base lo trata como el dueño.
    await como(K, K.recepcion.usuarioId, async (c) => {
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.roles.administracion,
          K.recepcion.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501'));
      await c.query("select set_config('app.usuario_id', $1, true)", [K.duenoId]);
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.roles.administracion,
          K.recepcion.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
  });
});
