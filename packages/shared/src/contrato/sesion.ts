import { z } from 'zod';

import { ACCIONES, MODULOS } from '../permisos.js';
import { idSchema } from './comun.js';
import { ESTADOS_SEDE } from './sedes.js';

/** Roles de sistema que nacen con cada clínica. Una clínica puede crear otros. */
export const ROLES_SISTEMA = [
  'dueno',
  'administracion',
  'odontologo',
  'asistente',
  'recepcion',
] as const;
export type RolSistema = (typeof ROLES_SISTEMA)[number];

export const permisoSchema = z.object({
  modulo: z.enum(MODULOS),
  accion: z.enum(ACCIONES),
});
export type Permiso = z.infer<typeof permisoSchema>;

/**
 * `GET /api/v1/sesion` — quién soy, en qué clínica trabajo y qué puedo hacer.
 * Es lo primero que pide la web después de iniciar sesión.
 */
export const sesionSchema = z.object({
  usuario: z.object({
    id: idSchema,
    nombre: z.string(),
    email: z.email(),
    mfaActivo: z.boolean(),
  }),
  /** Nivel del token: aal2 = pasó el segundo factor en esta sesión. */
  nivelAutenticacion: z.enum(['aal1', 'aal2']),
  /** El rol pide doble factor y el usuario todavía no lo activó. */
  debeActivarMfa: z.boolean(),
  /** Todas las clínicas donde el usuario tiene membresía activa. */
  clinicas: z.array(z.object({ id: idSchema, nombre: z.string() })),
  clinica: z.object({
    id: idSchema,
    nombre: z.string(),
    zonaHoraria: z.string(),
  }),
  rol: z.object({ id: idSchema, codigo: z.string(), nombre: z.string() }),
  permisos: z.array(permisoSchema),
  /** Sedes que este usuario puede ver. */
  sedes: z.array(
    z.object({
      id: idSchema,
      nombre: z.string(),
      estado: z.enum(ESTADOS_SEDE),
      color: z.string().nullable(),
    }),
  ),
  sedeDefectoId: idSchema.nullable(),
  /** Puede usar «Todas las sedes» en el selector (ve más de una). */
  puedeVerTodasLasSedes: z.boolean(),
  /** Minutos sin actividad tras los que la web cierra la sesión. */
  inactividadMin: z.number().int().positive(),
});
export type Sesion = z.infer<typeof sesionSchema>;
