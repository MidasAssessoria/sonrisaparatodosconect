/**
 * Invitaciones (0010, 0015) contra Postgres real, como app_api y con los envoltorios que usa la API:
 * alta, reenvío, anulación, consulta pública, aceptación (cuenta nueva y existente), vencida/usada/
 * anulada/inexistente con la misma respuesta, correo distinto, dos veces, 20 simultáneas, y que la
 * membresía activada conserve el rol y las sedes que eligió la clínica.
 *
 * Desde 0015 nadie invita con un rol que da más que el suyo: por defecto invita el dueño;
 * administración invita con `rolAdministrable` (incluido en el suyo). Los límites en detalle están en
 * test/limites.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  aceptarInvitacion,
  anularInvitacion,
  buscarMembresiaActiva,
  conContexto,
  consultarInvitacion,
  crearInvitacion,
  crearPool,
  hashTokenInvitacion,
  listarPersonal,
  reenviarInvitacion,
  sinContexto,
  type DatosInvitacion,
  type TransaccionConecta,
} from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearRolDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, errorDe, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin, 6);
const api = nuevoPool(urls().urlApi, 6);
const poolApi = crearPool(urls().urlApi, { max: 24 });

interface Clinica extends ClinicaDePrueba {
  sede1: string;
  sede2: string;
  administra: UsuarioDePrueba;
  recepcion: UsuarioDePrueba;
  /** Rol de la clínica con permisos incluidos en los de Administración (ella lo puede asignar). */
  rolAdministrable: string;
}

let A: Clinica;
let B: Clinica;

async function prepararClinica(): Promise<Clinica> {
  const clinica = await crearClinicaDePrueba(admin);
  const [s1, s2, administra, recepcion, administrable] = await Promise.all([
    crearSedeDePrueba(admin, clinica.clinicaId),
    crearSedeDePrueba(admin, clinica.clinicaId),
    crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId, rol: 'administracion' }),
    crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId, rol: 'recepcion' }),
    crearRolDePrueba(admin, {
      clinicaId: clinica.clinicaId,
      nombre: 'Cobranzas',
      permisos: ['inicio:ver', 'caja:ver', 'caja:exportar', 'reportes:ver'],
    }),
  ]);
  return {
    ...clinica,
    sede1: s1.sedeId,
    sede2: s2.sedeId,
    administra,
    recepcion,
    rolAdministrable: administrable.rolId,
  };
}

beforeAll(async () => {
  [A, B] = await Promise.all([prepararClinica(), prepararClinica()]);
  return () => poolApi.end();
});

function nuevoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashTokenInvitacion(token) };
}

function correoNuevo(): string {
  return `persona-${randomUUID().slice(0, 8)}@prueba.test`;
}

/** Como la API: transacción de app_api con la clínica y el usuario dados (membresía verificada). */
const comoApi = <T>(
  clinica: Clinica,
  usuarioId: string,
  fn: (tx: TransaccionConecta) => Promise<T>,
): Promise<T> => conContexto(poolApi, { clinicaId: clinica.clinicaId, usuarioId }, fn);

async function invitar(
  clinica: Clinica,
  datos: Partial<DatosInvitacion> = {},
  quien: string = clinica.duenoId,
): Promise<{
  membresiaId: string;
  invitacionId: string;
  token: string;
  hash: string;
  email: string;
}> {
  const { token, hash } = nuevoToken();
  const email = datos.email ?? correoNuevo();
  const creada = await comoApi(clinica, quien, (tx) =>
    crearInvitacion(tx, {
      nombre: 'Lucía Benítez',
      rolId: clinica.roles.recepcion,
      sedeIds: [clinica.sede1],
      sedeDefectoId: clinica.sede1,
      ...datos,
      email,
      tokenHash: datos.tokenHash ?? hash,
    }),
  );
  return { ...creada, token, hash: datos.tokenHash ?? hash, email: email.trim().toLowerCase() };
}

