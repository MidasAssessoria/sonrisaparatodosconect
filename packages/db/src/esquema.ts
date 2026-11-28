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
  IDIOMAS_PACIENTE,
  Modulo,
  ORIGENES_PACIENTE,
  SEXOS,
  TasaIva,
  TipoAlerta,
  TipoRelacion,
} from '@conecta/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
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
  /**
   * (22023) Alguna sede elegida está dada de baja. Desde 0015/0016 también al asignar una sede o una
   * sede por defecto dada de baja, o al activar un tramo o un sillón en una sede dada de baja.
   */
  'sede_dada_de_baja',
] as const;
export type RestriccionPersonal = (typeof RESTRICCIONES_PERSONAL)[number];

/**
 * Nombres de regla de la revisión del Sprint 2 (migración 0015: límites de quien administra y baja
 * con motivo) que la base pone en el campo `constraint` de sus errores. Van aparte de las listas
 * anteriores para no romper a quien ya tiene un mapa exhaustivo de ellas. Ningún dueño activo de la
 * clínica recibe los de los límites (no tiene límite). Código entre paréntesis.
 */
export const RESTRICCIONES_LIMITES = [
  /**
   * (42501) Un rol activo quedaría, al terminar la sentencia, con permisos que el rol del actor no
   * tiene (alta, atributos o matriz). El mensaje lista los permisos que sobran (`modulo:accion`).
   */
  'rol_permisos_ajenos',
  /** (42501) Un rol activo quedaría con todas_las_sedes y el rol del actor no la tiene. */
  'rol_todas_las_sedes_ajeno',
  /**
   * (42501) Invitar, reenviar, cambiar el rol o reactivar con un rol que tiene permisos que el del
   * actor no tiene. El mensaje lista los que sobran.
   */
  'asignacion_rol_superior',
  /** (42501) Lo mismo con un rol que tiene todas_las_sedes, si el del actor no la tiene. */
  'asignacion_todas_las_sedes',
  /** (42501) Editar un rol de sistema o su matriz sin ser dueño. */
  'rol_sistema_solo_dueno',
  /** (23514, CHECK real de app.rol) Dueño/a y Administración exigen siempre doble factor. */
  'rol_mfa_obligatorio',
  /**
   * (42501) Quien no ve todas las sedes tocó una membresía (o su invitación, o su vínculo con un
   * profesional) con sedes fuera de las suyas, o asignó una sede que no ve.
   */
  'acceso_fuera_de_sedes',
  /** (23514) Pasar a inactivo una membresía o un rol sin motivo. */
  'baja_sin_motivo',
  /** (P0002) `desactivar_membresia` con un id que no es una membresía activa de la clínica. */
  'membresia_no_activa',
] as const;
export type RestriccionLimite = (typeof RESTRICCIONES_LIMITES)[number];

/** Nombres de regla de `app.encolar` (0018) en el campo `constraint` de sus errores. */
export const RESTRICCIONES_COLA = [
  /** (42501) Sin clínica en el contexto, o la clínica está dada de baja. */
  'cola_sin_contexto',
  /** (22023) Una cola que no está en la lista de `app.encolar`. */
  'cola_no_permitida',
  /** (22023) Datos que no tienen la forma de esa cola, otro clinicaId, o un registro que no existe. */
  'cola_datos_invalidos',
] as const;
export type RestriccionCola = (typeof RESTRICCIONES_COLA)[number];

/**
 * Nombres de regla del Sprint 3 (pacientes, grupo familiar, alertas y nota interna, migraciones
 * 0019–0027) que la base pone en el campo `constraint` de sus errores. Código entre paréntesis.
 * Además de estas, los nombres de restricciones reales que la API puede recibir:
 *   - 23514: `paciente_nombres_check`, `paciente_apellidos_check`, `paciente_ci_check`,
 *     `paciente_ruc_check`, `paciente_fecha_nac_check`, `paciente_sexo_check`,
 *     `paciente_telefono_check`, `paciente_email_check`, `paciente_ciudad_check`,
 *     `paciente_direccion_check`, `paciente_idioma_check`, `paciente_origen_check`,
 *     `paciente_motivo_baja_check`, `paciente_relacion_tipo_check`,
 *     `paciente_relacion_consigo_mismo`, `paciente_relacion_motivo_baja_check`,
 *     `paciente_alerta_texto_check`, `paciente_alerta_tipo_check` (0027),
 *     `paciente_nota_texto_check`. `paciente_ruc_check` exige desde 0027 una base de 3 a 9
 *     caracteres sin ceros a la izquierda (como normalizarRuc);
 *   - 23505: `paciente_relacion_par_activo` (ya hay un vínculo activo entre esos dos pacientes);
 *   - 23503: `paciente_relacion_paciente_fkey`, `paciente_relacion_familiar_fkey` (paciente que no
 *     es de la clínica), `paciente_alerta_paciente_fkey`, `paciente_nota_paciente_fkey`.
 * Y `baja_sin_motivo` (23514, de `RESTRICCIONES_LIMITES`) al desactivar un paciente sin motivo.
 */
