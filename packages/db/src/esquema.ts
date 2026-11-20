/**
 * Esquema Drizzle del schema `app`, escrito a mano como espejo de `migraciones/*.sql`.
 *
 * La fuente de verdad son las migraciones: este archivo solo da tipos a las consultas. Una prueba
 * (test/esquema.test.ts) compara cada tabla y columna con la base real, en los dos sentidos.
 * Restricciones, índices, RLS y triggers viven solo en SQL.
 */
import type { Accion, AccionAuditoria, EstadoSede, Modulo } from '@conecta/shared';
import {
  bigint,
  boolean,
  inet,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const esquemaApp = pgSchema('app');

/*
 * Valores de los CHECK de la base (una meta-prueba verifica que coincidan). Los que también son
 * parte del contrato de la API (estados de sede, acciones de auditoría, módulos, acciones, roles de
 * sistema) viven solo en `@conecta/shared`: se importan de ahí. Acá quedan los que son solo de la
 * base.
 */

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

/** Acciones que registra la API con `app.registrar_evento()`; el resto las escribe la base. */
export const ACCIONES_EVENTO = [
  'ver',
  'exportar',
  'enviar',
  'ingresar',
] as const satisfies readonly AccionAuditoria[];
export type AccionEvento = (typeof ACCIONES_EVENTO)[number];

/** Motivo de cierre de una sesión (`app.sesion.motivo_cierre`). */
export const MOTIVOS_CIERRE_SESION = ['salida', 'inactividad'] as const;
export type MotivoCierreSesion = (typeof MOTIVOS_CIERRE_SESION)[number];

/**
 * Lo que devuelve `app.tocar_sesion()`:
 * - `nueva`: no existía y se creó (primer pedido: registrar `ingresar`).
 * - `activa`: abierta y dentro del límite de inactividad.
 * - `vencida`: se pasó del límite y se cerró ahora (confirmar la transacción y responder `no_autenticado`).
 * - `cerrada`: ya estaba cerrada (responder `no_autenticado`).
 */
export const RESULTADOS_TOCAR_SESION = ['nueva', 'activa', 'vencida', 'cerrada'] as const;
export type ResultadoTocarSesion = (typeof RESULTADOS_TOCAR_SESION)[number];

/**
 * Nombres de regla que la base pone en el campo `constraint` de sus errores (además de los nombres
 * de las restricciones reales), para que la API elija el mensaje sin leer el texto del error.
 * Todas con código 42501 salvo `membresia_ultimo_dueno` y `rol_dueno_activo` (23514).
 */
export const RESTRICCIONES_ACCESO = [
  /** Cambio de personal o roles sin usuario en el contexto. */
  'acceso_sin_actor',
  /** El actor no es miembro activo (con rol y clínica activos) de la clínica de la fila. */
  'acceso_sin_membresia',
  /** Al rol del actor le falta personal:crear / personal:editar / configuracion:editar. */
  'acceso_sin_permiso',
  /** Su propia membresía, sus propias sedes, su propio rol o los permisos de su rol. */
  'acceso_propio',
  /** El rol de sistema dueno, sus permisos, o la membresía/sedes de un dueño sin ser dueño. */
  'acceso_rol_dueno',
  /** Membresía creada no pendiente, o una que entra o sale de pendiente por la clínica. */
  'membresia_nace_pendiente',
  /** Alta de un rol de sistema por app_api. */
  'rol_sistema',
  /** 23514: la clínica se quedaría sin ningún dueño activo. */
  'membresia_ultimo_dueno',
  /** 23514: desactivar el rol de sistema dueno. */
  'rol_dueno_activo',
  /** Tocar o cerrar una sesión de otra persona. */
  'sesion_ajena',
  /** Cambio de usuario que no quedaría auditado en ninguna clínica. */
  'auditoria_sin_clinica',
] as const;
export type RestriccionAcceso = (typeof RESTRICCIONES_ACCESO)[number];

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
  /** Solo lectura para app_api: lo cambian `app.activar_mfa()` y `app.desactivar_mfa()`. */
  mfaActivo: boolean('mfa_activo').notNull().default(false),
  ultimoAcceso: timestamp('ultimo_acceso', { withTimezone: true }),
  /** Última baja del doble factor: tokens aal2 emitidos hasta acá no cuentan. */
  mfaDesactivadoEn: timestamp('mfa_desactivado_en', { withTimezone: true }),
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
  /** Ve todas las sedes de la clínica (si no, las de `usuario_sede` y su sede por defecto). */
  todasLasSedes: boolean('todas_las_sedes').notNull().default(false),
  /** Obliga a usar doble factor. */
  exigeMfa: boolean('exige_mfa').notNull().default(false),
  /** Minutos sin actividad tras los que la sesión vence (5 a 240). */
  inactividadMin: integer('inactividad_min').notNull().default(30),
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
  /** Nunca NULL en filas nuevas (CHECK NOT VALID); puede serlo en filas anteriores a 0007. */
  clinicaId: uuid('clinica_id'),
  usuarioId: uuid('usuario_id'),
  fecha: timestamp('fecha', { withTimezone: true }).notNull().defaultNow(),
  entidad: text('entidad').notNull(),
  entidadId: uuid('entidad_id'),
  accion: text('accion').$type<AccionAuditoria>().notNull(),
  antes: jsonb('antes'),
  despues: jsonb('despues'),
  ip: inet('ip'),
  /** Módulo de la entidad. NULL solo en filas viejas de entidades que no son tablas. */
  modulo: text('modulo').$type<Modulo>(),
  /** Sede del registro afectado; NULL si no aplica. */
  sedeId: uuid('sede_id'),
  /** Nombre del autor en el momento del evento (NULL si fue el sistema). */
  usuarioNombre: text('usuario_nombre'),
});

/**
 * Sesiones de Supabase Auth (`id` = `session_id` del token). Global como `usuario`: cada quien ve
 * solo las suyas. Solo lectura para app_api: las escriben `app.tocar_sesion()` y `app.cerrar_sesion()`.
 */
export const sesion = esquemaApp.table('sesion', {
  id: uuid('id').primaryKey(),
  usuarioId: uuid('usuario_id').notNull(),
  iniciadaEn: timestamp('iniciada_en', { withTimezone: true }).notNull().defaultNow(),
  ultimaActividad: timestamp('ultima_actividad', { withTimezone: true }).notNull().defaultNow(),
  cerradaEn: timestamp('cerrada_en', { withTimezone: true }),
  motivoCierre: text('motivo_cierre').$type<MotivoCierreSesion>(),
  ...auditoriaFila,
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
  sesion,
};
export type Esquema = typeof esquema;
