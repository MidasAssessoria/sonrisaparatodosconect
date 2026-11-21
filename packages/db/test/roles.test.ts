/**
 * Roles creados por la clínica (0010, 0015): alta sin código de sistema, matriz de permisos
 * reemplazable (lo que se quita queda activo = false), desactivar con motivo y sin personas, permisos
 * crear/editar/anular, autoescalada imposible y rol dueño intocable. Como app_api, con los
 * envoltorios de la API. Desde 0015 nadie deja un rol con más de lo que tiene él (salvo un dueño):
 * Administración arma roles con permisos que ella tiene. Más casos en test/limites.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { ACCIONES, MODULOS } from '@conecta/shared';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  conContexto,
  crearInvitacion,
  crearPool,
  desactivarRol,
  hashTokenInvitacion,
  reemplazarPermisosRol,
  rol as tablaRol,
  type PermisoRol,
  type TransaccionConecta,
} from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, errorDe, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin, 6);
const api = nuevoPool(urls().urlApi, 6);
const poolApi = crearPool(urls().urlApi, { max: 6 });

let K: ClinicaDePrueba;
let administra: UsuarioDePrueba;
let recepcion: UsuarioDePrueba;

beforeAll(async () => {
  K = await crearClinicaDePrueba(admin);
  [administra, recepcion] = await Promise.all([
    crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId, rol: 'administracion' }),
    crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId, rol: 'recepcion' }),
  ]);
  return () => poolApi.end();
});

const comoApi = <T>(usuarioId: string, fn: (tx: TransaccionConecta) => Promise<T>): Promise<T> =>
  conContexto(poolApi, { clinicaId: K.clinicaId, usuarioId }, fn);

/** Alta de un rol como la API: INSERT del rol (sin código) y su matriz, en una transacción. */
async function crearRol(
  usuarioId: string,
  nombre: string,
  permisos: PermisoRol[],
): Promise<{ id: string; codigo: string; activos: number }> {
  return comoApi(usuarioId, async (tx) => {
    const [fila] = await tx
      .insert(tablaRol)
      .values({ clinicaId: K.clinicaId, nombre, inactividadMin: 20, exigeMfa: true })
      .returning({ id: tablaRol.id, codigo: tablaRol.codigo });
    const activos = await reemplazarPermisosRol(tx, fila!.id, permisos);
    return { id: fila!.id, codigo: fila!.codigo, activos };
  });
}

async function matriz(rolId: string): Promise<{ permiso: string; activo: boolean; id: string }[]> {
  return enTransaccion(admin, { clinica: K.clinicaId }, async (c) => {
    const { rows } = await c.query<{ permiso: string; activo: boolean; id: string }>(
      `select modulo || ':' || accion as permiso, activo, id from app.rol_permiso
       where rol_id = $1 order by 1`,
      [rolId],
    );
    return rows;
  });
}

const p = (modulo: PermisoRol['modulo'], accion: PermisoRol['accion']): PermisoRol => ({
  modulo,
  accion,
});

