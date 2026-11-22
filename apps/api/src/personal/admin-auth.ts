/**
 * Cuentas de Supabase Auth del lado del servidor (Admin API). Lo usan las invitaciones (contrato de
 * personal): pedirle a Supabase el correo de invitación para un correo sin cuenta confirmada, y
 * consultar si una cuenta existe, si su correo está confirmado y si nació de una invitación.
 *
 * La clave secreta (`SUPABASE_SECRET_KEY`) vive solo dentro del cliente de Supabase: nunca va a un
 * registro, a una respuesta ni a un error. Sin clave, `disponible` es false y todo lo que necesita
 * la Admin API responde 503 `servicio_no_disponible`.
 *
 * Los errores salen ya como `ErrorApi` del contrato; ningún mensaje de Supabase llega al cliente.
 *
 * COSTO de `buscarPorCorreo`: la Admin API no busca por correo exacto (el filtro de `listUsers` va
 * en la URL y busca por subcadena), así que se recorre la lista de a 1000 cuentas: un pedido por
 * cada 1000 cuentas del proyecto hasta encontrarla (con 50.000 cuentas, hasta 50 pedidos; más allá
 * responde 503 y hay que cambiar la búsqueda). Para no pagarlo en cada consulta:
 *   - las invitaciones miran primero `app.usuario` (quien ya aceptó alguna invitación tiene cuenta
 *     confirmada) y llaman a la Admin API solo si hace falta;
 *   - acá se recuerda, en memoria y por instancia, el id de cuenta de cada correo visto (clave:
 *     SHA-256 del correo, no el correo; hasta `MAX_RECORDADOS`): con un id conocido alcanza un solo
 *     `getUserById`, y si el correo de esa cuenta cambió se vuelve a recorrer la lista.
 */
import { createHash } from 'node:crypto';
import { createClient, isAuthApiError, type User } from '@supabase/supabase-js';
import { errores, type ErrorApi } from '../errores/error-api.js';

export const ADMIN_AUTH = Symbol('ADMIN_AUTH');

/** Marca que la API pone en `user_metadata` de las cuentas que nacen de una invitación. */
export const METADATO_INVITACION = 'conecta_invitacion';

export interface CuentaAuth {
  /** Id de la cuenta en Supabase Auth (= `app.usuario.id`). */
  id: string;
  /** Correo de la cuenta, en minúsculas. */
  email: string;
  /** El correo está confirmado (`email_confirmed_at`). */
  confirmada: boolean;
  /**
   * La cuenta nació de una invitación (`invited_at`, o la marca de la API en sus metadatos): quien
   * la abrió desde el correo todavía puede no haber elegido contraseña.
   */
  nacidaPorInvitacion: boolean;
}

export interface AdminAuth {
  /** Hay clave secreta: se puede usar la Admin API. */
  readonly disponible: boolean;
  /** Cuenta con ese correo (sin distinguir mayúsculas), o null. */
  buscarPorCorreo(email: string): Promise<CuentaAuth | null>;
  /** Cuenta con ese id, o null si no existe. */
  obtenerCuenta(id: string): Promise<CuentaAuth | null>;
  /**
   * Pide a Supabase el correo de invitación (`inviteUserByEmail`) con vuelta a `redirectTo`. Si el
   * correo no tiene cuenta, Supabase la crea (sin confirmar); si la tiene sin confirmar, reenvía.
   * Devuelve `ya_confirmada` si el correo ya tiene una cuenta confirmada (no se manda nada).
   */
  invitarPorCorreo(email: string, redirectTo: string): Promise<'enviada' | 'ya_confirmada'>;
  /**
   * Manda un enlace de ingreso por correo (magic link de Supabase, sin crear cuentas) con vuelta a
   * `redirectTo`. Para una cuenta nacida de una invitación que ya confirmó su correo pero todavía no
   * aceptó nada: el enlace del correo de invitación se usa una sola vez, y sin esto esa persona no
   * tendría cómo volver con sesión.
   */
  enviarEnlaceIngreso(email: string, redirectTo: string): Promise<void>;
}

export const MENSAJE_SIN_CLAVE_SECRETA =
  'Todavía no podemos mandar ni aceptar invitaciones: falta configurar la conexión con el servicio de cuentas. Avisá a soporte.';

export const servicioDeCuentasCaido = (): ErrorApi =>
  errores.servicioNoDisponible(
    'El servicio de cuentas no responde en este momento. Esperá unos segundos y probá de nuevo.',
  );

