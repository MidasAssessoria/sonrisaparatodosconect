import type { Modulo } from '@conecta/shared';
import type { IconoNombre } from '@conecta/ui';
import type { Textos } from './i18n/es.js';

/**
 * Registro de módulos que ya existen en la web. Para sumar uno: agregalo acá (con su ruta)
 * y su `<Route>` en `Rutas.tsx`. La navegación muestra solo los que el rol puede `ver`.
 */
export interface ModuloWeb {
  id: keyof Textos['modulos'];
  /** Módulo de permisos (`packages/shared/src/permisos.ts`). */
  modulo: Modulo;
  icono: IconoNombre;
  ruta: string;
}

export const MODULOS_WEB: readonly ModuloWeb[] = [
  { id: 'inicio', modulo: 'inicio', icono: 'inicio', ruta: '/' },
  { id: 'sedes', modulo: 'sedes', icono: 'sede', ruta: '/sedes' },
  { id: 'personal', modulo: 'personal', icono: 'personal', ruta: '/personal' },
  { id: 'profesionales', modulo: 'personal', icono: 'odontologia', ruta: '/profesionales' },
  { id: 'tratamientos', modulo: 'configuracion', icono: 'tabla', ruta: '/tratamientos' },
  { id: 'auditoria', modulo: 'auditoria', icono: 'archivo', ruta: '/auditoria' },
];

export type IdModuloWeb = ModuloWeb['id'];

export function modulosVisibles(puede: (m: Modulo, a: 'ver') => boolean): ModuloWeb[] {
  return MODULOS_WEB.filter((m) => puede(m.modulo, 'ver'));
}

/** Módulo activo según la ruta actual. */
export function moduloDeRuta(pathname: string): IdModuloWeb | undefined {
  const candidatos = MODULOS_WEB.filter((m) =>
    m.ruta === '/' ? pathname === '/' : pathname === m.ruta || pathname.startsWith(`${m.ruta}/`),
  );
  return candidatos[0]?.id;
}
