/**
 * Cuando falla algo de lo que depende la API (el JWKS de Supabase, la base de datos), la respuesta
 * es 503 `servicio_no_disponible`, nunca 401: un 401 hace que la web cierre la sesión de todos.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearVerificadorSupabase } from '../src/auth/verificador-jwt.js';
import { crearPrueba, esperarError, generarClaves, type Prueba } from './ayudas.js';

type Comportamiento = 'error500' | 'colgado' | 'json_roto' | 'ok';

/** JWKS de prueba por HTTP que se porta como se le pida. */
async function servidorJwks(claves: object): Promise<{
  url: string;
  fijar: (c: Comportamiento) => void;
  cerrar: () => Promise<void>;
}> {
  let comportamiento: Comportamiento = 'ok';
  const colgados = new Set<() => void>();
  const servidor: Server = createServer((_req, res) => {
    switch (comportamiento) {
      case 'error500':
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('fallo');
        return;
      case 'json_roto':
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"keys": [');
        return;
      case 'colgado':
        // No responde nunca (hasta que se cierra el servidor).
        colgados.add(() => res.destroy());
        return;
      case 'ok':
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(claves));
    }
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/auth/v1/.well-known/jwks.json`,
    fijar: (c) => (comportamiento = c),
    cerrar: async () => {
      for (const soltar of colgados) soltar();
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}

describe('JWKS de Supabase que falla', () => {
  let jwks: Awaited<ReturnType<typeof servidorJwks>>;
  let firmar: (aal?: string) => Promise<string>;
  let emisor: string;

  beforeAll(async () => {
    const par = await generarClaves('ES256', 'clave-remota');
    jwks = await servidorJwks({ keys: [par.publica] });
    // Un emisor cualquiera: alcanza con que el verificador y el token coincidan.
    emisor = 'http://127.0.0.1:54321/auth/v1';
    const { SignJWT } = await import('jose');
    firmar = (aal = 'aal1') =>
      new SignJWT({ aal, session_id: randomUUID() })
        .setProtectedHeader({ alg: 'ES256', kid: 'clave-remota', typ: 'JWT' })
        .setSubject(randomUUID())
        .setIssuer(emisor)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(par.privada);
  });

  afterAll(async () => {
    await jwks.cerrar();
  });

  it('JWKS que responde 500, JSON roto o no responde → 503 servicio_no_disponible', async () => {
    for (const comportamiento of ['error500', 'json_roto'] as const) {
      jwks.fijar(comportamiento);
      // Un verificador nuevo por caso: sin caché de una consulta anterior.
      const verificador = crearVerificadorSupabase(jwks.url, emisor);
      await expect(verificador.verificar(await firmar())).rejects.toMatchObject({
        estado: 503,
        codigo: 'servicio_no_disponible',
      });
    }
  });

  it('de punta a punta: el 500 del JWKS llega como 503, y con el JWKS sano el mismo token pasa', async () => {
    jwks.fijar('error500');
    const verificador = crearVerificadorSupabase(jwks.url, emisor);
    const prueba: Prueba = await crearPrueba({ verificador, config: { emisorJwt: emisor } });
    try {
      const token = await firmar();
      const respuesta = await esperarError(
        prueba.pedir('get', '/sesion', { token }),
        503,
        'servicio_no_disponible',
      );
      expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/Probá de nuevo/);

      jwks.fijar('ok');
      // Usuario desconocido para la base: lo importante es que el token se verificó.
      await esperarError(prueba.pedir('get', '/sesion', { token }), 403, 'sin_membresia');
    } finally {
      await prueba.cerrar();
    }
  });

  it('un token inválido con el JWKS sano sigue siendo 401', async () => {
    jwks.fijar('ok');
    const verificador = crearVerificadorSupabase(jwks.url, emisor);
    const otro = await generarClaves('ES256', 'clave-remota');
    const { SignJWT } = await import('jose');
    const falso = await new SignJWT({ session_id: randomUUID() })
      .setProtectedHeader({ alg: 'ES256', kid: 'clave-remota' })
      .setSubject(randomUUID())
      .setIssuer(emisor)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(otro.privada);
    await expect(verificador.verificar(falso)).rejects.toMatchObject({
      estado: 401,
      codigo: 'no_autenticado',
    });
  });

  it('JWKS que no responde → 503 (tras el tiempo de espera)', async () => {
    jwks.fijar('colgado');
    const { createRemoteJWKSet } = await import('jose');
    const { crearVerificadorJwt } = await import('../src/auth/verificador-jwt.js');
    // Mismo verificador que en producción, con un tiempo de espera corto para la prueba.
    const verificador = crearVerificadorJwt(
      createRemoteJWKSet(new URL(jwks.url), { timeoutDuration: 300 }),
      { emisor },
    );
    await expect(verificador.verificar(await firmar())).rejects.toMatchObject({
      estado: 503,
      codigo: 'servicio_no_disponible',
    });
  });
});

describe('base de datos caída', () => {
  let prueba: Prueba;

  beforeAll(async () => {
    // Un puerto donde no escucha nadie.
    prueba = await crearPrueba({
      config: { databaseUrl: 'postgres://app_api:x@127.0.0.1:9/conecta' },
    });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('un pedido con sesión → 503 servicio_no_disponible, no 401 ni 500', async () => {
    const token = await prueba.token({ sub: randomUUID() });
    const respuesta = await esperarError(
      prueba.pedir('get', '/sesion', { token }),
      503,
      'servicio_no_disponible',
    );
    expect(JSON.stringify(respuesta.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|postgres/);
    await esperarError(
      prueba.pedir('post', '/sesion/cerrar', { token }),
      503,
      'servicio_no_disponible',
    );
    // Lo que no necesita la base sigue andando.
    await prueba.pedir('get', '/salud').expect(200);
  });
});
