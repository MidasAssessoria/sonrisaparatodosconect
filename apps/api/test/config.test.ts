import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarConfig, ErrorDeConfiguracion } from '../src/config.js';

const PRODUCCION = {
  NODE_ENV: 'production',
  PORT: '8080',
  DATABASE_URL: 'postgresql://app_api:x@db.example.com:5432/conecta',
  SUPABASE_URL: 'https://proyecto.supabase.co/',
  SUPABASE_JWKS_URL: 'https://proyecto.supabase.co/auth/v1/.well-known/jwks.json',
  WEB_ORIGIN: 'https://app.example.com, https://staging.example.com',
  TRUST_PROXY: '1',
  ARCHIVOS_ALMACEN: 'supabase',
  ARCHIVOS_DIRECTORIO: '/var/conecta/archivos',
  ARCHIVOS_FIRMA_SECRETO: 'x'.repeat(40),
  SUPABASE_SECRET_KEY: 'sb_secret_' + 'y'.repeat(30),
};

/** Producción completa salvo TRUST_PROXY. */
const PRODUCCION_SIN_PROXY: Record<string, string> = Object.fromEntries(
  Object.entries(PRODUCCION).filter(([clave]) => clave !== 'TRUST_PROXY'),
);

const RAIZ_API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Arranca `src/main.ts` con un entorno controlado (sin heredar el del proceso) y espera que termine. */
function arrancarApi(
  entorno: Record<string, string>,
): Promise<{ codigo: number | null; salida: string }> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(
      process.execPath,
      [
        '--conditions=@conecta/source',
        '--import',
        '@swc-node/register/esm-register',
        'src/main.ts',
      ],
      {
        cwd: RAIZ_API,
        env: {
          // Lo mínimo para que Node corra en cualquier sistema; nada de la configuración del proceso.
          ...(process.env['PATH'] ? { PATH: process.env['PATH'] } : {}),
          ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
          ...entorno,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let salida = '';
    hijo.stdout.on('data', (d: Buffer) => (salida += d.toString('utf8')));
    hijo.stderr.on('data', (d: Buffer) => (salida += d.toString('utf8')));
    const limite = setTimeout(() => {
      hijo.kill();
      rechazar(new Error(`La API no terminó a tiempo. Salida:\n${salida}`));
    }, 60_000);
    hijo.on('error', rechazar);
    hijo.on('exit', (codigo) => {
      clearTimeout(limite);
      resolver({ codigo, salida });
    });
  });
}

describe('cargarConfig', () => {
  it('usa valores por defecto en test', () => {
    const config = cargarConfig({ NODE_ENV: 'test' });
    expect(config.entorno).toBe('test');
    expect(config.databaseUrl).toMatch(/^postgres:\/\//);
    expect(config.trustProxy).toBe(false);
    expect(config.limitePedidosPorMinuto).toBeGreaterThan(0);
    expect(config.limitePedidosPorUsuario).toBeGreaterThan(0);
  });

  it('en desarrollo TRUST_PROXY tiene valor por defecto (false)', () => {
    expect(cargarConfig({ NODE_ENV: 'development' }).trustProxy).toBe(false);
  });

  it('en producción falla y nombra cada variable que falta', () => {
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(ErrorDeConfiguracion);
    expect(() => cargarConfig({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL: falta[\s\S]*SUPABASE_URL: falta[\s\S]*SUPABASE_JWKS_URL: falta[\s\S]*WEB_ORIGIN: falta[\s\S]*TRUST_PROXY: falta/,
    );
  });

  it('en producción TRUST_PROXY es obligatorio y el error explica por qué', () => {
    for (const entorno of [PRODUCCION_SIN_PROXY, { ...PRODUCCION_SIN_PROXY, TRUST_PROXY: '' }]) {
      let mensaje = '';
      try {
        cargarConfig(entorno);
      } catch (error) {
        expect(error).toBeInstanceOf(ErrorDeConfiguracion);
        mensaje = (error as Error).message;
      }
      expect(mensaje).toMatch(/TRUST_PROXY: falta/);
      expect(mensaje).toMatch(/proxy/);
      expect(mensaje).toMatch(/límite de pedidos/);
      expect(mensaje).toMatch(/IP del proxy/);
      // Solo esa variable: el resto está bien.
      expect(mensaje.match(/^- /gm)).toHaveLength(1);
    }
  });

  it('en producción acepta una configuración completa', () => {
    const config = cargarConfig(PRODUCCION);
    expect(config.puerto).toBe(8080);
    expect(config.emisorJwt).toBe('https://proyecto.supabase.co/auth/v1');
    expect(config.webOrigenes).toEqual(['https://app.example.com', 'https://staging.example.com']);
    expect(config.trustProxy).toBe(1);
    expect(config.limitePedidosPorMinuto).toBe(300);
    expect(config.limitePedidosPorUsuario).toBe(120);
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('TRUST_PROXY acepta true, false o una cantidad de proxies', () => {
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => cargarConfig({ ...PRODUCCION, TRUST_PROXY: 'si' })).toThrow(/TRUST_PROXY/);
  });

  it('RATE_LIMIT_USER_PER_MINUTE se puede ajustar y se valida', () => {
    expect(
      cargarConfig({ ...PRODUCCION, RATE_LIMIT_USER_PER_MINUTE: '60' }).limitePedidosPorUsuario,
    ).toBe(60);
    expect(() => cargarConfig({ ...PRODUCCION, RATE_LIMIT_USER_PER_MINUTE: '0' })).toThrow(
      /RATE_LIMIT_USER_PER_MINUTE/,
    );
  });

  it('en producción los archivos se configuran explícitamente', () => {
    const sinSecreto: Record<string, string> = { ...PRODUCCION };
    delete sinSecreto['ARCHIVOS_FIRMA_SECRETO'];
    expect(() => cargarConfig(sinSecreto)).toThrow(/ARCHIVOS_FIRMA_SECRETO/);
    expect(() => cargarConfig({ ...PRODUCCION, ARCHIVOS_FIRMA_SECRETO: 'corto' })).toThrow(/32/);
    expect(cargarConfig(PRODUCCION).archivos.almacen).toBe('supabase');
  });

  it('fuera de producción usa el almacén local y la clave secreta es opcional', () => {
    const config = cargarConfig({ NODE_ENV: 'development' });
    expect(config.archivos.almacen).toBe('local');
    expect(config.supabaseSecretKey).toBeUndefined();
  });

  it('rechaza un WEB_ORIGIN que no es una URL', () => {
    expect(() => cargarConfig({ ...PRODUCCION, WEB_ORIGIN: '*' })).toThrow(/WEB_ORIGIN/);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => cargarConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});

describe('arranque', () => {
  it('en producción sin TRUST_PROXY la API no arranca y dice por qué', async () => {
    const { codigo, salida } = await arrancarApi(PRODUCCION_SIN_PROXY);
    expect(codigo).toBe(1);
    expect(salida).toMatch(/TRUST_PROXY: falta/);
    expect(salida).toMatch(/IP del proxy/);
    expect(salida).not.toMatch(/API escuchando/);
  });
});
