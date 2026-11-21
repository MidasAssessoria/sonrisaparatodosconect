/**
 * Validaciones de la disponibilidad que no necesitan la base: superposición dentro del pedido y
 * tramo dentro del horario de la sede. Los mensajes dicen qué tramo choca y por qué.
 */
import type { TramoDisponibilidad } from '@conecta/shared';
import type { DetalleError } from '../errores/error-api.js';

export const NOMBRE_DIA = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;

export function nombreDia(dia: number): string {
  return NOMBRE_DIA[dia] ?? String(dia);
}

/** `08:00:00` (Postgres) → `08:00` (contrato). */
export function horaCorta(valor: string): string {
  return valor.slice(0, 5);
}

/** Clave de igualdad de un tramo: si coincide, se conserva la fila (no se desactiva ni se crea). */
export function claveTramo(t: TramoDisponibilidad): string {
  return [t.sedeId, String(t.diaSemana), t.horaInicio, t.horaFin, t.sillonId ?? ''].join('|');
}

/**
 * Dos tramos se pisan el mismo día aunque sean en sedes distintas (una persona no está en dos
 * lugares). Tocarse en un extremo (08:00–12:00 y 12:00–16:00) está bien: rangos [inicio, fin).
 */
export function superposiciones(
  tramos: TramoDisponibilidad[],
  nombreSede: (id: string) => string,
): DetalleError[] {
  const detalles: DetalleError[] = [];
  const porDia = new Map<number, { indice: number; t: TramoDisponibilidad }[]>();
  tramos.forEach((t, indice) => {
    const lista = porDia.get(t.diaSemana) ?? [];
    lista.push({ indice, t });
    porDia.set(t.diaSemana, lista);
  });
  for (const [dia, lista] of [...porDia.entries()].sort((x, y) => x[0] - y[0])) {
    lista.sort((x, y) => x.t.horaInicio.localeCompare(y.t.horaInicio) || x.indice - y.indice);
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i];
        const b = lista[j];
        if (!a || !b) continue;
        if (b.t.horaInicio >= a.t.horaFin) break;
        const mismaSede = a.t.sedeId === b.t.sedeId;
        detalles.push({
          campo: `tramos.${String(Math.max(a.indice, b.indice))}`,
          mensaje:
            `El ${nombreDia(dia)}, el tramo de ${b.t.horaInicio} a ${b.t.horaFin} en ${nombreSede(b.t.sedeId)} ` +
            `se superpone con el de ${a.t.horaInicio} a ${a.t.horaFin}` +
            (mismaSede
              ? '.'
              : ` en ${nombreSede(a.t.sedeId)}: no puede estar en dos sedes a la vez.`),
        });
      }
    }
  }
  return detalles;
}

export interface FranjaHorario {
  horaInicio: string;
  horaFin: string;
}

/** Une las franjas que se tocan o se pisan (08–12 y 12–18 = 08–18). Devuelve ordenado. */
export function unirFranjas(franjas: FranjaHorario[]): FranjaHorario[] {
  const ordenadas = [...franjas].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  const unidas: FranjaHorario[] = [];
  for (const f of ordenadas) {
    const ultima = unidas[unidas.length - 1];
    if (ultima && f.horaInicio <= ultima.horaFin) {
      if (f.horaFin > ultima.horaFin) ultima.horaFin = f.horaFin;
    } else {
      unidas.push({ ...f });
    }
  }
  return unidas;
}

/** ¿El tramo cae entero dentro de una franja (ya unida) del horario de la sede? */
export function dentroDelHorario(tramo: FranjaHorario, franjas: FranjaHorario[]): boolean {
  return franjas.some((f) => f.horaInicio <= tramo.horaInicio && tramo.horaFin <= f.horaFin);
}

export function describirFranjas(franjas: FranjaHorario[]): string {
  const partes = franjas.map((f) => `de ${f.horaInicio} a ${f.horaFin}`);
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1] ?? ''}`;
}
