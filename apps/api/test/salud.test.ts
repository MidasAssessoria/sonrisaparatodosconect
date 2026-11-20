import { respuestaSaludSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearPrueba, esperarError, segun, type Prueba } from './ayudas.js';

describe('GET /api/v1/salud', () => {
  let prueba: Prueba;

  beforeAll(async () => {
    prueba = await crearPrueba();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('responde { ok: true } sin sesión', async () => {
    const respuesta = await prueba.pedir('get', '/salud').expect(200);
    expect(segun(respuestaSaludSchema, respuesta.body)).toEqual({ ok: true });
  });

  it('no expone rutas fuera del prefijo, y el 404 tiene la forma del contrato', async () => {
    const { default: request } = await import('supertest');
    const respuesta = await request(prueba.servidor()).get('/salud').expect(404);
    expect(respuesta.body).toMatchObject({ codigo: 'no_encontrado' });
    await esperarError(prueba.pedir('get', '/no-existe'), 404, 'no_encontrado');
  });
});
