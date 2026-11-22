import { z } from 'zod';

import { fechaHoraSchema, horaSchema, idSchema } from './comun.js';

/*
 * Profesionales (módulo `personal`). Un profesional es quien atiende pacientes y aparece en la
 * agenda. Suele estar asociado a una persona del equipo (`membresiaId`), pero puede no tener
 * usuario (un especialista que viene una vez por mes y no entra al sistema). Nunca se borra: se
 * desactiva.
 */

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Elegí un color válido.');

/** Tramo semanal de atención en una sede. 0 = domingo … 6 = sábado. */
export const tramoDisponibilidadSchema = z
  .object({
    sedeId: idSchema,
    diaSemana: z.number().int().min(0).max(6),
    horaInicio: horaSchema,
    horaFin: horaSchema,
    /** Sillón fijo en ese tramo, si lo tiene. */
    sillonId: idSchema.nullable().default(null),
  })
  .refine((t) => t.horaInicio < t.horaFin, {
    message: 'La hora de fin tiene que ser posterior a la de inicio.',
    path: ['horaFin'],
  });
export type TramoDisponibilidad = z.infer<typeof tramoDisponibilidadSchema>;

export const bloqueoSchema = z.object({
  id: idSchema,
  desde: fechaHoraSchema,
  hasta: fechaHoraSchema,
  motivo: z.string(),
});
export type Bloqueo = z.infer<typeof bloqueoSchema>;

export const profesionalSchema = z.object({
  id: idSchema,
  membresiaId: idSchema.nullable(),
  nombre: z.string(),
  especialidad: z.string().nullable(),
  color: z.string(),
  /** Registro profesional: sale en recetas y consentimientos. */
  registroProf: z.string().nullable(),
  activo: z.boolean(),
  disponibilidad: z.array(tramoDisponibilidadSchema),
  /** Bloqueos que todavía no terminaron, del más cercano al más lejano. */
  bloqueos: z.array(bloqueoSchema),
});
export type Profesional = z.infer<typeof profesionalSchema>;

/** `POST /api/v1/profesionales` — permiso `personal:crear`. */
export const crearProfesionalSchema = z.object({
  membresiaId: idSchema.optional(),
  nombre: z.string().trim().min(2, 'Poné el nombre.').max(120),
  especialidad: z.string().trim().max(80).optional(),
  color: colorSchema,
  registroProf: z.string().trim().max(40).optional(),
});
export type CrearProfesional = z.infer<typeof crearProfesionalSchema>;

/** `PATCH /api/v1/profesionales/:id` — permiso `personal:editar`. `null` borra el dato. */
export const editarProfesionalSchema = z.object({
  membresiaId: idSchema.nullable().optional(),
  nombre: z.string().trim().min(2).max(120).optional(),
  especialidad: z.string().trim().max(80).nullable().optional(),
  color: colorSchema.optional(),
  registroProf: z.string().trim().max(40).nullable().optional(),
  activo: z.boolean().optional(),
});
export type EditarProfesional = z.infer<typeof editarProfesionalSchema>;

/**
 * `PUT /api/v1/profesionales/:id/disponibilidad` — permiso `personal:editar`. Reemplaza toda la
 * disponibilidad. La API rechaza: tramos superpuestos el mismo día (aunque sean en sedes
 * distintas: una persona no está en dos lugares), tramos fuera del horario de la sede ese día,
 * sedes dadas de baja y sillones que no son de esa sede.
 */
export const reemplazarDisponibilidadSchema = z.object({
  tramos: z.array(tramoDisponibilidadSchema).max(60),
});
export type ReemplazarDisponibilidad = z.infer<typeof reemplazarDisponibilidadSchema>;

/** `POST /api/v1/profesionales/:id/bloqueos` — permiso `personal:editar`. */
export const crearBloqueoSchema = z
  .object({
    desde: fechaHoraSchema,
    hasta: fechaHoraSchema,
    motivo: z.string().trim().min(3, 'Contanos el motivo (vacaciones, congreso…).').max(200),
  })
  .refine((b) => new Date(b.desde) < new Date(b.hasta), {
    message: 'El fin del bloqueo tiene que ser posterior al inicio.',
    path: ['hasta'],
  });
export type CrearBloqueo = z.infer<typeof crearBloqueoSchema>;
