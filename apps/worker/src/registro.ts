/**
 * Registro del worker: una línea JSON por evento. Nada personal ni clínico: solo ids, nombres de
 * cola, resultados y nombres de error (nunca mensajes de error, que pueden traer SQL o datos).
 */
export type DatoRegistro = string | number | boolean | null;

export interface Registro {
  info(evento: string, datos?: Record<string, DatoRegistro>): void;
  advertencia(evento: string, datos?: Record<string, DatoRegistro>): void;
  error(evento: string, datos?: Record<string, DatoRegistro>): void;
}

export function crearRegistroConsola(): Registro {
  const escribir = (nivel: string, evento: string, datos: Record<string, DatoRegistro> = {}) => {
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

/** Nombre y código de un error, para registrar sin su mensaje. */
export function datosDeError(error: unknown): Record<string, DatoRegistro> {
  const codigo = (error as { code?: unknown } | null)?.code;
  return {
    error: error instanceof Error ? error.name : typeof error,
    codigo: typeof codigo === 'string' ? codigo : null,
  };
}
