import {
  CABECERA_CLINICA,
  errorApiSchema,
  invitacionAceptadaSchema,
  invitacionCreadaSchema,
  invitacionPublicaSchema,
  personaSchema,
  rolSchema,
  type AceptarInvitacion,
  type Baja,
  type CrearInvitacion,
  type CrearRol,
  type EditarPersona,
  type EditarRol,
  type InvitacionCreada,
  type InvitacionPublica,
  type Persona,
  type Rol,
} from '@conecta/shared';
import { z } from 'zod';
import { BASE_API } from '../../api/cliente.js';
import { ErrorConecta } from '../../api/errores.js';

/*
 * Cliente de los endpoints de Equipo, Invitaciones y Roles.
 *
 * Provisorio: `api/cliente.ts` no expone su `pedir` genérico ni el `fetch` con el que se creó, así
 * que este archivo repite la misma forma de pedir (cabeceras, errores del contrato, validación con
 * Zod). Convendría moverlo a `crearClienteApi` como `personal`, `invitaciones` y `roles`; entonces
 * `useApiPersonal` (en `consultas.ts`) pasa a devolver `api` del contexto y las pantallas no cambian.
 */

export type ApiPersonal = ReturnType<typeof crearApiPersonal>;

export interface OpcionesApiPersonal {
  obtenerToken: () => Promise<string | null>;
  obtenerClinicaId: () => string | null;
  /** `fetch` a usar; por defecto el global, leído en cada pedido. */
  fetch?: typeof fetch;
  base?: string;
  /** Reacciones globales (sesión vencida, doble factor…) ante errores de pedidos con sesión. */
  alError?: (e: ErrorConecta) => void;
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
  429: {
    codigo: 'demasiados_pedidos',
    mensaje: 'Hay muchos pedidos seguidos. Esperá un momento y probá de nuevo.',
  },
  503: {
    codigo: 'servicio_no_disponible',
    mensaje: 'El servicio no responde en este momento. Esperá unos minutos y probá de nuevo.',
  },
};

interface Pedido<T> {
  metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  ruta: string;
  cuerpo?: unknown;
  esquema: z.ZodType<T> | null;
  /** Ruta pública: sin `X-Clinica-Id` y sin reacciones globales. */
  publica?: boolean;
  /** Sin `Authorization` aunque haya sesión. */
  sinToken?: boolean;
}

function id(v: string): string {
  return encodeURIComponent(v);
}

export function crearApiPersonal(op: OpcionesApiPersonal) {
  const base = op.base ?? BASE_API;
  const fetchImpl = op.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function pedir<T>(p: Pedido<T>): Promise<T> {
    const cabeceras: Record<string, string> = { Accept: 'application/json' };
    const token = p.sinToken ? null : await op.obtenerToken();
    if (token) cabeceras['Authorization'] = `Bearer ${token}`;
    const clinicaId = p.publica ? null : op.obtenerClinicaId();
    if (clinicaId) cabeceras[CABECERA_CLINICA] = clinicaId;
    if (p.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';

    const fallar = (e: ErrorConecta): never => {
      if (!p.publica) op.alError?.(e);
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
      const error = errorApiSchema.safeParse(cuerpo);
      if (error.success) {
        return fallar(
          new ErrorConecta(error.data.codigo, error.data.mensaje, {
            estado: respuesta.status,
            detalles: error.data.detalles ?? [],
          }),
        );
      }
      const porEstado = MENSAJE_POR_ESTADO[respuesta.status];
      return fallar(
        new ErrorConecta(
          porEstado?.codigo ?? 'error_interno',
          porEstado?.mensaje ?? 'El servidor tuvo un problema. Probá de nuevo en un momento.',
          { estado: respuesta.status },
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
    personal: {
      listar: (): Promise<Persona[]> =>
        pedir({ metodo: 'GET', ruta: '/personal', esquema: z.array(personaSchema) }),
      editar: (membresiaId: string, datos: EditarPersona): Promise<Persona> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/personal/${id(membresiaId)}`,
          cuerpo: datos,
          esquema: personaSchema,
        }),
      /** El contrato no fija la respuesta: se ignora y se vuelve a pedir la lista. */
      desactivar: (membresiaId: string, baja: Baja): Promise<void> =>
        pedir({
          metodo: 'POST',
          ruta: `/personal/${id(membresiaId)}/desactivar`,
          cuerpo: baja,
          esquema: null,
        }),
      reactivar: (membresiaId: string): Promise<void> =>
        pedir({ metodo: 'POST', ruta: `/personal/${id(membresiaId)}/reactivar`, esquema: null }),
    },
    invitaciones: {
      crear: (datos: CrearInvitacion): Promise<InvitacionCreada> =>
        pedir({
          metodo: 'POST',
          ruta: '/invitaciones',
          cuerpo: datos,
          esquema: invitacionCreadaSchema,
        }),
      /** `:id` = membresía pendiente (una sola invitación abierta por membresía). */
      reenviar: (membresiaId: string): Promise<InvitacionCreada> =>
        pedir({
          metodo: 'POST',
          ruta: `/invitaciones/${id(membresiaId)}/reenviar`,
          esquema: invitacionCreadaSchema,
        }),
      anular: (membresiaId: string, baja: Baja): Promise<void> =>
        pedir({
          metodo: 'DELETE',
          ruta: `/invitaciones/${id(membresiaId)}`,
          cuerpo: baja,
          esquema: null,
        }),
      consultar: (token: string): Promise<InvitacionPublica> =>
        pedir({
          metodo: 'POST',
          ruta: '/invitaciones/consultar',
          cuerpo: { token },
          esquema: invitacionPublicaSchema,
          publica: true,
          sinToken: true,
        }),
      /** `conSesion`: manda el token de la sesión abierta (cuenta existente). */
      aceptar: (
        datos: AceptarInvitacion,
        conSesion: boolean,
      ): Promise<z.infer<typeof invitacionAceptadaSchema>> =>
        pedir({
          metodo: 'POST',
          ruta: '/invitaciones/aceptar',
          cuerpo: datos,
          esquema: invitacionAceptadaSchema,
          publica: true,
          sinToken: !conSesion,
        }),
    },
    roles: {
      listar: (): Promise<Rol[]> =>
        pedir({ metodo: 'GET', ruta: '/roles', esquema: z.array(rolSchema) }),
      crear: (datos: CrearRol): Promise<Rol> =>
        pedir({ metodo: 'POST', ruta: '/roles', cuerpo: datos, esquema: rolSchema }),
      editar: (rolId: string, datos: EditarRol): Promise<Rol> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/roles/${id(rolId)}`,
          cuerpo: datos,
          esquema: rolSchema,
        }),
    },
  };
}
