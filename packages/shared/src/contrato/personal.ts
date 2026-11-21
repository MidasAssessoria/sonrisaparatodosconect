import { z } from 'zod';

import { ACCIONES, MODULOS } from '../permisos.js';
import { fechaHoraSchema, idSchema } from './comun.js';

/*
 * Personal, invitaciones y roles (módulos `personal` y `configuracion`).
 *
 * Una persona entra a una clínica solo por invitación, y **solo quien controla el correo
 * invitado puede usarla** (revisión de seguridad del Sprint 2: el enlace solo, que viaja por
 * WhatsApp, no prueba nada):
 *   1. Quien tiene `personal:crear` invita con nombre, correo, rol y sedes. Nace una membresía
 *      `pendiente` y una invitación con un token aleatorio del que la base guarda solo el hash.
 *      - Si el correo no tiene cuenta en Supabase Auth, la API le pide a Supabase que le mande el
 *        correo de invitación (`inviteUserByEmail`) con vuelta a `/invitacion?token=…`.
 *      - Si ya tiene cuenta, no se manda correo de Supabase: la persona entra con su contraseña.
 *      La respuesta trae además el enlace `/invitacion?token=…` UNA sola vez, para avisarle por
 *      WhatsApp; ese enlace solo muestra la invitación y no crea ni activa nada por sí solo.
 *   2. La persona abre el enlace. `POST /invitaciones/consultar` muestra a qué clínica y con qué
 *      rol la invitan, sin revelar datos de nadie más.
 *   3. `POST /invitaciones/aceptar` exige SIEMPRE `Authorization` con un JWT cuyo correo sea el
 *      de la invitación y esté **confirmado** en Supabase Auth (la API lo verifica con la Admin
 *      API, no con el cuerpo ni con el JWT solo):
 *      - cuenta nueva: la persona llega desde el correo de Supabase ya con sesión, elige su
 *        contraseña en la web (`updateUser`) y acepta;
 *      - cuenta existente: ingresa con su contraseña (y su segundo factor si lo tiene) y acepta.
 *      Se acepta con un token aal1: la persona todavía no es miembro de esta clínica. Una cuenta
 *      sin ninguna clínica activa tiene que poder aceptar sin pasar por `GET /sesion`.
 *      La membresía pasa a `activo` y la invitación queda usada.
 *   4. Un token vence a las 72 horas, se usa una sola vez y queda anulado si se reenvía o se anula
 *      la invitación. Reenviar vuelve a pedir a Supabase el correo si la cuenta todavía no está
 *      confirmada. Un token inválido, vencido o usado responde siempre lo mismo (`no_encontrado`).
 *
 * `/invitaciones/:id` (reenviar, anular) y `/personal/:id` reciben el id de la **membresía**.
 * Desactivar y reactivar responden 200 con la `Persona` actualizada.
 *
 * Límites de quien administra (revisión de seguridad del Sprint 2):
 *   - nadie da a un rol, ni asigna a una persona un rol con, permisos que no tiene él mismo
 *     (incluido `todasLasSedes`); el dueño no tiene límite;
 *   - los roles de sistema solo los edita un dueño, y Dueño/a y Administración siempre exigen
 *     doble factor;
 *   - quien no ve todas las sedes solo ve, edita, desactiva, reenvía o anula a personas cuyas
 *     sedes estén todas entre las suyas.
 */

export const ESTADOS_MEMBRESIA = ['pendiente', 'activo', 'inactivo'] as const;
export type EstadoMembresia = (typeof ESTADOS_MEMBRESIA)[number];

const nombrePersonaSchema = z.string().trim().min(2, 'Poné el nombre.').max(120);
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Escribí un correo válido.'));

export const rolResumenSchema = z.object({
  id: idSchema,
  codigo: z.string().nullable(),
  nombre: z.string(),
});
export type RolResumen = z.infer<typeof rolResumenSchema>;

/** Una persona del equipo = una membresía en esta clínica. */
export const personaSchema = z.object({
  membresiaId: idSchema,
  /** Nulo mientras la invitación no fue aceptada. */
  usuarioId: idSchema.nullable(),
  nombre: z.string(),
  email: z.string(),
  telefono: z.string().nullable(),
  rol: rolResumenSchema,
  estado: z.enum(ESTADOS_MEMBRESIA),
  sedeIds: z.array(idSchema),
  sedeDefectoId: idSchema.nullable(),
  ultimoAcceso: fechaHoraSchema.nullable(),
  mfaActivo: z.boolean(),
  /** Solo para pendientes: hasta cuándo sirve el último enlace enviado. */
  invitacionVenceEn: fechaHoraSchema.nullable(),
  /** Profesional asociado, si atiende pacientes. */
  profesionalId: idSchema.nullable(),
});
export type Persona = z.infer<typeof personaSchema>;

