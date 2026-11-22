import {
  tramoDisponibilidadSchema,
  type HorarioSede,
  type TramoDisponibilidad,
} from '@conecta/shared';
import { DIAS, horaCorta, nombreDia } from './formato.js';

/*
 * Validación de la disponibilidad semanal en la web, igual que la API
 * (`apps/api/src/profesionales/disponibilidad.ts`):
 *   - fin posterior al inicio;
 *   - sin tramos superpuestos el mismo día, aunque sean en otra sede (rangos [inicio, fin): tocarse
 *     en un extremo está bien);
 *   - cada tramo nuevo o cambiado cae entero dentro del horario de su sede ese día (las franjas que
 *     se tocan se unen). Los tramos que ya estaban guardados no se vuelven a medir contra el
 *     horario, como hace la API.
 */

/** Tramo en edición. `clave` identifica la fila en pantalla. */
export interface TramoEditable {
  clave: string;
  sedeId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  sillonId: string | null;
}

/** Lo que se sabe de una sede que la persona puede ver. `horarios: null` = no se conoce. */
export interface SedeDisponible {
  id: string;
  nombre: string;
  horarios: HorarioSede[] | null;
  sillones: { id: string; nombre: string; activo: boolean }[] | null;
}

export interface Franja {
  horaInicio: string;
  horaFin: string;
}

/** Une las franjas que se tocan o se pisan (8–12 y 12–18 = 8–18). */
export function unirFranjas(franjas: Franja[]): Franja[] {
  const ordenadas = [...franjas].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  const unidas: Franja[] = [];
  for (const f of ordenadas) {
    const ultima = unidas[unidas.length - 1];
    if (ultima && f.horaInicio <= ultima.horaFin) {
      if (f.horaFin > ultima.horaFin) ultima.horaFin = f.horaFin;
    } else {
      unidas.push({ horaInicio: f.horaInicio, horaFin: f.horaFin });
    }
  }
  return unidas;
}

export function franjasDelDia(horarios: HorarioSede[], dia: number): Franja[] {
  return unirFranjas(horarios.filter((h) => h.diaSemana === dia));
}

function describirFranjas(franjas: Franja[]): string {
  const partes = franjas.map((f) => `de ${horaCorta(f.horaInicio)} a ${horaCorta(f.horaFin)}`);
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1] ?? ''}`;
}

/** Clave de igualdad de un tramo (la misma que usa la API para conservar filas). */
export function claveTramo(t: Omit<TramoDisponibilidad, 'sillonId'> & { sillonId: string | null }) {
  return [t.sedeId, String(t.diaSemana), t.horaInicio, t.horaFin, t.sillonId ?? ''].join('|');
}

/** Orden del cuerpo del `PUT`: día (0 = domingo … 6), hora de inicio, sede. */
export function ordenarTramos<T extends TramoDisponibilidad>(tramos: T[]): T[] {
  return [...tramos].sort(
    (a, b) =>
      a.diaSemana - b.diaSemana ||
      a.horaInicio.localeCompare(b.horaInicio) ||
      a.sedeId.localeCompare(b.sedeId),
  );
}

export type ResultadoDisponibilidad =
  | { ok: true; tramos: TramoDisponibilidad[]; claves: (string | null)[] }
  | { ok: false; errores: Record<string, string> };

/**
 * Valida los tramos editables junto con los de sedes que la persona no ve (`ajenos`, van iguales).
 * Devuelve el reemplazo completo para la API y, por posición, la clave de pantalla de cada tramo
 * (`null` para los ajenos), para ubicar los errores que devuelva la API.
 */
export function validarDisponibilidad(
  tramos: TramoEditable[],
  {
    sedes,
    ajenos,
    guardados,
  }: {
    sedes: SedeDisponible[];
    ajenos: TramoDisponibilidad[];
    /** `claveTramo` de los tramos que ya estaban guardados. */
    guardados: Set<string>;
  },
): ResultadoDisponibilidad {
  const errores: Record<string, string> = {};
  const sedePorId = new Map(sedes.map((s) => [s.id, s]));
  const nombreSede = (sedeId: string) => {
    const s = sedePorId.get(sedeId);
    return s ? `«${s.nombre}»` : 'otra sede';
  };

  const validos: { clave: string | null; t: TramoDisponibilidad }[] = [];
  for (const t of tramos) {
    if (!t.horaInicio || !t.horaFin) {
      errores[t.clave] = 'Completá la hora de inicio y la de fin.';
      continue;
    }
    if (!t.sedeId) {
      errores[t.clave] = 'Elegí la sede.';
      continue;
    }
    const r = tramoDisponibilidadSchema.safeParse({
      sedeId: t.sedeId,
      diaSemana: t.diaSemana,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      sillonId: t.sillonId,
    });
    if (!r.success) {
      errores[t.clave] = r.error.issues[0]?.message ?? 'Revisá este tramo.';
      continue;
    }
    const sede = sedePorId.get(t.sedeId);
    if (sede?.horarios && !guardados.has(claveTramo(r.data))) {
      const franjas = franjasDelDia(sede.horarios, t.diaSemana);
      if (franjas.length === 0) {
        errores[t.clave] =
          `El ${nombreDia(t.diaSemana)} la sede ${nombreSede(t.sedeId)} no atiende. ` +
          'Quitá el tramo o cargá primero el horario de la sede.';
        continue;
      }
      if (!franjas.some((f) => f.horaInicio <= t.horaInicio && t.horaFin <= f.horaFin)) {
        errores[t.clave] =
          `El ${nombreDia(t.diaSemana)} la sede ${nombreSede(t.sedeId)} atiende ` +
          `${describirFranjas(franjas)}: este tramo queda fuera de ese horario.`;
        continue;
      }
    }
    validos.push({ clave: t.clave, t: r.data });
  }
  for (const a of ajenos) validos.push({ clave: null, t: a });

  // Superposiciones el mismo día, aunque sean en sedes distintas.
  for (const d of DIAS) {
    const delDia = validos
      .filter((v) => v.t.diaSemana === d.dia)
      .sort((x, y) => x.t.horaInicio.localeCompare(y.t.horaInicio));
    for (let i = 0; i < delDia.length; i++) {
      for (let j = i + 1; j < delDia.length; j++) {
        const a = delDia[i];
        const b = delDia[j];
        if (!a || !b) continue;
        if (b.t.horaInicio >= a.t.horaFin) break;
        // El error va en el tramo que se puede editar (el posterior si los dos se pueden).
        const [marcado, otro] = b.clave !== null ? [b, a] : [a, b];
        if (marcado.clave === null || errores[marcado.clave]) continue;
        const mismaSede = a.t.sedeId === b.t.sedeId;
        errores[marcado.clave] =
          `Se superpone con el tramo de ${horaCorta(otro.t.horaInicio)} a ${horaCorta(otro.t.horaFin)}` +
          (mismaSede
            ? '.'
            : ` en ${nombreSede(otro.t.sedeId)}: no puede estar en dos sedes a la vez.`);
      }
    }
  }

  if (Object.keys(errores).length) return { ok: false, errores };
  const ordenados = ordenarTramos(validos.map((v) => ({ ...v.t, clave: v.clave })));
  return {
    ok: true,
    tramos: ordenados.map((t) => ({
      sedeId: t.sedeId,
      diaSemana: t.diaSemana,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      sillonId: t.sillonId,
    })),
    claves: ordenados.map((t) => t.clave),
  };
}
