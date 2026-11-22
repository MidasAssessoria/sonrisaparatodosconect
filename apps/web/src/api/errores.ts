import type { CodigoError, PacienteResumen } from '@conecta/shared';

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
  /** Con 429: momento (ms) desde el que se puede volver a probar, según `Retry-After`. */
  readonly reintentarDesde: number | null;

  constructor(
    codigo: CodigoErrorWeb,
    mensaje: string,
    opciones: {
      estado?: number | null;
      detalles?: DetalleCampo[];
      reintentarDesde?: number | null;
    } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorConecta';
    this.codigo = codigo;
    this.estado = opciones.estado ?? null;
    this.detalles = opciones.detalles ?? [];
    this.reintentarDesde = opciones.reintentarDesde ?? null;
  }
}

/**
 * 409 por CI duplicada al guardar un paciente (contrato/pacientes.ts): trae el paciente que ya
 * tiene esa cédula. No bloquea: para guardar igual se reenvía con `confirmarCiDuplicada: true`.
 */
export class ErrorCiDuplicada extends ErrorConecta {
  readonly existente: PacienteResumen;

  constructor(mensaje: string, existente: PacienteResumen, detalles: DetalleCampo[] = []) {
    super('conflicto', mensaje, { estado: 409, detalles });
    this.name = 'ErrorCiDuplicada';
    this.existente = existente;
  }
}

/** Qué hace la app ante cada código. */
export type Reaccion =
  | { tipo: 'cerrar_sesion' }
  | { tipo: 'segundo_factor' }
  | { tipo: 'elegir_clinica' }
  | { tipo: 'sin_membresia' }
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
    case 'sin_membresia':
      return { tipo: 'sin_membresia' };
    case 'sin_permiso':
    case 'sede_no_permitida':
      return { tipo: 'sin_acceso' };
    default:
      // demasiados_pedidos y servicio_no_disponible también: mensaje y reintento manual, sin cerrar sesión.
      return { tipo: 'mensaje' };
  }
}

/**
 * Errores que vale la pena reintentar solos (consultas, no envíos): la red y un 5xx genérico.
 * Nunca un 429 (aunque llegue sin cuerpo) ni un 503 (`servicio_no_disponible`: reintento manual).
 */
export function esReintentable(error: unknown): boolean {
  return (
    error instanceof ErrorConecta &&
    error.estado !== 429 &&
    (error.codigo === 'sin_conexion' || error.codigo === 'error_interno')
  );
}

export const TEXTO_SIN_ACCESO = 'Tu rol no tiene acceso a esto.';
export const TEXTO_DEMASIADOS_PEDIDOS =
  'Hay muchos pedidos seguidos. Esperá un momento y probá de nuevo.';
export const TEXTO_SERVICIO_NO_DISPONIBLE =
  'El servicio no responde en este momento. Esperá unos minutos y probá de nuevo.';

/** Mensaje en pantalla para cualquier error. Siempre dice qué hacer. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorConecta) {
    const r = reaccionPorCodigo(error.codigo);
    if (r.tipo === 'sin_acceso') return TEXTO_SIN_ACCESO;
    if (error.codigo === 'demasiados_pedidos') return TEXTO_DEMASIADOS_PEDIDOS;
    if (error.message) return error.message;
  }
  return 'Algo salió mal. Probá de nuevo en un momento.';
}
