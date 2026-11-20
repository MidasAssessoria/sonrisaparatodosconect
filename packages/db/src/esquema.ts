/**
 * Esquema Drizzle del schema `app`, escrito a mano como espejo de `migraciones/*.sql`.
 *
 * La fuente de verdad son las migraciones: este archivo solo da tipos a las consultas. Una prueba
 * (test/esquema.test.ts) compara cada tabla y columna con la base real, en los dos sentidos.
 * Restricciones, índices, RLS y triggers viven solo en SQL.
 */
import type {
  Accion,
  AccionAuditoria,
  CategoriaArchivo,
  EstadoSede,
  Modulo,
  TasaIva,
} from '@conecta/shared';
import { sql } from 'drizzle-orm';
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

/**
 * Nombres de regla del Sprint 2 (invitaciones, membresías por invitación y roles) que la base pone
 * en el campo `constraint` de sus errores. Van aparte de `RESTRICCIONES_ACCESO` para no romper a
 * quien ya tiene un mapa exhaustivo de esa lista; la API los tiene que sumar a su traducción.
 * Código entre paréntesis.
 */
export const RESTRICCIONES_PERSONAL = [
  /** (42501) Alta de membresía con usuario, o cambio de usuario fuera de la aceptación. */
  'membresia_por_invitacion',
  /** (42501) Dar de baja una membresía pendiente que todavía tiene la invitación abierta. */
  'membresia_invitacion_abierta',
  /** (23514) Una membresía activa o pendiente con un rol desactivado. */
  'rol_inactivo',
  /** (23514) Desactivar un rol que usa alguna membresía activa o pendiente. */
  'rol_en_uso',
  /** (P0002) `reemplazar_permisos_rol` con un rol que no es de la clínica. */
  'rol_no_encontrado',
  /** (P0002) Token inexistente, vencido, usado o anulado (sin distinguir), o membresía no pendiente. */
  'invitacion_no_vigente',
  /** (P0002) Reenviar o anular para una membresía sin invitación pendiente en la clínica. */
  'invitacion_no_encontrada',
  /** (42501) Aceptar con otro correo, o reenviar a otro correo. */
  'invitacion_otro_correo',
  /** (42501) Al aceptar: el correo ya es de otra cuenta, o la cuenta tiene otro correo. */
  'invitacion_otra_cuenta',
  /** (42501) Invitación para una membresía que no está pendiente o ya tiene usuario. */
  'invitacion_membresia',
  /** (23505) El correo es de alguien que ya es (o fue: reactivarlo) miembro de la clínica. */
  'invitacion_ya_es_miembro',
  /** (22023) vence_en fuera de (ahora, ahora + 30 días]. */
  'invitacion_vencimiento',
  /** (22023) La sede por defecto no está entre las sedes elegidas. */
  'invitacion_sede_defecto',
  /** (22023) Alguna sede elegida está dada de baja. */
  'sede_dada_de_baja',
] as const;
export type RestriccionPersonal = (typeof RESTRICCIONES_PERSONAL)[number];

/** Dónde está guardado un archivo (`app.archivo.almacen`). */
export const ALMACENES_ARCHIVO = ['local', 'supabase'] as const;
export type AlmacenArchivo = (typeof ALMACENES_ARCHIVO)[number];

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
  /**
   * Roles de sistema: `dueno`, `administracion`, `odontologo`, `asistente`, `recepcion`. Roles de la
   * clínica: lo genera la base (`r` + 32 hex) si no se manda. Interno: la API lo muestra solo si
   * `esSistema` (el contrato pone `codigo: null` para los roles de la clínica).
   */
  codigo: text('codigo')
    .notNull()
    .default(sql`('r'::text || replace((gen_random_uuid())::text, '-'::text, ''::text))`),
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
  /**
   * NULL mientras la invitación no se aceptó (pendiente) o si se anuló antes (inactivo). Lo pone
   * `app.aceptar_invitacion()`, una sola vez. app_api no crea membresías con usuario.
   */
  usuarioId: uuid('usuario_id'),
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

/**
 * Invitación a una membresía pendiente. La base guarda solo el SHA-256 (hex) del token.
 * app_api la escribe con `app.crear_invitacion` / `reenviar_invitacion` / `anular_invitacion`
 * (INSERT solo de clinica_id, membresia_id, email, nombre, token_hash y vence_en; UPDATE solo de
 * anulada_en y motivo_anulacion). La marca de uso la pone `app.aceptar_invitacion`.
 */
