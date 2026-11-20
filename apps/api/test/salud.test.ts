import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/app.js';

describe('GET /api/v1/salud', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
  });

  const servidor = (): Server => app.getHttpServer() as Server;

  afterAll(async () => {
    await app.close();
  });

  it('responde { ok: true }', async () => {
    const respuesta = await request(servidor()).get('/api/v1/salud').expect(200);
    expect(respuesta.body).toEqual({ ok: true });
  });

  it('no expone rutas fuera del prefijo', async () => {
    await request(servidor()).get('/salud').expect(404);
  });
});
