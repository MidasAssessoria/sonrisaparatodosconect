import { z } from 'zod';

import { MODULOS } from '../permisos.js';
import { fechaHoraSchema, idSchema } from './comun.js';

export const ACCIONES_AUDITORIA = [
  'crear',
  'editar',
  'anular',
  'ver',
  'exportar',
  'enviar',
  /** Primer pedido de una sesión nueva. Los fallos de ingreso quedan en el registro de Supabase Auth. */
  'ingresar',
] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

export const eventoAuditoriaSchema = z.object({
  id: idSchema,
  fecha: fechaHoraSchema,
  /** El nombre es el que la persona tenía en el momento del evento. */
  usuario: z.object({ id: idSchema, nombre: z.string() }).nullable(),
  /** Módulo al que pertenece la entidad; decide quién puede ver el evento. */
  modulo: z.enum(MODULOS).nullable(),
  sedeId: idSchema.nullable(),
  entidad: z.string(),
  entidadId: idSchema.nullable(),
  accion: z.enum(ACCIONES_AUDITORIA),
  antes: z.record(z.string(), z.unknown()).nullable(),
  despues: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
});
export type EventoAuditoria = z.infer<typeof eventoAuditoriaSchema>;

/**
 * `GET /api/v1/auditoria` — permiso `auditoria:ver`. Del más nuevo al más viejo.
 *
 * Tener `auditoria:ver` no alcanza para ver cualquier cosa: solo se devuelven
 * los eventos de módulos donde el rol tiene `ver` y de sedes que el usuario
 * puede ver (los eventos sin sede se ven siempre).
 *
 * `desde` es inclusivo y `hasta` es exclusivo: para un día completo, `hasta`
 * es el inicio del día siguiente.
 */
export const consultaAuditoriaSchema = z.object({
  entidad: z.string().max(60).optional(),
  entidadId: idSchema.optional(),
  usuarioId: idSchema.optional(),
  accion: z.enum(ACCIONES_AUDITORIA).optional(),
  desde: fechaHoraSchema.optional(),
  hasta: fechaHoraSchema.optional(),
  /** Cursor opaco devuelto por la página anterior. */
  cursor: z.string().max(200).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});
export type ConsultaAuditoria = z.infer<typeof consultaAuditoriaSchema>;

export const paginaAuditoriaSchema = z.object({
  items: z.array(eventoAuditoriaSchema),
  siguienteCursor: z.string().nullable(),
});
export type PaginaAuditoria = z.infer<typeof paginaAuditoriaSchema>;
