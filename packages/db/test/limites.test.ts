/**
 * Límites de quien administra (0015), como app_api con SQL arbitrario y con los envoltorios de la
 * API: nadie otorga lo que no tiene (el ataque de la revisión del Sprint 2 en sus dos pasos y sus
 * variantes), roles de sistema solo para un dueño, doble factor obligatorio para Dueño/a y
 * Administración, alcance de sedes (también en el listado), desactivar con personal:anular y con
 * motivo, y el vínculo profesional-membresía.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  conContexto,
  crearInvitacion,
  crearPool,
  desactivarMembresia,
  hashTokenInvitacion,
  listarPersonal,
  membresiaEnAlcance,
  reemplazarPermisosRol,
  rol as tablaRol,
  type PermisoRol,
  type TransaccionConecta,
} from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearProfesionalDePrueba,
  crearRolDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, errorDe, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin, 6);
const api = nuevoPool(urls().urlApi, 6);
const poolApi = crearPool(urls().urlApi, { max: 4 });

interface Plantel extends ClinicaDePrueba {
  s1: string;
  s2: string;
  s3: string;
  administra: UsuarioDePrueba;
  odontologo: UsuarioDePrueba;
  /** Odontóloga dada de baja (rol de sistema con ficha clínica). */
  odontologaInactiva: UsuarioDePrueba;
  /** Rol de la clínica sin todas las sedes, con personal y configuración. */
  rolEncargada: string;
  /** Encargada de la sede S1 (solo ve S1). */
  encargada: UsuarioDePrueba;
  /** Roles chicos: incluidos en los de la encargada y en los de Administración. */
  rolMenor: string;
  rolMenor2: string;
  /** Como rolMenor pero con todas las sedes. */
  rolMenorTodas: string;
  enS1: UsuarioDePrueba;
  enS1yS2: UsuarioDePrueba;
  sinSedes: UsuarioDePrueba;
  /** usuario_sede en S1 y sede por defecto S2: su alcance es S1 + S2. */
  conDefectoS2: UsuarioDePrueba;
}

let K: Plantel;

beforeAll(async () => {
  const clinica = await crearClinicaDePrueba(admin);
  const id = clinica.clinicaId;
  const [{ sedeId: s1 }, { sedeId: s2 }, { sedeId: s3 }] = await Promise.all([
    crearSedeDePrueba(admin, id),
    crearSedeDePrueba(admin, id),
    crearSedeDePrueba(admin, id),
  ]);
  const [encargadaRol, menor, menor2, menorTodas] = await Promise.all([
    crearRolDePrueba(admin, {
      clinicaId: id,
      nombre: 'Encargada de sede',
      permisos: [
        'inicio:ver',
        'agenda:ver',
        'caja:ver',
        'personal:ver',
        'personal:crear',
        'personal:editar',
        'personal:anular',
        'configuracion:ver',
        'configuracion:crear',
        'configuracion:editar',
      ],
    }),
    crearRolDePrueba(admin, {
      clinicaId: id,
      nombre: 'Menor',
      permisos: ['inicio:ver', 'caja:ver'],
    }),
    crearRolDePrueba(admin, { clinicaId: id, nombre: 'Menor 2', permisos: ['agenda:ver'] }),
    crearRolDePrueba(admin, {
      clinicaId: id,
      nombre: 'Menor con todas las sedes',
      permisos: ['inicio:ver'],
      todasLasSedes: true,
    }),
  ]);
  const [
    administra,
    odontologo,
    odontologaInactiva,
    encargada,
    enS1,
    enS1yS2,
    sinSedes,
    conDefectoS2,
  ] = await Promise.all([
    crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'administracion' }),
    crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'odontologo' }),
    crearUsuarioDePrueba(admin, { clinicaId: id, rol: 'odontologo', estado: 'inactivo' }),
    crearUsuarioDePrueba(admin, { clinicaId: id, rolId: encargadaRol.rolId, sedeIds: [s1] }),
    crearUsuarioDePrueba(admin, { clinicaId: id, rolId: menor.rolId, sedeIds: [s1] }),
    crearUsuarioDePrueba(admin, { clinicaId: id, rolId: menor.rolId, sedeIds: [s1, s2] }),
    crearUsuarioDePrueba(admin, { clinicaId: id, rolId: menor.rolId }),
    crearUsuarioDePrueba(admin, {
      clinicaId: id,
      rolId: menor.rolId,
      sedeIds: [s1],
      sedeDefectoId: s2,
    }),
  ]);
  K = {
    ...clinica,
    s1,
    s2,
    s3,
    administra,
    odontologo,
    odontologaInactiva,
    rolEncargada: encargadaRol.rolId,
    encargada,
    rolMenor: menor.rolId,
    rolMenor2: menor2.rolId,
    rolMenorTodas: menorTodas.rolId,
    enS1,
    enS1yS2,
    sinSedes,
    conDefectoS2,
  };
  return () => poolApi.end();
});

