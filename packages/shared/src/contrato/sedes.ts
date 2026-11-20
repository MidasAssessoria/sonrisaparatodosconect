import { z } from 'zod';

import { horaSchema, idSchema } from './comun.js';

export const ESTADOS_SEDE = ['abierta', 'proxima', 'cerrada'] as const;
export type EstadoSede = (typeof ESTADOS_SEDE)[number];

/** 0 = domingo … 6 = sábado. */
export const horarioSedeSchema = z
  .object({
    diaSemana: z.number().int().min(0).max(6),
    horaInicio: horaSchema,
    horaFin: horaSchema,
    intervaloMin: z.number().int().min(5).max(120).default(30),
  })
  .refine((h) => h.horaInicio < h.horaFin, {
    message: 'La hora de cierre tiene que ser posterior a la de apertura.',
    path: ['horaFin'],
  });
export type HorarioSede = z.infer<typeof horarioSedeSchema>;

export const sillonSchema = z.object({
  id: idSchema,
  sedeId: idSchema,
  nombre: z.string(),
  activo: z.boolean(),
});
export type Sillon = z.infer<typeof sillonSchema>;

export const sedeSchema = z.object({
  id: idSchema,
  nombre: z.string(),
  direccion: z.string().nullable(),
  telefono: z.string().nullable(),
  estado: z.enum(ESTADOS_SEDE),
  color: z.string().nullable(),
  horarios: z.array(horarioSedeSchema),
  sillones: z.array(sillonSchema),
});
export type Sede = z.infer<typeof sedeSchema>;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Elegí un color válido.');

/** `POST /api/v1/sedes` */
export const crearSedeSchema = z.object({
  nombre: z.string().trim().min(2, 'Poné el nombre de la sede.').max(80),
  direccion: z.string().trim().max(200).optional(),
  telefono: z.string().trim().max(30).optional(),
  estado: z.enum(ESTADOS_SEDE).default('abierta'),
  color: colorSchema.optional(),
});
export type CrearSede = z.infer<typeof crearSedeSchema>;

/** `PATCH /api/v1/sedes/:id` */
export const editarSedeSchema = crearSedeSchema.partial();
export type EditarSede = z.infer<typeof editarSedeSchema>;

/** `PUT /api/v1/sedes/:id/horarios` — reemplaza el horario completo de la sede. */
export const reemplazarHorariosSchema = z.object({
  horarios: z.array(horarioSedeSchema).max(28),
});
export type ReemplazarHorarios = z.infer<typeof reemplazarHorariosSchema>;

/** `POST /api/v1/sedes/:id/sillones` */
export const crearSillonSchema = z.object({
  nombre: z.string().trim().min(1, 'Poné el nombre del sillón.').max(40),
});
export type CrearSillon = z.infer<typeof crearSillonSchema>;

/** `PATCH /api/v1/sillones/:id` — se desactiva, no se borra. */
export const editarSillonSchema = z.object({
  nombre: z.string().trim().min(1).max(40).optional(),
  activo: z.boolean().optional(),
});
export type EditarSillon = z.infer<typeof editarSillonSchema>;

/*
 * Rutas del módulo (todas bajo /api/v1, permiso módulo `sedes`):
 *   GET    /sedes                  ver     → Sede[] (solo las que el usuario puede ver)
 *   POST   /sedes                  crear   → Sede
 *   GET    /sedes/:id              ver     → Sede
 *   PATCH  /sedes/:id              editar  → Sede
 *   DELETE /sedes/:id              anular  (cuerpo: bajaSchema) → 204; baja lógica
 *   PUT    /sedes/:id/horarios     editar  → Sede
 *   POST   /sedes/:id/sillones     crear   → Sillon
 *   PATCH  /sillones/:id           editar  → Sillon
 */
