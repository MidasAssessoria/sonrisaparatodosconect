/**
 * Cuentas de Supabase Auth del lado del servidor (Admin API). Solo lo usa la aceptación de
 * invitaciones: buscar si un correo ya tiene cuenta, crear la cuenta confirmada de quien acepta sin
 * cuenta previa y borrarla si la aceptación falla después (compensación).
 *
 * La clave secreta (`SUPABASE_SECRET_KEY`) vive solo dentro del cliente de Supabase: nunca va a un
 * registro, a una respuesta ni a un error. Sin clave, `disponible` es false y todo lo que necesita
 * la Admin API responde 503 `servicio_no_disponible`.
 *
 * Los errores salen ya como `ErrorApi` del contrato; ningún mensaje de Supabase llega al cliente.
 */
import { createClient, isAuthApiError, isAuthWeakPasswordError } from '@supabase/supabase-js';
import { errores, type ErrorApi } from '../errores/error-api.js';

export const ADMIN_AUTH = Symbol('ADMIN_AUTH');

export interface CuentaAuth {
  /** Id de la cuenta en Supabase Auth (= `app.usuario.id`). */
  id: string;
  /** Correo de la cuenta, en minúsculas. */
  email: string;
}

export interface AdminAuth {
  /** Hay clave secreta: se pueden crear cuentas. */
  readonly disponible: boolean;
  /** Cuenta con ese correo (sin distinguir mayúsculas), o null. */
  buscarPorCorreo(email: string): Promise<CuentaAuth | null>;
  /**
   * Crea la cuenta con el correo ya confirmado (tener el enlace prueba el acceso a la invitación).
   * Lanza `conflicto` si el correo ya tiene cuenta y `datos_invalidos` si Auth rechaza la clave.
   */
  crearCuentaConfirmada(email: string, clave: string): Promise<CuentaAuth>;
  /** Borra una cuenta. Si ya no existe, no hace nada. */
  borrarCuenta(id: string): Promise<void>;
}

export const MENSAJE_SIN_CLAVE_SECRETA =
  'Todavía no se pueden crear cuentas nuevas desde una invitación: falta configurar la conexión con el servicio de cuentas. Avisá a la clínica; si ya tenés una cuenta con ese correo, ingresá con ella y abrí el enlace de nuevo.';

export const cuentaExistente = (): ErrorApi =>
  errores.conflicto(
    'Ese correo ya tiene una cuenta. Ingresá con esa cuenta y abrí el enlace de nuevo para aceptar.',
  );

const servicioDeCuentasCaido = (): ErrorApi =>
  errores.servicioNoDisponible(
    'El servicio de cuentas no responde en este momento. Esperá unos segundos y probá de nuevo.',
  );

/** Sin clave secreta: nada de la Admin API está disponible. */
export const adminAuthNoConfigurado: AdminAuth = {
  disponible: false,
  buscarPorCorreo: () => Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
  crearCuentaConfirmada: () =>
    Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
  borrarCuenta: () => Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
};

/** Usuarios por página al buscar por correo (la Admin API no busca por correo exacto). */
const POR_PAGINA = 1000;
/** Tope de páginas: con más de 50.000 cuentas hay que cambiar la búsqueda (ver el reporte). */
const MAX_PAGINAS = 50;
const ESPERA_MS = 8_000;

const CODIGOS_CUENTA_EXISTENTE = new Set(['email_exists', 'user_already_exists']);

/** Implementación real con `@supabase/supabase-js` (cliente admin, sin sesión persistente). */
export function crearAdminAuthSupabase(
  url: string,
  claveSecreta: string,
  opciones: { porPagina?: number } = {},
): AdminAuth {
  const porPagina = opciones.porPagina ?? POR_PAGINA;
  const cliente = createClient(url, claveSecreta, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (entrada, init) => fetch(entrada, { ...init, signal: AbortSignal.timeout(ESPERA_MS) }),
    },
  });
  const admin = cliente.auth.admin;

  return {
    disponible: true,

    async buscarPorCorreo(email) {
      const buscado = email.trim().toLowerCase();
      // Se recorre la lista en vez de usar el filtro de la Admin API: el filtro va en la URL (y el
      // correo terminaría en los registros de algún proxy) y además busca por subcadena.
      for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
        let respuesta;
        try {
          respuesta = await admin.listUsers({ page: pagina, perPage: porPagina });
        } catch {
          throw servicioDeCuentasCaido();
        }
        if (respuesta.error) throw servicioDeCuentasCaido();
        const hallada = respuesta.data.users.find((u) => u.email?.toLowerCase() === buscado);
        if (hallada?.email) return { id: hallada.id, email: hallada.email.toLowerCase() };
        if (respuesta.data.users.length < porPagina || !respuesta.data.nextPage) return null;
      }
      throw servicioDeCuentasCaido();
    },

    async crearCuentaConfirmada(email, clave) {
      let respuesta;
      try {
        respuesta = await admin.createUser({ email, password: clave, email_confirm: true });
      } catch {
        throw servicioDeCuentasCaido();
      }
      const { data, error } = respuesta;
      if (error) {
        if (isAuthWeakPasswordError(error)) {
          throw errores.datosInvalidos(
            'Esa contraseña es muy fácil de adivinar. Elegí otra más larga, con letras y números.',
            [{ campo: 'clave', mensaje: 'Elegí una contraseña más segura.' }],
          );
        }
        if (isAuthApiError(error) && error.code && CODIGOS_CUENTA_EXISTENTE.has(error.code)) {
          throw cuentaExistente();
        }
        throw servicioDeCuentasCaido();
      }
      const correo = data.user.email?.toLowerCase();
      if (!correo) throw servicioDeCuentasCaido();
      return { id: data.user.id.toLowerCase(), email: correo };
    },

    async borrarCuenta(id) {
      let respuesta;
      try {
        respuesta = await admin.deleteUser(id);
      } catch {
        throw servicioDeCuentasCaido();
      }
      if (respuesta.error) {
        if (isAuthApiError(respuesta.error) && respuesta.error.status === 404) return;
        throw servicioDeCuentasCaido();
      }
    },
  };
}
