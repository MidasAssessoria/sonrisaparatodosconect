import type { EstadoSede } from '@conecta/shared';
import type { IconoNombre, Tono } from '@conecta/ui';
import { COLORES } from '@conecta/ui';

export const TEXTO_ESTADO_SEDE: Record<EstadoSede, string> = {
  abierta: 'Abierta',
  proxima: 'Próxima apertura',
  cerrada: 'Cerrada',
};

/**
 * Estado = color + ícono + texto. «Cerrada» usa la cruz (como «Inactivo»): el candado queda solo
 * para «Tu rol no tiene acceso a esto».
 */
export function infoEstadoSede(estado: EstadoSede): {
  tono: Tono;
  icono: IconoNombre;
  texto: string;
} {
  switch (estado) {
    case 'abierta':
      return { tono: 'exito', icono: 'check', texto: TEXTO_ESTADO_SEDE.abierta };
    case 'proxima':
      return { tono: 'info', icono: 'reloj', texto: TEXTO_ESTADO_SEDE.proxima };
    case 'cerrada':
      return { tono: 'neutro', icono: 'cerrar', texto: TEXTO_ESTADO_SEDE.cerrada };
  }
}

/** Colores de sede: los de marca del design system (nunca los clínicos). */
export const COLORES_SEDE: { valor: string; nombre: string }[] = [
  { valor: COLORES.turquesa, nombre: 'Turquesa' },
  { valor: COLORES.cielo, nombre: 'Cielo' },
  { valor: COLORES.uva, nombre: 'Uva' },
  { valor: COLORES.rosa, nombre: 'Rosa' },
  { valor: COLORES.sol, nombre: 'Sol' },
  { valor: COLORES.coral, nombre: 'Coral' },
];

/** 0 = domingo … 6 = sábado; se muestran de lunes a domingo. */
export const DIAS_SEMANA: { dia: number; nombre: string }[] = [
  { dia: 1, nombre: 'Lunes' },
  { dia: 2, nombre: 'Martes' },
  { dia: 3, nombre: 'Miércoles' },
  { dia: 4, nombre: 'Jueves' },
  { dia: 5, nombre: 'Viernes' },
  { dia: 6, nombre: 'Sábado' },
  { dia: 0, nombre: 'Domingo' },
];
