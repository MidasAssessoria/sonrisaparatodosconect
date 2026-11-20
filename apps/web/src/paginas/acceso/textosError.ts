import { ErrorAuth } from '../../auth/servicioAuth.js';
import type { Textos } from '../../i18n/es.js';

/** Mensaje para un error de Supabase Auth, con la voz del design system. */
export function mensajeAuth(error: unknown, t: Textos): string {
  if (!(error instanceof ErrorAuth)) return t.comun.errorGenerico;
  switch (error.tipo) {
    case 'credenciales':
      return t.acceso.credenciales;
    case 'correo_sin_confirmar':
      return t.acceso.sinConfirmar;
    case 'codigo_invalido':
      return t.segundoFactor.incorrecto;
    case 'clave_debil':
      return t.nuevaClave.debil;
    case 'clave_repetida':
      return t.nuevaClave.repetida;
    case 'demasiados_intentos':
      return t.acceso.demasiados;
    case 'sin_conexion':
      return t.comun.sinConexion;
    default:
      return t.comun.errorGenerico;
  }
}

export const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const RE_CODIGO = /^\d{6}$/;
