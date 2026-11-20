import {
  ACCIONES,
  MODULOS,
  type Accion,
  type Modulo,
  type Permiso,
  type Sede,
  type Sesion,
} from '@conecta/shared';
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
import { registrarRutaNoSimulada } from './rutasNoSimuladas.js';

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
  rolRecepcion: uuid(31),
  rolAdministracion: uuid(32),
  rolLectura: uuid(33),
  factor: uuid(40),
};

function matriz(filas: [Modulo, Accion[]][]): Permiso[] {
  return filas.flatMap(([modulo, acciones]) => acciones.map((accion) => ({ modulo, accion })));
}

/*
 * Matriz inicial de cada rol de sistema, igual a `packages/db/migraciones/0005_alta_clinica.sql`.
 * Si la migración cambia, cambiá esto también.
 */

/** dueno: todos los módulos y todas las acciones. */
export const PERMISOS_DUENO: Permiso[] = matriz(MODULOS.map((m) => [m, [...ACCIONES]]));

export const PERMISOS_ADMINISTRACION: Permiso[] = matriz([
  ['inicio', ['ver']],
  ['agenda', ['ver']],
  ['pacientes', ['ver']],
  ['presupuestos', ['ver']],
  ['caja', ['ver', 'anular', 'exportar']],
  ['contabilidad', ['ver', 'crear', 'editar', 'anular', 'exportar']],
  ['reportes', ['ver', 'exportar']],
  ['personal', ['ver', 'crear', 'editar', 'anular']],
  ['inventario', ['ver', 'exportar']],
  ['mensajeria', ['ver', 'editar']],
  ['sedes', ['ver', 'crear', 'editar', 'anular']],
  ['auditoria', ['ver']],
  ['configuracion', ['ver', 'editar']],
]);

/** recepcion: sin Sedes ni Auditoría. */
export const PERMISOS_RECEPCION: Permiso[] = matriz([
  ['inicio', ['ver']],
  ['agenda', ['ver', 'crear', 'editar', 'anular']],
  ['pacientes', ['ver', 'crear', 'editar']],
  ['presupuestos', ['ver']],
  ['caja', ['ver', 'crear', 'editar']],
  ['mensajeria', ['ver', 'crear']],
]);

/**
 * Rol propio de una clínica (no es de sistema): solo mira las sedes. Ningún rol de sistema tiene
 * `sedes:ver` sin poder editar; sirve para probar la pantalla en solo lectura.
 */
export const PERMISOS_LECTURA_SEDES: Permiso[] = matriz([
  ['inicio', ['ver']],
  ['sedes', ['ver']],
]);

export const ROL_DUENO = { id: IDS.rol, codigo: 'dueno', nombre: 'Dueño/a', exigeMfa: true };
export const ROL_RECEPCION = {
  id: IDS.rolRecepcion,
  codigo: 'recepcion',
  nombre: 'Recepción y caja',
  exigeMfa: false,
};
export const ROL_LECTURA_SEDES = {
  id: IDS.rolLectura,
  codigo: 'consulta_sedes',
  nombre: 'Consulta de sedes',
  exigeMfa: false,
};

export function sesionDe(parcial: Partial<Sesion> = {}): Sesion {
  return {
    usuario: {
      id: IDS.usuario,
      nombre: 'Lorena Fretes',
      email: 'lorena@ejemplo.test',
      mfaActivo: true,
    },
    nivelAutenticacion: 'aal2',
    clinicas: [{ id: IDS.clinicaA, nombre: 'Clínica Prueba' }],
    clinica: { id: IDS.clinicaA, nombre: 'Clínica Prueba', zonaHoraria: 'America/Asuncion' },
    rol: ROL_DUENO,
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
    verificarCodigo: vi.fn<(factorId: string, codigo: string) => Promise<void>>((factorId) => {
      estado.nivel = { actual: 'aal2', siguiente: 'aal2' };
      // Verificar un factor recién inscripto lo deja activo.
      if (!estado.factores.some((f) => f.id === factorId)) {
        estado.factores = [
          ...estado.factores,
          { id: factorId, nombre: 'Conecta', verificado: true },
        ];
      }
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
    quitarFactor: vi.fn<(factorId: string) => Promise<void>>(() => {
      estado.factores = estado.factores.filter((f) => !f.verificado);
      return Promise.resolve();
    }),
    refrescarSesion: vi.fn(() => {
      // Sin factor verificado, el token nuevo es aal1.
      if (!estado.factores.some((f) => f.verificado)) {
        estado.nivel = { actual: 'aal1', siguiente: 'aal1' };
      }
      return Promise.resolve();
    }),
    alCambiar: vi.fn((cb: (e: 'salio' | 'recuperacion') => void) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    }),
    emitir: (e: 'salio' | 'recuperacion') => oyentes.forEach((cb) => cb(e)),
  };
  return auth satisfies ServicioAuth & Record<string, unknown>;
}

export type AuthFalso = ReturnType<typeof crearAuthFalso>;

export interface RespuestaFalsa {
  estado?: number;
  cuerpo?: unknown;
  cabeceras?: Record<string, string>;
}

type Manejador = (pedido: {
  url: URL;
  cuerpo: unknown;
  cabeceras: Headers;
}) => RespuestaFalsa | undefined | Promise<RespuestaFalsa | undefined>;

export interface PedidoRegistrado {
  metodo: string;
  url: URL;
  cuerpo: unknown;
  cabeceras: Headers;
}

/** Rutas que toda sesión puede tocar sin que cada prueba las declare. */
const RUTAS_POR_DEFECTO: Record<string, RespuestaFalsa> = {
  'POST /sesion/cerrar': { estado: 204 },
};

/**
 * `fetch` falso con rutas «MÉTODO /ruta» (con `:param`). Una ruta que la prueba no simuló
 * responde 500 y queda registrada: `setup.ts` hace fallar la prueba. `pedidos` guarda todo lo
 * que se pidió. Un manejador puede devolver una promesa (para respuestas tardías).
 */
export function crearFetchFalso(rutas: Record<string, Manejador | RespuestaFalsa>) {
  const pedidos: PedidoRegistrado[] = [];
  const todas: Record<string, Manejador | RespuestaFalsa> = { ...RUTAS_POR_DEFECTO, ...rutas };
  const fn = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
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
      todas[clave] ??
      Object.entries(todas).find(([patron]) => {
        const re = new RegExp(`^${patron.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
        return re.test(clave);
      })?.[1];
    if (!manejador) {
      registrarRutaNoSimulada(clave);
      return Response.json(
        { codigo: 'error_interno', mensaje: `Ruta no simulada en la prueba: ${clave}` },
        { status: 500 },
      );
    }
    const r =
      typeof manejador === 'function' ? await manejador({ url, cuerpo, cabeceras }) : manejador;
    if (!r) {
      registrarRutaNoSimulada(`${clave} (el manejador no respondió)`);
      return Response.json({ codigo: 'error_interno', mensaje: 'Sin respuesta.' }, { status: 500 });
    }
    const estado = r.estado ?? 200;
    const headers = new Headers(r.cabeceras);
    if (estado === 204) return new Response(null, { status: 204, headers });
    return Response.json(r.cuerpo ?? null, { status: estado, headers });
  });
  return { fetch: fn as unknown as typeof fetch, pedidos };
}

/** Promesa que se resuelve a mano (para simular respuestas tardías). */
export function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promesa, resolver };
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
