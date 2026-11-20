import { z } from 'zod';

import { idSchema } from './comun.js';

/*
 * Catálogo de tratamientos (módulo `configuracion`) y configuración de agenda por sede (módulo
 * `sedes`). Dinero: guaraníes enteros, IVA incluido. Nada se borra: se desactiva. Cambiar un
 * precio no toca nada ya emitido (los presupuestos copian nombre, precio e IVA).
 */

export const TASAS_IVA = [10, 5, 0] as const;
export type TasaIva = (typeof TASAS_IVA)[number];

/** Guaraníes enteros y no negativos, hasta 999.999.999. */
export const montoSchema = z
  .number()
  .int('Los guaraníes no llevan decimales.')
  .min(0)
  .max(999_999_999);

export const tratamientoSchema = z.object({
  id: idSchema,
  nombre: z.string(),
  categoria: z.string().nullable(),
  precio: montoSchema,
  iva: z.union([z.literal(10), z.literal(5), z.literal(0)]),
  duracionMin: z.number().int(),
  activo: z.boolean(),
});
export type Tratamiento = z.infer<typeof tratamientoSchema>;

const duracionSchema = z
  .number()
  .int()
  .min(5)
  .max(480)
  .refine((m) => m % 5 === 0, 'La duración va en pasos de 5 minutos.');

/** `POST /api/v1/tratamientos` — permiso `configuracion:crear`. */
export const crearTratamientoSchema = z.object({
  nombre: z.string().trim().min(2, 'Poné el nombre del tratamiento.').max(120),
  categoria: z.string().trim().max(60).optional(),
  precio: montoSchema,
  iva: z.union([z.literal(10), z.literal(5), z.literal(0)]).default(10),
  duracionMin: duracionSchema.default(30),
});
export type CrearTratamiento = z.infer<typeof crearTratamientoSchema>;

/** `PATCH /api/v1/tratamientos/:id` — permiso `configuracion:editar`. */
export const editarTratamientoSchema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  categoria: z.string().trim().max(60).nullable().optional(),
  precio: montoSchema.optional(),
  iva: z.union([z.literal(10), z.literal(5), z.literal(0)]).optional(),
  duracionMin: duracionSchema.optional(),
  activo: z.boolean().optional(),
});
export type EditarTratamiento = z.infer<typeof editarTratamientoSchema>;

/** Configuración de agenda y reserva online de una sede (una fila por sede). */
export const agendaConfigSchema = z.object({
  sedeId: idSchema,
  /** No se reserva online para dentro de menos de estos minutos. */
  anticipacionMin: z.number().int().min(0).max(2880),
  /** Hasta cuántos días adelante se puede reservar online. */
  diasAdelante: z.number().int().min(1).max(90),
  reservaOnlineActiva: z.boolean(),
});
export type AgendaConfig = z.infer<typeof agendaConfigSchema>;

/**
 * `GET /api/v1/sedes/:id/agenda` (`sedes:ver`) devuelve la configuración, con valores por defecto
 * (120 min, 14 días, reserva apagada) si la sede todavía no tiene fila.
 * `PUT /api/v1/sedes/:id/agenda` (`sedes:editar`) la reemplaza.
 */
export const guardarAgendaConfigSchema = agendaConfigSchema.omit({ sedeId: true });
export type GuardarAgendaConfig = z.infer<typeof guardarAgendaConfigSchema>;
