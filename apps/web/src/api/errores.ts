import type { CodigoError } from '@conecta/shared';

/**
 * Códigos que ve la web. Los de la API (`CodigoError`) más dos propios:
 * - `sin_conexion`: el pedido no llegó (red caída, servidor apagado).
 * - `respuesta_invalida`: la API respondió algo que no cumple el contrato.
 */
export type CodigoErrorWeb = CodigoError | 'sin_conexion' | 'respuesta_invalida';

export interface DetalleCampo {
  campo: string;
  mensaje: string;
}

/** Error de un pedido a la API. La web decide según `codigo`, no según el texto. */
export class ErrorConecta extends Error {
  readonly codigo: CodigoErrorWeb;
  readonly estado: number | null;
  readonly detalles: DetalleCampo[];

  constructor(
    codigo: CodigoErrorWeb,
    mensaje: string,
    opciones: { estado?: number | null; detalles?: DetalleCampo[] } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorConecta';
    this.codigo = codigo;
    this.estado = opciones.estado ?? null;
    this.detalles = opciones.detalles ?? [];
  }
}

/** Qué hace la app ante cada código. */
export type Reaccion =
  | { tipo: 'cerrar_sesion' }
  | { tipo: 'segundo_factor' }
  | { tipo: 'elegir_clinica' }
  | { tipo: 'sin_acceso' }
  | { tipo: 'mensaje' };

export function reaccionPorCodigo(codigo: CodigoErrorWeb): Reaccion {
  switch (codigo) {
    case 'no_autenticado':
      return { tipo: 'cerrar_sesion' };
    case 'mfa_requerido':
      return { tipo: 'segundo_factor' };
    case 'clinica_requerida':
      return { tipo: 'elegir_clinica' };
    case 'sin_permiso':
    case 'sede_no_permitida':
      return { tipo: 'sin_acceso' };
    default:
      return { tipo: 'mensaje' };
  }
}

export const TEXTO_SIN_ACCESO = 'Tu rol no tiene acceso a esto.';

/** Mensaje en pantalla para cualquier error. Siempre dice qué hacer. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorConecta) {
    const r = reaccionPorCodigo(error.codigo);
    if (r.tipo === 'sin_acceso') return TEXTO_SIN_ACCESO;
    if (error.message) return error.message;
  }
  return 'Algo salió mal. Probá de nuevo en un momento.';
}