export const RESTRICCIONES_PACIENTES = [
  /** (42501) Al actor le falta pacientes:crear / pacientes:editar / pacientes:anular. */
  'pacientes_sin_permiso',
  /**
   * (42501) Al actor le falta ficha_clinica:editar (alertas manuales y nota interna) o, desde 0023,
   * ficha_clinica:ver para escribir la nota interna o para cargar, desactivar o tocar una alerta
   * inactiva.
   */
  'ficha_clinica_sin_permiso',
  /** (22023) Alta de un paciente ya inactivo. */
  'paciente_nace_activo',
  /** (23514) Fecha de nacimiento posterior a hoy (zona de la clínica). */
  'paciente_fecha_nac_futura',
  /** (P0002) `desactivar_paciente` / `reactivar_paciente` con un id que no es de la clínica. */
  'paciente_no_encontrado',
  /** (22023) Vínculo con un paciente inactivo. */
  'relacion_paciente_inactivo',
  /**
   * (23514) madre con un familiar de sexo M, o padre con uno de sexo F. Desde 0026 también al
   * cambiar el sexo de un paciente que figura como madre/padre en un vínculo cargado a mano.
   */
  'relacion_tipo_sexo',
  /**
   * (23514) El otro sentido ya existe con un tipo que no corresponde; un espejo cargado a mano; o
   * (`editarRelacion`) falta el otro sentido.
   */
  'relacion_espejo_inconsistente',
  /** (23514) Tutor legal o responsable de pago marcado en los dos sentidos. */
  'relacion_marca_un_sentido',
  /** (22023) Cambiar un vínculo dado de baja (o crearlo ya dado de baja; o `editarRelacion`). */
  'relacion_dada_de_baja',
  /** (P0002) `baja_relacion` / `editar_relacion` con un id que no es de la clínica. */
  'relacion_no_encontrada',
  /**
   * (P0002) `cambiar_alerta` con un id que no es de la clínica (o, sin ficha_clinica:ver, de una
   * alerta inactiva: no existe para quien no la puede ver).
   */
  'alerta_no_encontrada',
  /** (22023) Cursor de `listar_pacientes` que no se puede decodificar (desde 0025 es opaco). */
  'cursor_invalido',
  /** (22023) Límite fuera de 1..1000. */
  'pacientes_limite',
  /** (22023) Filtro que no está en FILTROS_PACIENTES. */
  'pacientes_filtro',
] as const;
export type RestriccionPaciente = (typeof RESTRICCIONES_PACIENTES)[number];

export type SexoPaciente = (typeof SEXOS)[number];
export type IdiomaPaciente = (typeof IDIOMAS_PACIENTE)[number];
export type OrigenPaciente = (typeof ORIGENES_PACIENTE)[number];

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
  /**
   * Motivo de la desactivación vigente (la base lo borra al reactivar). Para app_api, desactivar
   * exige motivo: usá `desactivarRol`.
   */
  motivoBaja: text('motivo_baja'),
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
  /**
   * Motivo de la baja vigente (estado inactivo; la base lo borra al reactivar). Para app_api, pasar a
   * inactivo exige motivo: usá `desactivarMembresia` (o `anularInvitacion` para una pendiente).
   */
  motivoBaja: text('motivo_baja'),
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

/**
 * Paciente (módulo pacientes). La base normaliza al guardar (CI sin puntos, teléfono a E.164,
 * correo en minúsculas, texto opcional vacío -> NULL) y valida el formato con CHECK. La CI NO es
 * única. Se desactiva con motivo (`app.desactivar_paciente`), no se borra. `origen` no cambia.
 * La nota interna NO está acá: ver `pacienteNota`.
 */
