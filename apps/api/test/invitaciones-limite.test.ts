/**
 * Límite propio de las rutas públicas de invitación: por IP y por ruta, más estricto que el
 * general. Cuenta también los pedidos mal formados (corre antes de validar el cuerpo).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITE_INVITACIONES_PREDETERMINADO } from '../src/personal/limite-invitaciones.js';
import { esperarError, type Prueba } from './ayudas.js';
import { crearPruebaPersonal } from './ayudas-personal.js';

const LIMITE = 5;

describe('límite de pedidos de consultar y aceptar', () => {
  let prueba: Prueba;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal({ limiteInvitaciones: LIMITE });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const inventado = () => `inventado-${randomUUID()}`;

  it('el predeterminado es 20 por minuto', () => {
    expect(LIMITE_INVITACIONES_PREDETERMINADO).toBe(20);
  });

  it('consultar: pasado el límite responde 429 con Retry-After; aceptar cuenta aparte', async () => {
    for (let i = 0; i < LIMITE; i++) {
      // Token bien formado que no existe (404) y uno mal formado (400): los dos cuentan.
      const cuerpo = i % 2 === 0 ? { token: inventado() } : { token: 'corto' };
      const r = await prueba.pedir('post', '/invitaciones/consultar', { cuerpo });
      expect([400, 404]).toContain(r.status);
    }
    const respuesta = await esperarError(
      prueba.pedir('post', '/invitaciones/consultar', { cuerpo: { token: inventado() } }),
      429,
      'demasiados_pedidos',
    );
    const espera = Number(respuesta.headers['retry-after']);
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(60);

    // La otra ruta pública tiene su propio contador (sin Authorization: 401, no 429).
    await esperarError(
      prueba.pedir('post', '/invitaciones/aceptar', { cuerpo: { token: inventado() } }),
      401,
      'no_autenticado',
    );
  });

  it('aceptar: pasado el límite responde 429', async () => {
    // Ya hubo un pedido a aceptar en la prueba anterior.
    for (let i = 1; i < LIMITE; i++) {
      await prueba
        .pedir('post', '/invitaciones/aceptar', { cuerpo: { token: inventado() } })
        .expect(401);
    }
    await esperarError(
      prueba.pedir('post', '/invitaciones/aceptar', { cuerpo: { token: inventado() } }),
      429,
      'demasiados_pedidos',
    );
  });

  it('las rutas con sesión no usan este límite', async () => {
    // Sin token: 401, no 429 (el límite general por IP es alto en las pruebas).
    await esperarError(prueba.pedir('get', '/personal'), 401, 'no_autenticado');
  });
});