/** `POST /api/v1/invitaciones` — permiso `personal:crear`. */
export const crearInvitacionSchema = z
  .object({
    nombre: nombrePersonaSchema,
    email: emailSchema,
    rolId: idSchema,
    sedeIds: z.array(idSchema).max(50).default([]),
    sedeDefectoId: idSchema.optional(),
  })
  .refine((v) => v.sedeDefectoId === undefined || v.sedeIds.includes(v.sedeDefectoId), {
    message: 'La sede por defecto tiene que estar entre las sedes elegidas.',
    path: ['sedeDefectoId'],
  });
export type CrearInvitacion = z.infer<typeof crearInvitacionSchema>;

/** Respuesta de crear y de reenviar: el enlace aparece solo acá, una vez. */
export const invitacionCreadaSchema = z.object({
  persona: personaSchema,
  /** Ruta relativa de la web con el token, p. ej. `/invitacion?token=…`. */
  enlace: z.string(),
  venceEn: fechaHoraSchema,
});
export type InvitacionCreada = z.infer<typeof invitacionCreadaSchema>;

/** `POST /api/v1/invitaciones/consultar` — público. */
export const consultarInvitacionSchema = z.object({ token: z.string().min(20).max(200) });
export const invitacionPublicaSchema = z.object({
  clinica: z.string(),
  rol: z.string(),
  nombre: z.string(),
  /** Correo con la parte local enmascarada: «ma***@gmail.com». */
  emailEnmascarado: z.string(),
  /**
   * `cuenta_existente`: entrá con tu contraseña y aceptá. `revisa_tu_correo`: abrí el correo de
   * invitación que te mandamos (desde ahí volvés ya con sesión y elegís tu contraseña).
   */
  siguientePaso: z.enum(['cuenta_existente', 'revisa_tu_correo']),
  venceEn: fechaHoraSchema,
});
export type InvitacionPublica = z.infer<typeof invitacionPublicaSchema>;

/**
 * `POST /api/v1/invitaciones/aceptar` — ruta pública que exige `Authorization` (ver arriba).
 */
export const aceptarInvitacionSchema = z.object({
  token: z.string().min(20).max(200),
});
export type AceptarInvitacion = z.infer<typeof aceptarInvitacionSchema>;
export const invitacionAceptadaSchema = z.object({
  email: z.string(),
  clinicaId: idSchema,
});

/** `PATCH /api/v1/personal/:membresiaId` — permiso `personal:editar`. */
export const editarPersonaSchema = z.object({
  rolId: idSchema.optional(),
  sedeIds: z.array(idSchema).max(50).optional(),
  sedeDefectoId: idSchema.nullable().optional(),
});
export type EditarPersona = z.infer<typeof editarPersonaSchema>;

/**
 * Permiso de un rol. Un rol no puede darse a sí mismo nada (la base lo impide), nadie edita su
 * propio rol, y el rol `dueno` no se edita.
 */
export const permisoRolSchema = z.object({
  modulo: z.enum(MODULOS),
  accion: z.enum(ACCIONES),
});

export const rolSchema = z.object({
  id: idSchema,
  /** Código de sistema (`dueno`, `recepcion`…) o nulo para roles creados por la clínica. */
  codigo: z.string().nullable(),
  nombre: z.string(),
  esSistema: z.boolean(),
  activo: z.boolean(),
  todasLasSedes: z.boolean(),
  exigeMfa: z.boolean(),
  inactividadMin: z.number().int(),
  permisos: z.array(permisoRolSchema),
  /** Cuántas membresías activas o pendientes lo usan. */
  personas: z.number().int(),
});
export type Rol = z.infer<typeof rolSchema>;

/** `POST /api/v1/roles` — permiso `configuracion:crear`. */
export const crearRolSchema = z.object({
  nombre: z.string().trim().min(2, 'Poné el nombre del rol.').max(60),
  todasLasSedes: z.boolean().default(false),
  exigeMfa: z.boolean().default(false),
  inactividadMin: z.number().int().min(5).max(240).default(30),
  permisos: z
    .array(permisoRolSchema)
    .max(MODULOS.length * ACCIONES.length)
    .default([]),
});
export type CrearRol = z.infer<typeof crearRolSchema>;

/**
 * `PATCH /api/v1/roles/:id` — permiso `configuracion:editar`. `permisos`, si viene, reemplaza la
 * matriz completa (lo que falta se revoca con `activo = false`, no se borra).
 */
export const editarRolSchema = z.object({
  nombre: z.string().trim().min(2).max(60).optional(),
  todasLasSedes: z.boolean().optional(),
  exigeMfa: z.boolean().optional(),
  inactividadMin: z.number().int().min(5).max(240).optional(),
  permisos: z
    .array(permisoRolSchema)
    .max(MODULOS.length * ACCIONES.length)
    .optional(),
});
export type EditarRol = z.infer<typeof editarRolSchema>;