/** Transacción de app_api con la clínica K y el usuario dado (se revierte al final). */
const como = <T>(usuario: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: K.clinicaId, usuario }, fn);

/** Como la API: `conContexto` (confirma si `fn` termina bien). */
const comoApi = <T>(usuarioId: string, fn: (tx: TransaccionConecta) => Promise<T>): Promise<T> =>
  conContexto(poolApi, { clinicaId: K.clinicaId, usuarioId }, fn);

/** Permisos activos de un rol, ordenados, vistos por la administración. */
async function permisos(rolId: string): Promise<string[]> {
  return enTransaccion(admin, { clinica: K.clinicaId }, (c) =>
    valor<string[]>(c, 'select app.permisos_de_rol($1, $2)', [K.clinicaId, rolId]),
  );
}

const comoPermisos = (lista: string[]): PermisoRol[] =>
  lista.map((x) => {
    const [modulo, accion] = x.split(':');
    return { modulo, accion } as PermisoRol;
  });

const SQL_INVITAR = 'select * from app.crear_invitacion($1, $2, $3, $4, $5, $6)';
const datosInvitacion = (
  rolId: string,
  sedes: string[] = [],
  defecto: string | null = null,
): unknown[] => [
  'Persona Invitada',
  `inv-${randomUUID().slice(0, 8)}@prueba.test`,
  rolId,
  sedes,
  defecto,
  hashTokenInvitacion(randomBytes(32).toString('base64url')),
];