describe('alta y matriz de un rol de la clínica', () => {
  it('nace sin código de sistema, con sus atributos y su matriz, todo auditado', async () => {
    const creado = await crearRol(administra.usuarioId, 'Cobranzas', [
      p('caja', 'ver'),
      p('caja', 'exportar'),
      p('pacientes', 'ver'),
      p('caja', 'ver'),
    ]);
    expect(creado.codigo).toMatch(/^r[0-9a-f]{32}$/);
    expect(creado.activos).toBe(3);
    await enTransaccion(admin, { clinica: K.clinicaId }, async (c) => {
      const { rows } = await c.query(
        'select es_sistema, activo, todas_las_sedes, exige_mfa, inactividad_min from app.rol where id = $1',
        [creado.id],
      );
      expect(rows[0]).toEqual({
        es_sistema: false,
        activo: true,
        todas_las_sedes: false,
        exige_mfa: true,
        inactividad_min: 20,
      });
      const auditoria = await c.query<{ entidad: string; total: number }>(
        `select entidad, count(*)::int as total from app.audit_log
         where clinica_id = $1 and usuario_id = $2 and accion = 'crear' and modulo = 'configuracion'
           and (entidad_id = $3 or (entidad = 'rol_permiso' and despues ->> 'rol_id' = $3::text))
         group by entidad order by entidad`,
        [K.clinicaId, administra.usuarioId, creado.id],
      );
      expect(auditoria.rows).toEqual([
        { entidad: 'rol', total: 1 },
        { entidad: 'rol_permiso', total: 3 },
      ]);
    });
  });

  it('reemplazar la matriz: lo que se quita queda inactivo (no se borra) y lo que vuelve se reactiva', async () => {
    const creado = await crearRol(administra.usuarioId, 'Cambiante', [
      p('agenda', 'ver'),
      p('contabilidad', 'crear'),
    ]);
    const antes = await matriz(creado.id);
    expect(
      await comoApi(administra.usuarioId, (tx) =>
        reemplazarPermisosRol(tx, creado.id, [p('agenda', 'ver'), p('reportes', 'ver')]),
      ),
    ).toBe(2);
    expect((await matriz(creado.id)).map((f) => [f.permiso, f.activo])).toEqual([
      ['agenda:ver', true],
      ['contabilidad:crear', false],
      ['reportes:ver', true],
    ]);
    expect(
      await comoApi(administra.usuarioId, (tx) =>
        reemplazarPermisosRol(tx, creado.id, [p('contabilidad', 'crear')]),
      ),
    ).toBe(1);
    const despues = await matriz(creado.id);
    // La misma fila de contabilidad:crear, reactivada.
    expect(despues.find((f) => f.permiso === 'contabilidad:crear')).toEqual({
      ...antes.find((f) => f.permiso === 'contabilidad:crear'),
      activo: true,
    });
    expect(despues.filter((f) => f.activo).map((f) => f.permiso)).toEqual(['contabilidad:crear']);
    // Vacía: todo inactivo.
    expect(
      await comoApi(administra.usuarioId, (tx) => reemplazarPermisosRol(tx, creado.id, [])),
    ).toBe(0);
  });

  it('rechaza permisos mal escritos, módulos o acciones que no existen y roles de otra clínica', async () => {
    const creado = await crearRol(administra.usuarioId, 'Validado', []);
    await enTransaccion(api, { clinica: K.clinicaId, usuario: administra.usuarioId }, async (c) => {
      for (const [permisos, codigo, restriccion] of [
        [['agenda'], '22023', null],
        [['agenda:ver; drop table x'], '22023', null],
        [[null], '22023', null],
        [['paciente:ver'], '23514', 'rol_permiso_modulo_check'],
        [['agenda:borrar'], '23514', 'rol_permiso_accion_check'],
      ] as const) {
        const r = await intentar(c, 'select app.reemplazar_permisos_rol($1, $2)', [
          creado.id,
          permisos,
        ]);
        expect({ permisos, r }).toMatchObject({
          permisos,
          r: restriccion ? rechazo(codigo, restriccion) : rechazo(codigo),
        });
      }
      const otra = await crearClinicaDePrueba(admin);
      expect(
        await intentar(c, "select app.reemplazar_permisos_rol($1, '{agenda:ver}')", [
          otra.roles.recepcion,
        ]),
      ).toMatchObject(rechazo('P0002', 'rol_no_encontrado'));
    });
  });

  it('la matriz completa (todos los módulos y acciones) es válida', async () => {
    const todo = MODULOS.flatMap((m) => ACCIONES.map((a) => p(m, a)));
    expect((await crearRol(K.duenoId, 'Casi dueño', todo)).activos).toBe(todo.length);
  });
});

