/**
 * Preferencias del usuario en `localStorage` (clínica, sede, idioma) y la marca de última actividad.
 * Nunca tokens ni datos clínicos. Todo con try/catch: el almacenamiento puede no estar disponible.
 */

const PREFIJO = 'conecta.';

export function leer(clave: string): string | null {
  try {
    return window.localStorage.getItem(PREFIJO + clave);
  } catch {
    return null;
  }
}

export function escribir(clave: string, valor: string | null): void {
  try {
    if (valor === null) window.localStorage.removeItem(PREFIJO + clave);
    else window.localStorage.setItem(PREFIJO + clave, valor);
  } catch {
    // Sin almacenamiento: la preferencia dura lo que la pestaña.
  }
}

export const claves = {
  idioma: 'idioma',
  clinica: (usuarioId: string) => `clinica.${usuarioId}`,
  sede: (usuarioId: string, clinicaId: string) => `sede.${usuarioId}.${clinicaId}`,
  actividad: 'actividad',
} as const;

/** Clave completa (con prefijo) para comparar en el evento `storage`. */
export function claveCompleta(clave: string): string {
  return PREFIJO + clave;
}

/** Valor especial guardado para «Todas las sedes». */
export const TODAS = '*';