export const invitacion = esquemaApp.table('invitacion', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  membresiaId: uuid('membresia_id').notNull(),
  /** En minúsculas; el mismo en todas las invitaciones de una membresía. */
  email: text('email').notNull(),
  nombre: text('nombre').notNull(),
  /** SHA-256 hex del token (64 caracteres). Único. */
  tokenHash: text('token_hash').notNull(),
  venceEn: timestamp('vence_en', { withTimezone: true }).notNull(),
  usadaEn: timestamp('usada_en', { withTimezone: true }),
  usadaPor: uuid('usada_por'),
  anuladaEn: timestamp('anulada_en', { withTimezone: true }),
  motivoAnulacion: text('motivo_anulacion'),
  /** Lo fija la base con el usuario del contexto. */
  invitadaPor: uuid('invitada_por'),
  ...auditoriaFila,
});

/** Quien atiende pacientes (módulo personal). Con o sin membresía; a lo sumo uno por membresía. */
export const profesional = esquemaApp.table('profesional', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  membresiaId: uuid('membresia_id'),
  nombre: text('nombre').notNull(),
  especialidad: text('especialidad'),
  /** `#RRGGBB`. */
  color: text('color').notNull(),
  registroProf: text('registro_prof'),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

/**
 * Tramo semanal de atención en una sede. No se edita: se desactiva y se crea otro. La base rechaza
 * (23P01 `profesional_disponibilidad_superpuesta`) dos tramos activos del mismo profesional que se
 * pisen el mismo día, aunque sean en sedes distintas; y (23503
 * `profesional_disponibilidad_sillon_fkey`) un sillón de otra sede.
 */
export const profesionalDisponibilidad = esquemaApp.table('profesional_disponibilidad', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  profesionalId: uuid('profesional_id').notNull(),
  sedeId: uuid('sede_id').notNull(),
  /** 0 = domingo … 6 = sábado. */
  diaSemana: smallint('dia_semana').notNull(),
  horaInicio: time('hora_inicio').notNull(),
  horaFin: time('hora_fin').notNull(),
  sillonId: uuid('sillon_id'),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

/** Bloqueo de agenda de un profesional. No se edita: se da de baja (deleted_at + motivo_baja). */
export const profesionalBloqueo = esquemaApp.table('profesional_bloqueo', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  profesionalId: uuid('profesional_id').notNull(),
  desde: timestamp('desde', { withTimezone: true }).notNull(),
  hasta: timestamp('hasta', { withTimezone: true }).notNull(),
  motivo: text('motivo').notNull(),
  ...bajaLogica,
  ...auditoriaFila,
});

/**
 * Catálogo de tratamientos (módulo configuracion). Guaraníes enteros con IVA incluido. Nombre único
 * entre los activos sin distinguir mayúsculas, tildes ni espacios (23505 `tratamiento_nombre_unico`).
 */
export const tratamiento = esquemaApp.table('tratamiento', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  nombre: text('nombre').notNull(),
  categoria: text('categoria'),
  precio: bigint('precio', { mode: 'number' }).notNull(),
  iva: smallint('iva').$type<TasaIva>().notNull().default(10),
  /** Múltiplo de 5, entre 5 y 480. */
  duracionMin: smallint('duracion_min').notNull().default(30),
  activo: boolean('activo').notNull().default(true),
  ...auditoriaFila,
});

/** Configuración de agenda y reserva online de una sede (módulo sedes); una fila por sede. */
export const agendaConfig = esquemaApp.table('agenda_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  sedeId: uuid('sede_id').notNull(),
  anticipacionMin: integer('anticipacion_min').notNull().default(120),
  diasAdelante: integer('dias_adelante').notNull().default(14),
  reservaOnlineActiva: boolean('reserva_online_activa').notNull().default(false),
  ...auditoriaFila,
});

/**
 * Metadatos de un archivo privado. Inmutables salvo la baja. `modulo` la genera la base desde
 * `categoria` (no se escribe). `ruta` empieza con `<clinica_id>/`; `subidoPor` lo fija la base.
 */
export const archivo = esquemaApp.table('archivo', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  categoria: text('categoria').$type<CategoriaArchivo>().notNull(),
  /** Generada: el módulo de la categoría (nunca NULL, CHECK). */
  modulo: text('modulo')
    .$type<Modulo>()
    .generatedAlwaysAs(
      sql`CASE categoria WHEN 'firma_profesional'::text THEN 'personal'::text WHEN 'logo_clinica'::text THEN 'configuracion'::text ELSE NULL::text END`,
    ),
  sedeId: uuid('sede_id'),
  almacen: text('almacen').$type<AlmacenArchivo>().notNull(),
  bucket: text('bucket').notNull(),
  ruta: text('ruta').notNull(),
  nombreOriginal: text('nombre_original').notNull(),
  /** Tipo MIME detectado por el contenido. */
  tipo: text('tipo').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  ancho: integer('ancho'),
  alto: integer('alto'),
  /** SHA-256 hex del contenido. */
  sha256: text('sha256').notNull(),
  subidoPor: uuid('subido_por'),
  ...bajaLogica,
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
  invitacion,
  profesional,
  profesionalDisponibilidad,
  profesionalBloqueo,
  tratamiento,
  agendaConfig,
  archivo,
};
export type Esquema = typeof esquema;