describe('permisos para roles', () => {
  it('sin configuracion:editar ni configuracion:crear no se crea ni se toca un rol', async () => {
    const e = await errorDe(crearRol(recepcion.usuarioId, 'Pirata', [p('caja', 'ver')]));
    expect(e).toMatchObject({ codigo: '42501', restriccion: 'acceso_sin_permiso' });
  });

  it('solo configuracion:crear: crea un rol con su matriz en la misma transacción, pero no edita después ni otros roles', async () => {
    const soloCrear = await crearRol(K.duenoId, 'Solo crear roles', [
      p('configuracion', 'ver'),
      p('configuracion', 'crear'),
    ]);
    const persona = await crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId });
    await enTransaccion(
      admin,
      { clinica: K.clinicaId, usuario: '' },
      (c) =>
        c.query('update app.membresia set rol_id = $1 where id = $2', [
          soloCrear.id,
          persona.membresiaId,
        ]),
      { confirmar: true },
    );
    // Con lo que su rol tiene (0015: no da lo que no tiene).
    const nuevo = await crearRol(persona.usuarioId, 'Hecho por solo crear', [
      p('configuracion', 'ver'),
    ]);
    expect(nuevo.activos).toBe(1);
    expect(
      await errorDe(crearRol(persona.usuarioId, 'Con agenda', [p('agenda', 'ver')])),
    ).toMatchObject({ codigo: '42501', restriccion: 'rol_permisos_ajenos' });
    for (const fn of [
      (tx: TransaccionConecta) => reemplazarPermisosRol(tx, nuevo.id, [p('agenda', 'crear')]),
      (tx: TransaccionConecta) =>
        reemplazarPermisosRol(tx, K.roles.asistente, [p('agenda', 'ver')]),
    ]) {
      expect(await errorDe(comoApi(persona.usuarioId, fn))).toMatchObject({
        codigo: '42501',
        restriccion: 'acceso_sin_permiso',
      });
    }
  });

  it('desactivar un rol: con configuracion:anular y motivo alcanza; con personas activas o invitaciones pendientes, no', async () => {
    const libre = await crearRol(K.duenoId, 'Para desactivar', [p('agenda', 'ver')]);
    const conPersona = await crearRol(K.duenoId, 'Con una persona', [p('agenda', 'ver')]);
    const conInvitacion = await crearRol(K.duenoId, 'Con invitación', [p('agenda', 'ver')]);
    const conInactiva = await crearRol(K.duenoId, 'Con una inactiva', [p('agenda', 'ver')]);
    const activa = await crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId });
    const inactiva = await crearUsuarioDePrueba(admin, {
      clinicaId: K.clinicaId,
      estado: 'inactivo',
    });
    await enTransaccion(
      admin,
      { clinica: K.clinicaId, usuario: '' },
      async (c) => {
        await c.query('update app.membresia set rol_id = $1 where id = $2', [
          conPersona.id,
          activa.membresiaId,
        ]);
        await c.query('update app.membresia set rol_id = $1 where id = $2', [
          conInactiva.id,
          inactiva.membresiaId,
        ]);
      },
      { confirmar: true },
    );
    await crearInvitacionDePrueba(admin, { clinicaId: K.clinicaId, rolId: conInvitacion.id });
    // Alguien con solo configuracion:anular (y ver).
    const anula = await crearRol(K.duenoId, 'Solo anular roles', [
      p('configuracion', 'ver'),
      p('configuracion', 'anular'),
    ]);
    const quien = await crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId });
    await enTransaccion(
      admin,
      { clinica: K.clinicaId, usuario: '' },
      (c) =>
        c.query('update app.membresia set rol_id = $1 where id = $2', [
          anula.id,
          quien.membresiaId,
        ]),
      { confirmar: true },
    );
    await enTransaccion(api, { clinica: K.clinicaId, usuario: quien.usuarioId }, async (c) => {
      // Sin motivo, no (0015).
      expect(
        await intentar(c, 'update app.rol set activo = false where id = $1', [libre.id]),
      ).toMatchObject(rechazo('23514', 'baja_sin_motivo'));
      expect(await intentar(c, "select app.desactivar_rol($1, '  ')", [libre.id])).toMatchObject(
        rechazo('23514', 'baja_sin_motivo'),
      );
      const desactivar =
        "update app.rol set activo = false, motivo_baja = ' Ya no se usa ' where id = $1";
      expect(await intentar(c, desactivar, [libre.id])).toMatchObject({ ok: true, cantidad: 1 });
      expect(await valor(c, 'select motivo_baja from app.rol where id = $1', [libre.id])).toBe(
        'Ya no se usa',
      );
      expect(await intentar(c, desactivar, [conInactiva.id])).toMatchObject({
        ok: true,
        cantidad: 1,
      });
      for (const id of [conPersona.id, conInvitacion.id]) {
        expect(await intentar(c, desactivar, [id])).toMatchObject(rechazo('23514', 'rol_en_uso'));
      }
      // Solo anular: no edita el nombre.
      expect(
        await intentar(c, "update app.rol set nombre = 'Otro nombre' where id = $1", [
          conPersona.id,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
      // La desactivación quedó como anular en la auditoría, con el motivo.
      expect(
        await valor(
          c,
          `select accion || '|' || (despues ->> 'motivo_baja') from app.audit_log
           where entidad = 'rol' and entidad_id = $1 order by fecha desc limit 1`,
          [libre.id],
        ),
      ).toBe('anular|Ya no se usa');
    });
    // Un rol desactivado no se usa para invitar ni para reincorporar a alguien.
    await enTransaccion(api, { clinica: K.clinicaId, usuario: administra.usuarioId }, async (c) => {
      await c.query("update app.rol set activo = false, motivo_baja = 'Baja' where id = any($1)", [
        [libre.id, conInactiva.id],
      ]);
      const r = await intentar(c, 'select * from app.crear_invitacion($1, $2, $3, $4, null, $5)', [
        'Alguien',
        `alguien-${randomUUID().slice(0, 6)}@prueba.test`,
        libre.id,
        [],
        hashTokenInvitacion(randomBytes(16).toString('hex')),
      ]);
      expect(r).toMatchObject(rechazo('23514', 'rol_inactivo'));
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [
          inactiva.membresiaId,
        ]),
      ).toMatchObject(rechazo('23514', 'rol_inactivo'));
    });
  });

  it('desactivar un rol mientras otra transacción invita con ese rol: nunca quedan las dos', async () => {
    const enDisputa = await crearRol(K.duenoId, 'En disputa', [p('agenda', 'ver')]);
    const uno = await api.connect();
    const dos = await api.connect();
    try {
      for (const [cliente, usuario] of [
        [uno, K.duenoId],
        [dos, administra.usuarioId],
      ] as const) {
        await cliente.query('BEGIN');
        await cliente.query("set local lock_timeout = '5s'");
        await cliente.query(
          "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
          [K.clinicaId, usuario],
        );
      }
      // Uno invita con el rol (toma el rol con bloqueo compartido)…
      await uno.query('select * from app.crear_invitacion($1, $2, $3, $4, null, $5)', [
        'En disputa',
        `disputa-${randomUUID().slice(0, 6)}@prueba.test`,
        enDisputa.id,
        [],
        hashTokenInvitacion(randomUUID()),
      ]);
      // …y el otro intenta desactivarlo: espera, y al confirmar el primero ve la invitación.
      const desactivar = dos
        .query("select app.desactivar_rol($1, 'Ya no se usa')", [enDisputa.id])
        .then(
          () => null,
          (e: unknown) => e as { code?: string; constraint?: string },
        );
      await new Promise((r) => setTimeout(r, 300));
      await uno.query('COMMIT');
      expect(await desactivar).toMatchObject({ code: '23514', constraint: 'rol_en_uso' });
      await dos.query('ROLLBACK');
    } finally {
      await uno.query('ROLLBACK').catch(() => undefined);
      await dos.query('ROLLBACK').catch(() => undefined);
      uno.release();
      dos.release();
    }
  });
});

