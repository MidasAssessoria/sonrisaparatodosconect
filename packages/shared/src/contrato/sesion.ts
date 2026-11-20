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
 *
 * Es el único endpoint que tolera la falta de `X-Clinica-Id` con varias
 * membresías: responde con la más antigua activa y la lista completa en
 * `clinicas`, para que la web ofrezca elegir. El resto responde
 * `clinica_requerida`.
 *
 * Doble factor. La API exige un token aal2 cuando el rol lo pide
 * (`rol.exige_mfa`: dueño y administración) o cuando el usuario ya lo activó
 * (`usuario.mfaActivo`). En esos casos, con un token aal1 **todo** endpoint
 * (incluido este) responde `mfa_requerido`, y la web decide qué mostrar
 * preguntándole a Supabase si hay un factor verificado: si lo hay, pide el
 * código; si no, obliga a activarlo antes de seguir.
 *
 * `usuario.mfaActivo` lo mantiene la API: pasa a `true` cuando llega un token
 * aal2 y vuelve a `false` solo con `DELETE /api/v1/sesion/mfa` (exige aal2; la
 * web lo llama justo después de quitar el factor en Supabase y enseguida
 * refresca la sesión). Los tokens aal2 emitidos antes de esa baja no lo
 * vuelven a encender.
 *
 * Sesiones. La API lleva la última actividad de cada sesión (`session_id` del
 * token). Pasados `inactividadMin` minutos sin pedidos, o después de
 * `POST /api/v1/sesion/cerrar` (204; la web lo llama al cerrar sesión), el
 * token deja de servir y todo responde `no_autenticado`. El primer pedido de
 * una sesión nueva queda en auditoría como `ingresar`.
 */
export const sesionSchema = z.object({
  usuario: z.object({
    id: idSchema,
    nombre: z.string(),
    /** Texto tal como está guardado: la respuesta no lo vuelve a validar como correo. */
    email: z.string(),
    mfaActivo: z.boolean(),
  }),
  /** Nivel del token: aal2 = pasó el segundo factor en esta sesión. */
  nivelAutenticacion: z.enum(['aal1', 'aal2']),
  /** Todas las clínicas donde el usuario tiene membresía activa. */
  clinicas: z.array(z.object({ id: idSchema, nombre: z.string() })),
  clinica: z.object({
    id: idSchema,
    nombre: z.string(),
    zonaHoraria: z.string(),
  }),
  rol: z.object({
    id: idSchema,
    codigo: z.string(),
    nombre: z.string(),
    /** El rol obliga a usar doble factor. */
    exigeMfa: z.boolean(),
  }),
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
  /** Minutos sin actividad tras los que la sesión se cierra (dato del rol; lo aplican la web y la API). */
  inactividadMin: z.number().int().positive(),
});
export type Sesion = z.infer<typeof sesionSchema>;