describe('nadie otorga lo que no tiene: el ataque de la revisión', () => {
  it('paso 1: Administración no le agrega ficha_clinica:exportar al rol Asistente (ni toca roles de sistema); las asistentes reales no cambian', async () => {
    const antes = await permisos(K.roles.asistente);
    expect(antes).toContain('ficha_clinica:ver');
    expect(
      await errorDe(
        comoApi(K.administra.usuarioId, (tx) =>
          reemplazarPermisosRol(
            tx,
            K.roles.asistente,
            comoPermisos([...antes, 'ficha_clinica:exportar']),
          ),
        ),
      ),
    ).toMatchObject({ codigo: '42501', restriccion: 'rol_sistema_solo_dueno' });
    await como(K.administra.usuarioId, async (c) => {
      for (const [texto, parametros] of [
        [
          `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion)
           values ($1, $2, 'ficha_clinica', 'exportar')`,
          [K.clinicaId, K.roles.asistente],
        ],
        [
          `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion)
           values ($1, $2, 'ficha_clinica', 'exportar')
           on conflict (clinica_id, rol_id, modulo, accion) do update set activo = true`,
          [K.clinicaId, K.roles.odontologo],
        ],
        ['update app.rol set todas_las_sedes = true where id = $1', [K.roles.asistente]],
        ["update app.rol set nombre = 'Recepción' where id = $1", [K.roles.recepcion]],
        ['update app.rol_permiso set activo = false where rol_id = $1', [K.roles.odontologo]],
      ] as const) {
        expect({ texto, r: await intentar(c, texto, [...parametros]) }).toMatchObject({
          texto,
          r: rechazo('42501', 'rol_sistema_solo_dueno'),
        });
      }
    });
    expect(await permisos(K.roles.asistente)).toEqual(antes);
  });

  it('paso 2: Administración no se invita con una cuenta propia con un rol que da más que el suyo', async () => {
    for (const [rolId, falta] of [
      [K.roles.asistente, 'ficha_clinica:ver'],
      [K.roles.odontologo, 'ficha_clinica:editar'],
      [K.roles.recepcion, 'caja:crear'],
    ] as const) {
      const e = await errorDe(
        comoApi(K.administra.usuarioId, (tx) =>
          crearInvitacion(tx, {
            nombre: 'Mi otra cuenta',
            email: `otra-${randomUUID().slice(0, 8)}@prueba.test`,
            rolId,
            sedeIds: [],
            tokenHash: hashTokenInvitacion(randomUUID()),
          }),
        ),
      );
      expect({ rolId, e }).toMatchObject({
        rolId,
        e: { codigo: '42501', restriccion: 'asignacion_rol_superior' },
      });
      // El mensaje dice qué permisos sobran (nombres de módulo y acción, nada personal).
      expect(e.mensaje).toContain(falta);
    }
    // Con un rol que no da más que el suyo, sí.
    const creada = await comoApi(K.administra.usuarioId, (tx) =>
      crearInvitacion(tx, {
        nombre: 'Cobranzas',
        email: `cobranzas-${randomUUID().slice(0, 8)}@prueba.test`,
        rolId: K.rolMenor,
        sedeIds: [],
        tokenHash: hashTokenInvitacion(randomUUID()),
      }),
    );
    expect(creada.membresiaId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('un rol de la clínica con más permisos (lo armó el dueño): ni se edita ni se asigna; quitándole lo que sobra, sí', async () => {
    const { rolId } = await crearRolDePrueba(admin, {
      clinicaId: K.clinicaId,
      nombre: 'Cobranzas y fichas',
      permisos: ['caja:ver', 'ficha_clinica:exportar'],
    });
    await como(K.administra.usuarioId, async (c) => {
      for (const [texto, parametros] of [
        ["update app.rol set nombre = 'Otro nombre' where id = $1", [rolId]],
        ['update app.rol set inactividad_min = 20 where id = $1', [rolId]],
        [
          'select app.reemplazar_permisos_rol($1, $2)',
          [rolId, ['caja:ver', 'caja:exportar', 'ficha_clinica:exportar']],
        ],
        // Quitarle otra cosa lo deja igual con lo que sobra.
        [
          "update app.rol_permiso set activo = false where rol_id = $1 and modulo = 'caja'",
          [rolId],
        ],
      ] as const) {
        expect({ texto, r: await intentar(c, texto, [...parametros]) }).toMatchObject({
          texto,
          r: rechazo('42501', 'rol_permisos_ajenos'),
        });
      }
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(rolId))).toMatchObject(
        rechazo('42501', 'asignacion_rol_superior'),
      );
      // Reemplazar la matriz revoca primero: el estado intermedio no la hace fallar.
      expect(
        await intentar(c, "select app.reemplazar_permisos_rol($1, '{caja:ver,caja:exportar}')", [
          rolId,
        ]),
      ).toMatchObject({ ok: true, filas: [{ reemplazar_permisos_rol: 2 }] });
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(rolId))).toMatchObject({ ok: true });
      expect(
        await intentar(c, "update app.rol set nombre = 'Cobranzas' where id = $1", [rolId]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
  });

  it('crear un rol con lo que no tiene (alta + matriz, como la API) falla entero', async () => {
    const nombre = `Fichas ${randomUUID().slice(0, 6)}`;
    const e = await errorDe(
      comoApi(K.administra.usuarioId, async (tx) => {
        const [fila] = await tx
          .insert(tablaRol)
          .values({ clinicaId: K.clinicaId, nombre })
          .returning({ id: tablaRol.id });
        await reemplazarPermisosRol(tx, fila!.id, comoPermisos(['caja:ver', 'ficha_clinica:ver']));
      }),
    );
    expect(e).toMatchObject({ codigo: '42501', restriccion: 'rol_permisos_ajenos' });
    expect(e.mensaje).toContain('ficha_clinica:ver');
    expect(e.mensaje).not.toContain('caja:ver');
    expect(
      await enTransaccion(admin, { clinica: K.clinicaId }, (c) =>
        valor(c, 'select count(*)::int from app.rol where nombre = $1', [nombre]),
      ),
    ).toBe(0);
  });

  it('todas las sedes: quien no las ve no crea, ni edita, ni asigna un rol que las vea', async () => {
    await como(K.encargada.usuarioId, async (c) => {
      expect(
        await intentar(
          c,
          "insert into app.rol (clinica_id, nombre, todas_las_sedes) values ($1, 'Global', true)",
          [K.clinicaId],
        ),
      ).toMatchObject(rechazo('42501', 'rol_todas_las_sedes_ajeno'));
      expect(
        await intentar(c, 'update app.rol set todas_las_sedes = true where id = $1', [K.rolMenor]),
      ).toMatchObject(rechazo('42501', 'rol_todas_las_sedes_ajeno'));
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(K.rolMenorTodas))).toMatchObject(
        rechazo('42501', 'asignacion_todas_las_sedes'),
      );
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.rolMenorTodas,
          K.enS1.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'asignacion_todas_las_sedes'));
      // Lo que sí: un rol sin todas las sedes, con lo que ella tiene.
      expect(
        await intentar(
          c,
          "insert into app.rol (clinica_id, nombre) values ($1, 'Local') returning id",
          [K.clinicaId],
        ),
      ).toMatchObject({ ok: true });
    });
    // Administración ve todas las sedes: puede.
    await como(K.administra.usuarioId, async (c) => {
      expect(
        await intentar(
          c,
          "insert into app.rol (clinica_id, nombre, todas_las_sedes) values ($1, 'Global', true)",
          [K.clinicaId],
        ),
      ).toMatchObject({ ok: true });
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(K.rolMenorTodas))).toMatchObject({
        ok: true,
      });
    });
  });

  it('reactivar o cambiar de rol a alguien hacia un rol que da más: no; dar de baja o bajar de rol, sí', async () => {
    await como(K.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [
          K.odontologaInactiva.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'asignacion_rol_superior'));
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.roles.odontologo,
          K.enS1.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'asignacion_rol_superior'));
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.rolMenor2,
          K.enS1.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      // Bajar de rol o dar de baja a quien tiene más permisos no otorga nada.
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.rolMenor,
          K.odontologo.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, "select app.desactivar_membresia($1, 'Terminó el contrato')", [
          K.odontologo.membresiaId,
        ]),
      ).toMatchObject({ ok: true });
    });
    // El dueño no tiene límite.
    await como(K.duenoId, async (c) => {
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [
          K.odontologaInactiva.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
  });

  it('reenviar una invitación con un rol que da más es volver a darlo: no; anularla, sí', async () => {
    const inv = await crearInvitacionDePrueba(admin, { clinicaId: K.clinicaId, rol: 'odontologo' });
    await como(K.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, 'select * from app.reenviar_invitacion($1, $2)', [
          inv.membresiaId,
          hashTokenInvitacion(randomUUID()),
        ]),
      ).toMatchObject(rechazo('42501', 'asignacion_rol_superior'));
      expect(
        await intentar(c, "select app.anular_invitacion($1, 'No viene')", [inv.membresiaId]),
      ).toMatchObject({ ok: true });
    });
  });

  it('el dueño no tiene límite: edita roles de sistema y asigna cualquier rol', async () => {
    await como(K.duenoId, async (c) => {
      const antes = await permisos(K.roles.asistente);
      expect(
        await intentar(c, 'select app.reemplazar_permisos_rol($1, $2)', [
          K.roles.asistente,
          [...antes, 'ficha_clinica:exportar'],
        ]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, 'update app.rol set todas_las_sedes = true where id = $1', [
          K.roles.odontologo,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(K.roles.odontologo))).toMatchObject({
        ok: true,
      });
    });
  });

  it('Dueño/a y Administración exigen siempre doble factor (para todos, también migraciones)', async () => {
    await como(K.duenoId, async (c) => {
      expect(
        await intentar(c, 'update app.rol set exige_mfa = false where id = $1', [
          K.roles.administracion,
        ]),
      ).toMatchObject(rechazo('23514', 'rol_mfa_obligatorio'));
      // Los demás roles de sistema, a gusto del dueño.
      expect(
        await intentar(c, 'update app.rol set exige_mfa = true where id = $1', [K.roles.recepcion]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
    await enTransaccion(admin, { clinica: K.clinicaId, usuario: '' }, async (c) => {
      for (const rolId of [K.roles.dueno, K.roles.administracion]) {
        expect(
          await intentar(c, 'update app.rol set exige_mfa = false where id = $1', [rolId]),
        ).toMatchObject(rechazo('23514', 'rol_mfa_obligatorio'));
      }
    });
  });

  it('en varios pasos: con el control diferido, cuenta el estado al confirmar', async () => {
    const { rolId } = await crearRolDePrueba(admin, {
      clinicaId: K.clinicaId,
      permisos: ['caja:ver', 'ficha_clinica:ver'],
    });
    const diferir = 'set constraints app.rol_limite_actor, app.rol_permiso_limite_actor deferred';
    await como(K.administra.usuarioId, async (c) => {
      await c.query(diferir);
      // Renombrar primero y sacar lo que sobra después (el orden de la API hoy): al confirmar, bien.
      expect(
        await intentar(c, "update app.rol set nombre = 'Solo caja' where id = $1", [rolId]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, "select app.reemplazar_permisos_rol($1, '{caja:ver}')", [rolId]),
      ).toMatchObject({ ok: true });
      expect(await intentar(c, 'set constraints all immediate')).toMatchObject({ ok: true });
    });
    await como(K.administra.usuarioId, async (c) => {
      await c.query(diferir);
      expect(
        await intentar(
          c,
          "select app.reemplazar_permisos_rol($1, '{inicio:ver,ficha_clinica:ver}')",
          [K.rolMenor2],
        ),
      ).toMatchObject({ ok: true });
      expect(await intentar(c, 'set constraints all immediate')).toMatchObject(
        rechazo('42501', 'rol_permisos_ajenos'),
      );
    });
  });
});

describe('alcance de sedes', () => {
  it('el listado: quien ve todas las sedes ve a todos; quien no, solo a quienes trabajan en sus sedes', async () => {
    const deEncargada = await comoApi(K.encargada.usuarioId, (tx) => listarPersonal(tx));
    const ids = deEncargada.map((p) => p.membresiaId);
    for (const visible of [K.encargada, K.enS1, K.sinSedes]) {
      expect(ids).toContain(visible.membresiaId);
    }
    for (const oculta of [K.enS1yS2, K.conDefectoS2, K.administra]) {
      expect(ids).not.toContain(oculta.membresiaId);
    }
    expect(ids).not.toContain(K.membresiaDuenoId);
    const deAdministra = await comoApi(K.administra.usuarioId, (tx) => listarPersonal(tx));
    const todas = deAdministra.map((p) => p.membresiaId);
    for (const m of [K.encargada, K.enS1, K.sinSedes, K.enS1yS2, K.conDefectoS2, K.administra]) {
      expect(todas).toContain(m.membresiaId);
    }
    expect(todas).toContain(K.membresiaDuenoId);
    // Una por id, fuera del alcance: como si no existiera.
    expect(
      await comoApi(K.encargada.usuarioId, (tx) =>
        listarPersonal(tx, { membresiaId: K.enS1yS2.membresiaId }),
      ),
    ).toEqual([]);
    // membresiaEnAlcance dice lo mismo que el listado.
    const otra = await crearClinicaDePrueba(admin);
    await comoApi(K.encargada.usuarioId, async (tx) => {
      for (const p of deAdministra) {
        expect({ id: p.membresiaId, en: await membresiaEnAlcance(tx, p.membresiaId) }).toEqual({
          id: p.membresiaId,
          en: ids.includes(p.membresiaId),
        });
      }
      expect(await membresiaEnAlcance(tx, randomUUID())).toBe(false);
      expect(await membresiaEnAlcance(tx, otra.membresiaDuenoId)).toBe(false);
    });
    expect(
      await comoApi(K.administra.usuarioId, (tx) => membresiaEnAlcance(tx, randomUUID())),
    ).toBe(false);
  });

  it('quien no ve todas las sedes solo modifica a personas de sus sedes, y solo con sus sedes', async () => {
    await como(K.encargada.usuarioId, async (c) => {
      const fuera: [string, unknown[]][] = [
        ['update app.membresia set sede_defecto_id = $1 where id = $2', [K.s2, K.enS1.membresiaId]],
        [
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [K.clinicaId, K.enS1.membresiaId, K.s2],
        ],
        [
          'update app.usuario_sede set activo = false where membresia_id = $1 and sede_id = $2',
          [K.enS1yS2.membresiaId, K.s1],
        ],
        ["select app.desactivar_membresia($1, 'Se va')", [K.enS1yS2.membresiaId]],
        ["select app.desactivar_membresia($1, 'Se va')", [K.conDefectoS2.membresiaId]],
        ["select app.desactivar_membresia($1, 'Se va')", [K.administra.membresiaId]],
        [
          'update app.membresia set rol_id = $1 where id = $2',
          [K.rolMenor2, K.conDefectoS2.membresiaId],
        ],
      ];
      for (const [texto, parametros] of fuera) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: rechazo('42501', 'acceso_fuera_de_sedes'),
        });
      }
      const dentro: [string, unknown[]][] = [
        ['update app.membresia set sede_defecto_id = $1 where id = $2', [K.s1, K.enS1.membresiaId]],
        [
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [K.clinicaId, K.sinSedes.membresiaId, K.s1],
        ],
        ['update app.membresia set rol_id = $1 where id = $2', [K.rolMenor2, K.enS1.membresiaId]],
        ["select app.desactivar_membresia($1, 'Se mudó')", [K.enS1.membresiaId]],
      ];
      for (const [texto, parametros] of dentro) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: { ok: true },
        });
      }
    });
    // Quien ve todas las sedes, sí.
    await como(K.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, "select app.desactivar_membresia($1, 'Se va')", [K.enS1yS2.membresiaId]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(
          c,
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [K.clinicaId, K.enS1.membresiaId, K.s3],
        ),
      ).toMatchObject({ ok: true });
    });
  });

  it('invitar, reenviar y anular: solo con sus sedes', async () => {
    const enS2 = await crearInvitacionDePrueba(admin, {
      clinicaId: K.clinicaId,
      rolId: K.rolMenor,
      sedeIds: [K.s2],
    });
    const enS1 = await crearInvitacionDePrueba(admin, {
      clinicaId: K.clinicaId,
      rolId: K.rolMenor,
      sedeIds: [K.s1],
    });
    await como(K.encargada.usuarioId, async (c) => {
      for (const [sedes, defecto] of [
        [[K.s2], K.s2],
        [[K.s1, K.s2], K.s1],
        [[K.s1, K.s2], null],
      ] as const) {
        expect(
          await intentar(c, SQL_INVITAR, datosInvitacion(K.rolMenor, [...sedes], defecto)),
        ).toMatchObject(rechazo('42501', 'acceso_fuera_de_sedes'));
      }
      expect(
        await intentar(c, SQL_INVITAR, datosInvitacion(K.rolMenor, [K.s1], K.s1)),
      ).toMatchObject({ ok: true });
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(K.rolMenor))).toMatchObject({
        ok: true,
      });
      expect(
        await intentar(c, 'select * from app.reenviar_invitacion($1, $2)', [
          enS2.membresiaId,
          hashTokenInvitacion(randomUUID()),
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_fuera_de_sedes'));
      expect(
        await intentar(c, "select app.anular_invitacion($1, 'No viene')", [enS2.membresiaId]),
      ).toMatchObject(rechazo('42501', 'acceso_fuera_de_sedes'));
      expect(
        await intentar(c, 'select * from app.reenviar_invitacion($1, $2)', [
          enS1.membresiaId,
          hashTokenInvitacion(randomUUID()),
        ]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, "select app.anular_invitacion($1, 'No viene')", [enS1.membresiaId]),
      ).toMatchObject({ ok: true });
    });
  });
});

