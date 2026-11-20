import {
  CABECERA_CLINICA,
  errorApiSchema,
  paginaAuditoriaSchema,
  sedeSchema,
  sesionSchema,
  sillonSchema,
  type Baja,
  type ConsultaAuditoria,
  type CrearSede,
  type CrearSillon,
  type EditarSede,
  type EditarSillon,
  type PaginaAuditoria,
  type ReemplazarHorarios,
  type Sede,
  type Sesion,
  type Sillon,
} from '@conecta/shared';
import { z } from 'zod';
import { ErrorConecta, TEXTO_DEMASIADOS_PEDIDOS, TEXTO_SERVICIO_NO_DISPONIBLE } from './errores.js';

const RUTA_API = '/api/v1';

/**
 * Base de la API a partir de su origen (`VITE_API_URL`, p. ej. «https://api.conecta.com.py»).
 * Vacío = mismo origen que la web (en desarrollo, el proxy de Vite).
 */
export function baseApi(origen: string | undefined | null): string {
  const limpio = (origen ?? '').trim().replace(/\/+$/, '');
  return `${limpio}${RUTA_API}`;
}

/** Base configurada en el build. */
export const BASE_API = baseApi(import.meta.env['VITE_API_URL'] as string | undefined);

/** `Retry-After` en segundos o como fecha HTTP → momento (ms) desde el que se puede reintentar. */
export function reintentarDesde(valor: string | null, ahora: number = Date.now()): number | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (/^\d+$/.test(texto)) return ahora + Number(texto) * 1000;
  const fecha = Date.parse(texto);
  return Number.isFinite(fecha) ? Math.max(fecha, ahora) : null;
}

