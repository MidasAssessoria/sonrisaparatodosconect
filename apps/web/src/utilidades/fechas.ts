/** Fechas y horas en America/Asuncion con el formato del design system: «jue 14 de nov · 9:05». */

export const ZONA = 'America/Asuncion';

function partes(fecha: Date, opciones: Intl.DateTimeFormatOptions): Record<string, string> {
  const r: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('es-PY', { timeZone: ZONA, ...opciones }).formatToParts(
    fecha,
  )) {
    r[p.type] = p.value;
  }
  return r;
}

/** «jue 14 de nov» (con año si no es el año en curso). */
export function formatoFecha(iso: string | Date, ahora: Date = new Date()): string {
  const f = typeof iso === 'string' ? new Date(iso) : iso;
  const p = partes(f, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const anioActual = partes(ahora, { year: 'numeric' })['year'];
  const limpio = (s: string | undefined) => (s ?? '').replace('.', '').toLowerCase();
  const base = `${limpio(p['weekday'])} ${p['day']} de ${limpio(p['month'])}`;
  return p['year'] === anioActual ? base : `${base} de ${p['year']}`;
}

/** «9:05» (24 h, sin cero a la izquierda en la hora). */
export function formatoHora(iso: string | Date): string {
  const f = typeof iso === 'string' ? new Date(iso) : iso;
  const p = partes(f, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  return `${Number(p['hour'])}:${p['minute']}`;
}

export function formatoFechaHora(iso: string | Date, ahora: Date = new Date()): string {
  return `${formatoFecha(iso, ahora)} · ${formatoHora(iso)}`;
}

/** Desfase de Asunción en una fecha dada, como «-03:00». */
function desfase(fecha: Date): string {
  const nombre = partes(fecha, { timeZoneName: 'longOffset' })['timeZoneName'] ?? 'GMT-03:00';
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(nombre);
  if (!m) return '+00:00';
  return `${m[1]}:${m[2] ?? '00'}`;
}

/**
 * Límites de un día del calendario de Asunción («2026-11-20») como ISO con desfase,
 * listos para `desde`/`hasta` de la API.
 */
export function inicioDelDia(dia: string): string {
  const referencia = new Date(`${dia}T12:00:00Z`);
  return `${dia}T00:00:00${desfase(referencia)}`;
}

export function finDelDia(dia: string): string {
  const referencia = new Date(`${dia}T12:00:00Z`);
  return `${dia}T23:59:59.999${desfase(referencia)}`;
}
