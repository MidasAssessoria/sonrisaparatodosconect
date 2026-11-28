import { useMemo, useSyncExternalStore } from 'react';
import { claveCompleta, claves, escribir, leer } from './preferencias.js';

/*
 * Modo paciente: la tablet se le pasa al paciente para que complete la anamnesis. Mientras dura,
 * el armazón (menú, buscador, barra superior, rutas) no se muestra: solo el formulario en
 * pantalla completa y, al terminar o cancelar, el bloqueo «Devolvé la tablet a la clínica», del
 * que se sale con una credencial de quien tiene la sesión abierta.
 *
 * El estado vive en `localStorage` (no en `sessionStorage`): así lo respetan también las otras
 * pestañas de la app en el mismo navegador (una pestaña nueva con la misma sesión de Supabase
 * abriría todo), sobrevive a recargar la página y el botón Atrás no lo saca (el armazón lo mira
 * antes de mostrar nada). Guarda solo identificadores, ningún dato clínico. Se borra al
 * desbloquear y al cerrar la sesión.
 */

export type FaseModoPaciente = 'formulario' | 'bloqueado';

export interface ModoPaciente {
  usuarioId: string;
  /** `null` si lo guardado no se pudo leer: igual se bloquea. */
  pacienteId: string | null;
  fase: FaseModoPaciente;
}

const EVENTO = 'conecta:modo-paciente';
const RE_ID = /^[0-9a-f-]{36}$/i;

/** Lo guardado → estado. Algo ilegible también bloquea (nunca abre la app por un error). */
export function interpretarModoPaciente(texto: string | null): ModoPaciente | null {
  if (texto === null) return null;
  try {
    const v = JSON.parse(texto) as Partial<ModoPaciente>;
    return {
      usuarioId: typeof v.usuarioId === 'string' ? v.usuarioId : '',
      pacienteId:
        typeof v.pacienteId === 'string' && RE_ID.test(v.pacienteId) ? v.pacienteId : null,
      fase:
        v.fase === 'formulario' && typeof v.pacienteId === 'string' ? 'formulario' : 'bloqueado',
    };
  } catch {
    return { usuarioId: '', pacienteId: null, fase: 'bloqueado' };
  }
}

export function fijarModoPaciente(modo: ModoPaciente | null): void {
  escribir(claves.modoPaciente, modo ? JSON.stringify(modo) : null);
  window.dispatchEvent(new Event(EVENTO));
}

function suscribir(avisar: () => void): () => void {
  const enOtraPestana = (e: StorageEvent) => {
    if (e.key === null || e.key === claveCompleta(claves.modoPaciente)) avisar();
  };
  window.addEventListener('storage', enOtraPestana);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener('storage', enOtraPestana);
    window.removeEventListener(EVENTO, avisar);
  };
}

/** Estado del modo paciente, al día con esta y las demás pestañas. */
export function useModoPaciente(): ModoPaciente | null {
  const texto = useSyncExternalStore(suscribir, () => leer(claves.modoPaciente));
  return useMemo(() => interpretarModoPaciente(texto), [texto]);
}
