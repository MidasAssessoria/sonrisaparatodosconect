import type { Persona, Profesional, Sesion, Tratamiento } from '@conecta/shared';
import { vi } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  renderApp,
  sesionDe,
  uuid,
} from '../../test/fabricas.js';

/*
 * Ayudas de prueba de catálogos. Convendría mudarlas a `test/fabricas.tsx`.
 *
 * El cliente de catálogos (`api.ts`) usa el `fetch` global, así que además de pasárselo a la app
 * se reemplaza el global con el mismo `fetch` falso. Cada prueba tiene que llamar a
 * `vi.unstubAllGlobals()` en su `afterEach`.
 */

type Rutas = Parameters<typeof crearFetchFalso>[0];

export function montar(rutas: Rutas, ruta: string, sesion: Partial<Sesion> = {}) {
  const auth = crearAuthFalso({ conSesion: true });
  const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe(sesion) }, ...rutas });
  vi.stubGlobal('fetch', f.fetch);
  renderApp({ auth, fetch: f.fetch, ruta });
  return f;
}

export const IDS_CATALOGO = {
  acosta: uuid(500),
  rojas: uuid(501),
  sillonCentro: uuid(510),
  sedeAjena: uuid(520),
  bloqueo: uuid(530),
  membresiaGloria: uuid(540),
  limpieza: uuid(600),
  extraccion: uuid(601),
  blanqueamiento: uuid(602),
};

export function profesionalDe(parcial: Partial<Profesional> = {}): Profesional {
  return {
    id: IDS_CATALOGO.acosta,
    membresiaId: null,
    nombre: 'Dra. Marta Acosta',
    especialidad: 'Ortodoncia',
    color: '#2e9bec',
    registroProf: 'RP 1234',
    activo: true,
    disponibilidad: [],
    bloqueos: [],
    ...parcial,
  };
}

export function tratamientoDe(parcial: Partial<Tratamiento> = {}): Tratamiento {
  return {
    id: IDS_CATALOGO.limpieza,
    nombre: 'Limpieza dental',
    categoria: 'Prevención',
    precio: 150_000,
    iva: 10,
    duracionMin: 30,
    activo: true,
    ...parcial,
  };
}

export function personaDe(parcial: Partial<Persona> = {}): Persona {
  return {
    membresiaId: IDS_CATALOGO.membresiaGloria,
    usuarioId: uuid(541),
    nombre: 'Gloria Páez',
    email: 'gloria@ejemplo.test',
    telefono: null,
    rol: { id: IDS.rol, codigo: 'asistente', nombre: 'Asistente' },
    estado: 'activo',
    sedeIds: [IDS.sedeCentro],
    sedeDefectoId: IDS.sedeCentro,
    ultimoAcceso: null,
    mfaActivo: false,
    invitacionVenceEn: null,
    profesionalId: null,
    ...parcial,
  };
}
