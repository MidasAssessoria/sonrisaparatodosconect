/**
 * Roles: listado con permisos y personas, alta con su matriz, edición (la matriz se reemplaza y lo
 * revocado no se borra), desactivación, autoescalada, permisos y aislamiento.
 */
import { randomUUID } from 'node:crypto';
import { rolSchema, sesionSchema, type Rol } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  esperarError,
  otorgarPermiso,
  segun,
  type Clinica,
} from './ayudas.js';
import { crearPruebaPersonal, listarRoles, type PruebaPersonal } from './ayudas-personal.js';

describe('roles', () => {
  let prueba: PruebaPersonal;
  let a: Clinica;
  let b: Clinica;
  let duenoA: string;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal();
    a = await crearClinica(prueba, { sedes: 1 });
    b = await crearClinica(prueba, { sedes: 1 });
    duenoA = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const nombre = (base: string) => `${base} ${randomUUID().slice(0, 6)}`;

  const crearRol = async (token: string, cuerpo: object): Promise<Rol> =>
    segun(rolSchema, (await prueba.pedir('post', '/roles', { token, cuerpo }).expect(201)).body);

  it('lista los roles de sistema con código, permisos y personas; sin personal:ver → 403', async () => {
    const roles = await listarRoles(prueba, duenoA);
    const dueno = roles.find((r) => r.codigo === 'dueno');
    expect(dueno).toMatchObject({
      id: a.roles.dueno,
      nombre: 'Dueño/a',
      esSistema: true,
      activo: true,
      todasLasSedes: true,
      exigeMfa: true,
      personas: 1,
    });
    expect(dueno?.permisos).toHaveLength(14 * 5);
    expect(roles.find((r) => r.codigo === 'recepcion')?.permisos).toContainEqual({
      modulo: 'agenda',
      accion: 'ver',
    });
    expect(
      roles
        .filter((r) => r.esSistema)
        .map((r) => r.codigo)
        .sort(),
    ).toEqual(['administracion', 'asistente', 'dueno', 'odontologo', 'recepcion'].sort());

    const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await listarRoles(prueba, await administracion.token());
    const recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    await esperarError(
      prueba.pedir('get', '/roles', { token: await recepcion.token() }),
      403,
      'sin_permiso',
    );
  });

  it('crea un rol con su matriz; el código interno no sale; nombre repetido → conflicto', async () => {
    const n = nombre('Caja');
    const rol = await crearRol(duenoA, {
      nombre: n,
      inactividadMin: 20,
      permisos: [
        { modulo: 'caja', accion: 'ver' },
        { modulo: 'caja', accion: 'crear' },
        { modulo: 'agenda', accion: 'ver' },
      ],
    });
    expect(rol).toMatchObject({
      codigo: null,
      nombre: n,
      esSistema: false,
      activo: true,
      todasLasSedes: false,
      exigeMfa: false,
      inactividadMin: 20,
      personas: 0,
    });
    expect(rol.permisos).toEqual([
      { modulo: 'agenda', accion: 'ver' },
      { modulo: 'caja', accion: 'ver' },
      { modulo: 'caja', accion: 'crear' },
    ]);
    expect((await listarRoles(prueba, duenoA)).find((r) => r.id === rol.id)).toEqual(rol);

    const repetido = await esperarError(
      prueba.pedir('post', '/roles', { token: duenoA, cuerpo: { nombre: n.toUpperCase() } }),
      409,
      'conflicto',
    );
    expect((repetido.body as { mensaje: string }).mensaje).toMatch(/Ya hay un rol activo/);
    await esperarError(
      prueba.pedir('post', '/roles', {
        token: duenoA,
        cuerpo: { nombre: 'X', permisos: [{ modulo: 'nada', accion: 'ver' }] },
      }),
      400,
      'datos_invalidos',
    );
  });

  it('con configuracion:crear (sin editar) se crea un rol con su matriz inicial', async () => {
    const c = await crearClinica(prueba, { sedes: 1 });
    await otorgarPermiso(prueba, c.clinicaId, c.roles.odontologo, 'configuracion', 'crear');
    const odontologa = await crearPersona(prueba, c.clinicaId, { rol: 'odontologo' });
    const rol = await crearRol(await odontologa.token(), {
      nombre: 'Higienista',
      permisos: [{ modulo: 'agenda', accion: 'ver' }],
    });
    expect(rol.permisos).toEqual([{ modulo: 'agenda', accion: 'ver' }]);
    // Pero no lo puede editar después (eso es configuracion:editar).
    await esperarError(
      prueba.pedir('patch', `/roles/${rol.id}`, {
        token: await odontologa.token(),
        cuerpo: { nombre: 'Higienista 2' },
      }),
      403,
      'sin_permiso',
    );
  });

  it('edita atributos y reemplaza la matriz; lo revocado queda inactivo; la persona lo ve en su sesión', async () => {
    const rol = await crearRol(duenoA, {
      nombre: nombre('Recepción tarde'),
      permisos: [
        { modulo: 'agenda', accion: 'ver' },
        { modulo: 'pacientes', accion: 'ver' },
      ],
    });
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    await prueba
      .pedir('patch', `/personal/${persona.membresiaId}`, {
        token: duenoA,
        cuerpo: { rolId: rol.id },
      })
      .expect(200);

    const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const editado = segun(
      rolSchema,
      (
        await prueba
          .pedir('patch', `/roles/${rol.id}`, {
            token: await administracion.token(),
            cuerpo: {
              nombre: 'Recepción de la tarde',
              todasLasSedes: true,
              permisos: [
                { modulo: 'agenda', accion: 'ver' },
                { modulo: 'agenda', accion: 'crear' },
              ],
            },
          })
          .expect(200)
      ).body,
    );
    expect(editado).toMatchObject({
      nombre: 'Recepción de la tarde',
      todasLasSedes: true,
      personas: 1,
      permisos: [
        { modulo: 'agenda', accion: 'ver' },
        { modulo: 'agenda', accion: 'crear' },
      ],
    });
    const { rows } = await comoSistema<{ modulo: string; accion: string; activo: boolean }>(
      prueba.admin,
      a.clinicaId,
      'select modulo, accion, activo from app.rol_permiso where rol_id = $1 order by modulo, accion',
      [rol.id],
    );
    expect(rows).toEqual([
      { modulo: 'agenda', accion: 'crear', activo: true },
      { modulo: 'agenda', accion: 'ver', activo: true },
      { modulo: 'pacientes', accion: 'ver', activo: false },
    ]);

    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200)).body,
    );
    expect(sesion.permisos).toEqual(
      expect.arrayContaining([
        { modulo: 'agenda', accion: 'ver' },
        { modulo: 'agenda', accion: 'crear' },
      ]),
    );
    expect(sesion.permisos).toHaveLength(2);
    expect(sesion.puedeVerTodasLasSedes).toBe(false);
    expect(sesion.sedes.map((s) => s.id)).toEqual([a.sedes[0]!.sedeId]);
  });

  it('autoescalada: nadie toca su propio rol ni sus permisos, y el rol dueño no se modifica', async () => {
    const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const t = await administracion.token();
    const propio = await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.administracion}`, {
        token: t,
        cuerpo: { permisos: [{ modulo: 'ficha_clinica', accion: 'ver' }] },
      }),
      403,
      'sin_permiso',
    );
    expect((propio.body as { mensaje: string }).mensaje).toMatch(
      /No podés cambiar tu propio acceso/,
    );
    await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.administracion}`, {
        token: t,
        cuerpo: { todasLasSedes: false },
      }),
      403,
      'sin_permiso',
    );
    const dueno = await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.dueno}`, {
        token: t,
        cuerpo: { permisos: [] },
      }),
      403,
      'sin_permiso',
    );
    expect((dueno.body as { mensaje: string }).mensaje).toMatch(/rol Dueño\/a no se modifica/);
    await esperarError(
      prueba.pedir('delete', `/roles/${a.roles.dueno}`, {
        token: duenoA,
        cuerpo: { motivo: 'Probar' },
      }),
      409,
      'conflicto',
    );

    // Nada cambió.
    const roles = await listarRoles(prueba, duenoA);
    expect(roles.find((r) => r.id === a.roles.administracion)?.permisos).not.toContainEqual({
      modulo: 'ficha_clinica',
      accion: 'ver',
    });
    expect(roles.find((r) => r.id === a.roles.dueno)?.permisos).toHaveLength(70);
  });

  it('desactivar: con motivo; en uso → conflicto; sin anular → 403', async () => {
    const libre = await crearRol(duenoA, { nombre: nombre('Temporal') });
    const enUso = await crearRol(duenoA, { nombre: nombre('Usado') });
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    await prueba
      .pedir('patch', `/personal/${persona.membresiaId}`, {
        token: duenoA,
        cuerpo: { rolId: enUso.id },
      })
      .expect(200);

    await esperarError(
      prueba.pedir('delete', `/roles/${libre.id}`, { token: duenoA }),
      400,
      'datos_invalidos',
    );
    const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await esperarError(
      prueba.pedir('delete', `/roles/${libre.id}`, {
        token: await administracion.token(),
        cuerpo: { motivo: 'Ya no se usa' },
      }),
      403,
      'sin_permiso',
    );
    await prueba
      .pedir('delete', `/roles/${libre.id}`, { token: duenoA, cuerpo: { motivo: 'Ya no se usa' } })
      .expect(204);
    expect((await listarRoles(prueba, duenoA)).find((r) => r.id === libre.id)?.activo).toBe(false);
    await esperarError(
      prueba.pedir('delete', `/roles/${libre.id}`, { token: duenoA, cuerpo: { motivo: 'Otra' } }),
      409,
      'conflicto',
    );

    const r = await esperarError(
      prueba.pedir('delete', `/roles/${enUso.id}`, {
        token: duenoA,
        cuerpo: { motivo: 'Ya no se usa' },
      }),
      409,
      'conflicto',
    );
    expect((r.body as { mensaje: string }).mensaje).toBe(
      'Ese rol lo usa alguien del equipo o una invitación pendiente. Cambiales el rol antes de desactivarlo.',
    );
  });

  it('aislamiento: otra clínica no ve, edita ni desactiva roles de A', async () => {
    const rol = await crearRol(duenoA, { nombre: nombre('Solo de A') });
    const duenoB = await b.dueno.token();
    const deB = await listarRoles(prueba, duenoB);
    expect(deB.some((r) => r.id === rol.id || r.id === a.roles.recepcion)).toBe(false);
    await esperarError(
      prueba.pedir('patch', `/roles/${rol.id}`, { token: duenoB, cuerpo: { nombre: 'Robado' } }),
      404,
      'no_encontrado',
    );
    await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.recepcion}`, {
        token: duenoB,
        cuerpo: { permisos: [] },
      }),
      404,
      'no_encontrado',
    );
    await esperarError(
      prueba.pedir('delete', `/roles/${rol.id}`, { token: duenoB, cuerpo: { motivo: 'Ajeno' } }),
      404,
      'no_encontrado',
    );
    const deA = (await listarRoles(prueba, duenoA)).find((r) => r.id === rol.id);
    expect(deA).toMatchObject({ nombre: rol.nombre, activo: true });
  });
});
