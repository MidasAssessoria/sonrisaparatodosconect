import type { HorarioSede } from '@conecta/shared';
import { errores, type DetalleError } from '../errores/error-api.js';

export const NOMBRE_DIA = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;

/**
 * Rechaza tramos que se superponen el mismo día (tocarse en un extremo, 08:00–12:00 y 12:00–16:00,
 * está bien). El mensaje dice qué tramos chocan.
 */
export function validarTramos(horarios: HorarioSede[]): void {
  const detalles: DetalleError[] = [];
  const porDia = new Map<number, { indice: number; h: HorarioSede }[]>();
  horarios.forEach((h, indice) => {
    const lista = porDia.get(h.diaSemana) ?? [];
    lista.push({ indice, h });
    porDia.set(h.diaSemana, lista);
  });
  for (const [dia, tramos] of [...porDia.entries()].sort((a, b) => a[0] - b[0])) {
    tramos.sort((a, b) => a.h.horaInicio.localeCompare(b.h.horaInicio));
    for (let i = 0; i < tramos.length; i++) {
      for (let j = i + 1; j < tramos.length; j++) {
        const a = tramos[i];
        const b = tramos[j];
        if (!a || !b) continue;
        if (b.h.horaInicio >= a.h.horaFin) break;
        detalles.push({
          campo: `horarios.${String(b.indice)}`,
          mensaje:
            `El ${NOMBRE_DIA[dia] ?? String(dia)}, el tramo de ${b.h.horaInicio} a ${b.h.horaFin} ` +
            `se superpone con el de ${a.h.horaInicio} a ${a.h.horaFin}.`,
        });
      }
    }
  }
  if (detalles.length > 0) {
    throw errores.datosInvalidos(
      `Hay tramos que se superponen: ${detalles.map((d) => d.mensaje).join(' ')} Corregí uno de cada par y guardá de nuevo.`,
      detalles,
    );
  }
}

/** `08:00:00` (Postgres) → `08:00` (contrato). */
export function horaCorta(valor: string): string {
  return valor.slice(0, 5);
}
