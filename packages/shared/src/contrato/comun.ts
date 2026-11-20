import { z } from 'zod';

/** Identificador de cualquier entidad. */
export const idSchema = z.uuid();

/** Hora del día en formato de 24 h, «08:00». */
export const horaSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usá el formato HH:MM.');

/** Fecha y hora ISO 8601 con zona (la API siempre responde en UTC). */
export const fechaHoraSchema = z.iso.datetime({ offset: true });

/**
 * Cabeceras que la web manda en cada pedido con sesión.
 * - `Authorization: Bearer <token de Supabase Auth>`
 * - `X-Clinica-Id`: clínica en la que se trabaja. Si el usuario tiene una sola
 *   membresía activa se puede omitir; con varias es obligatoria.
 */
export const CABECERA_CLINICA = 'x-clinica-id';

/** Códigos de error estables: la web decide qué hacer según el código, no según el texto. */
export const CODIGOS_ERROR = [
  'no_autenticado',
  'mfa_requerido',
  'sin_membresia',
  'clinica_requerida',
  'sin_permiso',
  'sede_no_permitida',
  'no_encontrado',
  'datos_invalidos',
  'conflicto',
  /** 429: la web no reintenta sola; respeta `Retry-After`. */
  'demasiados_pedidos',
  /** 503: algo de lo que depende la API no responde. La web no cierra la sesión. */
  'servicio_no_disponible',
  'error_interno',
] as const;
export type CodigoError = (typeof CODIGOS_ERROR)[number];

/** Forma de toda respuesta de error de la API. El mensaje va en español y dice qué hacer. */
export const errorApiSchema = z.object({
  codigo: z.enum(CODIGOS_ERROR),
  mensaje: z.string(),
  detalles: z.array(z.object({ campo: z.string(), mensaje: z.string() })).optional(),
});
export type ErrorApi = z.infer<typeof errorApiSchema>;

/** Cuerpo de toda baja lógica: nada se borra, se da de baja con motivo. */
export const bajaSchema = z.object({
  motivo: z.string().trim().min(3, 'Contanos el motivo de la baja.').max(300),
});
export type Baja = z.infer<typeof bajaSchema>;
