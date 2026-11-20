import { describe, expect, it } from 'vitest';
import { cargarConfig, ErrorDeConfiguracion } from '../src/config.js';

describe('cargarConfig', () => {
  it('usa valores por defecto en test', () => {
    const config = cargarConfig({ NODE_ENV: 'test' });
    expect(config.entorno).toBe('test');
    expect(config.databaseUrl).toMatch(/^postgres:\/\//);
  });

  it('en producción falla y nombra cada variable que falta', () => {
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(ErrorDeConfiguracion);
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL: falta[\s\S]*SUPABASE_URL: falta[\s\S]*SUPABASE_JWKS_URL: falta/,
    );
  });

  it('en producción acepta una configuración completa', () => {
    const config = cargarConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: 'postgresql://app_api:x@db.example.com:5432/conecta',
      SUPABASE_URL: 'https://proyecto.supabase.co',
      SUPABASE_JWKS_URL: 'https://proyecto.supabase.co/auth/v1/.well-known/jwks.json',
    });
    expect(config.puerto).toBe(8080);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => cargarConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
