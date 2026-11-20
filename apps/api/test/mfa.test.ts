import { sesionSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  fijarMfa,
  leerMfa,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

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

  it('un token aal2 activa mfaActivo (y el dueño deja de deber activarlo)', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const antes = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200)).body,
    );
    expect(antes.usuario.mfaActivo).toBe(false);
    expect(antes.debeActivarMfa).toBe(true);

    const despues = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token: await persona.token('aal2') }).expect(200))
        .body,
    );
    expect(despues.nivelAutenticacion).toBe('aal2');
    expect(despues.usuario.mfaActivo).toBe(true);
    expect(despues.debeActivarMfa).toBe(false);
    expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(true);
  });

  it('cualquier endpoint con aal2 también lo activa', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await prueba.pedir('get', '/sedes', { token: await persona.token('aal2') }).expect(200);
    expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(true);
  });

  it('con mfaActivo y token aal1: mfa_requerido en todo salvo GET /sesion', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await fijarMfa(prueba, a.clinicaId, persona.usuarioId, true);
    const token = await persona.token('aal1');

    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token }).expect(200)).body,
    );
    expect(sesion).toMatchObject({ nivelAutenticacion: 'aal1', usuario: { mfaActivo: true } });

    await esperarError(prueba.pedir('get', '/sedes', { token }), 403, 'mfa_requerido');
    await esperarError(prueba.pedir('get', '/auditoria', { token }), 403, 'mfa_requerido');
    await esperarError(
      prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'Sin factor' } }),
      403,
      'mfa_requerido',
    );
    await esperarError(prueba.pedir('delete', '/sesion/mfa', { token }), 403, 'mfa_requerido');

    await prueba.pedir('get', '/sedes', { token: await persona.token('aal2') }).expect(200);
  });

  it('DELETE /sesion/mfa exige aal2 y apaga mfaActivo', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'dueno' });

    // Sin MFA activo y con aal1 tampoco se puede (no hay segundo factor confirmado).
    await esperarError(
      prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal1') }),
      403,
      'mfa_requerido',
    );

    await fijarMfa(prueba, a.clinicaId, persona.usuarioId, true);
    await prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal2') }).expect(204);
    expect(await leerMfa(prueba, a.clinicaId, persona.usuarioId)).toBe(false);

    // Con el factor quitado, un token aal1 vuelve a andar y el dueño vuelve a deber activarlo.
    const token = await persona.token('aal1');
    await prueba.pedir('get', '/sedes', { token }).expect(200);
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token }).expect(200)).body,
    );
    expect(sesion).toMatchObject({ debeActivarMfa: true, usuario: { mfaActivo: false } });
  });
});
