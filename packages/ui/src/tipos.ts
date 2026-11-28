import type { MouseEvent, ReactNode } from 'react';
import type { IconoNombre } from './componentes/Icono.js';

export type { IconoNombre } from './componentes/Icono.js';

/** Tonos de estado. Siempre con ícono o texto, nunca solo color. */
export type Tono = 'exito' | 'atencion' | 'progreso' | 'info' | 'categoria' | 'familia' | 'neutro';

/** Módulos fijos del design system (valor por defecto de la navegación). */
export type ModuloId =
  | 'inicio'
  | 'pacientes'
  | 'odontologia'
  | 'agenda'
  | 'caja'
  | 'personal'
  | 'inventario'
  | 'comunitaria'
  | 'estadisticas';

export type TonoColor = 'turquesa' | 'cielo' | 'uva' | 'rosa' | 'sol' | 'coral';

export type Idioma = 'es' | 'gn';

/** Un destino de navegación. La app real pasa solo los que el rol puede ver. */
export interface ItemNavegacion<I extends string = string> {
  id: I;
  nombre: string;
  icono: IconoNombre;
  /** Ruta del router (p. ej. «/pacientes»). Si falta, se usa `rutas[id]` o `#id`. */
  ruta?: string | undefined;
}

/** Lo que recibe `renderEnlace` para dibujar el enlace con el router de la app. */
export interface PropsEnlace<I extends string = string> {
  item: ItemNavegacion<I>;
  href: string;
  className: string;
  activo: boolean;
  'aria-current': 'page' | undefined;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}

/**
 * Dibuja un enlace de navegación sin recargar la página. Con React Router:
 * `({ href, item, activo, children, ...resto }) => <Link to={href} {...resto}>{children}</Link>`
 */
export type RenderEnlace<I extends string = string> = (props: PropsEnlace<I>) => ReactNode;

export interface PacienteResultado {
  /** Identificador del paciente (la app lo usa para abrir la ficha; también es la clave de la fila). */
  id?: string | undefined;
  nombre: string;
  documento?: string | undefined;
  telefono?: string | undefined;
  alerta?: string | undefined;
}

export interface Sede {
  id: string;
  nombre: string;
}

export interface UsuarioBarra {
  nombre: string;
  rol?: string | undefined;
}

/** Acción extra del menú de usuario (p. ej. «Mi perfil»). */
export interface AccionUsuario {
  id: string;
  texto: string;
  icono?: IconoNombre | undefined;
  onElegir: () => void;
}
