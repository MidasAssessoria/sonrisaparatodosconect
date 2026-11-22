import type { Accion, Modulo, Paciente } from '@conecta/shared';
import type { ComponentType } from 'react';
import type { Textos } from '../../i18n/es.js';
import { PestanaDatos } from './PestanaDatos.js';

/**
 * Pestañas de la ficha. Para sumar una (Anamnesis en el Sprint 4, Odontograma en el 6…):
 * agregala acá con `clinica: true` si muestra datos clínicos, su texto en `i18n/es.ts`
 * (`pacientes.pestanas`) y su componente. Las clínicas no aparecen sin `ficha_clinica:ver`
 * (recepción no ve el historial clínico), y su ruta tampoco abre.
 */
export interface PestanaFicha {
  id: keyof Textos['pacientes']['pestanas'];
  /** Segmento de la ruta: `/pacientes/:id` (vacío) o `/pacientes/:id/<ruta>`. */
  ruta: string;
  /** Muestra datos clínicos: exige `ficha_clinica:ver`. */
  clinica: boolean;
  Componente: ComponentType<{ paciente: Paciente }>;
}

export const PESTANAS_FICHA: readonly PestanaFicha[] = [
  { id: 'datos', ruta: '', clinica: false, Componente: PestanaDatos },
];

export function pestanasVisibles<P extends Pick<PestanaFicha, 'clinica'>>(
  pestanas: readonly P[],
  puede: (m: Modulo, a: Accion) => boolean,
): P[] {
  return pestanas.filter((p) => !p.clinica || puede('ficha_clinica', 'ver'));
}
