import {
  agendaConfigSchema,
  alertaManualSchema,
  archivoSchema,
  bloqueoSchema,
  CABECERA_CLINICA,
  ciDuplicadaSchema,
  errorApiSchema,
  invitacionAceptadaSchema,
  invitacionCreadaSchema,
  invitacionPublicaSchema,
  paginaAuditoriaSchema,
  paginaPacientesSchema,
  pacienteSchema,
  personaSchema,
  profesionalSchema,
  relacionSchema,
  resultadoBuscarSchema,
  rolSchema,
  sedeSchema,
  sesionSchema,
  sillonSchema,
  tratamientoSchema,
  urlArchivoSchema,
  type AgendaConfig,
  type AlertaManual,
  type Archivo,
  type Baja,
  type Bloqueo,
  type CategoriaArchivo,
  type ConsultaAuditoria,
  type ConsultaPacientes,
  type CrearBloqueo,
  type CrearInvitacion,
  type CrearPaciente,
  type CrearProfesional,
  type CrearRelacion,
  type CrearRol,
  type CrearSede,
  type CrearSillon,
  type CrearTratamiento,
  type EditarPaciente,
  type EditarPersona,
  type EditarProfesional,
  type EditarRol,
  type EditarSede,
  type EditarSillon,
  type EditarTratamiento,
  type GuardarAgendaConfig,
  type InvitacionCreada,
  type InvitacionPublica,
  type PaginaAuditoria,
  type Paciente,
  type PacienteResumen,
  type Persona,
  type Profesional,
  type ReemplazarDisponibilidad,
  type ReemplazarHorarios,
  type Relacion,
  type Rol,
  type Sede,
  type Sesion,
  type Sillon,
  type Tratamiento,
  type UrlArchivo,
} from '@conecta/shared';
import { z } from 'zod';
import {
  ErrorCiDuplicada,
  ErrorConecta,
  TEXTO_DEMASIADOS_PEDIDOS,
  TEXTO_SERVICIO_NO_DISPONIBLE,
} from './errores.js';

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
  /** Cuerpo JSON. */
  cuerpo?: unknown;
  /**
   * Cuerpo `multipart/form-data`. Sin `Content-Type` a mano: lo pone el navegador con el
   * `boundary` correcto.
   */
  formulario?: FormData;
  esquema: z.ZodType<T> | null;
  /** Clínica explícita para este pedido (p. ej. al elegir clínica). `null` = sin cabecera. */
  clinicaId?: string | null;
  /** No dispara las reacciones globales (`alError`); p. ej. el aviso de cierre de sesión. */
  silencioso?: boolean;
  /** `false`: sin `Authorization` aunque haya sesión. `'exigido'`: sin token, el pedido no sale. */
  token?: false | 'exigido';
  /**
   * Error propio de esta ruta a partir del cuerpo crudo de la respuesta (p. ej. el 409 de CI
   * duplicada, que trae más que `errorApiSchema`). `undefined` = el error genérico.
   */
  errorPropio?: (estado: number, cuerpo: unknown) => ErrorConecta | undefined;
}

/** Página de la lista de pacientes (`GET /pacientes`). */
export type PaginaPacientes = z.infer<typeof paginaPacientesSchema>;

/** 409 con `existente` (contrato/pacientes.ts, `ciDuplicadaSchema`) → `ErrorCiDuplicada` tipado. */
function errorCiDuplicada(estado: number, cuerpo: unknown): ErrorConecta | undefined {
  if (estado !== 409) return undefined;
  const r = ciDuplicadaSchema.safeParse(cuerpo);
  if (!r.success) return undefined;
  const detalles = errorApiSchema.safeParse(cuerpo);
  return new ErrorCiDuplicada(
    r.data.mensaje,
    r.data.existente,
    detalles.success ? (detalles.data.detalles ?? []) : [],
  );
}

/** Parámetros de una consulta, sin los vacíos. */
function consultaComoTexto(consulta: Record<string, string | number | undefined>): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(consulta)) {
    if (valor !== undefined && valor !== '') parametros.set(clave, String(valor));
  }
  const qs = parametros.toString();
  return qs ? `?${qs}` : '';
}

/** URL firmada de un archivo: absoluta (contrato), se usa tal cual. */
const urlArchivoAbsolutaSchema = urlArchivoSchema.refine((u) => /^https?:\/\//i.test(u.url), {
  message: 'La URL del archivo tiene que ser absoluta.',
  path: ['url'],
});

