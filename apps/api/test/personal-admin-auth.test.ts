/**
 * `crearAdminAuthSupabase` (la implementación real, con `@supabase/supabase-js`) contra una imitación
 * local de la Admin API de Supabase Auth (GoTrue): rutas, paginación, códigos de error, compensación
 * y que la clave secreta nunca aparezca en un error. No reemplaza probar contra Supabase de verdad.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/errores/error-api.js';
import { crearAdminAuthSupabase, type AdminAuth } from '../src/personal/admin-auth.js';

const CLAVE_SECRETA = 'sb_secret_prueba_no_es_real_0123456789';

interface Pedido {
  metodo: string;
  ruta: string;
  consulta: URLSearchParams;
  apikey: string | undefined;
  autorizacion: string | undefined;
  cuerpo: unknown;
}

interface UsuarioGoTrue {
  id: string;
  email: string;
}

function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolver) => {
    let texto = '';
    req.on('data', (parte: Buffer) => (texto += parte.toString('utf8')));
    req.on('end', () => {
      try {
        resolver(texto ? JSON.parse(texto) : null);
      } catch {
        resolver(null);
      }
    });
  });
}

/** Imitación mínima de `/auth/v1/admin/users` de GoTrue. */
async function imitacionGoTrue(): Promise<{
  url: string;
  usuarios: UsuarioGoTrue[];
  pedidos: Pedido[];
  caido: { valor: boolean };
  cerrar: () => Promise<void>;
}> {
  const usuarios: UsuarioGoTrue[] = [];
  const pedidos: Pedido[] = [];
  const caido = { valor: false };
  const servidor: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const cuerpo = await leerCuerpo(req);
      pedidos.push({
        metodo: req.method ?? '',
        ruta: url.pathname,
        consulta: url.searchParams,
        apikey: req.headers['apikey'] as string | undefined,
        autorizacion: req.headers.authorization,
        cuerpo,
      });
      const json = (estado: number, datos: unknown, cabeceras: Record<string, string> = {}) => {
        res.writeHead(estado, {
          'Content-Type': 'application/json',
          'x-supabase-api-version': '2024-01-01',
          ...cabeceras,
        });
        res.end(JSON.stringify(datos));
      };
      if (caido.valor) return json(503, { code: 'unexpected_failure', msg: 'caído' });
      const usuario = (u: UsuarioGoTrue) => ({
        id: u.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: u.email,
        email_confirmed_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
      const base = '/auth/v1/admin/users';
      if (req.method === 'GET' && url.pathname === base) {
        const pagina = Number(url.searchParams.get('page') || '1');
        const porPagina = Number(url.searchParams.get('per_page') || '50');
        const desde = (pagina - 1) * porPagina;
        const ultima = Math.max(1, Math.ceil(usuarios.length / porPagina));
        const enlaces = [
          `</admin/users?page=${String(ultima)}&per_page=${String(porPagina)}>; rel="last"`,
        ];
        if (pagina < ultima) {
          enlaces.unshift(
            `</admin/users?page=${String(pagina + 1)}&per_page=${String(porPagina)}>; rel="next"`,
          );
        }
        return json(
          200,
          { aud: 'authenticated', users: usuarios.slice(desde, desde + porPagina).map(usuario) },
          { 'x-total-count': String(usuarios.length), link: enlaces.join(',') },
        );
      }
      if (req.method === 'POST' && url.pathname === base) {
        const datos = cuerpo as { email: string; password: string; email_confirm: boolean };
        if (usuarios.some((u) => u.email === datos.email.toLowerCase())) {
          return json(422, {
            code: 'email_exists',
            msg: 'A user with this email address has already been registered',
          });
        }
        if (datos.password === 'clave-debil-123') {
          return json(422, {
            code: 'weak_password',
            msg: 'Password is known to be weak',
            weak_password: { reasons: ['pwned'] },
          });
        }
        const nuevo = { id: randomUUID(), email: datos.email.toLowerCase() };
        usuarios.push(nuevo);
        return json(200, usuario(nuevo));
      }
      const porId = url.pathname.startsWith(`${base}/`)
        ? url.pathname.slice(base.length + 1)
        : null;
      if (porId) {
        const encontrado = usuarios.find((u) => u.id === porId);
        if (!encontrado) return json(404, { code: 'user_not_found', msg: 'User not found' });
        if (req.method === 'GET') return json(200, usuario(encontrado));
        if (req.method === 'DELETE') {
          usuarios.splice(usuarios.indexOf(encontrado), 1);
          return json(200, {});
        }
      }
      return json(404, { code: 'not_found', msg: 'no' });
    })();
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    usuarios,
    pedidos,
    caido,
    cerrar: async () => {
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error('No falló.');
}

describe('AdminAuth con supabase-js (contra una imitación de la Admin API)', () => {
  let gotrue: Awaited<ReturnType<typeof imitacionGoTrue>>;
  let adminAuth: AdminAuth;

  beforeAll(async () => {
    gotrue = await imitacionGoTrue();
    // Páginas de 2 para que la búsqueda por correo recorra varias.
    adminAuth = crearAdminAuthSupabase(gotrue.url, CLAVE_SECRETA, { porPagina: 2 });
  });

  afterAll(async () => {
    await gotrue.cerrar();
  });

  beforeEach(() => {
    gotrue.pedidos.length = 0;
    gotrue.caido.valor = false;
  });

  it('crea una cuenta confirmada con la clave secreta en las cabeceras', async () => {
    const cuenta = await adminAuth.crearCuentaConfirmada(
      'Nueva@Prueba.test',
      'una-clave-larga-123',
    );
    expect(cuenta.email).toBe('nueva@prueba.test');
    const pedido = gotrue.pedidos.find((p) => p.metodo === 'POST');
    expect(pedido?.ruta).toBe('/auth/v1/admin/users');
    expect(pedido?.cuerpo).toMatchObject({ email_confirm: true, password: 'una-clave-larga-123' });
    expect(pedido?.apikey).toBe(CLAVE_SECRETA);
    expect(pedido?.autorizacion).toBe(`Bearer ${CLAVE_SECRETA}`);
  });

  it('correo ya registrado → conflicto; clave débil → datos_invalidos; nada de Supabase en el mensaje', async () => {
    await adminAuth.crearCuentaConfirmada('repetida@prueba.test', 'una-clave-larga-123');
    const repetida = await errorDe(
      adminAuth.crearCuentaConfirmada('repetida@prueba.test', 'una-clave-larga-123'),
    );
    expect(repetida.cuerpo()).toMatchObject({ codigo: 'conflicto' });
    const debil = await errorDe(
      adminAuth.crearCuentaConfirmada('debil@prueba.test', 'clave-debil-123'),
    );
    expect(debil.cuerpo()).toMatchObject({ codigo: 'datos_invalidos' });
    for (const e of [repetida, debil]) {
      expect(JSON.stringify(e.cuerpo())).not.toMatch(/already|weak|pwned|sb_secret/i);
    }
  });

  it('busca por correo recorriendo páginas, sin poner el correo en la URL', async () => {
    for (let i = 0; i < 3; i++)
      gotrue.usuarios.push({ id: randomUUID(), email: `relleno-${String(i)}@prueba.test` });
    const cuenta = await adminAuth.crearCuentaConfirmada(
      'buscada@prueba.test',
      'una-clave-larga-123',
    );
    gotrue.pedidos.length = 0;
    expect(await adminAuth.buscarPorCorreo('BUSCADA@prueba.test')).toEqual(cuenta);
    expect(await adminAuth.buscarPorCorreo('nadie@prueba.test')).toBeNull();
    const paginas = gotrue.pedidos.map((p) => p.consulta.get('page'));
    expect(new Set(paginas).size).toBeGreaterThan(2);
    for (const p of gotrue.pedidos) {
      expect(p.ruta).toBe('/auth/v1/admin/users');
      expect(p.consulta.toString()).not.toMatch(/prueba\.test|buscada|nadie/i);
    }
  });

  it('borra una cuenta; si ya no existe, no falla', async () => {
    const cuenta = await adminAuth.crearCuentaConfirmada(
      'borrar@prueba.test',
      'una-clave-larga-123',
    );
    await adminAuth.borrarCuenta(cuenta.id);
    expect(gotrue.usuarios.some((u) => u.id === cuenta.id)).toBe(false);
    await adminAuth.borrarCuenta(cuenta.id);
    await adminAuth.borrarCuenta(randomUUID());
  });

  it('Auth caído o inalcanzable → servicio_no_disponible, sin la clave en el error', async () => {
    gotrue.caido.valor = true;
    for (const operacion of [
      () => adminAuth.buscarPorCorreo('x@prueba.test'),
      () => adminAuth.crearCuentaConfirmada('x@prueba.test', 'una-clave-larga-123'),
      () => adminAuth.borrarCuenta(randomUUID()),
    ]) {
      const e = await errorDe(operacion());
      expect(e.estado).toBe(503);
      expect(e.codigo).toBe('servicio_no_disponible');
      expect(`${e.message} ${String(e.stack)}`).not.toContain(CLAVE_SECRETA);
    }
    const inalcanzable = crearAdminAuthSupabase('http://127.0.0.1:9', CLAVE_SECRETA);
    const e = await errorDe(inalcanzable.buscarPorCorreo('x@prueba.test'));
    expect(e.codigo).toBe('servicio_no_disponible');
  });
});
