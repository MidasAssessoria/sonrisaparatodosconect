import {
  agendaConfigSchema,
  bloqueoSchema,
  errorApiSchema,
  personaSchema,
  profesionalSchema,
  tratamientoSchema,
  CABECERA_CLINICA,
  type AgendaConfig,
  type Baja,
  type Bloqueo,
  type CrearBloqueo,
  type CrearProfesional,
  type CrearTratamiento,
  type EditarProfesional,
  type EditarTratamiento,
  type GuardarAgendaConfig,
  type Persona,
  type Profesional,
  type ReemplazarDisponibilidad,
  type Tratamiento,
} from '@conecta/shared';
import { useMemo } from 'react';
import { z } from 'zod';
import { BASE_API } from '../../api/cliente.js';
import { ErrorConecta } from '../../api/errores.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';

/*
 * Cliente de los endpoints de profesionales, tratamientos y agenda de sede (Sprint 2).
 *
 * Vive acá y no en `api/cliente.ts` porque ese archivo es compartido. Repite la forma de `pedir`
 * de ese cliente (cabeceras, errores con `ErrorConecta`, validación con el contrato). Convendría
 * mudarlo allá: así usaría el `fetch` que recibe `ProveedorSesion` y sus reacciones globales.
 * Mientras tanto usa el `fetch` global (el mismo que usa la app fuera de las pruebas).
 */

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const MENSAJE_SIN_CONEXION =
  'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';
const MENSAJE_RESPUESTA_INVALIDA =
  'El servidor respondió algo que no esperábamos. Probá de nuevo; si sigue pasando, avisá a soporte.';
const MENSAJE_POR_ESTADO: Record<number, { codigo: ErrorConecta['codigo']; mensaje: string }> = {
  401: { codigo: 'no_autenticado', mensaje: 'Tu sesión venció. Ingresá de nuevo.' },
  403: { codigo: 'sin_permiso', mensaje: 'Tu rol no tiene acceso a esto.' },
  404: { codigo: 'no_encontrado', mensaje: 'No encontramos lo que buscabas. Volvé a la lista.' },
  409: { codigo: 'conflicto', mensaje: 'Alguien cambió estos datos. Recargá y probá de nuevo.' },
};

export interface OpcionesClienteCatalogos {
  obtenerToken: () => Promise<string | null>;
  obtenerClinicaId: () => string | null;
  alError?: (e: ErrorConecta) => void;
  fetch?: typeof fetch;
  base?: string;
}

const id = (v: string) => encodeURIComponent(v);

