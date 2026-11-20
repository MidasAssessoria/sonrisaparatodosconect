/**
 * Fechas y horas en la zona de la clínica (`sesion.clinica.zonaHoraria`) con el formato del design
 * system: «jue 14 de nov · 9:05».
 *
 * Paraguay dejó el horario de verano en octubre de 2024: desde el 6/10/2024 (04:00 UTC) Asunción
 * queda fija en UTC−3. Los navegadores con la tabla de zonas vieja siguen creyendo que en invierno
 * pasa a UTC−4, así que para Asunción desde esa fecha no se le pregunta al navegador: se usa el
 * desfase fijo y se formatea en UTC. Antes de esa fecha (y para cualquier otra zona) manda `Intl`,
 * que para el pasado sí tiene los datos bien.
 */

export const ZONA_PREDETERMINADA = 'America/Asuncion';

interface ReglaFija {
  /** Instante (ms UTC) desde el que vale el desfase fijo. */
  desde: number;
  /** Minutos respecto de UTC (negativo al oeste). */
  desfaseMin: number;
}

const REGLAS_FIJAS: Record<string, ReglaFija> = {
  'America/Asuncion': { desde: Date.UTC(2024, 9, 6, 4, 0, 0), desfaseMin: -180 },
};

const MIN = 60_000;

function reglaFija(instante: number, zona: string): ReglaFija | null {
  const r = REGLAS_FIJAS[zona];
  return r && instante >= r.desde ? r : null;
}

function zonaValida(zona: string): string {
  try {
    new Intl.DateTimeFormat('es-PY', { timeZone: zona });
    return zona;
  } catch {
    return ZONA_PREDETERMINADA;
  }
}

/** Partes de la fecha en la zona, sin depender de la tabla del navegador cuando hay regla fija. */
function partes(
  fecha: Date,
  zona: string,
  opciones: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const regla = reglaFija(fecha.getTime(), zona);
  const formato = regla
    ? new Intl.DateTimeFormat('es-PY', { ...opciones, timeZone: 'UTC' })
    : new Intl.DateTimeFormat('es-PY', { ...opciones, timeZone: zonaValida(zona) });
  const fechaAFormatear = regla ? new Date(fecha.getTime() + regla.desfaseMin * MIN) : fecha;
  const r: Record<string, string> = {};
  for (const p of formato.formatToParts(fechaAFormatear)) r[p.type] = p.value;
  return r;
}

/** Desfase de la zona en un instante, en minutos (sin `timeZoneName: 'longOffset'`, que no está en todos lados). */
export function desfaseMinutos(instante: number, zona: string): number {
  const regla = reglaFija(instante, zona);
  if (regla) return regla.desfaseMin;
  const enSegundos = Math.floor(instante / 1000) * 1000;
  const p = partes(new Date(enSegundos), zona, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const local = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    Number(p['hour']),
    Number(p['minute']),
    Number(p['second']),
  );
  return Math.round((local - enSegundos) / MIN);
}

function textoDesfase(min: number): string {
  const signo = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${signo}${hh}:${mm}`;
}

function aFecha(iso: string | Date): Date {
  return typeof iso === 'string' ? new Date(iso) : iso;
}

/** «jue 14 de nov» (con año si no es el año en curso). */
export function formatoFecha(
  iso: string | Date,
  zona: string = ZONA_PREDETERMINADA,
  ahora: Date = new Date(),
): string {
  const p = partes(aFecha(iso), zona, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const anioActual = partes(ahora, zona, { year: 'numeric' })['year'];
  const limpio = (s: string | undefined) => (s ?? '').replace('.', '').toLowerCase();
  const base = `${limpio(p['weekday'])} ${p['day']} de ${limpio(p['month'])}`;
  return p['year'] === anioActual ? base : `${base} de ${p['year']}`;
}

/** «9:05» (24 h, sin cero a la izquierda en la hora). */
export function formatoHora(iso: string | Date, zona: string = ZONA_PREDETERMINADA): string {
  const p = partes(aFecha(iso), zona, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  return `${Number(p['hour'])}:${p['minute']}`;
}

export function formatoFechaHora(
  iso: string | Date,
  zona: string = ZONA_PREDETERMINADA,
  ahora: Date = new Date(),
): string {
  return `${formatoFecha(iso, zona, ahora)} · ${formatoHora(iso, zona)}`;
}

function componentes(dia: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new RangeError(`Día inválido: ${dia}`);
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

/** «2026-11-20» → «2026-11-21». */
export function diaSiguiente(dia: string): string {
  const [a, m, d] = componentes(dia);
  return new Date(Date.UTC(a, m, d + 1)).toISOString().slice(0, 10);
}

/**
 * Inicio de un día del calendario de la zona («2026-11-20») como ISO con desfase, listo para
 * `desde` de la API.
 */
export function inicioDelDia(dia: string, zona: string = ZONA_PREDETERMINADA): string {
  const [a, m, d] = componentes(dia);
  const medianocheLocal = Date.UTC(a, m, d);
  // El instante t cumple t + desfase(t) = medianoche local; dos pasadas alcanzan.
  const t0 = medianocheLocal - desfaseMinutos(medianocheLocal, zona) * MIN;
  const t1 = medianocheLocal - desfaseMinutos(t0, zona) * MIN;
  return `${dia}T00:00:00${textoDesfase(desfaseMinutos(t1, zona))}`;
}

/** `hasta` de la API es exclusivo: para incluir el día completo, el inicio del día siguiente. */
export function hastaExclusivo(dia: string, zona: string = ZONA_PREDETERMINADA): string {
  return inicioDelDia(diaSiguiente(dia), zona);
}
