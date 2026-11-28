import type { Accion, Modulo } from '@conecta/shared';
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
  /** Otras rutas que cuelgan de este módulo (p. ej. Roles, que se abre desde Equipo). */
  otrasRutas?: readonly string[];
  /** Además de `modulo:ver`, lo que hace falta para que aparezca (p. ej. poder editar). */
  exige?: readonly (readonly [Modulo, Accion])[];
}

export type Puede = (m: Modulo, a: Accion) => boolean;

export const MODULOS_WEB: readonly ModuloWeb[] = [
  { id: 'inicio', modulo: 'inicio', icono: 'inicio', ruta: '/' },
  { id: 'pacientes', modulo: 'pacientes', icono: 'pacientes', ruta: '/pacientes' },
  { id: 'sedes', modulo: 'sedes', icono: 'sede', ruta: '/sedes' },
  {
    id: 'personal',
    modulo: 'personal',
    icono: 'personal',
    ruta: '/personal',
    otrasRutas: ['/roles'],
  },
  { id: 'profesionales', modulo: 'personal', icono: 'odontologia', ruta: '/profesionales' },
  { id: 'tratamientos', modulo: 'configuracion', icono: 'tabla', ruta: '/tratamientos' },
  /*
   * Catálogo de preguntas de la anamnesis: `configuracion:editar` (Administración lo edita sin ver
   * fichas clínicas: el texto de las preguntas no es dato de ningún paciente).
   */
  {
    id: 'cuestionario',
    modulo: 'configuracion',
    icono: 'archivo',
    ruta: '/cuestionario',
    exige: [['configuracion', 'editar']],
  },
  { id: 'auditoria', modulo: 'auditoria', icono: 'archivo', ruta: '/auditoria' },
];

export type IdModuloWeb = ModuloWeb['id'];

export function moduloVisible(m: ModuloWeb, puede: Puede): boolean {
  return puede(m.modulo, 'ver') && (m.exige ?? []).every(([mod, accion]) => puede(mod, accion));
}

export function modulosVisibles(puede: Puede): ModuloWeb[] {
  return MODULOS_WEB.filter((m) => moduloVisible(m, puede));
}

/** Módulo activo según la ruta actual. */
export function moduloDeRuta(pathname: string): IdModuloWeb | undefined {
  const dentro = (ruta: string) =>
    ruta === '/' ? pathname === '/' : pathname === ruta || pathname.startsWith(`${ruta}/`);
  const candidatos = MODULOS_WEB.filter((m) => dentro(m.ruta) || (m.otrasRutas ?? []).some(dentro));
  return candidatos[0]?.id;
}
