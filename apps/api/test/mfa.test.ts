import { sesionSchema, type Sesion } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  fijarMfa,
  ingresosDeSesion,
  leerMfa,
  leerSesion,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

type Metodo = 'get' | 'post' | 'patch' | 'put' | 'delete';

describe('doble factor', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  async function sesion(token: string): Promise<Sesion> {
    return segun(sesionSchema, (await prueba.pedir('get', '/sesion', { token }).expect(200)).body);
  }

  /** Todos los endpoints con sesión, con una sede y un sillón de la clínica. */
  function endpoints(): [Metodo, string, object | undefined][] {
    const [s] = a.sedes;
    return [
      ['get', '/sesion', undefined],
      ['get', '/sedes', undefined],
      ['post', '/sedes', { nombre: 'Sin segundo factor' }],
      ['get', `/sedes/${s!.sedeId}`, undefined],
      ['patch', `/sedes/${s!.sedeId}`, { nombre: 'Tomada sin factor' }],
      ['delete', `/sedes/${s!.sedeId}`, { motivo: 'Sin segundo factor' }],
      ['put', `/sedes/${s!.sedeId}/horarios`, { horarios: [] }],
      ['post', `/sedes/${s!.sedeId}/sillones`, { nombre: 'Intruso' }],
      ['patch', `/sillones/${s!.sillonId}`, { activo: false }],
      ['get', '/auditoria', undefined],
      ['delete', '/sesion/mfa', undefined],
    ];
  }

  it('rol que exige doble factor con aal1: mfa_requerido en cada endpoint, incluido GET /sesion', async () => {
    for (const rol of ['dueno', 'administracion'] as const) {
      const persona = await crearPersona(prueba, a.clinicaId, { rol });
      const token = await persona.token('aal1');
      for (const [metodo, ruta, cuerpo] of endpoints()) {
        const respuesta = await esperarError(
          prueba.pedir(metodo, ruta, { token, ...(cuerpo ? { cuerpo } : {}) }),
          403,
          'mfa_requerido',
        );
        expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/doble factor/);
      }
      // Nada cambió, y la sesión no se creó ni se registró el ingreso (todavía no pasó el factor).
      const { rows } = await comoSistema<{ nombre: string; deleted_at: Date | null }>(
        prueba.admin,
        a.clinicaId,
        'select nombre, deleted_at from app.sede where id = $1',
        [a.sedes[0]!.sedeId],
      );
      expect(rows[0]).toEqual({ nombre: 'Sede 1', deleted_at: null });
      expect(await leerSesion(prueba, a.clinicaId, persona.usuarioId, persona.sesionId)).toBeNull();
      expect(await ingresosDeSesion(prueba, a.clinicaId, persona.sesionId)).toBe(0);
      expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(false);
    }
  });

  it('POST /sesion/cerrar funciona con aal1 y el doble factor pendiente', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const token = await persona.token('aal1');
    await esperarError(prueba.pedir('get', '/sesion', { token }), 403, 'mfa_requerido');
    await prueba.pedir('post', '/sesion/cerrar', { token }).expect(204);
    expect(
      await leerSesion(prueba, a.clinicaId, persona.usuarioId, persona.sesionId),
    ).toMatchObject({ motivo_cierre: 'salida' });
    // La sesión cerrada ya no sirve, ni siquiera pasando el segundo factor.
    await esperarError(
      prueba.pedir('get', '/sesion', { token: await persona.token('aal2') }),
      401,
      'no_autenticado',
    );
  });

  it('con aal2: activa mfaActivo, informa exigeMfa y registra el ingreso', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const s = await sesion(await persona.token('aal2'));
    expect(s).toMatchObject({
      nivelAutenticacion: 'aal2',
      usuario: { mfaActivo: true },
      rol: { codigo: 'administracion', exigeMfa: true },
    });
    expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(true);
    expect(await ingresosDeSesion(prueba, a.clinicaId, persona.sesionId)).toBe(1);
  });

  it('rol que no lo exige: aal1 anda; con el factor activo, aal1 → mfa_requerido en todo', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const s = await sesion(await persona.token('aal1'));
    expect(s).toMatchObject({
      nivelAutenticacion: 'aal1',
      usuario: { mfaActivo: false },
      rol: { exigeMfa: false },
    });

    await fijarMfa(prueba, a.clinicaId, persona.usuarioId, true);
    const token = await persona.token('aal1');
    for (const [metodo, ruta, cuerpo] of endpoints()) {
      await esperarError(
        prueba.pedir(metodo, ruta, { token, ...(cuerpo ? { cuerpo } : {}) }),
        403,
        'mfa_requerido',
      );
    }
    await prueba.pedir('post', '/sesion/cerrar', { token }).expect(204);
  });

  it('DELETE /sesion/mfa exige aal2', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    await esperarError(
      prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal1') }),
      403,
      'mfa_requerido',
    );
  });

  it('DELETE /sesion/mfa seguido de un pedido con el mismo token: ese token ya no cuenta como aal2', async () => {
    // Rol que exige el factor: el mismo token pasa a mfa_requerido.
    const admin = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const tokenAdmin = await admin.token('aal2');
    expect((await sesion(tokenAdmin)).usuario.mfaActivo).toBe(true);
    await prueba.pedir('delete', '/sesion/mfa', { token: tokenAdmin }).expect(204);
    expect(await leerMfa(prueba, a.clinicaId, admin.usuarioId)).toBe(false);
    await esperarError(prueba.pedir('get', '/sesion', { token: tokenAdmin }), 403, 'mfa_requerido');
    await esperarError(prueba.pedir('get', '/sedes', { token: tokenAdmin }), 403, 'mfa_requerido');
    expect(await leerMfa(prueba, a.clinicaId, admin.usuarioId)).toBe(false);

    // Rol que no lo exige: el mismo token sigue andando, pero como aal1 y sin reactivar el factor.
    const odontologo = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const token = await odontologo.token('aal2');
    expect((await sesion(token)).usuario.mfaActivo).toBe(true);
    await prueba.pedir('delete', '/sesion/mfa', { token }).expect(204);
    const despues = await sesion(token);
    expect(despues).toMatchObject({ nivelAutenticacion: 'aal1', usuario: { mfaActivo: false } });
    // Tampoco puede volver a dar de baja (ni nada que exija aal2) con ese token.
    await esperarError(prueba.pedir('delete', '/sesion/mfa', { token }), 403, 'mfa_requerido');
    expect(await leerMfa(prueba, a.clinicaId, odontologo.usuarioId)).toBe(false);
  });

  it('un token aal2 emitido antes de la baja no reactiva el factor; uno posterior sí', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const ahora = Math.floor(Date.now() / 1000);
    // Emitido antes de la baja, pero usado por primera vez después.
    const viejo = await persona.token('aal2', { iat: ahora - 60 });

    await sesion(await persona.token('aal2'));
    await prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal2') }).expect(204);

    const conViejo = await sesion(viejo);
    expect(conViejo).toMatchObject({ nivelAutenticacion: 'aal1', usuario: { mfaActivo: false } });
    expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(false);

    // Un token aal2 emitido después de la baja (volvió a activar el factor en Supabase) sí cuenta.
    const nuevo = await persona.token('aal2', { iat: ahora + 5 });
    const conNuevo = await sesion(nuevo);
    expect(conNuevo).toMatchObject({ nivelAutenticacion: 'aal2', usuario: { mfaActivo: true } });
    expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(true);
    // Y con el factor activo de nuevo, el token viejo vale aal1: mfa_requerido.
    await esperarError(prueba.pedir('get', '/sesion', { token: viejo }), 403, 'mfa_requerido');
  });

  it('activar y quitar el doble factor queda auditado (sin que app_api escriba mfa_activo)', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
    await sesion(await persona.token('aal2'));
    await prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal2') }).expect(204);
    const { rows } = await comoSistema<{ antes: boolean; despues: boolean }>(
      prueba.admin,
      a.clinicaId,
      `select (antes ->> 'mfa_activo')::boolean as antes, (despues ->> 'mfa_activo')::boolean as despues
       from app.audit_log where clinica_id = $1 and entidad = 'usuario' and entidad_id = $2
         and accion = 'editar' order by fecha, id`,
      [a.clinicaId, persona.usuarioId],
    );
    expect(rows).toEqual([
      { antes: false, despues: true },
      { antes: true, despues: false },
    ]);
  });
});
