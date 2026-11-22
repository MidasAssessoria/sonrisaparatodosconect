import type { Persona } from '@conecta/shared';
import { fecha, fechaHora } from './consultas.js';
import { T } from './textos.js';

/** Nombres de las sedes que quien mira puede ver; las demás se cuentan aparte. */
export function textoSedes(sedeIds: string[], visibles: { id: string; nombre: string }[]): string {
  if (sedeIds.length === 0) return T.equipo.sinSedes;
  const nombres = sedeIds
    .map((id) => visibles.find((s) => s.id === id)?.nombre)
    .filter((n): n is string => !!n);
  const ocultas = sedeIds.length - nombres.length;
  return [...nombres, ...(ocultas > 0 ? [T.equipo.sedeOculta(ocultas)] : [])].join(', ');
}

/** Último acceso; para pendientes, hasta cuándo sirve el enlace. */
export function textoAcceso(p: Persona, zona: string, ahora = Date.now()): string {
  if (p.estado === 'pendiente' && p.invitacionVenceEn) {
    return Date.parse(p.invitacionVenceEn) < ahora
      ? T.equipo.vencido
      : T.equipo.venceEl(fecha(p.invitacionVenceEn, zona));
  }
  return p.ultimoAcceso ? fechaHora(p.ultimoAcceso, zona) : T.equipo.nuncaIngreso;
}