/** Segmento de ruta seguro. */
const seg = (v: string) => encodeURIComponent(v);

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
    const fallar = (e: ErrorConecta): never => {
      if (!p.silencioso) opciones.alError?.(e);
      throw e;
    };

    const cabeceras: Record<string, string> = { Accept: 'application/json' };
    const token = p.token === false ? null : await opciones.obtenerToken();
    if (token) cabeceras['Authorization'] = `Bearer ${token}`;
    else if (p.token === 'exigido') {
      const porEstado = MENSAJE_POR_ESTADO[401];
      return fallar(new ErrorConecta('no_autenticado', porEstado?.mensaje ?? '', { estado: null }));
    }
    const clinicaId = p.clinicaId === undefined ? opciones.obtenerClinicaId() : p.clinicaId;
    if (clinicaId) cabeceras[CABECERA_CLINICA] = clinicaId;
    let cuerpo: BodyInit | undefined;
    if (p.formulario !== undefined) {
      cuerpo = p.formulario;
    } else if (p.cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(p.cuerpo);
    }

    let respuesta: Response;
    try {
      respuesta = await fetchImpl(`${base}${p.ruta}`, {
        method: p.metodo,
        headers: cabeceras,
        ...(cuerpo !== undefined ? { body: cuerpo } : {}),
      });
    } catch {
      return fallar(new ErrorConecta('sin_conexion', MENSAJE_SIN_CONEXION));
    }

    if (!respuesta.ok) {
      let cuerpoError: unknown;
      try {
        cuerpoError = await respuesta.json();
      } catch {
        cuerpoError = null;
      }
      const desde =
        respuesta.status === 429 ? reintentarDesde(respuesta.headers.get('retry-after')) : null;
      const propio = p.errorPropio?.(respuesta.status, cuerpoError);
      if (propio) return fallar(propio);
      const error = errorApiSchema.safeParse(cuerpoError);
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
    /** Equipo: una persona = una membresía (`:id` es el id de la membresía). */
    personal: {
      listar: (): Promise<Persona[]> =>
        pedir({ metodo: 'GET', ruta: '/personal', esquema: z.array(personaSchema) }),
      editar: (membresiaId: string, datos: EditarPersona): Promise<Persona> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/personal/${seg(membresiaId)}`,
          cuerpo: datos,
          esquema: personaSchema,
        }),
      desactivar: (membresiaId: string, baja: Baja): Promise<Persona> =>
        pedir({
          metodo: 'POST',
          ruta: `/personal/${seg(membresiaId)}/desactivar`,
          cuerpo: baja,
          esquema: personaSchema,
        }),
      reactivar: (membresiaId: string): Promise<Persona> =>
        pedir({
          metodo: 'POST',
          ruta: `/personal/${seg(membresiaId)}/reactivar`,
          esquema: personaSchema,
        }),
    },
    invitaciones: {
      crear: (datos: CrearInvitacion): Promise<InvitacionCreada> =>
        pedir({
          metodo: 'POST',
          ruta: '/invitaciones',
          cuerpo: datos,
          esquema: invitacionCreadaSchema,
        }),
      /** `:id` = membresía pendiente. */
      reenviar: (membresiaId: string): Promise<InvitacionCreada> =>
        pedir({
          metodo: 'POST',
          ruta: `/invitaciones/${seg(membresiaId)}/reenviar`,
          esquema: invitacionCreadaSchema,
        }),
      anular: (membresiaId: string, baja: Baja): Promise<void> =>
        pedir({
          metodo: 'DELETE',
          ruta: `/invitaciones/${seg(membresiaId)}`,
          cuerpo: baja,
          esquema: null,
        }),
      /** Pública: sin token ni clínica, y sin reacciones globales. */
      consultar: (token: string): Promise<InvitacionPublica> =>
        pedir({
          metodo: 'POST',
          ruta: '/invitaciones/consultar',
          cuerpo: { token },
          esquema: invitacionPublicaSchema,
          clinicaId: null,
          token: false,
          silencioso: true,
        }),
      /**
       * Exige `Authorization` (correo de la invitación, confirmado) y va sin `X-Clinica-Id`: la
       * persona todavía no es miembro de esa clínica. Sin sesión no sale.
       */
      aceptar: (token: string): Promise<z.infer<typeof invitacionAceptadaSchema>> =>
        pedir({
          metodo: 'POST',
          ruta: '/invitaciones/aceptar',
          cuerpo: { token },
          esquema: invitacionAceptadaSchema,
          clinicaId: null,
          token: 'exigido',
          silencioso: true,
        }),
    },
    roles: {
      listar: (): Promise<Rol[]> =>
        pedir({ metodo: 'GET', ruta: '/roles', esquema: z.array(rolSchema) }),
      crear: (datos: CrearRol): Promise<Rol> =>
        pedir({ metodo: 'POST', ruta: '/roles', cuerpo: datos, esquema: rolSchema }),
      editar: (rolId: string, datos: EditarRol): Promise<Rol> =>
        pedir({ metodo: 'PATCH', ruta: `/roles/${seg(rolId)}`, cuerpo: datos, esquema: rolSchema }),
      /** Baja lógica con motivo: el rol queda inactivo. */
      desactivar: (rolId: string, baja: Baja): Promise<void> =>
        pedir({ metodo: 'DELETE', ruta: `/roles/${seg(rolId)}`, cuerpo: baja, esquema: null }),
    },
    profesionales: {
      listar: (): Promise<Profesional[]> =>
        pedir({ metodo: 'GET', ruta: '/profesionales', esquema: z.array(profesionalSchema) }),
      obtener: (pid: string): Promise<Profesional> =>
        pedir({ metodo: 'GET', ruta: `/profesionales/${seg(pid)}`, esquema: profesionalSchema }),
      crear: (datos: CrearProfesional): Promise<Profesional> =>
        pedir({
          metodo: 'POST',
          ruta: '/profesionales',
          cuerpo: datos,
          esquema: profesionalSchema,
        }),
      editar: (pid: string, datos: EditarProfesional): Promise<Profesional> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/profesionales/${seg(pid)}`,
          cuerpo: datos,
          esquema: profesionalSchema,
        }),
      reemplazarDisponibilidad: (
        pid: string,
        datos: ReemplazarDisponibilidad,
      ): Promise<Profesional> =>
        pedir({
          metodo: 'PUT',
          ruta: `/profesionales/${seg(pid)}/disponibilidad`,
          cuerpo: datos,
          esquema: profesionalSchema,
        }),
      crearBloqueo: (pid: string, datos: CrearBloqueo): Promise<Bloqueo> =>
        pedir({
          metodo: 'POST',
          ruta: `/profesionales/${seg(pid)}/bloqueos`,
          cuerpo: datos,
          esquema: bloqueoSchema,
        }),
      quitarBloqueo: (bid: string, baja: Baja): Promise<void> =>
        pedir({ metodo: 'DELETE', ruta: `/bloqueos/${seg(bid)}`, cuerpo: baja, esquema: null }),
    },
    tratamientos: {
      listar: (): Promise<Tratamiento[]> =>
        pedir({ metodo: 'GET', ruta: '/tratamientos', esquema: z.array(tratamientoSchema) }),
      crear: (datos: CrearTratamiento): Promise<Tratamiento> =>
        pedir({ metodo: 'POST', ruta: '/tratamientos', cuerpo: datos, esquema: tratamientoSchema }),
      editar: (tid: string, datos: EditarTratamiento): Promise<Tratamiento> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/tratamientos/${seg(tid)}`,
          cuerpo: datos,
          esquema: tratamientoSchema,
        }),
    },
    /** Configuración de agenda y reserva online de una sede. */
    agenda: {
      obtener: (sedeId: string): Promise<AgendaConfig> =>
        pedir({ metodo: 'GET', ruta: `/sedes/${seg(sedeId)}/agenda`, esquema: agendaConfigSchema }),
      guardar: (sedeId: string, datos: GuardarAgendaConfig): Promise<AgendaConfig> =>
        pedir({
          metodo: 'PUT',
          ruta: `/sedes/${seg(sedeId)}/agenda`,
          cuerpo: datos,
          esquema: agendaConfigSchema,
        }),
    },
    archivos: {
      /**
       * `multipart/form-data` con `categoria` ANTES que `archivo`: la API exige el permiso apenas
       * lee la categoría, antes de aceptar un byte del archivo.
       */
      subir: (categoria: CategoriaArchivo, archivo: Blob, nombre?: string): Promise<Archivo> => {
        const formulario = new FormData();
        formulario.append('categoria', categoria);
        const nombreArchivo = nombre ?? (archivo instanceof File ? archivo.name : 'archivo');
        formulario.append('archivo', archivo, nombreArchivo);
        return pedir({ metodo: 'POST', ruta: '/archivos', formulario, esquema: archivoSchema });
      },
      /** URL firmada (vence en minutos). Es absoluta y se usa tal cual: no se le antepone nada. */
      url: (archivoId: string): Promise<UrlArchivo> =>
        pedir({
          metodo: 'GET',
          ruta: `/archivos/${seg(archivoId)}/url`,
          esquema: urlArchivoAbsolutaSchema,
        }),
    },
    /**
     * Pacientes (contrato/pacientes.ts). La búsqueda (`q`) viaja tal como se escribió: la API
     * normaliza tildes, puntos de la CI y formatos de teléfono.
     */
    pacientes: {
      listar: (consulta: Partial<ConsultaPacientes>): Promise<PaginaPacientes> =>
        pedir({
          metodo: 'GET',
          ruta: `/pacientes${consultaComoTexto({ ...consulta })}`,
          esquema: paginaPacientesSchema,
        }),
      /** Abrir la ficha queda en auditoría como `ver`. */
      obtener: (pid: string): Promise<Paciente> =>
        pedir({ metodo: 'GET', ruta: `/pacientes/${seg(pid)}`, esquema: pacienteSchema }),
      /** 409 por CI que ya tiene otro paciente → `ErrorCiDuplicada` (con `existente`). */
      crear: (datos: CrearPaciente): Promise<Paciente> =>
        pedir({
          metodo: 'POST',
          ruta: '/pacientes',
          cuerpo: datos,
          esquema: pacienteSchema,
          errorPropio: errorCiDuplicada,
        }),
      /** `null` borra el dato. 409 por CI duplicada → `ErrorCiDuplicada`. */
      editar: (pid: string, datos: EditarPaciente): Promise<Paciente> =>
        pedir({
          metodo: 'PATCH',
          ruta: `/pacientes/${seg(pid)}`,
          cuerpo: datos,
          esquema: pacienteSchema,
          errorPropio: errorCiDuplicada,
        }),
      desactivar: (pid: string, baja: Baja): Promise<Paciente> =>
        pedir({
          metodo: 'POST',
          ruta: `/pacientes/${seg(pid)}/desactivar`,
          cuerpo: baja,
          esquema: pacienteSchema,
        }),
      reactivar: (pid: string): Promise<Paciente> =>
        pedir({
          metodo: 'POST',
          ruta: `/pacientes/${seg(pid)}/reactivar`,
          esquema: pacienteSchema,
        }),
      /** Crea el vínculo y su espejo; responde la relación vista desde `pid`. */
      crearRelacion: (pid: string, datos: CrearRelacion): Promise<Relacion> =>
        pedir({
          metodo: 'POST',
          ruta: `/pacientes/${seg(pid)}/relaciones`,
          cuerpo: datos,
          esquema: relacionSchema,
        }),
      /** Da de baja el vínculo y su espejo (204). */
      quitarRelacion: (relacionId: string): Promise<void> =>
        pedir({ metodo: 'DELETE', ruta: `/relaciones/${seg(relacionId)}`, esquema: null }),
      crearAlerta: (pid: string, datos: { texto: string }): Promise<AlertaManual> =>
        pedir({
          metodo: 'POST',
          ruta: `/pacientes/${seg(pid)}/alertas`,
          cuerpo: datos,
          esquema: alertaManualSchema,
        }),
      /**
       * Activa o desactiva una alerta. El contrato no dice qué responde: no se lee la respuesta y
       * quien llama actualiza la ficha que tiene en pantalla.
       */
      editarAlerta: (alertaId: string, datos: { activa: boolean }): Promise<void> =>
        pedir({ metodo: 'PATCH', ruta: `/alertas/${seg(alertaId)}`, cuerpo: datos, esquema: null }),
    },
    /** Buscador global: hasta 6 pacientes activos. Con menos de 2 caracteres no hace falta pedir. */
    buscar: (q: string): Promise<PacienteResumen[]> =>
      pedir({
        metodo: 'GET',
        ruta: `/buscar${consultaComoTexto({ q })}`,
        esquema: resultadoBuscarSchema,
      }).then((r) => r.pacientes),
  };
}

export type ClienteApi = ReturnType<typeof crearClienteApi>;