export const paciente = esquemaApp.table('paciente', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  nombres: text('nombres').notNull(),
  apellidos: text('apellidos'),
  /** Solo dígitos, sin ceros a la izquierda. */
  ci: text('ci'),
  /** `base-dv`. */
  ruc: text('ruc'),
  /** `YYYY-MM-DD`. */
  fechaNac: date('fecha_nac', { mode: 'string' }),
  sexo: text('sexo').$type<SexoPaciente>(),
  /** E.164. */
  telefono: text('telefono'),
  email: text('email'),
  ciudad: text('ciudad'),
  direccion: text('direccion'),
  idioma: text('idioma').$type<IdiomaPaciente>().notNull().default('es'),
  aceptaWhatsapp: boolean('acepta_whatsapp').notNull().default(false),
  origen: text('origen').$type<OrigenPaciente>().notNull().default('recepcion'),
  activo: boolean('activo').notNull().default(true),
  motivoBaja: text('motivo_baja'),
  /** Generada (COLLATE "C"): clave de orden de los apellidos o, si no hay, de los nombres. */
  ordenApellidos: text('orden_apellidos').generatedAlwaysAs(
    sql`app.clave_orden(COALESCE(apellidos, nombres))`,
  ),
  /** Generada (COLLATE "C"): clave de orden de los nombres. */
  ordenNombres: text('orden_nombres').generatedAlwaysAs(sql`app.clave_orden(nombres)`),
  ...auditoriaFila,
});

/**
 * Índice de búsqueda (dato derivado; lo mantiene la base, app_api solo lee). Usalo a través de
 * `buscarPacientes` / `listarPacientes`: su política solo muestra las filas que coinciden con la
 * búsqueda en curso.
 */
export const pacienteBusqueda = esquemaApp.table('paciente_busqueda', {
  /** = paciente.id */
  id: uuid('id').primaryKey(),
  clinicaId: uuid('clinica_id').notNull(),
  texto: text('texto').notNull(),
  /** Copia de paciente.activo. */
  activo: boolean('activo').notNull(),
  /** Copia de paciente.orden_apellidos (COLLATE "C"). */
  ordenApellidos: text('orden_apellidos').notNull(),
  /** Copia de paciente.orden_nombres (COLLATE "C"). */
  ordenNombres: text('orden_nombres').notNull(),
  ...auditoriaFila,
});

/**
 * Vínculo del grupo familiar: «familiar es `tipo` de paciente». La base crea y da de baja el otro
 * sentido. paciente_id, familiar_id, espejo y tipo no cambian (el tipo de un espejo lo recalcula la
 * base cuando cambia el sexo del familiar).
 */
export const pacienteRelacion = esquemaApp.table('paciente_relacion', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  pacienteId: uuid('paciente_id').notNull(),
  familiarId: uuid('familiar_id').notNull(),
  tipo: text('tipo').$type<TipoRelacion>().notNull(),
  /** paciente_id es tutor legal de familiar_id. */
  esTutorLegal: boolean('es_tutor_legal').notNull().default(false),
  /** paciente_id paga por familiar_id. */
  esResponsablePago: boolean('es_responsable_pago').notNull().default(false),
  /** true si la creó la base como el otro sentido de un vínculo (0026). */
  espejo: boolean('espejo').notNull().default(false),
  ...bajaLogica,
  ...auditoriaFila,
});

/**
 * Alerta manual (módulo ficha_clinica). Solo se activa o desactiva. `creadaPor` la fija la base. Las
 * inactivas solo existen para quien tiene `ficha_clinica:ver` (RLS, 0023).
 */
export const pacienteAlerta = esquemaApp.table('paciente_alerta', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  pacienteId: uuid('paciente_id').notNull(),
  /** alergia o condicion (0027). No cambia. */
  tipo: text('tipo').$type<TipoAlerta>().notNull(),
  texto: text('texto').notNull(),
  activa: boolean('activa').notNull().default(true),
  creadaPor: uuid('creada_por'),
  ...auditoriaFila,
});

/**
 * Nota interna (módulo ficha_clinica), una por paciente. Sin `ficha_clinica:ver` no se ve ni la
 * fila (RLS) ni su historial en audit_log (0023); escribirla exige `ficha_clinica:editar` y `ver`.
 * `texto` NULL = borrada.
 */
export const pacienteNota = esquemaApp.table('paciente_nota', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicaId: uuid('clinica_id').notNull(),
  pacienteId: uuid('paciente_id').notNull(),
  texto: text('texto'),
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
  paciente,
  pacienteBusqueda,
  pacienteRelacion,
  pacienteAlerta,
  pacienteNota,
};
export type Esquema = typeof esquema;
