import { type Accion, type Modulo, type Permiso, type Persona, type Rol } from '@conecta/shared';
import { vi } from 'vitest';
import {
  IDS,
  PERMISOS_DUENO,
  PERMISOS_RECEPCION,
  renderApp,
  uuid,
  type AuthFalso,
} from '../../test/fabricas.js';

/*
 * Ayudas de prueba de Equipo, Roles e Invitación. Candidatas a `test/fabricas.tsx`.
 *
 * Mientras el cliente de estos endpoints viva fuera de `api/cliente.ts` (ver `api.ts`), usa el
 * `fetch` global: `renderPersonal` lo reemplaza por el falso además de pasárselo a la app.
 */

export const IDS_PERSONAL = {
  ana: uuid(501),
  gloria: uuid(502),
  carlos: uuid(503),
  usuarioAna: uuid(601),
  usuarioCarlos: uuid(603),
  rolAsistente: uuid(34),
  rolPropio: uuid(35),
};

export function personaDe(parcial: Partial<Persona> = {}): Persona {
  return {
    membresiaId: IDS_PERSONAL.ana,
    usuarioId: IDS_PERSONAL.usuarioAna,
    nombre: 'Marta Acosta',
    email: 'marta@ejemplo.test',
    telefono: null,
    rol: { id: IDS.rolRecepcion, codigo: 'recepcion', nombre: 'Recepción y caja' },
    estado: 'activo',
    sedeIds: [IDS.sedeCentro],
    sedeDefectoId: IDS.sedeCentro,
    ultimoAcceso: '2026-11-19T12:05:00Z',
    mfaActivo: false,
    invitacionVenceEn: null,
    profesionalId: null,
    ...parcial,
  };
}

export function rolDe(parcial: Partial<Rol> = {}): Rol {
  return {
    id: IDS.rolRecepcion,
    codigo: 'recepcion',
    nombre: 'Recepción y caja',
    esSistema: true,
    activo: true,
    todasLasSedes: false,
    exigeMfa: false,
    inactividadMin: 30,
    permisos: PERMISOS_RECEPCION,
    personas: 2,
    ...parcial,
  };
}

export const ROL_DUENO_COMPLETO = rolDe({
  id: IDS.rol,
  codigo: 'dueno',
  nombre: 'Dueño/a',
  todasLasSedes: true,
  exigeMfa: true,
  inactividadMin: 15,
  permisos: PERMISOS_DUENO,
  personas: 1,
});

export function permisos(filas: [Modulo, Accion[]][]): Permiso[] {
  return filas.flatMap(([modulo, acciones]) => acciones.map((accion) => ({ modulo, accion })));
}

/** Solo mira el equipo (sin crear, editar ni anular). */
export const PERMISOS_SOLO_VER_EQUIPO = permisos([
  ['inicio', ['ver']],
  ['personal', ['ver']],
]);

export function renderPersonal(op: { auth: AuthFalso; fetch: typeof fetch; ruta: string }) {
  vi.stubGlobal('fetch', op.fetch);
  return renderApp(op);
}

/** `navigator.clipboard` falso (jsdom no lo trae). */
export function portapapelesFalso() {
  const writeText = vi.fn<(t: string) => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}
