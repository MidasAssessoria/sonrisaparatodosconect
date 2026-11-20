/**
 * Esquema Drizzle del schema `app`, escrito a mano como espejo de `migraciones/*.sql`.
 *
 * La fuente de verdad son las migraciones: este archivo solo da tipos a las consultas. Una prueba
 * (test/esquema.test.ts) compara cada tabla y columna con la base real, en los dos sentidos.
 * Restricciones, índices, RLS y triggers viven solo en SQL.
 */
import type { Accion, Modulo } from '@conecta/shared';
import {
  bigint,
  boolean,
  inet,
  jsonb,
  pgSchema,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const esquemaApp = pgSchema('app');

/** Valores de los CHECK de la base (una prueba verifica que coincidan). */
export const ESTADOS_SEDE = ['abierta', 'proxima', 'cerrada'] as const;
export type EstadoSede = (typeof ESTADOS_SEDE)[number];

export const ESTADOS_MEMBRESIA = ['pendiente', 'activo', 'inactivo'] as const;
export type EstadoMembresia = (typeof ESTADOS_MEMBRESIA)[number];

export const TIPOS_NUMERADOR = [
  'presupuesto',
  'receta',
  'certificado',
  'indicaciones',
  'consentimiento',
  'recibo',
] as const;
export type TipoNumerador = (typeof TIPOS_NUMERADOR)[number];

export const ACCIONES_AUDITORIA = [
  'crear',
  'editar',
  'anular',
  'ver',
  'exportar',
  'enviar',
] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

/** Acciones que registra la API con `app.registrar_evento()`; el resto las escribe la base. */
export const ACCIONES_EVENTO = ['ver', 'exportar', 'enviar'] as const;
export type AccionEvento = (typeof ACCIONES_EVENTO)[number];

/** Roles de sistema que crea `app.alta_clinica()` en toda clínica nueva. */
export const CODIGOS_ROL_SISTEMA = [
  'dueno',
  'administracion',
  'odontologo',
  'asistente',
  'recepcion',
] as const;
export type CodigoRolSistema = (typeof CODIGOS_ROL_SISTEMA)[number];

/** Auditoría de fila. La fija el trigger `app.fijar_auditoria_fila()`: lo que mande el cliente se pisa. */
const auditoriaFila = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  updatedBy: uuid('updated_by'),
};

/** Baja lógica de datos editables. deleted_at/deleted_by los fija la base al dar de baja. */
const bajaLogica = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  motivoBaja: text('motivo_baja'),
};

/** Identidad global (sin clinica_id). `id` = id del usuario en Supabase Auth. */
export const usuario = esquemaApp.table('usuario', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull(),
  email: text('email').notNull(),
  telefono: text('telefono'),
  mfaActivo: boolean('mfa_activo').notNull().default(false),
  ultimoAcceso: timestamp('ultimo_acceso', { withTimezone: true }),
  ...auditoriaFila,
});

export const clinica = esquemaApp.table('clinica', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  razonSocial: text('razon_social'),
  ruc: text('ruc'),
  zonaHoraria: text('zona_horaria').notNull().default('America/Asuncion'),
  edadPediatrica: smallint('edad_pediatrica').notNull().default(12),
  edadTutor: smallint('edad_tutor').notNull().default(18),
  topeDescuentoPct: smallint('tope_descuento_pct').notNull().default(50),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

export const sede = esquemaApp.table('sede', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  nombre: text('nombre').notNull(),
  direccion: text('direccion'),
  telefono: text('telefono'),
  estado: text('estado').$type<EstadoSede>().notNull().default('abierta'),
  color: text('color'),
  ...bajaLogica,
  ...auditoriaFila,
});

export const sedeHorario = esquemaApp.table('sede_horario', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  sedeId: uuid('sede_id').notNull(),
  /** 0 = domingo … 6 = sábado. */
  diaSemana: smallint('dia_semana').notNull(),
  horaInicio: time('hora_inicio').notNull(),
  horaFin: time('hora_fin').notNull(),
  intervaloMin: smallint('intervalo_min').notNull().default(30),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

export const sillon = esquemaApp.table('sillon', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  sedeId: uuid('sede_id').notNull(),
  nombre: text('nombre').notNull(),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

export const rol = esquemaApp.table('rol', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  nombre: text('nombre').notNull(),
  codigo: text('codigo').notNull(),
  esSistema: boolean('es_sistema').notNull().default(false),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

export const rolPermiso = esquemaApp.table('rol_permiso', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  rolId: uuid('rol_id').notNull(),
  modulo: text('modulo').$type<Modulo>().notNull(),
  accion: text('accion').$type<Accion>().notNull(),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

export const membresia = esquemaApp.table('membresia', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  usuarioId: uuid('usuario_id').notNull(),
  rolId: uuid('rol_id').notNull(),
  sedeDefectoId: uuid('sede_defecto_id'),
  estado: text('estado').$type<EstadoMembresia>().notNull().default('pendiente'),
  ...auditoriaFila,
});

export const usuarioSede = esquemaApp.table('usuario_sede', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  membresiaId: uuid('membresia_id').notNull(),
  sedeId: uuid('sede_id').notNull(),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

/** Solo lectura para app_api: lo escriben los triggers y `app.registrar_evento()`. */
export const auditLog = esquemaApp.table('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id'),
  usuarioId: uuid('usuario_id'),
  fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
  entidad: text('entidad').notNull(),
  entidadId: uuid('entidad_id'),
  accion: text('accion').$type<AccionAuditoria>().notNull(),
  antes: jsonb('antes'),
  despues: jsonb('despues'),
  ip: inet('ip'),
});

/** Solo lectura para app_api: los números salen de `app.siguiente_numero()`. */
export const numerador = esquemaApp.table('numerador', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  tipo: text('tipo').$type<TipoNumerador>().notNull(),
  sedeId: uuid('sede_id'),
  ultimo: bigint('ultimo', { mode: 'number' }).notNull().default(0),
  ...auditoriaFila,
});

/** Todas las tablas, para `drizzle(pool, { schema })` y para la prueba de introspección. */
export const esquema = {
  usuario,
  clinica,
  sede,
  sedeHorario,
  sillon,
  rol,
  rolPermiso,
  membresia,
  usuarioSede,
  auditLog,
  numerador,
};
export type Esquema = typeof esquema;
