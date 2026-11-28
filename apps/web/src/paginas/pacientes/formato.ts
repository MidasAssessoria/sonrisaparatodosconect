import { formatoCi, formatoTelefono, type PacienteResumen } from '@conecta/shared';
import type { PacienteResultado } from '@conecta/ui';
import type { Textos } from '../../i18n/es.js';

type TextosPacientes = Textos['pacientes'];

/** «Ana Giménez». */
export function nombreCompleto(p: Pick<PacienteResumen, 'nombres' | 'apellidos'>): string {
  return [p.nombres, p.apellidos].filter(Boolean).join(' ').trim();
}

/** «CI 4.123.456» o `undefined` sin CI. */
export function textoCi(t: TextosPacientes, ci: string | null): string | undefined {
  return ci ? t.ci(formatoCi(ci)) : undefined;
}

/** «0981 123 456» (Paraguay) o el número internacional tal cual. */
export function textoTelefono(telefono: string | null): string | undefined {
  return telefono ? formatoTelefono(telefono) : undefined;
}

/** «34 años · CI 4.123.456 · 0981 123 456» (sin los datos que faltan). */
export function metaPaciente(t: TextosPacientes, p: PacienteResumen): string {
  return [p.edad != null ? t.edad(p.edad) : null, textoCi(t, p.ci), textoTelefono(p.telefono)]
    .filter(Boolean)
    .join(' · ');
}

/** Fila del buscador (`Buscador` de @conecta/ui). */
export function resultadoBuscador(t: TextosPacientes, p: PacienteResumen): PacienteResultado {
  return {
    id: p.id,
    nombre: nombreCompleto(p),
    documento: textoCi(t, p.ci),
    telefono: textoTelefono(p.telefono),
    alerta: p.conAlerta ? t.conAlerta : undefined,
  };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Día del calendario («1992-03-14» → «14 de mar de 1992»). Es una fecha sin hora (nacimiento):
 * no se pasa por ninguna zona horaria, así no se corre un día.
 */
export function formatoDia(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return dia;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
}

/** WhatsApp: «+595981123456» → «https://wa.me/595981123456». */
export function enlaceWhatsapp(telefono: string): string {
  return `https://wa.me/${telefono.replace(/\D/g, '')}`;
}

/** «Alergia a la penicilina (urticaria con amoxicilina)»: el detalle aparte, si llega. */
export function textoAlertaMedica(a: { texto: string; detalle: string | null }): string {
  return a.detalle ? `${a.texto} (${a.detalle})` : a.texto;
}
