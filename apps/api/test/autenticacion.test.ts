import { randomUUID } from 'node:crypto';
import { sesionSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearClinica,
  crearPrueba,
  esperarError,
  generarClaves,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

function base64url(valor: object): string {
  return Buffer.from(JSON.stringify(valor)).toString('base64url');
}

describe('autenticación (JWT de Supabase)', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const sesion = (token?: string) => prueba.pedir('get', '/sesion', token ? { token } : {});

  it('acepta un token ES256 válido', async () => {
    const respuesta = await sesion(await a.dueno.token()).expect(200);
    segun(sesionSchema, respuesta.body);
  });

  it('acepta un token RS256 válido', async () => {
    const token = await prueba.token({ sub: a.duenoId, alg: 'RS256' });
    await sesion(token).expect(200);
  });

  it('sin token → no_autenticado', async () => {
    await esperarError(sesion(), 401, 'no_autenticado');
    await esperarError(prueba.pedir('get', '/sedes'), 401, 'no_autenticado');
  });

  it('cabecera Authorization mal formada → no_autenticado', async () => {
    for (const valor of [
      'Basic abc',
      'Bearer',
      'Bearer a.b.c d',
      `Token ${await a.dueno.token()}`,
    ]) {
      await esperarError(
        prueba.pedir('get', '/sesion').set('Authorization', valor),
        401,
        'no_autenticado',
      );
    }
  });

  it('firma inválida (payload alterado) → no_autenticado', async () => {
    const token = await a.dueno.token();
    const [cabecera, , firma] = token.split('.');
    const otro = base64url({
      sub: randomUUID(),
      aal: 'aal2',
      iss: prueba.config.emisorJwt,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    await esperarError(sesion(`${cabecera}.${otro}.${firma}`), 401, 'no_autenticado');
  });

  it('vencido → no_autenticado', async () => {
    const token = await prueba.token({ sub: a.duenoId, venceEn: -60 });
    const respuesta = await esperarError(sesion(token), 401, 'no_autenticado');
    expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/venció/);
  });

  it('emisor incorrecto → no_autenticado', async () => {
    const token = await prueba.token({
      sub: a.duenoId,
      emisor: 'https://otro.supabase.co/auth/v1',
    });
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('audiencia incorrecta → no_autenticado', async () => {
    const token = await prueba.token({ sub: a.duenoId, audiencia: 'anon' });
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('alg none → no_autenticado', async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      sub: a.duenoId,
      aal: 'aal2',
      iss: prueba.config.emisorJwt,
      aud: 'authenticated',
      iat: ahora,
      exp: ahora + 600,
    })}.`;
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('HS256 firmado con la clave pública como secreto → no_autenticado', async () => {
    const { SignJWT } = await import('jose');
    const secreto = new TextEncoder().encode('clave-ec');
    const token = await new SignJWT({ aal: 'aal2' })
      .setProtectedHeader({ alg: 'HS256', kid: 'clave-ec' })
      .setSubject(a.duenoId)
      .setIssuer(prueba.config.emisorJwt)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(secreto);
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('token de otro par de claves (mismo kid) → no_autenticado', async () => {
    const ajena = await generarClaves('ES256', 'clave-ec');
    const token = await prueba.token({ sub: a.duenoId, clave: ajena });
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('token de otro par de claves (kid desconocido) → no_autenticado', async () => {
    const ajena = await generarClaves('ES256', 'otra-clave');
    const token = await prueba.token({ sub: a.duenoId, clave: ajena });
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('sub que no es UUID → no_autenticado', async () => {
    const token = await prueba.token({ sub: "1' or '1'='1" });
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('sin exp (firmado con la clave correcta) → no_autenticado', async () => {
    const token = await prueba.token({ sub: a.duenoId, venceEn: null });
    await esperarError(sesion(token), 401, 'no_autenticado');
  });

  it('usuario válido en Auth pero sin fila en usuario → sin_membresia', async () => {
    const token = await prueba.token({ sub: randomUUID(), email: 'nuevo@prueba.test' });
    await esperarError(sesion(token), 403, 'sin_membresia');
    await esperarError(prueba.pedir('get', '/sedes', { token }), 403, 'sin_membresia');
  });
});