export interface OpcionesClienteApi {
  /** `fetch` a usar (las pruebas pasan uno falso). */
  fetch?: typeof fetch;
  /** Base de la API; por defecto `BASE_API` (de `VITE_API_URL`). */
  base?: string;
  /** Token de acceso vigente de Supabase, o `null` sin sesión. */
  obtenerToken: () => Promise<string | null>;
  /** Clínica en la que se trabaja (`X-Clinica-Id`), o `null` para omitir la cabecera. */
  obtenerClinicaId: () => string | null;
  /** Se llama ante todo error de la API antes de lanzarlo (reacciones globales). */
  alError?: (error: ErrorConecta) => void;
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Pedido<T> {
  metodo: Metodo;
  ruta: string;
  cuerpo?: unknown;
  esquema: z.ZodType<T> | null;
  /** Clínica explícita para este pedido (p. ej. al elegir clínica). `null` = sin cabecera. */
  clinicaId?: string | null;
  /** No dispara las reacciones globales (`alError`); p. ej. el aviso de cierre de sesión. */
  silencioso?: boolean;
}

const MENSAJE_SIN_CONEXION =
  'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';
const MENSAJE_RESPUESTA_INVALIDA =
  'El servidor respondió algo que no esperábamos. Probá de nuevo; si sigue pasando, avisá a soporte.';

const MENSAJE_POR_ESTADO: Record<number, { codigo: ErrorConecta['codigo']; mensaje: string }> = {
  401: { codigo: 'no_autenticado', mensaje: 'Tu sesión venció. Ingresá de nuevo.' },
  403: { codigo: 'sin_permiso', mensaje: 'Tu rol no tiene acceso a esto.' },
  404: { codigo: 'no_encontrado', mensaje: 'No encontramos lo que buscabas. Volvé a la lista.' },
  409: { codigo: 'conflicto', mensaje: 'Alguien cambió estos datos. Recargá y probá de nuevo.' },
  429: { codigo: 'demasiados_pedidos', mensaje: TEXTO_DEMASIADOS_PEDIDOS },
  503: { codigo: 'servicio_no_disponible', mensaje: TEXTO_SERVICIO_NO_DISPONIBLE },
};

export function crearClienteApi(opciones: OpcionesClienteApi) {
  const fetchImpl = opciones.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = opciones.base ?? BASE_API;

  async function pedir<T>(p: Pedido<T>): Promise<T> {
    const cabeceras: Record<string, string> = { Accept: 'application/json' };
    const token = await opciones.obtenerToken();
    if (token) cabeceras['Authorization'] = `Bearer ${token}`;
    const clinicaId = p.clinicaId === undefined ? opciones.obtenerClinicaId() : p.clinicaId;
    if (clinicaId) cabeceras[CABECERA_CLINICA] = clinicaId;
    if (p.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

    const fallar = (e: ErrorConecta): never => {
      if (!p.silencioso) opciones.alError?.(e);
      throw e;
    };

    let respuesta: Response;
    try {
      respuesta = await fetchImpl(`${base}${p.ruta}`, {
        method: p.metodo,
        headers: cabeceras,
        ...(p.cuerpo !== undefined ? { body: JSON.stringify(p.cuerpo) } : {}),
      });
    } catch {
      return fallar(new ErrorConecta('sin_conexion', MENSAJE_SIN_CONEXION));
    }

    if (!respuesta.ok) {
      let cuerpo: unknown;
      try {
        cuerpo = await respuesta.json();
      } catch {
        cuerpo = null;
      }
      const desde =
        respuesta.status === 429 ? reintentarDesde(respuesta.headers.get('retry-after')) : null;
      const error = errorApiSchema.safeParse(cuerpo);
      if (error.success) {
        return fallar(
          new ErrorConecta(error.data.codigo, error.data.mensaje, {
            estado: respuesta.status,
            detalles: error.data.detalles ?? [],
            reintentarDesde: desde,
          }),
        );
      }
      const porEstado = MENSAJE_POR_ESTADO[respuesta.status];
      return fallar(
        new ErrorConecta(
          porEstado?.codigo ?? 'error_interno',
          porEstado?.mensaje ?? 'El servidor tuvo un problema. Probá de nuevo en un momento.',
          { estado: respuesta.status, reintentarDesde: desde },
        ),
      );
    }

    if (p.esquema === null || respuesta.status === 204) return undefined as T;

    let datos: unknown;
    try {
      datos = await respuesta.json();
    } catch {
      return fallar(
        new ErrorConecta('respuesta_invalida', MENSAJE_RESPUESTA_INVALIDA, {
          estado: respuesta.status,
        }),
      );
    }
    const validado = p.esquema.safeParse(datos);
    if (!validado.success) {
      return fallar(
        new ErrorConecta('respuesta_invalida', MENSAJE_RESPUESTA_INVALIDA, {
          estado: respuesta.status,
        }),
      );
    }
    return validado.data;
  }

  return {
    sesion: {
      /** `clinicaId` explícito: `null` = sin cabecera (que la API decida). */
      obtener: (clinicaId?: string | null): Promise<Sesion> =>
        pedir({
          metodo: 'GET',
          ruta: '/sesion',
          esquema: sesionSchema,
          ...(clinicaId !== undefined ? { clinicaId } : {}),
        }),
      /**
       * `POST /sesion/cerrar` (204): la API deja de aceptar el token. Silencioso: lo llama el
       * cierre de sesión y no tiene que volver a disparar reacciones globales.
       */
      cerrar: (): Promise<void> =>
        pedir({ metodo: 'POST', ruta: '/sesion/cerrar', esquema: null, silencioso: true }),
      /**
       * Aviso de actividad: `GET /sesion` sin leer la respuesta. La API renueva la última
       * actividad del lado del servidor con cualquier pedido autenticado. Silencioso: quien lo
       * llama decide qué errores importan (ver `ProveedorSesion.mantenerSesion`).
       */
      mantener: (): Promise<void> =>
        pedir({ metodo: 'GET', ruta: '/sesion', esquema: null, silencioso: true }),
      /** `DELETE /sesion/mfa` (204, exige aal2): se llama justo después de quitar el factor en Supabase. */
      quitarMfa: (): Promise<void> =>
        pedir({ metodo: 'DELETE', ruta: '/sesion/mfa', esquema: null }),
    },
    sedes: {
      listar: (): Promise<Sede[]> =>
        pedir({ metodo: 'GET', ruta: '/sedes', esquema: z.array(sedeSchema) }),
      obtener: (id: string): Promise<Sede> =>
        pedir({ metodo: 'GET', ruta: `/sedes/${encodeURIComponent(id)}`, esquema: sedeSchema }),
      crear: (datos: CrearSede): Promise<Sede> =>
        pedir({ metodo: 'POST', ruta: '/sedes', cuerpo: datos, esquema: sedeSchema }),
      editar: (id: string, datos: EditarSede): Promise<Sede> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/sedes/${encodeURIComponent(id)}`,
          cuerpo: datos,
          esquema: sedeSchema,
        }),
      darDeBaja: (id: string, baja: Baja): Promise<void> =>
        pedir({
          metodo: 'DELETE',
          ruta: `/sedes/${encodeURIComponent(id)}`,
          cuerpo: baja,
          esquema: null,
        }),
      reemplazarHorarios: (id: string, datos: ReemplazarHorarios): Promise<Sede> =>
        pedir({
          metodo: 'PUT',
          ruta: `/sedes/${encodeURIComponent(id)}/horarios`,
          cuerpo: datos,
          esquema: sedeSchema,
        }),
      crearSillon: (sedeId: string, datos: CrearSillon): Promise<Sillon> =>
        pedir({
          metodo: 'POST',
          ruta: `/sedes/${encodeURIComponent(sedeId)}/sillones`,
          cuerpo: datos,
          esquema: sillonSchema,
        }),
      editarSillon: (id: string, datos: EditarSillon): Promise<Sillon> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/sillones/${encodeURIComponent(id)}`,
          cuerpo: datos,
          esquema: sillonSchema,
        }),
    },
    auditoria: {
      listar: (consulta: Partial<ConsultaAuditoria>): Promise<PaginaAuditoria> => {
        const parametros = new URLSearchParams();
        for (const [clave, valor] of Object.entries(consulta)) {
          if (valor !== undefined && valor !== '') parametros.set(clave, String(valor));
        }
        const qs = parametros.toString();
        return pedir({
          metodo: 'GET',
          ruta: `/auditoria${qs ? `?${qs}` : ''}`,
          esquema: paginaAuditoriaSchema,
        });
      },
    },
  };
}

export type ClienteApi = ReturnType<typeof crearClienteApi>;