describe('desactivar: personal:anular alcanza y el motivo es obligatorio', () => {
  it('con solo personal:anular se desactiva (con motivo, auditado); no se cambia el rol ni se reactiva', async () => {
    const { rolId: soloAnular } = await crearRolDePrueba(admin, {
      clinicaId: K.clinicaId,
      permisos: ['personal:ver', 'personal:anular'],
      todasLasSedes: true,
    });
    const [quien, persona, inactiva] = await Promise.all([
      crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId, rolId: soloAnular }),
      crearUsuarioDePrueba(admin, { clinicaId: K.clinicaId, rolId: K.rolMenor }),
      crearUsuarioDePrueba(admin, {
        clinicaId: K.clinicaId,
        rolId: K.rolMenor,
        estado: 'inactivo',
      }),
    ]);
    await comoApi(quien.usuarioId, (tx) =>
      desactivarMembresia(tx, persona.membresiaId, '  Renunció  '),
    );
    await enTransaccion(admin, { clinica: K.clinicaId }, async (c) => {
      const { rows } = await c.query(
        'select estado, motivo_baja from app.membresia where id = $1',
        [persona.membresiaId],
      );
      expect(rows[0]).toEqual({ estado: 'inactivo', motivo_baja: 'Renunció' });
      const auditoria = await c.query(
        `select accion, usuario_id, despues ->> 'motivo_baja' as motivo from app.audit_log
         where entidad = 'membresia' and entidad_id = $1 order by fecha desc limit 1`,
        [persona.membresiaId],
      );
      expect(auditoria.rows[0]).toEqual({
        accion: 'anular',
        usuario_id: quien.usuarioId,
        motivo: 'Renunció',
      });
    });
    await como(quien.usuarioId, async (c) => {
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.rolMenor2,
          K.sinSedes.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [
          inactiva.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
      // Ni da de baja y cambia otra cosa en el mismo paso.
      expect(
        await intentar(
          c,
          "update app.membresia set estado = 'inactivo', motivo_baja = 'x', sede_defecto_id = $2 where id = $1",
          [K.sinSedes.membresiaId, K.s1],
        ),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
    });
  });

  it('sin motivo no hay baja; reactivar borra el motivo (queda en la auditoría)', async () => {
    const persona = await crearUsuarioDePrueba(admin, {
      clinicaId: K.clinicaId,
      rolId: K.rolMenor,
    });
    await enTransaccion(
      api,
      { clinica: K.clinicaId, usuario: K.administra.usuarioId },
      async (c) => {
        for (const [texto, parametros, codigo, restriccion] of [
          [
            "update app.membresia set estado = 'inactivo' where id = $1",
            [persona.membresiaId],
            '23514',
            'baja_sin_motivo',
          ],
          [
            "update app.membresia set estado = 'inactivo', motivo_baja = '   ' where id = $1",
            [persona.membresiaId],
            '23514',
            'baja_sin_motivo',
          ],
          [
            "select app.desactivar_membresia($1, '')",
            [persona.membresiaId],
            '23514',
            'baja_sin_motivo',
          ],
          [
            'select app.desactivar_membresia($1, null)',
            [persona.membresiaId],
            '23514',
            'baja_sin_motivo',
          ],
          [
            "select app.desactivar_membresia($1, repeat('x', 501))",
            [persona.membresiaId],
            '23514',
            'membresia_motivo_baja_check',
          ],
          [
            "select app.desactivar_membresia($1, 'x')",
            [randomUUID()],
            'P0002',
            'membresia_no_activa',
          ],
        ] as const) {
          expect({ texto, r: await intentar(c, texto, [...parametros]) }).toMatchObject({
            texto,
            r: rechazo(codigo, restriccion),
          });
        }
        await c.query("select app.desactivar_membresia($1, 'Licencia')", [persona.membresiaId]);
        expect(
          await intentar(c, "select app.desactivar_membresia($1, 'Otra vez')", [
            persona.membresiaId,
          ]),
        ).toMatchObject(rechazo('P0002', 'membresia_no_activa'));
        await c.query("update app.membresia set estado = 'activo' where id = $1", [
          persona.membresiaId,
        ]);
        expect(
          await valor(c, 'select motivo_baja from app.membresia where id = $1', [
            persona.membresiaId,
          ]),
        ).toBeNull();
        expect(
          await valor(
            c,
            `select accion || '|' || (antes ->> 'motivo_baja') || '|' || coalesce(despues ->> 'motivo_baja', 'null')
             from app.audit_log where entidad = 'membresia' and entidad_id = $1
             order by fecha desc, id desc limit 1`,
            [persona.membresiaId],
          ),
        ).toBe('editar|Licencia|null');
        // Roles: igual.
        expect(
          await intentar(c, 'update app.rol set activo = false where id = $1', [K.rolMenor2]),
        ).toMatchObject(rechazo('23514', 'baja_sin_motivo'));
        const libre = await valor<string>(
          c,
          "insert into app.rol (clinica_id, nombre) values ($1, 'Temporal') returning id",
          [K.clinicaId],
        );
        await c.query("select app.desactivar_rol($1, 'Era temporal')", [libre]);
        expect(await valor(c, 'select motivo_baja from app.rol where id = $1', [libre])).toBe(
          'Era temporal',
        );
        await c.query('update app.rol set activo = true where id = $1', [libre]);
        expect(await valor(c, 'select motivo_baja from app.rol where id = $1', [libre])).toBeNull();
      },
    );
  });
});

