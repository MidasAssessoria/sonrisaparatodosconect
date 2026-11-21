import { describe, expect, it } from 'vitest';
import { cargarConfig } from '../src/config.js';

describe('cargarConfig', () => {
  it('en desarrollo y pruebas tiene valores por defecto', () => {
    expect(cargarConfig({ NODE_ENV: 'test' })).toMatchObject({
      entorno: 'test',
      poolMax: 4,
      concurrencia: 2,
      cierreMs: 30_000,
      archivos: { almacen: 'local' },
    });
  });

  it('en producción exige la conexión y el almacén, sin mostrar valores', () => {
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(/WORKER_DATABASE_URL: falta/);
    const secreto = 'postgres://app_worker:clave-secreta@db:5432/conecta';
    let mensaje = '';
    try {
      cargarConfig({
        NODE_ENV: 'production',
        WORKER_DATABASE_URL: secreto,
        WORKER_POOL_MAX: '1000',
        ARCHIVOS_ALMACEN: 'supabase',
        ARCHIVOS_DIRECTORIO: '/datos',
        SUPABASE_URL: 'https://x.supabase.co',
      });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toContain('WORKER_POOL_MAX: valor inválido');
    expect(mensaje).toContain('SUPABASE_SECRET_KEY');
    expect(mensaje).not.toContain('clave-secreta');
  });

  it('NODE_ENV inválido', () => {
    expect(() => cargarConfig({ NODE_ENV: 'prod' })).toThrow('NODE_ENV');
  });
});