export function crearClienteCatalogos(op: OpcionesClienteCatalogos) {
  const base = op.base ?? BASE_API;
  // Se lee en cada pedido: las pruebas reemplazan el `fetch` global.
  const fetchImpl = op.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

  async function pedir<T>(
    metodo: Metodo,
    ruta: string,
    esquema: z.ZodType<T> | null,
    cuerpo?: unknown,
  ): Promise<T> {
    const cabeceras: Record<string, string> = { Accept: 'application/json' };
    const token = await op.obtenerToken();
    if (token) cabeceras['Authorization'] = `Bearer ${token}`;
    const clinicaId = op.obtenerClinicaId();
    if (clinicaId) cabeceras[CABECERA_CLINICA] = clinicaId;
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
    const fallar = (e: ErrorConecta): never => {
      op.alError?.(e);
      throw e;
    };

    let r: Response;
    try {
      r = await fetchImpl(`${base}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
      });
    } catch {
      return fallar(new ErrorConecta('sin_conexion', MENSAJE_SIN_CONEXION));
    }
    if (!r.ok) {
      let datos: unknown;
      try {
        datos = await r.json();
      } catch {
        datos = null;
      }
      const e = errorApiSchema.safeParse(datos);
      if (e.success) {
        return fallar(
          new ErrorConecta(e.data.codigo, e.data.mensaje, {
            estado: r.status,
            detalles: e.data.detalles ?? [],
          }),
        );
      }
      const porEstado = MENSAJE_POR_ESTADO[r.status];
      return fallar(
        new ErrorConecta(
          porEstado?.codigo ?? 'error_interno',
          porEstado?.mensaje ?? 'El servidor tuvo un problema. Probá de nuevo en un momento.',
          { estado: r.status },
        ),
      );
    }
    if (esquema === null || r.status === 204) return undefined as T;
    let datos: unknown;
    try {
      datos = await r.json();
    } catch {
      return fallar(
        new ErrorConecta('respuesta_invalida', MENSAJE_RESPUESTA_INVALIDA, { estado: r.status }),
      );
    }
    const v = esquema.safeParse(datos);
    if (!v.success) {
      return fallar(
        new ErrorConecta('respuesta_invalida', MENSAJE_RESPUESTA_INVALIDA, { estado: r.status }),
      );
    }
    return v.data;
  }

  return {
    profesionales: {
      listar: (): Promise<Profesional[]> =>
        pedir('GET', '/profesionales', z.array(profesionalSchema)),
      obtener: (pid: string): Promise<Profesional> =>
        pedir('GET', `/profesionales/${id(pid)}`, profesionalSchema),
      crear: (datos: CrearProfesional): Promise<Profesional> =>
        pedir('POST', '/profesionales', profesionalSchema, datos),
      editar: (pid: string, datos: EditarProfesional): Promise<Profesional> =>
        pedir('PATCH', `/profesionales/${id(pid)}`, profesionalSchema, datos),
      reemplazarDisponibilidad: (
        pid: string,
        datos: ReemplazarDisponibilidad,
      ): Promise<Profesional> =>
        pedir('PUT', `/profesionales/${id(pid)}/disponibilidad`, profesionalSchema, datos),
      crearBloqueo: (pid: string, datos: CrearBloqueo): Promise<Bloqueo> =>
        pedir('POST', `/profesionales/${id(pid)}/bloqueos`, bloqueoSchema, datos),
      quitarBloqueo: (bid: string, baja: Baja): Promise<void> =>
        pedir('DELETE', `/bloqueos/${id(bid)}`, null, baja),
    },
    personal: {
      listar: (): Promise<Persona[]> => pedir('GET', '/personal', z.array(personaSchema)),
    },
    tratamientos: {
      listar: (): Promise<Tratamiento[]> =>
        pedir('GET', '/tratamientos', z.array(tratamientoSchema)),
      crear: (datos: CrearTratamiento): Promise<Tratamiento> =>
        pedir('POST', '/tratamientos', tratamientoSchema, datos),
      editar: (tid: string, datos: EditarTratamiento): Promise<Tratamiento> =>
        pedir('PATCH', `/tratamientos/${id(tid)}`, tratamientoSchema, datos),
    },
    agenda: {
      obtener: (sedeId: string): Promise<AgendaConfig> =>
        pedir('GET', `/sedes/${id(sedeId)}/agenda`, agendaConfigSchema),
      guardar: (sedeId: string, datos: GuardarAgendaConfig): Promise<AgendaConfig> =>
        pedir('PUT', `/sedes/${id(sedeId)}/agenda`, agendaConfigSchema, datos),
    },
  };
}

export type ClienteCatalogos = ReturnType<typeof crearClienteCatalogos>;

/** Cliente con el token y la clínica de la sesión. Una sesión vencida cierra como el cliente común. */
export function useApiCatalogos(): ClienteCatalogos {
  const { auth, sesion, cerrarSesion } = useSesionLista();
  const clinicaId = sesion.clinica.id;
  return useMemo(
    () =>
      crearClienteCatalogos({
        obtenerToken: () => auth.obtenerToken(),
        obtenerClinicaId: () => clinicaId,
        alError: (e) => {
          if (e.codigo === 'no_autenticado') void cerrarSesion({ tipo: 'vencida' });
          else if (e.codigo === 'sin_membresia') void cerrarSesion({ tipo: 'sin_membresia' });
        },
      }),
    [auth, clinicaId, cerrarSesion],
  );
}

export const claves = {
  profesionales: (c: string) => ['profesionales', c] as const,
  profesional: (c: string, pid: string) => ['profesionales', c, pid] as const,
  personal: (c: string) => ['catalogos', 'personal', c] as const,
  tratamientos: (c: string) => ['tratamientos', c] as const,
  agenda: (c: string, sedeId: string) => ['agenda-sede', c, sedeId] as const,
};