describe('profesional y membresía', () => {
  const SQL_PROFESIONAL = `insert into app.profesional (clinica_id, membresia_id, nombre, color)
    values ($1, $2, 'Dra. Vínculo', '#18BFB0') returning id`;

  it('nadie se vincula a sí mismo (salvo el dueño), la de un dueño solo un dueño, y con alcance de sedes', async () => {
    await como(K.administra.usuarioId, async (c) => {
      expect(
        await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.administra.membresiaId]),
      ).toMatchObject(rechazo('42501', 'acceso_propio'));
      expect(await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.membresiaDuenoId])).toMatchObject(
        rechazo('42501', 'acceso_rol_dueno'),
      );
      // Cargar a un odontólogo como profesional no le da nada: sin límite de rol.
      expect(
        await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.odontologo.membresiaId]),
      ).toMatchObject({ ok: true });
    });
    const vinculadoFuera = await crearProfesionalDePrueba(admin, {
      clinicaId: K.clinicaId,
      membresiaId: K.enS1yS2.membresiaId,
    });
    await como(K.encargada.usuarioId, async (c) => {
      expect(
        await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.conDefectoS2.membresiaId]),
      ).toMatchObject(rechazo('42501', 'acceso_fuera_de_sedes'));
      const dentro = await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.enS1.membresiaId]);
      expect(dentro).toMatchObject({ ok: true });
      const id = (dentro.ok ? dentro.filas[0]?.['id'] : null) as string;
      for (const [texto, parametros] of [
        [
          'update app.profesional set membresia_id = $1 where id = $2',
          [K.conDefectoS2.membresiaId, id],
        ],
        [
          'update app.profesional set membresia_id = null where id = $1',
          [vinculadoFuera.profesionalId],
        ],
      ] as const) {
        expect({ texto, r: await intentar(c, texto, [...parametros]) }).toMatchObject({
          texto,
          r: rechazo('42501', 'acceso_fuera_de_sedes'),
        });
      }
      // Editar otros datos de un profesional no pasa por estas reglas.
      expect(
        await intentar(c, "update app.profesional set especialidad = 'Ortodoncia' where id = $1", [
          vinculadoFuera.profesionalId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
    // Sin permisos de personal no se vincula a nadie (un profesional sin membresía no es un vínculo).
    const sinPermiso = await crearUsuarioDePrueba(admin, {
      clinicaId: K.clinicaId,
      rolId: K.rolMenor,
    });
    await como(sinPermiso.usuarioId, async (c) => {
      expect(
        await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.sinSedes.membresiaId]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
      expect(await intentar(c, SQL_PROFESIONAL, [K.clinicaId, null])).toMatchObject({ ok: true });
    });
    // El dueño-odontólogo sí se vincula a sí mismo.
    await como(K.duenoId, async (c) => {
      expect(await intentar(c, SQL_PROFESIONAL, [K.clinicaId, K.membresiaDuenoId])).toMatchObject({
        ok: true,
      });
    });
  });
});

