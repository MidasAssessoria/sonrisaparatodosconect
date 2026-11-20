import { describe, expect, it } from 'vitest';
import { iniciarWorker } from './worker.js';

describe('iniciarWorker', () => {
  it('avisa que está listo y cierra una sola vez', async () => {
    const mensajes: string[] = [];
    const worker = iniciarWorker({ info: (m) => mensajes.push(m) });
    expect(mensajes).toEqual(['worker listo']);

    await Promise.all([worker.detener('SIGTERM'), worker.detener('SIGINT')]);
    await worker.cerrado;
    expect(mensajes).toEqual(['worker listo', 'worker cerrando (SIGTERM)']);
  });
});
