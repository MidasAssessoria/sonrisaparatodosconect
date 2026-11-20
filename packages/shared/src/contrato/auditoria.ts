import { z } from 'zod';

import { fechaHoraSchema, idSchema } from './comun.js';

export const ACCIONES_AUDITORIA = [
  'crear',
  'editar',
  'anular',
  'ver',
  'exportar',
  'enviar',
] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

export const eventoAuditoriaSchema = z.object({
  id: idSchema,
  fecha: fechaHoraSchema,
  usuario: z.object({ id: idSchema, nombre: z.string() }).nullable(),
  entidad: z.string(),
  entidadId: idSchema.nullable(),
  accion: z.enum(ACCIONES_AUDITORIA),
  antes: z.record(z.string(), z.unknown()).nullable(),
  despues: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
});
export type EventoAuditoria = z.infer<typeof eventoAuditoriaSchema>;

/** `GET /api/v1/auditoria` — permiso `auditoria:ver`. Del más nuevo al más viejo. */
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
