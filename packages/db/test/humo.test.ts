import { describe, expect, it } from 'vitest';
import { crearClinicaDePrueba, crearSedeDePrueba } from '../src/pruebas/index.js';
import { enTransaccion, nuevoPool, urls, valor } from './ayudas.js';

describe('banco de pruebas', () => {
  const admin = nuevoPool(urls().urlAdmin);
  const api = nuevoPool(urls().urlApi);

  it('conecta como app_api y como administración, sin superusuario', async () => {
    const usuarioApi = await enTransaccion(api, {}, (c) => valor<string>(c, 'select current_user'));
    expect(usuarioApi).toBe('app_api');
    const esSuper = await enTransaccion(admin, {}, (c) =>
      valor<boolean>(c, 'select rolsuper from pg_roles where rolname = current_user'),
    );
    expect(esSuper).toBe(false);
  });

  it('Postgres es de la serie 17', async () => {
    const version = await enTransaccion(api, {}, (c) =>
      valor<string>(c, "select current_setting('server_version_num')"),
    );
    expect(Number(version)).toBeGreaterThanOrEqual(170000);
    expect(Number(version)).toBeLessThan(180000);
  });

  it('una clínica de prueba se ve con su contexto', async () => {
    const clinica = await crearClinicaDePrueba(admin);
    const { sedeId } = await crearSedeDePrueba(admin, clinica.clinicaId);
    const sedes = await enTransaccion(
      api,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => (await c.query<{ id: string }>('select id from app.sede')).rows.map((f) => f.id),
    );
    expect(sedes).toEqual([sedeId]);
  });
});
