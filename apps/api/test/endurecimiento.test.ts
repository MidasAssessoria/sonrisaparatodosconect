import { randomUUID } from 'node:crypto';
import { paginaAuditoriaSchema, sedeSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicioBd } from '../src/base/servicio-bd.js';
import type { DatoRegistro, Registro } from '../src/comun/registro.js';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  leerSesion,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

const ORIGEN_WEB = 'https://app.conecta.test';

describe('cabeceras de seguridad y CORS', () => {
  let prueba: Prueba;

  beforeAll(async () => {
    prueba = await crearPrueba({ config: { webOrigenes: [ORIGEN_WEB] } });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('manda cabeceras de seguridad, sin caché y con id de pedido', async () => {
    const respuesta = await prueba.pedir('get', '/salud').expect(200);
    expect(respuesta.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    expect(respuesta.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(respuesta.headers['content-security-policy']).toBeDefined();
    expect(respuesta.headers['x-powered-by']).toBeUndefined();
    expect(respuesta.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CORS solo para WEB_ORIGIN, con las cabeceras que usa la web', async () => {
    const permitido = await prueba.pedir('get', '/salud').set('Origin', ORIGEN_WEB).expect(200);
    expect(permitido.headers['access-control-allow-origin']).toBe(ORIGEN_WEB);

    const ajeno = await prueba
      .pedir('get', '/salud')
      .set('Origin', 'https://malo.example')
      .expect(200);
    expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();

    const previo = await prueba
      .pedir('get', '/sedes')
      .set('Origin', ORIGEN_WEB)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-clinica-id');
    // supertest no tiene .options() en el ayudante: se arma el preflight a mano.
    expect(previo.status).toBeLessThan(500);
    const { default: request } = await import('supertest');
    const preflight = await request(prueba.servidor())
      .options('/api/v1/sedes')
      .set('Origin', ORIGEN_WEB)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-clinica-id');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(ORIGEN_WEB);
    expect(String(preflight.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'x-clinica-id',
    );
    const preflightAjeno = await request(prueba.servidor())
      .options('/api/v1/sedes')
      .set('Origin', 'https://malo.example')
      .set('Access-Control-Request-Method', 'DELETE');
    expect(preflightAjeno.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('límite de pedidos por IP', () => {
  let prueba: Prueba;

  beforeAll(async () => {
    prueba = await crearPrueba({ config: { limitePedidosPorMinuto: 5, trustProxy: 1 } });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('después del límite responde 429 demasiados_pedidos con Retry-After; cada IP cuenta aparte; /salud no cuenta', async () => {
    const desde = (ip: string) => prueba.pedir('get', '/sedes').set('X-Forwarded-For', ip);
    for (let i = 0; i < 5; i++) await desde('198.51.100.1').expect(401);
    const bloqueado = await esperarError(desde('198.51.100.1'), 429, 'demasiados_pedidos');
    expect((bloqueado.body as { mensaje: string }).mensaje).toMatch(/demasiados pedidos/);
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(bloqueado.headers['retry-after'])).toBeLessThanOrEqual(60);

    await desde('198.51.100.2').expect(401);
    for (let i = 0; i < 10; i++) {
      await prueba.pedir('get', '/salud').set('X-Forwarded-For', '198.51.100.1').expect(200);
    }
  });
});

describe('límite de pedidos por usuario', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba({
      config: {
        limitePedidosPorUsuario: 4,
        limitePedidosPorMinuto: 1_000,
        trustProxy: 1,
        webOrigenes: [ORIGEN_WEB],
      },
    });
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('cuenta por usuario aunque cambie de IP, con Retry-After expuesto por CORS; otro usuario sigue', async () => {
    const token = await a.dueno.token();
    for (let i = 0; i < 4; i++) {
      await prueba
        .pedir('get', '/sedes', { token })
        .set('X-Forwarded-For', `198.51.100.${String(10 + i)}`)
        .expect(200);
    }
    const bloqueado = await esperarError(
      prueba
        .pedir('get', '/sedes', { token })
        .set('X-Forwarded-For', '198.51.100.99')
        .set('Origin', ORIGEN_WEB),
      429,
      'demasiados_pedidos',
    );
    const espera = Number(bloqueado.headers['retry-after']);
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(60);
    expect(bloqueado.headers['access-control-allow-origin']).toBe(ORIGEN_WEB);
    expect(String(bloqueado.headers['access-control-expose-headers']).toLowerCase()).toContain(
      'retry-after',
    );
    // También con otro token del mismo usuario (otra sesión), y también para cerrar sesión.
    await esperarError(
      prueba.pedir('get', '/sesion', {
        token: await a.dueno.token('aal2', { sesion: randomUUID() }),
      }),
      429,
      'demasiados_pedidos',
    );
    await esperarError(
      prueba.pedir('post', '/sesion/cerrar', { token }),
      429,
      'demasiados_pedidos',
    );

    // Otra persona desde la misma IP no se ve afectada.
    const otra = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await prueba
      .pedir('get', '/sedes', { token: await otra.token() })
      .set('X-Forwarded-For', '198.51.100.99')
      .expect(200);
  });

  it('el 429 por usuario llega antes de tocar la base (sin ingresos ni sesiones nuevas)', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    for (let i = 0; i < 4; i++) {
      await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200);
    }
    const nueva = randomUUID();
    await esperarError(
      prueba.pedir('get', '/sesion', { token: await persona.token('aal1', { sesion: nueva }) }),
      429,
      'demasiados_pedidos',
    );
    expect(await leerSesion(prueba, a.clinicaId, persona.usuarioId, nueva)).toBeNull();
  });
});

describe('IP del cliente y TRUST_PROXY', () => {
  async function ipAuditada(prueba: Prueba, a: Clinica, xff: string): Promise<string | null> {
    const token = await a.dueno.token();
    const sede = segun(
      sedeSchema,
      (
        await prueba
          .pedir('post', '/sedes', {
            token,
            cuerpo: { nombre: `IP ${xff.slice(0, 20)} ${Date.now()}` },
          })
          .set('X-Forwarded-For', xff)
          .expect(201)
      ).body,
    );
    const pagina = segun(
      paginaAuditoriaSchema,
      (await prueba.pedir('get', `/auditoria?entidadId=${sede.id}`, { token }).expect(200)).body,
    );
    return pagina.items[0]?.ip ?? null;
  }

  it('sin TRUST_PROXY, X-Forwarded-For se ignora', async () => {
    const prueba = await crearPrueba({ config: { trustProxy: false } });
    try {
      const a = await crearClinica(prueba, { sedes: 0 });
      expect(await ipAuditada(prueba, a, '203.0.113.7')).toMatch(/127\.0\.0\.1|::1/);
    } finally {
      await prueba.cerrar();
    }
  });

  it('con TRUST_PROXY, se toma de X-Forwarded-For; un valor que no es IP se descarta', async () => {
    const prueba = await crearPrueba({ config: { trustProxy: 1 } });
    try {
      const a = await crearClinica(prueba, { sedes: 0 });
      expect(await ipAuditada(prueba, a, '203.0.113.7')).toBe('203.0.113.7');
      expect(await ipAuditada(prueba, a, '10.0.0.1, 203.0.113.9')).toBe('203.0.113.9');
      expect(await ipAuditada(prueba, a, 'no-es-una-ip')).toBeNull();
    } finally {
      await prueba.cerrar();
    }
  });
});

describe('registro (logs)', () => {
  it('una línea por pedido con id y patrón de ruta; sin correos, cuerpos ni ids de la URL', async () => {
    const lineas: { nivel: string; evento: string; datos: Record<string, DatoRegistro> }[] = [];
    const registro: Registro = {
      info: (evento, datos = {}) => lineas.push({ nivel: 'info', evento, datos }),
      advertencia: (evento, datos = {}) => lineas.push({ nivel: 'advertencia', evento, datos }),
      error: (evento, datos = {}) => lineas.push({ nivel: 'error', evento, datos }),
    };
    const prueba = await crearPrueba({ registro });
    try {
      const a = await crearClinica(prueba, { sedes: 1 });
      const email = 'paciente.secreta@correo.test';
      const token = await prueba.token({ sub: a.duenoId, email, aal: 'aal2' });
      const sede = segun(
        sedeSchema,
        (
          await prueba
            .pedir('post', '/sedes', {
              token,
              cuerpo: { nombre: 'Consultorio Dra. Pérez', direccion: 'Calle Privada 99' },
            })
            .expect(201)
        ).body,
      );
      await prueba
        .pedir('get', `/sedes/${sede.id}?nota=${encodeURIComponent(email)}`, { token })
        .set('X-Request-Id', 'pedido-0001')
        .expect(200);
      await prueba
        .pedir('get', `/auditoria?entidad=sede&usuarioId=${a.duenoId}`, { token })
        .expect(200);
      await prueba.pedir('get', `/fuera/${encodeURIComponent(email)}`).expect(404);

      const texto = JSON.stringify(lineas);
      for (const prohibido of [
        email,
        'Consultorio',
        'Pérez',
        'Calle Privada',
        sede.id,
        a.duenoId,
        a.clinicaId,
        token.split('.')[1] ?? 'token',
      ]) {
        expect(texto).not.toContain(prohibido);
      }
      const pedidos = lineas.filter((l) => l.evento === 'pedido');
      expect(pedidos.map((l) => l.datos['ruta'])).toEqual([
        '/api/v1/sedes',
        '/api/v1/sedes/:id',
        '/api/v1/auditoria',
        '(sin ruta)',
      ]);
      expect(pedidos[1]?.datos).toMatchObject({
        pedido: 'pedido-0001',
        metodo: 'GET',
        estado: 200,
      });
      expect(typeof pedidos[1]?.datos['ms']).toBe('number');
    } finally {
      await prueba.cerrar();
    }
  });
});

describe('cierre ordenado', () => {
  it('al cerrar la app se cierra el pool de la base', async () => {
    const prueba = await crearPrueba();
    const bd = prueba.app.get(ServicioBd);
    const pool = (bd as unknown as { pool: { ending: boolean; totalCount: number } }).pool;
    await prueba.pedir('get', '/sesion', {
      token: await prueba.token({ sub: crypto.randomUUID() }),
    });
    expect(pool.ending).toBe(false);
    await prueba.cerrar();
    expect(pool.ending).toBe(true);
    expect(pool.totalCount).toBe(0);
  });
});
