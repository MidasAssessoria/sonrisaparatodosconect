import type { CodigoError, ErrorApi as CuerpoErrorApi } from '@conecta/shared';

export type DetalleError = NonNullable<CuerpoErrorApi['detalles']>[number];

/**
 * Error con código estable del contrato (`CODIGOS_ERROR`). El filtro global lo responde tal cual;
 * cualquier otro error se traduce antes de salir (ver `traducir.ts`).
 */
export class ErrorApi extends Error {
  override name = 'ErrorApi';

  constructor(
    readonly estado: number,
    readonly codigo: CodigoError,
    mensaje: string,
    readonly detalles?: DetalleError[],
  ) {
    super(mensaje);
  }

  cuerpo(): CuerpoErrorApi {
    return {
      codigo: this.codigo,
      mensaje: this.message,
      ...(this.detalles && this.detalles.length > 0 ? { detalles: this.detalles } : {}),
    };
  }
}

/** Errores frecuentes, con mensajes que dicen qué hacer. */
export const errores = {
  noAutenticado: (mensaje = 'Tu sesión no es válida o venció. Ingresá de nuevo.') =>
    new ErrorApi(401, 'no_autenticado', mensaje),
  mfaRequerido: (
    mensaje = 'Tu cuenta tiene doble factor: confirmá el código de tu aplicación para seguir.',
  ) => new ErrorApi(403, 'mfa_requerido', mensaje),
  sinMembresia: (
    mensaje = 'No tenés acceso activo a esta clínica. Pedile a quien la administra que te habilite.',
  ) => new ErrorApi(403, 'sin_membresia', mensaje),
  clinicaRequerida: () =>
    new ErrorApi(
      400,
      'clinica_requerida',
      'Trabajás en más de una clínica: elegí en cuál querés trabajar y probá de nuevo.',
    ),
  sinPermiso: (
    mensaje = 'Tu rol no tiene permiso para hacer esto. Pedile acceso a quien administra la clínica.',
  ) => new ErrorApi(403, 'sin_permiso', mensaje),
  sedeNoPermitida: () =>
    new ErrorApi(
      403,
      'sede_no_permitida',
      'No tenés acceso a esa sede. Elegí una de tus sedes o pedile acceso a quien administra la clínica.',
    ),
  noEncontrado: (mensaje = 'No encontramos lo que buscabas. Volvé a la lista y probá de nuevo.') =>
    new ErrorApi(404, 'no_encontrado', mensaje),
  datosInvalidos: (mensaje: string, detalles?: DetalleError[]) =>
    new ErrorApi(400, 'datos_invalidos', mensaje, detalles),
  conflicto: (mensaje: string) => new ErrorApi(409, 'conflicto', mensaje),
  interno: () =>
    new ErrorApi(
      500,
      'error_interno',
      'Tuvimos un problema en el servidor. Probá de nuevo en un momento; si sigue pasando, avisá a soporte.',
    ),
};