const consultar = (hash: string) => sinContexto(poolApi, (tx) => consultarInvitacion(tx, hash));
const aceptar = (hash: string, usuarioId: string, email: string) =>
  sinContexto(poolApi, (tx) => aceptarInvitacion(tx, { tokenHash: hash, usuarioId, email }), {
    ip: '203.0.113.9',
  });

/** Estado de una membresía visto por la administración. */
interface EstadoMembresiaPrueba {
  estado: string;
  usuario_id: string | null;
  rol_id: string;
  sede_defecto_id: string | null;
  sedes: string[];
}

async function membresia(clinica: Clinica, id: string): Promise<EstadoMembresiaPrueba> {
  return enTransaccion(admin, { clinica: clinica.clinicaId }, async (c) => {
    const { rows } = await c.query<EstadoMembresiaPrueba>(
      `select m.estado, m.usuario_id, m.rol_id, m.sede_defecto_id,
              array(select us.sede_id::text from app.usuario_sede us
                    where us.membresia_id = m.id and us.activo order by 1) as sedes
       from app.membresia m where m.id = $1`,
      [id],
    );
    const fila = rows[0];
    if (!fila) throw new Error(`No existe la membresía ${id}.`);
    return fila;
  });
}

describe('alta de una invitación', () => {
  it('crea la membresía pendiente sin usuario, sus sedes y la invitación (solo el hash), todo auditado', async () => {
    const { token, hash } = nuevoToken();
    const email = `  Lucia.Benitez-${randomUUID().slice(0, 6)}@Prueba.Test `;
    const creada = await comoApi(A, A.administra.usuarioId, (tx) =>
      crearInvitacion(tx, {
        nombre: '  Lucía Benítez ',
        email,
        rolId: A.rolAdministrable,
        sedeIds: [A.sede1, A.sede2, A.sede1],
        sedeDefectoId: A.sede2,
        tokenHash: hash,
      }),
    );
    // 72 horas por defecto.
    const horas = (creada.venceEn.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(71.9);
    expect(horas).toBeLessThanOrEqual(72);
    expect(await membresia(A, creada.membresiaId)).toEqual({
      estado: 'pendiente',
      usuario_id: null,
      rol_id: A.rolAdministrable,
      sede_defecto_id: A.sede2,
      sedes: [A.sede1, A.sede2].sort(),
    });
    await enTransaccion(admin, { clinica: A.clinicaId }, async (c) => {
      const { rows } = await c.query(
        'select email, nombre, token_hash, invitada_por, usada_en, anulada_en from app.invitacion where id = $1',
        [creada.invitacionId],
      );
      expect(rows[0]).toEqual({
        email: email.trim().toLowerCase(),
        nombre: 'Lucía Benítez',
        token_hash: hash,
        invitada_por: A.administra.usuarioId,
        usada_en: null,
        anulada_en: null,
      });
      // El token en claro no está en ninguna parte de la base, y su hash tampoco en la auditoría
      // (0017: la invitación se audita sin token_hash).
      for (const secreto of [token, hash]) {
        expect(
          await valor(
            c,
            `select count(*)::int from app.audit_log where clinica_id = $1 and (despues::text like $2 or antes::text like $2)`,
            [A.clinicaId, `%${secreto}%`],
          ),
        ).toBe(0);
      }
      expect(
        await valor(
          c,
          `select count(*)::int from app.audit_log
           where entidad = 'invitacion' and (despues ? 'token_hash' or antes ? 'token_hash')`,
        ),
      ).toBe(0);
      const auditoria = await c.query<{ entidad: string; modulo: string; usuario_id: string }>(
        `select entidad, modulo, usuario_id from app.audit_log
         where clinica_id = $1 and accion = 'crear' and entidad_id = any($2) order by entidad`,
        [A.clinicaId, [creada.membresiaId, creada.invitacionId]],
      );
      expect(auditoria.rows).toEqual([
        { entidad: 'invitacion', modulo: 'personal', usuario_id: A.administra.usuarioId },
        { entidad: 'membresia', modulo: 'personal', usuario_id: A.administra.usuarioId },
      ]);
    });
  });

  it('el listado de personal muestra la invitación pendiente con el nombre y el correo invitados', async () => {
    const inv = await invitar(A, { nombre: 'Ivana Colmán', sedeIds: [A.sede1, A.sede2] });
    const [persona] = await comoApi(A, A.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(persona).toMatchObject({
      membresiaId: inv.membresiaId,
      usuarioId: null,
      nombre: 'Ivana Colmán',
      email: inv.email,
      telefono: null,
      rol: { id: A.roles.recepcion, codigo: 'recepcion', nombre: 'Recepción y caja' },
      estado: 'pendiente',
      sedeIds: [A.sede1, A.sede2].sort(),
      sedeDefectoId: A.sede1,
      ultimoAcceso: null,
      mfaActivo: false,
      profesionalId: null,
    });
    expect(persona?.invitacionVenceEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Toda la clínica: dueño, administración, recepción y las invitaciones.
    const todas = await comoApi(A, A.duenoId, (tx) => listarPersonal(tx));
    expect(todas.find((p) => p.usuarioId === A.duenoId)).toMatchObject({
      estado: 'activo',
      rol: { codigo: 'dueno' },
      invitacionVenceEn: null,
    });
    expect(todas.every((p) => p.membresiaId)).toBe(true);
    // Desde otra clínica no aparece.
    const deB = await comoApi(B, B.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(deB).toEqual([]);
  });

  it('valida sedes, vencimiento, rol y permisos', async () => {
    const casos: [string, Partial<DatosInvitacion>, string | null, string][] = [
      [
        'sede por defecto fuera de las elegidas',
        { sedeIds: [A.sede1], sedeDefectoId: A.sede2 },
        null,
        'invitacion_sede_defecto',
      ],
      [
        'vence en más de 30 días',
        { venceEn: new Date(Date.now() + 31 * 86_400_000) },
        null,
        'invitacion_vencimiento',
      ],
      ['ya vencida', { venceEn: new Date(Date.now() - 60_000) }, null, 'invitacion_vencimiento'],
      ['rol de otra clínica', { rolId: B.roles.recepcion }, null, 'membresia_rol_fkey'],
      [
        'sede de otra clínica',
        { sedeIds: [B.sede1], sedeDefectoId: B.sede1 },
        null,
        'membresia_sede_defecto_fkey',
      ],
      ['correo inválido', { email: 'no-es-un-correo' }, null, 'invitacion_email_check'],
      ['hash que no es SHA-256 hex', { tokenHash: 'abc' }, null, 'invitacion_token_hash_check'],
      ['recepción no invita', {}, A.recepcion.usuarioId, 'acceso_sin_permiso'],
      [
        'administración no invita como dueño',
        { rolId: A.roles.dueno },
        A.administra.usuarioId,
        'acceso_rol_dueno',
      ],
      [
        'administración no invita con un rol que da más que el suyo',
        { rolId: A.roles.recepcion },
        A.administra.usuarioId,
        'asignacion_rol_superior',
      ],
    ];
    for (const [nombre, datos, quien, restriccion] of casos) {
      const e = await errorDe(invitar(A, datos, quien ?? A.duenoId));
      expect({ nombre, restriccion: e.restriccion }).toEqual({ nombre, restriccion });
    }
    // El dueño sí invita a otro dueño.
    const dueno = await invitar(A, { rolId: A.roles.dueno }, A.duenoId);
    expect((await membresia(A, dueno.membresiaId)).rol_id).toBe(A.roles.dueno);
  });

  it('una sede dada de baja no se asigna', async () => {
    const { sedeId } = await crearSedeDePrueba(admin, A.clinicaId);
    await enTransaccion(
      admin,
      { clinica: A.clinicaId, usuario: '' },
      (c) =>
        c.query("update app.sede set deleted_at = now(), motivo_baja = 'Cerró' where id = $1", [
          sedeId,
        ]),
      { confirmar: true },
    );
    const e = await errorDe(invitar(A, { sedeIds: [sedeId], sedeDefectoId: sedeId }));
    expect(e).toMatchObject({ codigo: '22023', restriccion: 'sede_dada_de_baja' });
  });

  it('un correo, una persona: no se invita a quien ya es o fue miembro ni dos veces al mismo correo', async () => {
    const correoAdministra = await enTransaccion(admin, { clinica: A.clinicaId }, (c) =>
      valor<string>(c, 'select email from app.usuario where id = $1', [A.administra.usuarioId]),
    );
    const inactivo = await crearUsuarioDePrueba(admin, {
      clinicaId: A.clinicaId,
      estado: 'inactivo',
    });
    for (const email of [correoAdministra.toUpperCase(), inactivo.email]) {
      const e = await errorDe(invitar(A, { email }, A.duenoId));
      expect({ email, e }).toMatchObject({
        email,
        e: { codigo: '23505', restriccion: 'invitacion_ya_es_miembro' },
      });
    }
    const email = correoNuevo();
    await invitar(A, { email });
    expect(await errorDe(invitar(A, { email: email.toUpperCase() }))).toMatchObject({
      codigo: '23505',
      restriccion: 'invitacion_abierta_email',
    });
    // En otra clínica, el mismo correo sí.
    await invitar(B, { email });
  });

  it('sin contexto de clínica no se invita, ni se reenvía, ni se anula', async () => {
    await enTransaccion(api, { usuario: A.duenoId }, async (c) => {
      const hash = nuevoToken().hash;
      for (const [texto, parametros] of [
        [
          'select * from app.crear_invitacion($1, $2, $3, $4, null, $5)',
          ['X', correoNuevo(), A.roles.recepcion, [], hash],
        ],
        ['select * from app.reenviar_invitacion($1, $2)', [randomUUID(), hash]],
        ['select app.anular_invitacion($1, $2)', [randomUUID(), 'motivo']],
      ] as const) {
        expect(await intentar(c, texto, [...parametros])).toMatchObject(rechazo('42501'));
      }
    });
  });
});

describe('consulta pública', () => {
  it('devuelve clínica, rol, nombre, correo, vencimiento y si el correo ya tiene cuenta', async () => {
    const nueva = await invitar(A, { nombre: 'Persona Nueva' });
    const clinicaNombre = await enTransaccion(admin, { clinica: A.clinicaId }, (c) =>
      valor<string>(c, 'select nombre from app.clinica where id = $1', [A.clinicaId]),
    );
    expect(await consultar(nueva.hash)).toEqual({
      clinica: clinicaNombre,
      rol: 'Recepción y caja',
      nombre: 'Persona Nueva',
      email: nueva.email,
      venceEn: expect.any(Date) as unknown,
      usuarioExiste: false,
    });
    // Alguien que trabaja en B, invitado en A: hay que ingresar antes de aceptar.
    const deB = await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId });
    const existente = await invitar(A, { email: deB.email.toUpperCase() });
    expect(await consultar(existente.hash)).toMatchObject({
      email: deB.email,
      usuarioExiste: true,
    });
  });

  it('deja el contexto como estaba y limpia el parámetro de búsqueda', async () => {
    const inv = await invitar(A);
    await enTransaccion(api, { clinica: B.clinicaId, usuario: B.duenoId }, async (c) => {
      const { rows } = await c.query('select * from app.consultar_invitacion($1)', [inv.hash]);
      expect(rows).toHaveLength(1);
      expect(
        await valor(
          c,
          `select current_setting('app.clinica_id') || '|' || current_setting('app.usuario_id') || '|' ||
                  coalesce(current_setting('app.invitacion_token_hash', true), '') || '|' ||
                  coalesce(current_setting('app.usuario_email_buscado', true), '')`,
        ),
      ).toBe(`${B.clinicaId}|${B.duenoId}||`);
    });
  });
});

describe('reenvío y anulación', () => {
  it('reenviar: el token viejo deja de servir y el nuevo sí, para el mismo correo y la misma membresía', async () => {
    const inv = await invitar(A, { nombre: 'Para Reenviar' });
    const nuevo = nuevoToken();
    const reenviada = await comoApi(A, A.duenoId, (tx) =>
      reenviarInvitacion(tx, inv.membresiaId, nuevo.hash),
    );
    expect(reenviada.invitacionId).not.toBe(inv.invitacionId);
    expect(await consultar(inv.hash)).toBeNull();
    expect(await consultar(nuevo.hash)).toMatchObject({
      email: inv.email,
      nombre: 'Para Reenviar',
    });
    expect(await errorDe(aceptar(inv.hash, randomUUID(), inv.email))).toMatchObject({
      codigo: 'P0002',
      restriccion: 'invitacion_no_vigente',
    });
    // Una sola persona en el listado, con el vencimiento del enlace nuevo.
    const personas = await comoApi(A, A.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(personas).toHaveLength(1);
    expect(personas[0]?.invitacionVenceEn).toBe(reenviada.venceEn.toISOString());
    // La vieja quedó anulada con motivo (no se borró), y ni la anulación ni el alta nueva dejan los
    // hashes en la auditoría.
    await enTransaccion(admin, { clinica: A.clinicaId }, async (c) => {
      expect(
        await valor(c, 'select motivo_anulacion from app.invitacion where id = $1', [
          inv.invitacionId,
        ]),
      ).toMatch(/Reenviada/);
      const auditoria = await c.query<{ accion: string; texto: string }>(
        `select accion, coalesce(antes::text, '') || coalesce(despues::text, '') as texto
         from app.audit_log where entidad = 'invitacion' and entidad_id = any($1)`,
        [[inv.invitacionId, reenviada.invitacionId]],
      );
      expect(auditoria.rows.map((f) => f.accion).sort()).toEqual(['crear', 'crear', 'editar']);
      for (const fila of auditoria.rows) {
        expect(fila.texto).not.toContain(inv.hash);
        expect(fila.texto).not.toContain(nuevo.hash);
        expect(fila.texto).not.toContain('token_hash');
      }
    });
    // Y sirve para aceptar.
    const usuario = randomUUID();
    expect(await aceptar(nuevo.hash, usuario, inv.email)).toBe(A.clinicaId);
  });

  it('anular: la membresía pendiente pasa a inactiva sin usuario y el enlace no sirve más', async () => {
    const inv = await invitar(A);
    await comoApi(A, A.administra.usuarioId, (tx) =>
      anularInvitacion(tx, inv.membresiaId, 'Se equivocó de correo'),
    );
    expect(await membresia(A, inv.membresiaId)).toMatchObject({
      estado: 'inactivo',
      usuario_id: null,
    });
    expect(await consultar(inv.hash)).toBeNull();
    expect(await errorDe(aceptar(inv.hash, randomUUID(), inv.email))).toMatchObject({
      restriccion: 'invitacion_no_vigente',
    });
    // Ni se reenvía ni se reactiva (una membresía activa necesita usuario).
    expect(
      await errorDe(
        comoApi(A, A.administra.usuarioId, (tx) =>
          reenviarInvitacion(tx, inv.membresiaId, nuevoToken().hash),
        ),
      ),
    ).toMatchObject({ codigo: '42501', restriccion: 'invitacion_membresia' });
    await enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, async (c) => {
      expect(
        await intentar(c, "update app.membresia set estado = 'activo' where id = $1", [
          inv.membresiaId,
        ]),
      ).toMatchObject(rechazo('23514', 'membresia_usuario_check'));
    });
    // El listado la muestra inactiva, con los datos de la invitación y sin vencimiento.
    const [persona] = await comoApi(A, A.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(persona).toMatchObject({
      estado: 'inactivo',
      usuarioId: null,
      email: inv.email,
      invitacionVenceEn: null,
    });
    // El mismo correo se puede volver a invitar (otra membresía).
    const otra = await invitar(A, { email: inv.email });
    expect(otra.membresiaId).not.toBe(inv.membresiaId);
    // Anular dos veces, o una membresía activa: no hay invitación pendiente.
    for (const id of [inv.membresiaId, A.recepcion.membresiaId]) {
      expect(
        await errorDe(
          comoApi(A, A.administra.usuarioId, (tx) => anularInvitacion(tx, id, 'Otra vez')),
        ),
      ).toMatchObject({ codigo: 'P0002', restriccion: 'invitacion_no_encontrada' });
    }
  });

  it('anular exige motivo y permiso; administración no toca la invitación de un dueño', async () => {
    const inv = await invitar(A);
    expect(
      await errorDe(
        comoApi(A, A.administra.usuarioId, (tx) => anularInvitacion(tx, inv.membresiaId, '  ')),
      ),
    ).toMatchObject({ codigo: '22023' });
    expect(
      await errorDe(
        comoApi(A, A.recepcion.usuarioId, (tx) => anularInvitacion(tx, inv.membresiaId, 'No')),
      ),
    ).toMatchObject({ codigo: '42501', restriccion: 'acceso_sin_permiso' });
    const deDueno = await invitar(A, { rolId: A.roles.dueno }, A.duenoId);
    const operaciones: ((tx: TransaccionConecta) => Promise<unknown>)[] = [
      (tx) => anularInvitacion(tx, deDueno.membresiaId, 'Quitarle'),
      (tx) => reenviarInvitacion(tx, deDueno.membresiaId, nuevoToken().hash),
    ];
    for (const fn of operaciones) {
      expect(await errorDe(comoApi(A, A.administra.usuarioId, fn))).toMatchObject({
        codigo: '42501',
        restriccion: 'acceso_rol_dueno',
      });
    }
  });
});

describe('aceptación', () => {
  it('con un usuario nuevo: crea su identidad con el nombre invitado, activa la membresía y lo audita con la persona como autora', async () => {
    const inv = await invitar(A, {
      nombre: 'Rocío Giménez',
      rolId: A.roles.odontologo,
      sedeIds: [A.sede1, A.sede2],
      sedeDefectoId: A.sede2,
    });
    const usuario = randomUUID();
    expect(await aceptar(inv.hash, usuario, ` ${inv.email.toUpperCase()} `)).toBe(A.clinicaId);
    // Rol y sedes, los que eligió la clínica.
    expect(await membresia(A, inv.membresiaId)).toEqual({
      estado: 'activo',
      usuario_id: usuario,
      rol_id: A.roles.odontologo,
      sede_defecto_id: A.sede2,
      sedes: [A.sede1, A.sede2].sort(),
    });
    expect(await buscarMembresiaActiva(poolApi, usuario, A.clinicaId)).toEqual({
      membresiaId: inv.membresiaId,
      rolId: A.roles.odontologo,
      sedeDefectoId: A.sede2,
    });
    await enTransaccion(admin, { clinica: A.clinicaId }, async (c) => {
      expect(
        (await c.query('select nombre, email from app.usuario where id = $1', [usuario])).rows,
      ).toEqual([{ nombre: 'Rocío Giménez', email: inv.email }]);
      const { rows } = await c.query<{
        entidad: string;
        accion: string;
        usuario_id: string;
        usuario_nombre: string;
        modulo: string;
        ip: string;
      }>(
        `select entidad, accion, usuario_id, usuario_nombre, modulo, host(ip) as ip from app.audit_log
         where clinica_id = $1 and usuario_id = $2 order by entidad`,
        [A.clinicaId, usuario],
      );
      expect(rows).toEqual([
        {
          entidad: 'invitacion',
          accion: 'editar',
          usuario_id: usuario,
          usuario_nombre: 'Rocío Giménez',
          modulo: 'personal',
          ip: '203.0.113.9',
        },
        {
          entidad: 'membresia',
          accion: 'editar',
          usuario_id: usuario,
          usuario_nombre: 'Rocío Giménez',
          modulo: 'personal',
          ip: '203.0.113.9',
        },
        {
          entidad: 'usuario',
          accion: 'crear',
          usuario_id: usuario,
          usuario_nombre: 'Rocío Giménez',
          modulo: 'personal',
          ip: '203.0.113.9',
        },
      ]);
      expect(
        await valor(c, 'select usada_por::text from app.invitacion where id = $1', [
          inv.invitacionId,
        ]),
      ).toBe(usuario);
    });
    // El listado ya muestra a la persona con su usuario.
    const [persona] = await comoApi(A, A.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(persona).toMatchObject({
      usuarioId: usuario,
      estado: 'activo',
      invitacionVenceEn: null,
    });
  });

  it('con un usuario que ya existe en otra clínica: no lo duplica ni le cambia el nombre; recién ahí A ve su perfil', async () => {
    const deB = await crearUsuarioDePrueba(admin, {
      clinicaId: B.clinicaId,
      nombre: 'Nombre Real',
    });
    const inv = await invitar(A, { email: deB.email, nombre: 'Como lo escribió A' });
    // Pendiente: A no ve el perfil, solo lo que escribió.
    const antes = await comoApi(A, A.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(antes[0]).toMatchObject({ usuarioId: null, nombre: 'Como lo escribió A' });
    await enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.usuario where id = $1', [deB.usuarioId]),
      ).toBe(0);
    });
    expect(await aceptar(inv.hash, deB.usuarioId, deB.email)).toBe(A.clinicaId);
    const despues = await comoApi(A, A.duenoId, (tx) =>
      listarPersonal(tx, { membresiaId: inv.membresiaId }),
    );
    expect(despues[0]).toMatchObject({
      usuarioId: deB.usuarioId,
      nombre: 'Nombre Real',
      estado: 'activo',
    });
    // Sigue activo en B.
    expect(await buscarMembresiaActiva(poolApi, deB.usuarioId, B.clinicaId)).not.toBeNull();
  });

  it('con otro correo, con una cuenta de otro correo o con un correo que ya es de otra cuenta: no', async () => {
    const inv = await invitar(A);
    const otraCuenta = await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId });
    const casos: [string, string, string, string][] = [
      ['correo distinto', randomUUID(), correoNuevo(), 'invitacion_otro_correo'],
      [
        'cuenta existente con otro correo',
        otraCuenta.usuarioId,
        inv.email,
        'invitacion_otra_cuenta',
      ],
    ];
    for (const [nombre, usuario, email, restriccion] of casos) {
      const e = await errorDe(aceptar(inv.hash, usuario, email));
      expect({ nombre, e }).toMatchObject({ nombre, e: { codigo: '42501', restriccion } });
    }
    // El correo invitado es de otra cuenta y se intenta con un id nuevo.
    const deB = await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId });
    const deOtro = await invitar(A, { email: deB.email });
    expect(await errorDe(aceptar(deOtro.hash, randomUUID(), deB.email))).toMatchObject({
      codigo: '42501',
      restriccion: 'invitacion_otra_cuenta',
    });
    // Nada cambió: las dos siguen pendientes y sirven.
    expect((await membresia(A, inv.membresiaId)).estado).toBe('pendiente');
    expect(await consultar(inv.hash)).not.toBeNull();
  });

  it('dos veces con el mismo token: la segunda falla', async () => {
    const inv = await invitar(A);
    await aceptar(inv.hash, randomUUID(), inv.email);
    for (const usuario of [randomUUID(), A.duenoId]) {
      expect(await errorDe(aceptar(inv.hash, usuario, inv.email))).toMatchObject({
        codigo: 'P0002',
        restriccion: 'invitacion_no_vigente',
      });
    }
  });

  it('vencida, usada, anulada, inexistente o mal formada: la consulta no devuelve nada y la aceptación falla igual', async () => {
    const vencida = await crearInvitacionDePrueba(admin, {
      clinicaId: A.clinicaId,
      venceEn: new Date(Date.now() - 60_000),
    });
    const usada = await invitar(A);
    await aceptar(usada.hash, randomUUID(), usada.email);
    const anulada = await invitar(A);
    await comoApi(A, A.duenoId, (tx) => anularInvitacion(tx, anulada.membresiaId, 'No viene'));
    const casos: [string, string, string][] = [
      ['vencida', vencida.tokenHash, vencida.email],
      ['usada', usada.hash, usada.email],
      ['anulada', anulada.hash, anulada.email],
      ['inexistente', nuevoToken().hash, correoNuevo()],
      ['mayúsculas', usada.hash.toUpperCase(), usada.email],
      ['corto', 'abc', correoNuevo()],
      ['vacío', '', correoNuevo()],
    ];
    const respuestas = new Set<string>();
    for (const [nombre, hash, email] of casos) {
      expect({ nombre, consulta: await consultar(hash) }).toEqual({ nombre, consulta: null });
      const e = await errorDe(aceptar(hash, randomUUID(), email));
      respuestas.add(`${e.codigo}|${e.restriccion}|${e.mensaje}`);
    }
    // Siempre la misma respuesta: no se distingue cuál de los casos es.
    expect([...respuestas]).toEqual([
      'P0002|invitacion_no_vigente|Ese enlace de invitación no sirve: pedí uno nuevo a la clínica.',
    ]);
  });

  it('20 aceptaciones simultáneas del mismo token: gana una sola', async () => {
    const inv = await invitar(A);
    const usuarios = Array.from({ length: 20 }, () => randomUUID());
    const resultados = await Promise.allSettled(
      usuarios.map((u) => aceptar(inv.hash, u, inv.email)),
    );
    const ganadores = resultados.flatMap((r, i) => (r.status === 'fulfilled' ? [usuarios[i]] : []));
    expect(ganadores).toHaveLength(1);
    for (const r of resultados) {
      if (r.status === 'rejected') {
        expect(await errorDe(Promise.reject(r.reason as Error))).toMatchObject({
          codigo: 'P0002',
          restriccion: 'invitacion_no_vigente',
        });
      }
    }
    expect(await membresia(A, inv.membresiaId)).toMatchObject({
      estado: 'activo',
      usuario_id: ganadores[0],
    });
    // Una sola identidad con ese correo.
    await enTransaccion(admin, { clinica: A.clinicaId }, async (c) => {
      await c.query("select set_config('app.usuario_email_buscado', $1, true)", [inv.email]);
      expect(
        await valor(c, 'select count(*)::int from app.usuario where lower(email) = $1', [
          inv.email,
        ]),
      ).toBe(1);
    });
  });

  it('quien ya tiene una membresía en esa clínica no acepta otra', async () => {
    // B.recepcion invitada en B con su propio correo no se puede (ya es miembro); con una cuenta que
    // ya está inactiva en A y una invitación vieja creada antes, la base rechaza la segunda membresía.
    const persona = await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId });
    const inv = await invitar(A, { email: persona.email });
    await crearUsuarioDePrueba(admin, {
      clinicaId: A.clinicaId,
      usuarioId: persona.usuarioId,
      estado: 'inactivo',
    });
    expect(await errorDe(aceptar(inv.hash, persona.usuarioId, persona.email))).toMatchObject({
      codigo: '23505',
      restriccion: 'membresia_usuario_clinica_key',
    });
  });

  it('una clínica de baja no acepta invitaciones', async () => {
    const C = await prepararClinica();
    const inv = await invitar(C);
    await enTransaccion(
      admin,
      { clinica: C.clinicaId, usuario: '' },
      (c) => c.query('update app.clinica set activo = false where id = $1', [C.clinicaId]),
      { confirmar: true },
    );
    expect(await consultar(inv.hash)).toBeNull();
    expect(await errorDe(aceptar(inv.hash, randomUUID(), inv.email))).toMatchObject({
      restriccion: 'invitacion_no_vigente',
    });
  });

  it('quien aceptó no puede cambiarse el rol ni las sedes después (nadie toca lo propio)', async () => {
    const inv = await invitar(A, { rolId: A.roles.recepcion });
    const usuario = randomUUID();
    await aceptar(inv.hash, usuario, inv.email);
    await enTransaccion(api, { clinica: A.clinicaId, usuario }, async (c) => {
      for (const [texto, parametros] of [
        ['update app.membresia set rol_id = $1 where id = $2', [A.roles.dueno, inv.membresiaId]],
        ['update app.membresia set sede_defecto_id = $1 where id = $2', [A.sede2, inv.membresiaId]],
        [
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [A.clinicaId, inv.membresiaId, A.sede2],
        ],
      ] as const) {
        expect(await intentar(c, texto, [...parametros])).toMatchObject(rechazo('42501'));
      }
    });
    expect(await membresia(A, inv.membresiaId)).toMatchObject({
      rol_id: A.roles.recepcion,
      sedes: [A.sede1],
    });
  });
});
