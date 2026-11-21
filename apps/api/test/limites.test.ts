/**
 * Límites de quien administra (contrato de personal, migración 0015), de punta a punta por la API:
 * el ataque de escalada de la revisión del Sprint 2 (Administración se da, o le da a otro, lo que no
 * tiene) queda rechazado con un mensaje que dice qué hacer; el dueño no tiene límite; editar un rol
 * en un solo pedido mira el estado final (control diferido al COMMIT).
 */
import { crearRolDePrueba, crearUsuarioDePrueba } from '@conecta/db/pruebas';
import { rolSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  esperarError,
  segun,
  type Clinica,
} from './ayudas.js';
import {
  crearPruebaPersonal,
  invitar,
  listarRoles,
  type PruebaPersonal,
} from './ayudas-personal.js';

describe('límites de quien administra', () => {
  let prueba: PruebaPersonal;
  let a: Clinica;
  let tAdm: string;
  let duenoA: string;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal();
    a = await crearClinica(prueba, { sedes: 2 });
    const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    tAdm = await administracion.token();
    duenoA = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const permisosDe = async (rolId: string): Promise<string[]> => {
    const { rows } = await comoSistema<{ p: string }>(
      prueba.admin,
      a.clinicaId,
      `select modulo || ':' || accion as p from app.rol_permiso
       where rol_id = $1 and activo order by 1`,
      [rolId],
    );
    return rows.map((f) => f.p);
  };

  it('Administración agrega ficha_clinica:exportar al rol Asistente → rechazado (rol de sistema: solo un dueño)', async () => {
    const asistente = (await listarRoles(prueba, tAdm)).find((r) => r.id === a.roles.asistente)!;
    const antes = await permisosDe(a.roles.asistente);
    const r = await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.asistente}`, {
        token: tAdm,
        cuerpo: {
          permisos: [...asistente.permisos, { modulo: 'ficha_clinica', accion: 'exportar' }],
        },
      }),
      403,
      'sin_permiso',
    );
    expect((r.body as { mensaje: string }).mensaje).toBe(
      'Los roles de sistema solo los cambia un dueño. Creá un rol propio o pedile el cambio al dueño.',
    );
    expect(await permisosDe(a.roles.asistente)).toEqual(antes);
  });

  it('Administración agrega a un rol propio un permiso que no tiene → rechazado con la lista de lo que sobra', async () => {
    const { rolId } = await crearRolDePrueba(prueba.admin, {
      clinicaId: a.clinicaId,
      permisos: ['agenda:ver'],
    });
    const r = await esperarError(
      prueba.pedir('patch', `/roles/${rolId}`, {
        token: tAdm,
        cuerpo: {
          permisos: [
            { modulo: 'agenda', accion: 'ver' },
            { modulo: 'ficha_clinica', accion: 'exportar' },
            { modulo: 'agenda', accion: 'crear' },
          ],
        },
      }),
      403,
      'sin_permiso',
    );
    expect((r.body as { mensaje: string }).mensaje).toBe(
      'Ese rol quedaría con permisos que tu rol no tiene: agenda:crear, ficha_clinica:exportar. Quitáselos o pedile al dueño que haga el cambio.',
    );
    expect(await permisosDe(rolId)).toEqual(['agenda:ver']);
    // Crear un rol así tampoco.
    await esperarError(
      prueba.pedir('post', '/roles', {
        token: tAdm,
        cuerpo: {
          nombre: 'Rol con exportar',
          permisos: [{ modulo: 'ficha_clinica', accion: 'exportar' }],
        },
      }),
      403,
      'sin_permiso',
    );
    // El dueño sí puede.
    const delDueno = segun(
      rolSchema,
      (
        await prueba
          .pedir('patch', `/roles/${rolId}`, {
            token: duenoA,
            cuerpo: { permisos: [{ modulo: 'ficha_clinica', accion: 'exportar' }] },
          })
          .expect(200)
      ).body,
    );
    expect(delDueno.permisos).toEqual([{ modulo: 'ficha_clinica', accion: 'exportar' }]);
  });

  it('Administración invita con un rol que da más que el suyo → rechazado, sin correo; ni cambiándole el rol a alguien', async () => {
    const antes = prueba.adminAuth.invitaciones.length;
    const r = await esperarError(
      prueba.pedir('post', '/invitaciones', {
        token: tAdm,
        cuerpo: {
          nombre: 'Recepcionista Nueva',
          email: 'recepcionista-nueva@prueba.test',
          rolId: a.roles.recepcion,
        },
      }),
      403,
      'sin_permiso',
    );
    expect((r.body as { mensaje: string }).mensaje).toBe(
      'Ese rol da permisos que tu rol no tiene: agenda:anular, agenda:crear, agenda:editar, caja:crear, caja:editar, mensajeria:crear, pacientes:crear, pacientes:editar. Pedile al dueño que lo asigne.',
    );
    expect(prueba.adminAuth.invitaciones.length).toBe(antes);

    // Cambiar el rol de alguien a uno superior, tampoco.
    const { rolId: rolMenor } = await crearRolDePrueba(prueba.admin, {
      clinicaId: a.clinicaId,
      permisos: ['agenda:ver'],
    });
    const persona = await crearUsuarioDePrueba(prueba.admin, {
      clinicaId: a.clinicaId,
      rolId: rolMenor,
    });
    await esperarError(
      prueba.pedir('patch', `/personal/${persona.membresiaId}`, {
        token: tAdm,
        cuerpo: { rolId: a.roles.recepcion },
      }),
      403,
      'sin_permiso',
    );
    // El dueño sí invita con ese rol.
    await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
  });

  it('Administración apaga el doble factor de su rol → rechazado; el dueño tampoco puede apagarlo', async () => {
    const propio = await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.administracion}`, {
        token: tAdm,
        cuerpo: { exigeMfa: false },
      }),
      403,
      'sin_permiso',
    );
    expect((propio.body as { mensaje: string }).mensaje).toMatch(
      /No podés cambiar tu propio acceso/,
    );
    // Ni siquiera el dueño: Dueño/a y Administración siempre exigen doble factor.
    const dueno = await esperarError(
      prueba.pedir('patch', `/roles/${a.roles.administracion}`, {
        token: duenoA,
        cuerpo: { exigeMfa: false },
      }),
      400,
      'datos_invalidos',
    );
    expect((dueno.body as { mensaje: string }).mensaje).toMatch(/exigen siempre doble factor/);
    expect(
      (await listarRoles(prueba, duenoA)).find((r) => r.id === a.roles.administracion)?.exigeMfa,
    ).toBe(true);
  });

  it('editar un rol en un solo pedido mira el estado final: quitar lo ajeno y renombrar pasa; solo renombrar no', async () => {
    const { rolId } = await crearRolDePrueba(prueba.admin, {
      clinicaId: a.clinicaId,
      nombre: 'Con permiso ajeno',
      permisos: ['agenda:ver', 'ficha_clinica:ver'],
    });
    // Solo renombrar: el rol seguiría con ficha_clinica:ver (Administración no lo tiene).
    const r = await esperarError(
      prueba.pedir('patch', `/roles/${rolId}`, { token: tAdm, cuerpo: { nombre: 'Renombrado' } }),
      403,
      'sin_permiso',
    );
    expect((r.body as { mensaje: string }).mensaje).toBe(
      'Ese rol quedaría con permisos que tu rol no tiene: ficha_clinica:ver. Quitáselos o pedile al dueño que haga el cambio.',
    );
    // Renombrar y quitar lo ajeno en el mismo pedido.
    const editado = segun(
      rolSchema,
      (
        await prueba
          .pedir('patch', `/roles/${rolId}`, {
            token: tAdm,
            cuerpo: { nombre: 'Renombrado', permisos: [{ modulo: 'agenda', accion: 'ver' }] },
          })
          .expect(200)
      ).body,
    );
    expect(editado).toMatchObject({
      nombre: 'Renombrado',
      permisos: [{ modulo: 'agenda', accion: 'ver' }],
    });
  });
});