describe('autoescalada y rol dueño', () => {
  it('nadie cambia la matriz ni los datos de su propio rol, ni se asigna un rol nuevo', async () => {
    const todopoderoso = await crearRol(K.duenoId, 'Todopoderoso', [
      p('ficha_clinica', 'ver'),
      p('auditoria', 'exportar'),
    ]);
    const propias: ((tx: TransaccionConecta) => Promise<unknown>)[] = [
      (tx) => reemplazarPermisosRol(tx, K.roles.administracion, [p('ficha_clinica', 'ver')]),
      (tx) =>
        tx.execute(
          `update app.rol set exige_mfa = false where id = '${K.roles.administracion}'` as never,
        ),
      (tx) =>
        tx.execute(
          `update app.membresia set rol_id = '${todopoderoso.id}' where id = '${administra.membresiaId}'` as never,
        ),
    ];
    for (const fn of propias) {
      expect(await errorDe(comoApi(administra.usuarioId, fn))).toMatchObject({
        codigo: '42501',
        restriccion: 'acceso_propio',
      });
    }
  });

  it('el rol dueño y sus permisos no se tocan: ni administración, ni el dueño (es su propio rol)', async () => {
    for (const [quien, restriccion] of [
      [administra.usuarioId, 'acceso_rol_dueno'],
      [K.duenoId, 'acceso_propio'],
    ] as const) {
      expect(
        await errorDe(
          comoApi(quien, (tx) => reemplazarPermisosRol(tx, K.roles.dueno, [p('agenda', 'ver')])),
        ),
      ).toMatchObject({ codigo: '42501', restriccion });
    }
    await enTransaccion(api, { clinica: K.clinicaId, usuario: administra.usuarioId }, async (c) => {
      expect(
        await intentar(c, 'update app.rol set activo = false where id = $1', [K.roles.dueno]),
      ).toMatchObject(rechazo('23514', 'rol_dueno_activo'));
      // Ni un rol de sistema nuevo, ni un rol propio con el código de un rol de sistema.
      expect(
        await intentar(
          c,
          "insert into app.rol (clinica_id, nombre, es_sistema) values ($1, 'Otro dueño', true)",
          [K.clinicaId],
        ),
      ).toMatchObject(rechazo('42501', 'rol_sistema'));
      expect(
        await intentar(
          c,
          "insert into app.rol (clinica_id, nombre, codigo) values ($1, 'Falso', 'dueno')",
          [K.clinicaId],
        ),
      ).toMatchObject(rechazo('23505', 'rol_codigo_key'));
    });
  });

  it('0015 revierte la decisión de 0010: nadie le da a un rol ni asigna un rol con permisos que no tiene', async () => {
    // Administración no ve la ficha clínica: no arma un rol que la vea, y con uno que armó el dueño
    // no invita (la segunda cuenta propia ya no sirve para escalar).
    expect(
      await errorDe(crearRol(administra.usuarioId, 'Con ficha', [p('ficha_clinica', 'ver')])),
    ).toMatchObject({ codigo: '42501', restriccion: 'rol_permisos_ajenos' });
    const conFicha = await crearRol(K.duenoId, 'Con ficha (del dueño)', [
      p('ficha_clinica', 'ver'),
    ]);
    const invitar = (quien: string) =>
      comoApi(quien, (tx) =>
        crearInvitacion(tx, {
          nombre: 'Segunda cuenta',
          email: `segunda-${randomUUID().slice(0, 6)}@prueba.test`,
          rolId: conFicha.id,
          sedeIds: [],
          tokenHash: hashTokenInvitacion(randomUUID()),
        }),
      );
    expect(await errorDe(invitar(administra.usuarioId))).toMatchObject({
      codigo: '42501',
      restriccion: 'asignacion_rol_superior',
    });
    // El dueño no tiene límite.
    expect((await invitar(K.duenoId)).membresiaId).toMatch(/^[0-9a-f-]{36}$/);
    // desactivarRol: el envoltorio de la API.
    const viejo = await crearRol(administra.usuarioId, 'Para dar de baja', [p('caja', 'ver')]);
    await comoApi(administra.usuarioId, (tx) => desactivarRol(tx, viejo.id, 'Se fusionó con Caja'));
    expect(
      await errorDe(comoApi(administra.usuarioId, (tx) => desactivarRol(tx, viejo.id, 'Otra vez'))),
    ).toMatchObject({ codigo: 'P0002', restriccion: 'rol_no_encontrado' });
  });
});

describe('roles y aislamiento', () => {
  it('otra clínica no ve, no edita, no desactiva ni asigna los roles de K', async () => {
    const creado = await crearRol(K.duenoId, 'Rol de K', [p('agenda', 'ver')]);
    const otra = await crearClinicaDePrueba(admin);
    await enTransaccion(
      api,
      { clinica: otra.clinicaId, usuario: otra.duenoId },
      async (c: pg.PoolClient) => {
        expect(await valor(c, 'select count(*)::int from app.rol where id = $1', [creado.id])).toBe(
          0,
        );
        expect(
          await intentar(c, 'update app.rol set activo = false where id = $1', [creado.id]),
        ).toMatchObject({ ok: true, cantidad: 0 });
        expect(
          await intentar(c, "select app.reemplazar_permisos_rol($1, '{}')", [creado.id]),
        ).toMatchObject(rechazo('P0002', 'rol_no_encontrado'));
        expect(
          await intentar(c, 'insert into app.membresia (clinica_id, rol_id) values ($1, $2)', [
            otra.clinicaId,
            creado.id,
          ]),
        ).toMatchObject(rechazo('23503'));
      },
    );
  });
});