describe('pasada adversarial sobre los límites (app_api con SQL arbitrario)', () => {
  it('diferir el control no lo esquiva: corre al confirmar y la transacción se revierte', async () => {
    const cliente = await api.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(
        "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
        [K.clinicaId, K.administra.usuarioId],
      );
      await cliente.query('set constraints all deferred');
      await cliente.query(
        `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion)
         values ($1, $2, 'ficha_clinica', 'exportar')`,
        [K.clinicaId, K.rolMenor2],
      );
      await expect(cliente.query('COMMIT')).rejects.toMatchObject({
        code: '42501',
        constraint: 'rol_permisos_ajenos',
      });
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
    }
    expect(await permisos(K.rolMenor2)).toEqual(['agenda:ver']);
  });

  it('ni por partes: un permiso inactivo que se activa, un rol que se reactiva con más, o asignar y después agrandar', async () => {
    await como(K.administra.usuarioId, async (c) => {
      // Un permiso que se agrega inactivo pasa (el rol no da nada nuevo); activarlo, no.
      expect(
        await intentar(
          c,
          `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion, activo)
           values ($1, $2, 'ficha_clinica', 'ver', false)`,
          [K.clinicaId, K.rolMenor2],
        ),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(
          c,
          "update app.rol_permiso set activo = true where rol_id = $1 and modulo = 'ficha_clinica'",
          [K.rolMenor2],
        ),
      ).toMatchObject(rechazo('42501', 'rol_permisos_ajenos'));
      // Asignar un rol que no da más y en la misma transacción agrandarlo.
      expect(
        await intentar(c, 'update app.membresia set rol_id = $1 where id = $2', [
          K.rolMenor2,
          K.sinSedes.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(
          c,
          "select app.reemplazar_permisos_rol($1, '{agenda:ver,ficha_clinica:ver}')",
          [K.rolMenor2],
        ),
      ).toMatchObject(rechazo('42501', 'rol_permisos_ajenos'));
    });
    // Un rol inactivo no se controla (no da nada); al reactivarlo, sí.
    const { rolId } = await crearRolDePrueba(admin, { clinicaId: K.clinicaId, permisos: [] });
    await como(K.administra.usuarioId, async (c) => {
      await c.query("select app.desactivar_rol($1, 'Pausa')", [rolId]);
      expect(
        await intentar(
          c,
          `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion)
           values ($1, $2, 'ficha_clinica', 'exportar')`,
          [K.clinicaId, rolId],
        ),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, 'update app.rol set activo = true where id = $1', [rolId]),
      ).toMatchObject(rechazo('42501', 'rol_permisos_ajenos'));
    });
  });

  it('ni con funciones temporales que imitan las ayudas, ni con ON CONFLICT o MERGE', async () => {
    await como(K.encargada.usuarioId, async (c) => {
      // Funciones temporales con el nombre de las ayudas: las defensas llaman a app.* (y pg_temp no
      // se busca para funciones ni operadores).
      await c.query(
        'create function pg_temp.alcance_sedes(uuid, uuid) returns uuid[] language sql as $$ select null::uuid[] $$',
      );
      await c.query(
        "create function pg_temp.permisos_de_rol(uuid, uuid) returns text[] language sql as $$ select '{}'::text[] $$",
      );
      await c.query('set local search_path = pg_temp, app, pg_catalog');
      expect(
        await intentar(c, "select app.desactivar_membresia($1, 'Se va')", [K.enS1yS2.membresiaId]),
      ).toMatchObject(rechazo('42501', 'acceso_fuera_de_sedes'));
      expect(await intentar(c, SQL_INVITAR, datosInvitacion(K.roles.odontologo))).toMatchObject(
        rechazo('42501', 'asignacion_rol_superior'),
      );
      // Reactivar una sede de una persona fuera del alcance con ON CONFLICT DO UPDATE.
      expect(
        await intentar(
          c,
          `insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)
           on conflict (clinica_id, membresia_id, sede_id) do update set activo = true`,
          [K.clinicaId, K.enS1yS2.membresiaId, K.s2],
        ),
      ).toMatchObject(rechazo('42501', 'acceso_fuera_de_sedes'));
    });
    await como(K.administra.usuarioId, async (c) => {
      // Vincularse a sí misma con MERGE.
      expect(
        await intentar(
          c,
          `merge into app.profesional p using (select $1::uuid as clinica_id, $2::uuid as membresia_id) v
           on false when not matched then
             insert (clinica_id, membresia_id, nombre, color) values (v.clinica_id, v.membresia_id, 'Yo', '#18BFB0')`,
          [K.clinicaId, K.administra.membresiaId],
        ),
      ).toMatchObject(rechazo('42501', 'acceso_propio'));
    });
  });

  it('la excepción de limpieza de sedes de baja no deja pasar ningún otro cambio', async () => {
    const { sedeId } = await crearSedeDePrueba(admin, K.clinicaId);
    const persona = await crearUsuarioDePrueba(admin, {
      clinicaId: K.clinicaId,
      rolId: K.rolMenor,
      sedeIds: [sedeId],
      sedeDefectoId: sedeId,
    });
    // La sede se da de baja como el sistema, sin la cascada (simula una fila vieja, previa a 0016).
    await enTransaccion(
      admin,
      { clinica: K.clinicaId, usuario: '' },
      async (c) => {
        await c.query('alter table app.sede disable trigger sede_baja_en_cascada');
        await c.query(
          "update app.sede set deleted_at = now(), motivo_baja = 'Cerró' where id = $1",
          [sedeId],
        );
        await c.query('alter table app.sede enable trigger sede_baja_en_cascada');
      },
      { confirmar: true },
    );
    const sinPermiso = await crearUsuarioDePrueba(admin, {
      clinicaId: K.clinicaId,
      rolId: K.rolMenor,
    });
    await como(sinPermiso.usuarioId, async (c) => {
      // Vaciar la sede por defecto junto con otro cambio, o reactivar: con las reglas de siempre.
      for (const [texto, parametros] of [
        [
          'update app.membresia set sede_defecto_id = null, rol_id = $2 where id = $1',
          [persona.membresiaId, K.rolMenor2],
        ],
        [
          "update app.membresia set sede_defecto_id = null, estado = 'inactivo', motivo_baja = 'x' where id = $1",
          [persona.membresiaId],
        ],
      ] as const) {
        expect({ texto, r: await intentar(c, texto, [...parametros]) }).toMatchObject({
          texto,
          r: rechazo('42501', 'acceso_sin_permiso'),
        });
      }
      // Solo la limpieza pura pasa, sin permisos de personal.
      expect(
        await intentar(c, 'update app.membresia set sede_defecto_id = null where id = $1', [
          persona.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, 'update app.usuario_sede set activo = false where membresia_id = $1', [
          persona.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
      expect(
        await intentar(c, 'update app.usuario_sede set activo = true where membresia_id = $1', [
          persona.membresiaId,
        ]),
      ).toMatchObject(rechazo('42501', 'acceso_sin_permiso'));
    });
  });
});
