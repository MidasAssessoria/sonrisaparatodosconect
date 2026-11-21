/**
 * `crearAdminAuthSupabase` (la implementación real, con `@supabase/supabase-js`) contra una imitación
 * local de la API de Supabase Auth (GoTrue): invitar por correo (con `redirect_to`), enlace de
 * ingreso, estado de confirmación, búsqueda por correo (paginada y recordada), códigos de error y
 * que la clave secreta nunca aparezca en un error. No reemplaza probar contra Supabase de verdad.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/errores/error-api.js';
import {
  crearAdminAuthSupabase,
  METADATO_INVITACION,
  type AdminAuth,
} from '../src/personal/admin-auth.js';

const CLAVE_SECRETA = 'sb_secret_prueba_no_es_real_0123456789';
const VUELTA = 'http://localhost:5173/invitacion?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

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
  confirmado: boolean;
  invitado: boolean;
  metadatos: Record<string, unknown>;
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

/** Imitación mínima de GoTrue: `/admin/users`, `/admin/users/:id`, `/invite` y `/otp`. */
async function imitacionGoTrue(): Promise<{
  url: string;
  usuarios: UsuarioGoTrue[];
  pedidos: Pedido[];
  caido: { valor: boolean };
  limiteCorreo: { valor: boolean };
  cerrar: () => Promise<void>;
}> {
  const usuarios: UsuarioGoTrue[] = [];
  const pedidos: Pedido[] = [];
  const caido = { valor: false };
  const limiteCorreo = { valor: false };
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
      const ahora = new Date().toISOString();
      const usuario = (u: UsuarioGoTrue) => ({
        id: u.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: u.email,
        ...(u.confirmado ? { email_confirmed_at: ahora, confirmed_at: ahora } : {}),
        ...(u.invitado ? { invited_at: ahora } : {}),
        app_metadata: {},
        user_metadata: u.metadatos,
        created_at: ahora,
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
      if (req.method === 'POST' && url.pathname === '/auth/v1/invite') {
        if (limiteCorreo.valor) {
          return json(429, {
            code: 'over_email_send_rate_limit',
            msg: 'email rate limit exceeded',
          });
        }
        const datos = cuerpo as { email: string; data?: Record<string, unknown> };
        const email = datos.email.toLowerCase();
        const existente = usuarios.find((u) => u.email === email);
        if (existente?.confirmado) {
          return json(422, {
            code: 'email_exists',
            msg: 'A user with this email address has already been registered',
          });
        }
        const invitado = existente ?? {
          id: randomUUID(),
          email,
          confirmado: false,
          invitado: true,
          metadatos: datos.data ?? {},
        };
        invitado.invitado = true;
        if (!existente) usuarios.push(invitado);
        return json(200, usuario(invitado));
      }
      if (req.method === 'POST' && url.pathname === '/auth/v1/otp') {
        const datos = cuerpo as { email: string; create_user: boolean };
        if (!usuarios.some((u) => u.email === datos.email) && !datos.create_user) {
          return json(422, { code: 'otp_disabled', msg: 'Signups not allowed for otp' });
        }
        return json(200, {});
      }
      const porId = url.pathname.startsWith(`${base}/`)
        ? url.pathname.slice(base.length + 1)
        : null;
      if (porId && req.method === 'GET') {
        const encontrado = usuarios.find((u) => u.id === porId);
        if (!encontrado) return json(404, { code: 'user_not_found', msg: 'User not found' });
        return json(200, usuario(encontrado));
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
    limiteCorreo,
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

describe('AdminAuth con supabase-js (contra una imitación de GoTrue)', () => {
  let gotrue: Awaited<ReturnType<typeof imitacionGoTrue>>;
  let adminAuth: AdminAuth;

  const agregar = (email: string, opciones: Partial<UsuarioGoTrue> = {}): UsuarioGoTrue => {
    const u = {
      id: randomUUID(),
      email,
      confirmado: true,
      invitado: false,
      metadatos: {},
      ...opciones,
    };
    gotrue.usuarios.push(u);
    return u;
  };

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
    gotrue.limiteCorreo.valor = false;
  });

  it('invita por correo con redirect_to, la marca de la invitación y la clave secreta en las cabeceras', async () => {
    expect(await adminAuth.invitarPorCorreo('Nueva@Prueba.test', VUELTA)).toBe('enviada');
    const pedido = gotrue.pedidos.find((p) => p.ruta === '/auth/v1/invite');
    expect(pedido?.metodo).toBe('POST');
    expect(pedido?.consulta.get('redirect_to')).toBe(VUELTA);
    expect(pedido?.cuerpo).toEqual({
      email: 'nueva@prueba.test',
      data: { [METADATO_INVITACION]: true },
    });
    expect(pedido?.apikey).toBe(CLAVE_SECRETA);
    expect(pedido?.autorizacion).toBe(`Bearer ${CLAVE_SECRETA}`);

    const cuenta = await adminAuth.buscarPorCorreo('nueva@prueba.test');
    expect(cuenta).toMatchObject({
      email: 'nueva@prueba.test',
      confirmada: false,
      nacidaPorInvitacion: true,
    });
    // Sin confirmar: invitar otra vez la reenvía.
    expect(await adminAuth.invitarPorCorreo('nueva@prueba.test', VUELTA)).toBe('enviada');
  });

  it('correo con cuenta confirmada → ya_confirmada (no se manda nada); límite de correos → 503', async () => {
    agregar('confirmada@prueba.test');
    expect(await adminAuth.invitarPorCorreo('confirmada@prueba.test', VUELTA)).toBe(
      'ya_confirmada',
    );
    gotrue.limiteCorreo.valor = true;
    const e = await errorDe(adminAuth.invitarPorCorreo('otra@prueba.test', VUELTA));
    expect(e.estado).toBe(503);
    expect(e.message).toMatch(/no se guardó/);
    expect(JSON.stringify(e.cuerpo())).not.toMatch(/rate|limit|sb_secret/i);
  });

  it('obtiene una cuenta por id con su estado de confirmación; un id desconocido → null', async () => {
    const u = agregar('por-id@prueba.test', { confirmado: false });
    expect(await adminAuth.obtenerCuenta(u.id)).toEqual({
      id: u.id,
      email: 'por-id@prueba.test',
      confirmada: false,
      nacidaPorInvitacion: false,
    });
    u.confirmado = true;
    expect((await adminAuth.obtenerCuenta(u.id))?.confirmada).toBe(true);
    expect(await adminAuth.obtenerCuenta(randomUUID())).toBeNull();
  });

  it('nacida por invitación: por invited_at o por la marca en los metadatos', async () => {
    const porMarca = agregar('marca@prueba.test', { metadatos: { [METADATO_INVITACION]: true } });
    const porInvitedAt = agregar('invited@prueba.test', { invitado: true });
    const propia = agregar('propia@prueba.test');
    expect((await adminAuth.obtenerCuenta(porMarca.id))?.nacidaPorInvitacion).toBe(true);
    expect((await adminAuth.obtenerCuenta(porInvitedAt.id))?.nacidaPorInvitacion).toBe(true);
    expect((await adminAuth.obtenerCuenta(propia.id))?.nacidaPorInvitacion).toBe(false);
  });

  it('busca por correo recorriendo páginas sin poner el correo en la URL, y después lo recuerda', async () => {
    for (let i = 0; i < 3; i++) agregar(`relleno-${String(i)}@prueba.test`);
    const buscada = agregar('buscada@prueba.test');
    // Otra instancia (sin nada recordado).
    const nueva = crearAdminAuthSupabase(gotrue.url, CLAVE_SECRETA, { porPagina: 2 });
    gotrue.pedidos.length = 0;
    expect(await nueva.buscarPorCorreo('BUSCADA@prueba.test')).toMatchObject({
      id: buscada.id,
      email: 'buscada@prueba.test',
      confirmada: true,
    });
    expect(await nueva.buscarPorCorreo('nadie@prueba.test')).toBeNull();
    const paginas = gotrue.pedidos.map((p) => p.consulta.get('page'));
    expect(new Set(paginas).size).toBeGreaterThan(2);
    for (const p of gotrue.pedidos) {
      expect(p.ruta).toBe('/auth/v1/admin/users');
      expect(p.consulta.toString()).not.toMatch(/prueba\.test|buscada|nadie/i);
    }

    // La segunda vez: un solo pedido, por id.
    gotrue.pedidos.length = 0;
    expect((await nueva.buscarPorCorreo('buscada@prueba.test'))?.id).toBe(buscada.id);
    expect(gotrue.pedidos.map((p) => `${p.metodo} ${p.ruta}`)).toEqual([
      `GET /auth/v1/admin/users/${buscada.id}`,
    ]);

    // Si el correo de esa cuenta cambió, se vuelve a recorrer la lista.
    buscada.email = 'cambiada@prueba.test';
    gotrue.pedidos.length = 0;
    expect(await nueva.buscarPorCorreo('buscada@prueba.test')).toBeNull();
    expect(gotrue.pedidos.some((p) => p.ruta === '/auth/v1/admin/users')).toBe(true);
  });

  it('manda el enlace de ingreso (magic link) sin crear cuentas, con redirect_to', async () => {
    agregar('ingreso@prueba.test');
    await adminAuth.enviarEnlaceIngreso('Ingreso@Prueba.test', VUELTA);
    const pedido = gotrue.pedidos.find((p) => p.ruta === '/auth/v1/otp');
    expect(pedido?.consulta.get('redirect_to')).toBe(VUELTA);
    expect(pedido?.cuerpo).toMatchObject({ email: 'ingreso@prueba.test', create_user: false });
    const e = await errorDe(adminAuth.enviarEnlaceIngreso('nadie-otp@prueba.test', VUELTA));
    expect(e.estado).toBe(503);
  });

  it('Auth caído o inalcanzable → servicio_no_disponible, sin la clave en el error', async () => {
    gotrue.caido.valor = true;
    for (const operacion of [
      () => adminAuth.buscarPorCorreo('x@prueba.test'),
      () => adminAuth.obtenerCuenta(randomUUID()),
      () => adminAuth.invitarPorCorreo('x@prueba.test', VUELTA),
      () => adminAuth.enviarEnlaceIngreso('x@prueba.test', VUELTA),
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
