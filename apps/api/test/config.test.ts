import { describe, expect, it } from 'vitest';
import { cargarConfig, ErrorDeConfiguracion } from '../src/config.js';

const PRODUCCION = {
  NODE_ENV: 'production',
  PORT: '8080',
  DATABASE_URL: 'postgresql://app_api:x@db.example.com:5432/conecta',
  SUPABASE_URL: 'https://proyecto.supabase.co/',
  SUPABASE_JWKS_URL: 'https://proyecto.supabase.co/auth/v1/.well-known/jwks.json',
  WEB_ORIGIN: 'https://app.example.com, https://staging.example.com',
};

describe('cargarConfig', () => {
  it('usa valores por defecto en test', () => {
    const config = cargarConfig({ NODE_ENV: 'test' });
    expect(config.entorno).toBe('test');
    expect(config.databaseUrl).toMatch(/^postgres:\/\//);
    expect(config.trustProxy).toBe(false);
    expect(config.limitePedidosPorMinuto).toBeGreaterThan(0);
  });

  it('en producción falla y nombra cada variable que falta', () => {
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(ErrorDeConfiguracion);
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL: falta[\s\S]*SUPABASE_URL: falta[\s\S]*SUPABASE_JWKS_URL: falta[\s\S]*WEB_ORIGIN: falta/,
    );
  });

  it('en producción acepta una configuración completa', () => {
    const config = cargarConfig(PRODUCCION);
    expect(config.puerto).toBe(8080);
    expect(config.emisorJwt).toBe('https://proyecto.supabase.co/auth/v1');
    expect(config.webOrigenes).toEqual(['https://app.example.com', 'https://staging.example.com']);
    expect(config.trustProxy).toBe(false);
    expect(config.limitePedidosPorMinuto).toBe(300);
  });

  it('TRUST_PROXY acepta true, false o una cantidad de proxies', () => {
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'si' })).toThrow(/TRUST_PROXY/);
  });

  it('rechaza un WEB_ORIGIN que no es una URL', () => {
    expect(() => cargarConfig({ ...PRODUCCION, WEB_ORIGIN: '*' })).toThrow(/WEB_ORIGIN/);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => cargarConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
