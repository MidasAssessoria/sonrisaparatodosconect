import type { TasaIva, TramoDisponibilidad } from '@conecta/shared';
import { desfaseMinutos, ZONA_PREDETERMINADA } from '../../utilidades/fechas.js';

/** «08:00» → «8:00». */
export function horaCorta(h: string): string {
  return h.replace(/^0(\d)/, '$1');
}

/** 90 → «1 h 30 min»; 0 → «0 min». */
export function textoMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export const TEXTO_IVA: Record<TasaIva, string> = { 10: '10 %', 5: '5 %', 0: 'Exento' };

/** Dígitos de lo que se escribió, sin ceros adelante y hasta 9 cifras (999.999.999). */
export function soloDigitos(texto: string): string {
  return texto
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, 9);
}

/** «1500000» → «1.500.000» (separador de miles mientras se tipea). */
export function conMiles(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** «1.500.000» → 1500000; vacío → null. */
export function montoDesdeTexto(texto: string): number | null {
  const d = soloDigitos(texto);
  return d === '' ? null : Number(d);
}

/** 0 = domingo … 6 = sábado; se muestran de lunes a domingo. */
export const DIAS: { dia: number; nombre: string; corto: string; enFrase: string }[] = [
  { dia: 1, nombre: 'Lunes', corto: 'Lun', enFrase: 'lunes' },
  { dia: 2, nombre: 'Martes', corto: 'Mar', enFrase: 'martes' },
  { dia: 3, nombre: 'Miércoles', corto: 'Mié', enFrase: 'miércoles' },
  { dia: 4, nombre: 'Jueves', corto: 'Jue', enFrase: 'jueves' },
  { dia: 5, nombre: 'Viernes', corto: 'Vie', enFrase: 'viernes' },
  { dia: 6, nombre: 'Sábado', corto: 'Sáb', enFrase: 'sábado' },
  { dia: 0, nombre: 'Domingo', corto: 'Dom', enFrase: 'domingo' },
];

export function nombreDia(dia: number): string {
  return DIAS.find((d) => d.dia === dia)?.enFrase ?? String(dia);
}

/** Días con atención, de lunes a domingo: «Lun, Mié, Vie». */
export function resumenDias(tramos: Pick<TramoDisponibilidad, 'diaSemana'>[]): string {
  const dias = new Set(tramos.map((t) => t.diaSemana));
  const lista = DIAS.filter((d) => dias.has(d.dia)).map((d) => d.corto);
  return lista.length ? lista.join(', ') : 'Sin días cargados';
}

/**
 * Fecha («2026-11-25») y hora («08:30») de la zona de la clínica → ISO con desfase
 * («2026-11-25T08:30:00-03:00»), listo para la API.
 */
export function instanteLocal(dia: string, hora: string, zona: string = ZONA_PREDETERMINADA) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!m || !h) return null;
  const local = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(h[1]), Number(h[2]));
  // El instante t cumple t + desfase(t) = hora local; dos pasadas alcanzan.
  const t0 = local - desfaseMinutos(local, zona) * 60_000;
  const desfase = desfaseMinutos(local - desfaseMinutos(t0, zona) * 60_000, zona);
  const signo = desfase < 0 ? '-' : '+';
  const abs = Math.abs(desfase);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${dia}T${hora}:00${signo}${hh}:${mm}`;
}
