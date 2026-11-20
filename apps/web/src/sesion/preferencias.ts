/**
 * Preferencias del usuario en `localStorage` (clínica, sede, idioma) y la marca de última actividad.
 * Lo que vale solo para la sesión abierta en esta pestaña (la sede elegida a mano) va en
 * `sessionStorage`. Nunca tokens ni datos clínicos. Todo con try/catch: el almacenamiento puede no
 * estar disponible.
 */

const PREFIJO = 'conecta.';

function almacen(tipo: 'local' | 'sesion'): Storage {
  return tipo === 'local' ? window.localStorage : window.sessionStorage;
}

export function leer(clave: string): string | null {
  try {
    return almacen('local').getItem(PREFIJO + clave);
  } catch {
    return null;
  }
}

export function escribir(clave: string, valor: string | null): void {
  try {
    if (valor === null) almacen('local').removeItem(PREFIJO + clave);
    else almacen('local').setItem(PREFIJO + clave, valor);
  } catch {
    // Sin almacenamiento: la preferencia dura lo que la pestaña.
  }
}

/** Lo mismo, en `sessionStorage`: sobrevive a recargar la página, no a cerrar la pestaña. */
export function leerDeSesion(clave: string): string | null {
  try {
    return almacen('sesion').getItem(PREFIJO + clave);
  } catch {
    return null;
  }
}

export function escribirEnSesion(clave: string, valor: string | null): void {
  try {
    if (valor === null) almacen('sesion').removeItem(PREFIJO + clave);
    else almacen('sesion').setItem(PREFIJO + clave, valor);
  } catch {
    // Sin almacenamiento: dura lo que la página.
  }
}

/** Borra de `sessionStorage` todo lo que empieza con `clave` (p. ej. al cerrar sesión). */
export function olvidarDeSesion(prefijoClave: string): void {
  try {
    const s = almacen('sesion');
    const completas: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIJO + prefijoClave)) completas.push(k);
    }
    for (const k of completas) s.removeItem(k);
  } catch {
    // Sin almacenamiento: no hay nada que borrar.
  }
}

export const claves = {
  idioma: 'idioma',
  clinica: (usuarioId: string) => `clinica.${usuarioId}`,
  /** Última sede usada (localStorage): solo se usa si el usuario no tiene sede por defecto. */
  sede: (usuarioId: string, clinicaId: string) => `sede.${usuarioId}.${clinicaId}`,
  /** Sede elegida a mano en esta sesión (sessionStorage): manda sobre la sede por defecto. */
  sedeElegida: (usuarioId: string, clinicaId: string) => `sede-elegida.${usuarioId}.${clinicaId}`,
  sedesElegidas: 'sede-elegida.',
  actividad: 'actividad',
} as const;

/** Clave completa (con prefijo) para comparar en el evento `storage`. */
export function claveCompleta(clave: string): string {
  return PREFIJO + clave;
}

/** Valor especial guardado para «Todas las sedes». */
export const TODAS = '*';

/** Marca de última actividad compartida entre pestañas (ms), o `null` si no hay o no sirve. */
export function leerActividad(): number | null {
  const v = Number(leer(claves.actividad));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function marcarActividad(cuando: number = Date.now()): void {
  escribir(claves.actividad, String(cuando));
}
