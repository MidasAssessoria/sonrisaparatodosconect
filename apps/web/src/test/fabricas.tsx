import type { Accion, Modulo, Permiso, Sede, Sesion } from '@conecta/shared';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../App.js';
import type {
  FactorTotp,
  InscripcionTotp,
  NivelAutenticacion,
  ServicioAuth,
  SesionAuth,
} from '../auth/servicioAuth.js';

/** UUID v4 válido y legible: uuid(1) → 00000000-0000-4000-8000-000000000001. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const IDS = {
  usuario: uuid(1),
  clinicaA: uuid(10),
  clinicaB: uuid(11),
  sedeCentro: uuid(20),
  sedeNorte: uuid(21),
  rol: uuid(30),
  factor: uuid(40),
};

function todos(modulos: Modulo[], acciones: Accion[]): Permiso[] {
  return modulos.flatMap((modulo) => acciones.map((accion) => ({ modulo, accion })));
}

export const PERMISOS_DUENO: Permiso[] = todos(
  ['inicio', 'sedes', 'auditoria'],
  ['ver', 'crear', 'editar', 'anular', 'exportar'],
);

export const PERMISOS_RECEPCION: Permiso[] = [
  { modulo: 'inicio', accion: 'ver' },
  { modulo: 'sedes', accion: 'ver' },
];

export function sesionDe(parcial: Partial<Sesion> = {}): Sesion {
  return {
    usuario: {
      id: IDS.usuario,
      nombre: 'Lorena Fretes',
      email: 'lorena@ejemplo.test',
      mfaActivo: false,
    },
    nivelAutenticacion: 'aal1',
    debeActivarMfa: false,
    clinicas: [{ id: IDS.clinicaA, nombre: 'Clínica Prueba' }],
    clinica: { id: IDS.clinicaA, nombre: 'Clínica Prueba', zonaHoraria: 'America/Asuncion' },
    rol: { id: IDS.rol, codigo: 'dueno', nombre: 'Dueño' },
    permisos: PERMISOS_DUENO,
    sedes: [
      { id: IDS.sedeCentro, nombre: 'Centro', estado: 'abierta', color: null },
      { id: IDS.sedeNorte, nombre: 'Norte', estado: 'proxima', color: null },
    ],
    sedeDefectoId: IDS.sedeCentro,
    puedeVerTodasLasSedes: true,
    inactividadMin: 15,
    ...parcial,
  };
}

export function sedeDe(parcial: Partial<Sede> = {}): Sede {
  return {
    id: IDS.sedeCentro,
    nombre: 'Centro',
    direccion: 'Calle Uno 123',
    telefono: '021 000 000',
    estado: 'abierta',
    color: null,
    horarios: [],
    sillones: [],
    ...parcial,
  };
}

export interface OpcionesAuthFalso {
  conSesion?: boolean;
  nivel?: { actual: NivelAutenticacion; siguiente: NivelAutenticacion };
  factores?: FactorTotp[];
}

/** Servicio de autenticación falso con `vi.fn` en cada método. */
export function crearAuthFalso(op: OpcionesAuthFalso = {}) {
  const usuario: SesionAuth = { usuarioId: IDS.usuario, email: 'lorena@ejemplo.test' };
  const estado = {
    sesion: op.conSesion ? usuario : null,
    nivel: op.nivel ?? {
      actual: 'aal1' as NivelAutenticacion,
      siguiente: 'aal1' as NivelAutenticacion,
    },
    factores: op.factores ?? [],
  };
  const oyentes = new Set<(e: 'salio' | 'recuperacion') => void>();
  const auth = {
    estado,
    obtenerSesion: vi.fn(() => Promise.resolve(estado.sesion)),
    obtenerToken: vi.fn(() => Promise.resolve(estado.sesion ? 'token-de-prueba' : null)),
    iniciarSesion: vi.fn<(email: string, clave: string) => Promise<SesionAuth>>(() => {
      estado.sesion = usuario;
      return Promise.resolve(usuario);
    }),
    cerrarSesion: vi.fn(() => {
      estado.sesion = null;
      return Promise.resolve();
    }),
    enviarRecuperacion: vi.fn<(email: string, redirigirA: string) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    cambiarClave: vi.fn<(clave: string) => Promise<void>>(() => Promise.resolve()),
    nivel: vi.fn(() => Promise.resolve(estado.nivel)),
    factoresTotp: vi.fn(() => Promise.resolve(estado.factores)),
    verificarCodigo: vi.fn<(factorId: string, codigo: string) => Promise<void>>(() => {
      estado.nivel = { actual: 'aal2', siguiente: 'aal2' };
      return Promise.resolve();
    }),
    inscribirTotp: vi.fn<(nombre: string) => Promise<InscripcionTotp>>(() =>
      Promise.resolve({
        factorId: IDS.factor,
        qr: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>',
        secreto: 'ABCDEF123456',
        uri: 'otpauth://totp/Conecta',
      }),
    ),
    quitarFactor: vi.fn<(factorId: string) => Promise<void>>(() => Promise.resolve()),
    alCambiar: vi.fn((cb: (e: 'salio' | 'recuperacion') => void) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    }),
    emitir: (e: 'salio' | 'recuperacion') => oyentes.forEach((cb) => cb(e)),
  };
  return auth satisfies ServicioAuth & Record<string, unknown>;
}

export type AuthFalso = ReturnType<typeof crearAuthFalso>;

type Manejador = (pedido: {
  url: URL;
  cuerpo: unknown;
  cabeceras: Headers;
}) => { estado?: number; cuerpo?: unknown } | undefined;

export interface PedidoRegistrado {
  metodo: string;
  url: URL;
  cuerpo: unknown;
  cabeceras: Headers;
}

/**
 * `fetch` falso con rutas «MÉTODO /ruta». Si una ruta no está, responde 404 con el formato de la API.
 * `pedidos` guarda todo lo que se pidió.
 */
export function crearFetchFalso(
  rutas: Record<string, Manejador | { estado?: number; cuerpo?: unknown }>,
) {
  const pedidos: PedidoRegistrado[] = [];
  const fn = vi.fn((entrada: RequestInfo | URL, init?: RequestInit) => {
    const texto =
      typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const url = new URL(texto, 'http://localhost');
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const cabeceras = new Headers(init?.headers);
    const cuerpo: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidos.push({ metodo, url, cuerpo, cabeceras });
    const ruta = url.pathname.replace(/^\/api\/v1/, '');
    const clave = `${metodo} ${ruta}`;
    const manejador =
      rutas[clave] ??
      Object.entries(rutas).find(([patron]) => {
        const re = new RegExp(`^${patron.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
        return re.test(clave);
      })?.[1];
    const r = typeof manejador === 'function' ? manejador({ url, cuerpo, cabeceras }) : manejador;
    if (!r) {
      return Promise.resolve(
        Response.json({ codigo: 'no_encontrado', mensaje: 'No existe.' }, { status: 404 }),
      );
    }
    const estado = r.estado ?? 200;
    if (estado === 204) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json(r.cuerpo ?? null, { status: estado }));
  });
  return { fetch: fn as unknown as typeof fetch, pedidos };
}

export function renderApp({
  auth,
  fetch: fetchFalso,
  ruta = '/',
}: {
  auth: AuthFalso;
  fetch: typeof globalThis.fetch;
  ruta?: string;
}) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <App servicios={{ auth, fetch: fetchFalso }} />
    </MemoryRouter>,
  );
}
