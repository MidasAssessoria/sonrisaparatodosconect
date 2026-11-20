/**
 * Registro (logs) de la API: una línea JSON por evento.
 *
 * Regla: nada personal ni clínico. Solo se aceptan valores primitivos y quien llama elige qué
 * manda; nunca correos, nombres, cuerpos de pedidos, cadenas de consulta ni mensajes de error de la
 * base (los de Drizzle incluyen la consulta y sus parámetros).
 */
export const REGISTRO = Symbol('REGISTRO');

export type DatoRegistro = string | number | boolean | null;

export interface Registro {
  info(evento: string, datos?: Record<string, DatoRegistro>): void;
  advertencia(evento: string, datos?: Record<string, DatoRegistro>): void;
  error(evento: string, datos?: Record<string, DatoRegistro>): void;
}

type Nivel = 'info' | 'advertencia' | 'error';

/** Registro que escribe JSON por stdout/stderr. */
export function crearRegistroConsola(): Registro {
  const escribir = (nivel: Nivel, evento: string, datos: Record<string, DatoRegistro> = {}) => {
    const linea = JSON.stringify({ fecha: new Date().toISOString(), nivel, evento, ...datos });
    if (nivel === 'error') process.stderr.write(`${linea}\n`);
    else process.stdout.write(`${linea}\n`);
  };
  return {
    info: (evento, datos) => escribir('info', evento, datos),
    advertencia: (evento, datos) => escribir('advertencia', evento, datos),
    error: (evento, datos) => escribir('error', evento, datos),
  };
}

/** Registro que no escribe nada (pruebas). */
export const registroSilencioso: Registro = {
  info: () => undefined,
  advertencia: () => undefined,
  error: () => undefined,
};