export const correoNoEnviado = (): ErrorApi =>
  errores.servicioNoDisponible(
    'No pudimos mandar el correo de invitación en este momento, así que la invitación no se guardó. Esperá unos minutos y probá de nuevo.',
  );

/** Sin clave secreta: nada de la Admin API está disponible. */
export const adminAuthNoConfigurado: AdminAuth = {
  disponible: false,
  buscarPorCorreo: () => Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
  obtenerCuenta: () => Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
  invitarPorCorreo: () => Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
  enviarEnlaceIngreso: () =>
    Promise.reject(errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA)),
};

/** Usuarios por página al buscar por correo. */
const POR_PAGINA = 1000;
/** Tope de páginas: con más de 50.000 cuentas hay que cambiar la búsqueda (ver arriba). */
const MAX_PAGINAS = 50;
/** Correos recordados (hash → id de cuenta), por instancia. */
const MAX_RECORDADOS = 10_000;
const ESPERA_MS = 8_000;

const CODIGOS_CUENTA_EXISTENTE = new Set(['email_exists', 'user_already_exists']);

function normalizar(email: string): string {
  return email.trim().toLowerCase();
}

function hashCorreo(email: string): string {
  return createHash('sha256').update(normalizar(email), 'utf8').digest('hex');
}

/** `User` de Supabase → `CuentaAuth` (null si no tiene correo). */
export function cuentaDe(usuario: User): CuentaAuth | null {
  if (!usuario.email) return null;
  const metadatos = (usuario.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: usuario.id.toLowerCase(),
    email: normalizar(usuario.email),
    confirmada: Boolean(usuario.email_confirmed_at),
    nacidaPorInvitacion: Boolean(usuario.invited_at) || metadatos[METADATO_INVITACION] === true,
  };
}

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
  const recordados = new Map<string, string>();

  const recordar = (cuenta: CuentaAuth): void => {
    const clave = hashCorreo(cuenta.email);
    recordados.delete(clave);
    if (recordados.size >= MAX_RECORDADOS) {
      const masViejo = recordados.keys().next().value;
      if (masViejo !== undefined) recordados.delete(masViejo);
    }
    recordados.set(clave, cuenta.id);
  };

  async function obtenerCuenta(id: string): Promise<CuentaAuth | null> {
    let respuesta;
    try {
      respuesta = await admin.getUserById(id);
    } catch {
      throw servicioDeCuentasCaido();
    }
    if (respuesta.error) {
      if (isAuthApiError(respuesta.error) && respuesta.error.status === 404) return null;
      throw servicioDeCuentasCaido();
    }
    const cuenta = cuentaDe(respuesta.data.user);
    if (cuenta) recordar(cuenta);
    return cuenta;
  }

  async function recorrerLista(buscado: string): Promise<CuentaAuth | null> {
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
      const cuenta = hallada ? cuentaDe(hallada) : null;
      if (cuenta) {
        recordar(cuenta);
        return cuenta;
      }
      if (respuesta.data.users.length < porPagina || !respuesta.data.nextPage) return null;
    }
    throw servicioDeCuentasCaido();
  }

  return {
    disponible: true,

    obtenerCuenta,

    async buscarPorCorreo(email) {
      const buscado = normalizar(email);
      const id = recordados.get(hashCorreo(buscado));
      if (id !== undefined) {
        const cuenta = await obtenerCuenta(id);
        if (cuenta?.email === buscado) return cuenta;
        recordados.delete(hashCorreo(buscado));
      }
      return recorrerLista(buscado);
    },

    async invitarPorCorreo(email, redirectTo) {
      let respuesta;
      try {
        respuesta = await admin.inviteUserByEmail(normalizar(email), {
          redirectTo,
          data: { [METADATO_INVITACION]: true },
        });
      } catch {
        throw correoNoEnviado();
      }
      const { data, error } = respuesta;
      if (error) {
        if (isAuthApiError(error) && error.code && CODIGOS_CUENTA_EXISTENTE.has(error.code)) {
          return 'ya_confirmada';
        }
        throw correoNoEnviado();
      }
      const cuenta = cuentaDe(data.user);
      if (cuenta) recordar(cuenta);
      return 'enviada';
    },

    async enviarEnlaceIngreso(email, redirectTo) {
      let respuesta;
      try {
        respuesta = await cliente.auth.signInWithOtp({
          email: normalizar(email),
          options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
        });
      } catch {
        throw correoNoEnviado();
      }
      if (respuesta.error) throw correoNoEnviado();
    },
  };
}
