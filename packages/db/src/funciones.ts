/**
 * Llamadas tipadas a las funciones SQL que app_api puede ejecutar. Casi todas corren dentro de una
 * transacción con contexto (`conContexto` o `conUsuario`) y actúan sobre el usuario y la clínica
 * del contexto: no reciben el usuario ni la clínica como parámetro. Las dos excepciones son las
 * públicas de invitación (`consultarInvitacion`, `aceptarInvitacion`), que corren sin contexto
 * (`sinContexto`) y resuelven la clínica por el token.
 */
import { createHash } from 'node:crypto';
import type {
  Accion,
  AlertaManual,
  CrearPaciente,
  EditarPaciente,
  EditarRelacion,
  EstadoMembresia,
  FILTROS_PACIENTES,
  Modulo,
  Paciente,
  PacienteResumen,
  Persona,
  Relacion,
  TipoAlerta,
  TipoRelacion,
} from '@conecta/shared';
import { sql } from 'drizzle-orm';
import type { TransaccionConecta } from './contexto.js';
import {
  paciente,
  RESULTADOS_TOCAR_SESION,
  type AccionEvento,
  type IdiomaPaciente,
  type OrigenPaciente,
  type ResultadoTocarSesion,
  type SexoPaciente,
} from './esquema.js';

/** Filtro de la lista de pacientes (FILTROS_PACIENTES del contrato). */
export type FiltroPacientes = (typeof FILTROS_PACIENTES)[number];

function primera<T>(filas: T[], funcion: string): T {
  const fila = filas[0];
  if (fila === undefined) throw new Error(`${funcion} no devolvió ninguna fila.`);
  return fila;
}

/**
 * `app.tocar_sesion(sesion_id, inactividad_min)`: crea, renueva o vence la sesión del usuario del
 * contexto. No hace falta clínica en el contexto. Con `vencida`, el cierre queda escrito en esta
 * transacción: confirmala antes de responder `no_autenticado` (si se revierte, la sesión sigue
 * abierta). Lanza 42501 (`sesion_ajena`) si el id es de otra persona.
 */
export async function tocarSesion(
  tx: TransaccionConecta,
  sesionId: string,
  inactividadMin: number,
): Promise<ResultadoTocarSesion> {
  const { rows } = await tx.execute<{ resultado: string }>(
    sql`select app.tocar_sesion(${sesionId}::uuid, ${inactividadMin}::integer) as resultado`,
  );
  const resultado = primera(rows, 'app.tocar_sesion').resultado;
  if (!(RESULTADOS_TOCAR_SESION as readonly string[]).includes(resultado)) {
    throw new Error(`app.tocar_sesion devolvió un valor desconocido: ${resultado}.`);
  }
  return resultado as ResultadoTocarSesion;
}

/**
 * `app.cerrar_sesion(sesion_id)`: cierre por salida. `true` si la cerró ahora, `false` si ya
 * estaba cerrada. Si nunca se había tocado, la deja creada y cerrada. Lanza 42501 (`sesion_ajena`)
 * si el id es de otra persona.
 */
export async function cerrarSesion(tx: TransaccionConecta, sesionId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ cerrada: boolean }>(
    sql`select app.cerrar_sesion(${sesionId}::uuid) as cerrada`,
  );
  return primera(rows, 'app.cerrar_sesion').cerrada;
}

/**
 * `app.activar_mfa(token_emitido_en)`: marca el doble factor del usuario del contexto como activo.
 * `tokenEmitidoEn` es el `iat` del token aal2. Devuelve `false` (y no cambia nada) si ese token es
 * anterior o igual a la última baja del doble factor: la API tiene que tratarlo como aal1.
 */
export async function activarMfa(tx: TransaccionConecta, tokenEmitidoEn: Date): Promise<boolean> {
  const { rows } = await tx.execute<{ activo: boolean }>(
    sql`select app.activar_mfa(${tokenEmitidoEn.toISOString()}::timestamptz) as activo`,
  );
  return primera(rows, 'app.activar_mfa').activo;
}

/**
 * `app.desactivar_mfa()`: baja del doble factor del usuario del contexto. Devuelve
 * `mfa_desactivado_en`: tokens aal2 con `iat` hasta ese momento ya no cuentan.
 */
export async function desactivarMfa(tx: TransaccionConecta): Promise<Date> {
  const { rows } = await tx.execute<{ baja: Date | string }>(
    sql`select app.desactivar_mfa() as baja`,
  );
  const baja = primera(rows, 'app.desactivar_mfa').baja;
  return baja instanceof Date ? baja : new Date(baja);
}

export interface EventoAuditable {
  accion: AccionEvento;
  /** Nombre de una tabla auditada de app (p. ej. `sede`), o `sesion` con `ingresar`. */
  entidad: string;
  /** Registro afectado; tiene que existir en la clínica del contexto. */
  entidadId?: string | null | undefined;
  /** Objeto JSON de hasta 4096 bytes. Va a `despues`. */
  detalle?: Record<string, unknown> | null | undefined;
  /** Solo para eventos sobre un conjunto (sin `entidadId`) o igual a la sede del registro. */
  sedeId?: string | null | undefined;
}

/**
 * `app.registrar_evento(...)`: ver/exportar/enviar/ingresar. Devuelve el id de la fila de
 * auditoría (con `ingresar`, el de la ya existente si esa sesión ya ingresó en esta clínica).
 * Errores: 22023 si los datos no sirven; 42501 sin contexto, sin membresía activa o con la clínica
 * dada de baja.
 */
export async function registrarEvento(
  tx: TransaccionConecta,
  evento: EventoAuditable,
): Promise<string> {
  const detalle =
    evento.detalle === undefined || evento.detalle === null ? null : JSON.stringify(evento.detalle);
  const { rows } = await tx.execute<{ id: string }>(
    sql`select app.registrar_evento(${evento.accion}, ${evento.entidad},
          ${evento.entidadId ?? null}::uuid, ${detalle}::jsonb, ${evento.sedeId ?? null}::uuid) as id`,
  );
  return primera(rows, 'app.registrar_evento').id;
}

// ---------------------------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------------------------

function fecha(valor: Date | string): Date {
  return valor instanceof Date ? valor : new Date(valor);
}

function isoONulo(valor: Date | string | null): string | null {
  return valor === null ? null : fecha(valor).toISOString();
}

/**
 * Hash con el que la base guarda y busca un token de invitación: SHA-256 del token (UTF-8) en hex
 * (64 caracteres en minúsculas). La base nunca ve el token; la API lo genera (p. ej. 32 bytes
 * aleatorios en base64url), lo devuelve una sola vez en el enlace y pasa acá solo el hash.
 */
export function hashTokenInvitacion(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface DatosInvitacion {
  nombre: string;
  /** Se guarda en minúsculas y sin espacios alrededor. */
  email: string;
  rolId: string;
  sedeIds: readonly string[];
  /** Tiene que estar entre `sedeIds`. */
  sedeDefectoId?: string | null | undefined;
  /** `hashTokenInvitacion(token)`. */
  tokenHash: string;
  /** Por defecto, dentro de 72 horas. Entre ahora y 30 días. */
  venceEn?: Date | null | undefined;
}

export interface ResultadoCrearInvitacion {
  membresiaId: string;
  invitacionId: string;
  venceEn: Date;
}

/**
 * `app.crear_invitacion(...)` (permiso `personal:crear`, con contexto): crea la membresía pendiente
 * sin usuario (rol, sedes, sede por defecto) y su invitación, que vence a las 72 horas si no se
 * indica `venceEn`. Corre como app_api: la base aplica `app.proteger_acceso` y
 * `app.proteger_invitacion`.
 * Errores (campo `constraint`): `acceso_*` (42501), `asignacion_rol_superior` /
 * `asignacion_todas_las_sedes` (42501, el rol da más que el del actor), `acceso_fuera_de_sedes`
 * (42501, una sede que el actor no ve), `rol_inactivo` (23514), `invitacion_ya_es_miembro` (23505),
 * `invitacion_abierta_email` (23505, ya hay una invitación abierta para ese correo),
 * `invitacion_vencimiento` / `invitacion_sede_defecto` / `sede_dada_de_baja` (22023),
 * `invitacion_email_check` / `invitacion_nombre_check` / `invitacion_token_hash_check` (23514), FK
 * `membresia_rol_fkey` / `usuario_sede_sede_fkey` (23503).
 */
export async function crearInvitacion(
  tx: TransaccionConecta,
  datos: DatosInvitacion,
): Promise<ResultadoCrearInvitacion> {
  const { rows } = await tx.execute<{
    membresia_id: string;
    invitacion_id: string;
    vence_en: Date | string;
  }>(
    sql`select membresia_id, invitacion_id, vence_en from app.crear_invitacion(
          ${datos.nombre}, ${datos.email}, ${datos.rolId}::uuid,
          ${`{${datos.sedeIds.join(',')}}`}::uuid[], ${datos.sedeDefectoId ?? null}::uuid,
          ${datos.tokenHash}, ${datos.venceEn ? datos.venceEn.toISOString() : null}::timestamptz)`,
  );
  const fila = primera(rows, 'app.crear_invitacion');
  return {
    membresiaId: fila.membresia_id,
    invitacionId: fila.invitacion_id,
    venceEn: fecha(fila.vence_en),
  };
}

/**
 * `app.reenviar_invitacion(membresia, token_hash, vence_en)` (permiso `personal:crear`, con
 * contexto): anula la invitación abierta de esa membresía pendiente y crea otra con el mismo correo y
 * nombre (vence a las 72 horas si no se indica). El token viejo deja de servir. Errores:
 * `invitacion_no_encontrada` (P0002), `invitacion_membresia` (42501, la membresía ya no está
 * pendiente), `acceso_fuera_de_sedes` y `asignacion_rol_superior` / `asignacion_todas_las_sedes`
 * (42501: reenviar es volver a dar ese rol), los de `crearInvitacion`.
 */
export async function reenviarInvitacion(
  tx: TransaccionConecta,
  membresiaId: string,
  tokenHash: string,
  venceEn?: Date | null,
): Promise<{ invitacionId: string; venceEn: Date }> {
  const { rows } = await tx.execute<{ invitacion_id: string; vence_en: Date | string }>(
    sql`select invitacion_id, vence_en from app.reenviar_invitacion(
          ${membresiaId}::uuid, ${tokenHash}, ${venceEn ? venceEn.toISOString() : null}::timestamptz)`,
  );
  const fila = primera(rows, 'app.reenviar_invitacion');
  return { invitacionId: fila.invitacion_id, venceEn: fecha(fila.vence_en) };
}

/**
 * `app.anular_invitacion(membresia, motivo)` (permiso `personal:anular` o `personal:editar`, con
 * contexto): anula la invitación abierta y deja la membresía pendiente sin usuario en `inactivo`,
 * con el motivo también como `motivo_baja` de la membresía.
 * Errores: `invitacion_no_encontrada` (P0002, no hay membresía pendiente sin usuario con ese id),
 * `invitacion_anulacion_check` (22023, motivo vacío), `acceso_*` (42501, también
 * `acceso_fuera_de_sedes`).
 */
export async function anularInvitacion(
  tx: TransaccionConecta,
  membresiaId: string,
  motivo: string,
): Promise<void> {
  await tx.execute(sql`select app.anular_invitacion(${membresiaId}::uuid, ${motivo})`);
}

/** Lo que `app.consultar_invitacion` deja ver de una invitación vigente. */
export interface InvitacionConsultada {
  /** Nombre de la clínica. */
  clinica: string;
  /** Nombre del rol. */
  rol: string;
  /** Nombre de la persona invitada. */
  nombre: string;
  /** Correo invitado, completo (la API lo enmascara para la respuesta pública). */
  email: string;
  venceEn: Date;
  /**
   * Ya hay una identidad en `app.usuario` con ese correo (la persona es o fue miembro de alguna
   * clínica). NO dice si hay cuenta en Supabase Auth: una cuenta invitada que nunca aceptó nada no
   * tiene fila acá. Para elegir el siguiente paso, la API tiene que mirar Auth.
   */
  usuarioExiste: boolean;
}

/**
 * `app.consultar_invitacion(token_hash)`: público, sin contexto (usá `sinContexto`). `null` si el
 * token no existe, venció, se usó, se anuló o la membresía ya no está pendiente: no distingue el
 * caso (la API responde `no_encontrado`).
 */
export async function consultarInvitacion(
  tx: TransaccionConecta,
  tokenHash: string,
): Promise<InvitacionConsultada | null> {
  const { rows } = await tx.execute<{
    clinica: string;
    rol: string;
    nombre: string;
    email: string;
    vence_en: Date | string;
    usuario_existe: boolean;
  }>(
    sql`select clinica, rol, nombre, email, vence_en, usuario_existe
        from app.consultar_invitacion(${tokenHash})`,
  );
  const fila = rows[0];
  if (!fila) return null;
  return {
    clinica: fila.clinica,
    rol: fila.rol,
    nombre: fila.nombre,
    email: fila.email,
    venceEn: fecha(fila.vence_en),
    usuarioExiste: fila.usuario_existe,
  };
}

export interface AceptacionInvitacion {
  /** `hashTokenInvitacion(token)`. */
  tokenHash: string;
  /**
   * Id de Supabase Auth VERIFICADO por la API: el `sub` del JWT de quien acepta, cuyo correo la API
   * confirmó con la Admin API (contrato de personal, paso 3). La cuenta puede haber nacido antes (al
   * invitar con `inviteUserByEmail`, o mucho antes): la base no asume nada sobre eso.
   */
  usuarioId: string;
  /** Correo VERIFICADO y confirmado de esa cuenta. */
  email: string;
}

/**
 * `app.aceptar_invitacion(token_hash, usuario_id, email)`: público, sin contexto (usá
 * `sinContexto`). Crea la fila de `app.usuario` si todavía no existe (con el nombre de la
 * invitación), le pone el usuario a la membresía, la activa y marca la invitación usada; todo
 * auditado en esa clínica con la persona como autora. Devuelve la clínica.
 * Una segunda llamada con el mismo token falla; de varias simultáneas gana una.
 * La base confía en `usuarioId` y `email`: la API tiene que haberlos verificado (JWT + correo
 * confirmado en Auth).
 * Errores (campo `constraint`): `invitacion_no_vigente` (P0002, sin distinguir el motivo),
 * `invitacion_otro_correo` y `invitacion_otra_cuenta` (42501), `membresia_usuario_clinica_key`
 * (23505, ya tiene una membresía en esa clínica), `usuario_email_unico` (23505, carrera con otra
 * cuenta del mismo correo).
 */
export async function aceptarInvitacion(
  tx: TransaccionConecta,
  aceptacion: AceptacionInvitacion,
): Promise<string> {
  const { rows } = await tx.execute<{ clinica_id: string }>(
    sql`select app.aceptar_invitacion(${aceptacion.tokenHash}, ${aceptacion.usuarioId}::uuid,
          ${aceptacion.email}) as clinica_id`,
  );
  return primera(rows, 'app.aceptar_invitacion').clinica_id;
}

// ---------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------

export interface PermisoRol {
  modulo: Modulo;
  accion: Accion;
}

/**
 * `app.reemplazar_permisos_rol(rol, permisos)` (con contexto): la matriz del rol pasa a ser
 * exactamente `permisos`; lo que falta queda `activo = false` (no se borra) y lo que vuelve se
 * reactiva (primero revoca, después agrega). Devuelve cuántos permisos activos quedan. Permiso de la
 * base: `configuracion:editar`, o `configuracion:crear` si el rol se creó en esta misma transacción
 * por el mismo usuario. Salvo para un dueño, el rol (si está activo) tiene que quedar con permisos
 * incluidos en los del actor, y los roles de sistema no se tocan.
 * Errores: `rol_no_encontrado` (P0002), `acceso_propio` (su propio rol), `acceso_rol_dueno` (el rol
 * dueño), `rol_sistema_solo_dueno`, `rol_permisos_ajenos`, `acceso_sin_permiso` (42501),
 * `rol_permiso_modulo_check` / `rol_permiso_accion_check` (23514).
 *
 * Al editar un rol, llamala ANTES de cambiar sus atributos (o con
 * `SET CONSTRAINTS app.rol_limite_actor, app.rol_permiso_limite_actor DEFERRED`): el control de
 * `rol_permisos_ajenos` mira el rol al terminar cada sentencia, y un cambio de nombre de un rol que
 * todavía tiene permisos que el actor no tiene falla aunque la matriz nueva los quite.
 */
export async function reemplazarPermisosRol(
  tx: TransaccionConecta,
  rolId: string,
  permisos: readonly PermisoRol[],
): Promise<number> {
  const lista = permisos.map((p) => `${p.modulo}:${p.accion}`);
  const { rows } = await tx.execute<{ cantidad: number }>(
    sql`select app.reemplazar_permisos_rol(${rolId}::uuid, ${`{${lista.join(',')}}`}::text[]) as cantidad`,
  );
  return primera(rows, 'app.reemplazar_permisos_rol').cantidad;
}

/**
 * `app.desactivar_rol(rol, motivo)` (con contexto): desactiva un rol activo y guarda el motivo
 * (obligatorio; la base lo borra si el rol se reactiva). Permiso de la base: `configuracion:anular`
 * o `configuracion:editar`. Errores: `baja_sin_motivo` (23514), `rol_no_encontrado` (P0002, no hay
 * un rol ACTIVO con ese id en la clínica), `rol_en_uso` / `rol_dueno_activo` (23514),
 * `rol_motivo_baja_check` (23514, más de 500 caracteres), `acceso_*` / `rol_sistema_solo_dueno`
 * (42501).
 */
export async function desactivarRol(
  tx: TransaccionConecta,
  rolId: string,
  motivo: string,
): Promise<void> {
  await tx.execute(sql`select app.desactivar_rol(${rolId}::uuid, ${motivo})`);
}

// ---------------------------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------------------------

/**
 * `app.desactivar_membresia(membresia, motivo)` (con contexto): pasa una membresía ACTIVA a
 * `inactivo` y guarda el motivo (obligatorio; la base lo borra al reactivar). Permiso de la base:
 * `personal:anular` o `personal:editar`. Una pendiente se da de baja con `anularInvitacion`.
 * Errores: `baja_sin_motivo` (23514), `membresia_no_activa` (P0002), `membresia_motivo_baja_check`
 * (23514, más de 500 caracteres), `acceso_*` (42501, también `acceso_fuera_de_sedes`),
 * `membresia_ultimo_dueno` (23514).
 */
export async function desactivarMembresia(
  tx: TransaccionConecta,
  membresiaId: string,
  motivo: string,
): Promise<void> {
  await tx.execute(sql`select app.desactivar_membresia(${membresiaId}::uuid, ${motivo})`);
}

/**
 * `app.membresia_en_alcance(membresia)` (con contexto): `true` si el usuario del contexto puede ver
 * y modificar esa membresía por sede: su rol ve todas las sedes, o las sedes vigentes de la
 * membresía están todas entre las suyas (una con todas las sedes, nunca; una sin sedes, siempre).
 * `false` también si la membresía no es de la clínica. Es el mismo criterio que aplica la base al
 * modificar (`acceso_fuera_de_sedes`): sirve para responder 404 antes de intentar.
 */
export async function membresiaEnAlcance(
  tx: TransaccionConecta,
  membresiaId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ en_alcance: boolean }>(
    sql`select app.membresia_en_alcance(${membresiaId}::uuid)
               and exists (select 1 from app.membresia m
                           where m.clinica_id = app.clinica_actual() and m.id = ${membresiaId}::uuid)
               as en_alcance`,
  );
  return primera(rows, 'app.membresia_en_alcance').en_alcance;
}

// ---------------------------------------------------------------------------------------------
// Listado de personal (GET /personal, contrato personaSchema)
// ---------------------------------------------------------------------------------------------

type FilaPersona = {
  membresia_id: string;
  usuario_id: string | null;
  nombre: string;
  email: string;
  telefono: string | null;
  rol_id: string;
  rol_codigo: string | null;
  rol_nombre: string;
  estado: EstadoMembresia;
  sede_ids: string[] | null;
  sede_defecto_id: string | null;
  ultimo_acceso: Date | string | null;
  mfa_activo: boolean;
  invitacion_vence_en: Date | string | null;
  profesional_id: string | null;
};

/**
 * Personas (membresías) de la clínica del contexto que el usuario del contexto puede ver, con la
 * forma de `personaSchema`. Corre como app_api con RLS: de una membresía activa o inactiva con
 * usuario salen los datos de su usuario; de una pendiente (o anulada) sin usuario, el nombre y el
 * correo de su última invitación (que son de esta clínica). Nunca muestra el perfil de alguien con
 * una membresía pendiente (usuario_ver).
 * Alcance por sede (`app.membresia_en_alcance`, la base filtra): quien ve todas las sedes ve a
 * todos; si no, solo a las personas cuyas sedes están todas entre las suyas (no a quien ve todas).
 * `invitacionVenceEn`: solo si su última invitación sigue abierta (aunque esté vencida).
 * `rol.codigo`: solo para roles de sistema. `sedeIds`: las sedes activas de usuario_sede que no
 * están dadas de baja. `sedeDefectoId`: null si su sede está dada de baja.
 * Con `membresiaId`, solo esa (lista vacía si no es de la clínica o está fuera del alcance).
 */
export async function listarPersonal(
  tx: TransaccionConecta,
  opciones: { membresiaId?: string | undefined } = {},
): Promise<Persona[]> {
  const filtro = opciones.membresiaId ? sql`and m.id = ${opciones.membresiaId}::uuid` : sql``;
  const { rows } = await tx.execute<FilaPersona>(sql`
    select m.id as membresia_id, m.usuario_id, m.estado,
           (select s.id from app.sede s
            where s.clinica_id = m.clinica_id and s.id = m.sede_defecto_id
              and s.deleted_at is null) as sede_defecto_id,
           coalesce(u.nombre, i.nombre, '') as nombre,
           coalesce(u.email, i.email, '') as email,
           u.telefono, u.ultimo_acceso, coalesce(u.mfa_activo, false) as mfa_activo,
           r.id as rol_id, case when r.es_sistema then r.codigo end as rol_codigo,
           r.nombre as rol_nombre,
           array(select us.sede_id::text from app.usuario_sede us
                 join app.sede s on s.clinica_id = us.clinica_id and s.id = us.sede_id
                 where us.clinica_id = m.clinica_id and us.membresia_id = m.id and us.activo
                   and s.deleted_at is null
                 order by us.sede_id) as sede_ids,
           case when i.usada_en is null and i.anulada_en is null then i.vence_en end
             as invitacion_vence_en,
           p.id as profesional_id
    from app.membresia m
    join app.rol r on r.clinica_id = m.clinica_id and r.id = m.rol_id
    left join app.usuario u on u.id = m.usuario_id
    left join lateral (
      select x.nombre, x.email, x.vence_en, x.usada_en, x.anulada_en
      from app.invitacion x
      where x.clinica_id = m.clinica_id and x.membresia_id = m.id
      order by x.created_at desc, x.id desc
      limit 1
    ) i on true
    left join app.profesional p on p.clinica_id = m.clinica_id and p.membresia_id = m.id
    where m.clinica_id = app.clinica_actual() and app.membresia_en_alcance(m.id) ${filtro}
    order by lower(coalesce(u.nombre, i.nombre, '')), m.id`);
  return rows.map((f) => ({
    membresiaId: f.membresia_id,
    usuarioId: f.usuario_id,
    nombre: f.nombre,
    email: f.email,
    telefono: f.telefono,
    rol: { id: f.rol_id, codigo: f.rol_codigo, nombre: f.rol_nombre },
    estado: f.estado,
    sedeIds: f.sede_ids ?? [],
    sedeDefectoId: f.sede_defecto_id,
    ultimoAcceso: isoONulo(f.ultimo_acceso),
    mfaActivo: f.mfa_activo,
    invitacionVenceEn: isoONulo(f.invitacion_vence_en),
    profesionalId: f.profesional_id,
  }));
}

// ---------------------------------------------------------------------------------------------
// Pacientes (Sprint 3, migraciones 0019–0027)
// ---------------------------------------------------------------------------------------------
//
// Todo corre como app_api con el contexto de la clínica: RLS y `app.proteger_pacientes` deciden.
// Permisos que exige la base (además de los de la API): alta pacientes:crear; edición
// pacientes:editar; desactivar/reactivar pacientes:anular; vínculos pacientes:editar; alertas
// ficha_clinica:editar (y ver para cargar, desactivar o tocar una inactiva); nota interna
// ficha_clinica:editar y ver. La nota interna y las alertas inactivas solo se LEEN con
// ficha_clinica:ver (si no, no existen: estas funciones devuelven null o no las incluyen), y lo
// mismo su historial en audit_log. Edad, pediátrico y con alerta salen de un solo lugar de la base
// (`app.resumen_pacientes`). Nombres de regla de los errores: `RESTRICCIONES_PACIENTES`
// (src/esquema.ts).

/** Fila que devuelven `app.buscar_pacientes`, `app.listar_pacientes` y `app.pacientes_con_ci`. */
type FilaResumen = {
  id: string;
  nombres: string;
  apellidos: string | null;
  ci: string | null;
  sexo: SexoPaciente | null;
  telefono: string | null;
  fecha_nac: string | null;
  edad: number | null;
  pediatrico: boolean;
  con_alerta: boolean;
  activo: boolean;
};

const COLUMNAS_RESUMEN = sql.raw(
  'id, nombres, apellidos, ci, sexo, telefono, fecha_nac::text as fecha_nac, edad, pediatrico, con_alerta, activo',
);

function resumen(f: FilaResumen): PacienteResumen {
  return {
    id: f.id,
    nombres: f.nombres,
    apellidos: f.apellidos,
    ci: f.ci,
    sexo: f.sexo,
    telefono: f.telefono,
    fechaNac: f.fecha_nac,
    edad: f.edad,
    pediatrico: f.pediatrico,
    conAlerta: f.con_alerta,
    activo: f.activo,
  };
}

const ahoraSql = (ahora: Date | undefined) =>
  ahora ? sql`${ahora.toISOString()}::timestamptz` : sql`now()`;

export interface OpcionesBuscarPacientes {
  /** 1..1000; por defecto 6 (el buscador global). */
  limite?: number | undefined;
  /** Por defecto solo activos (el contrato del buscador). */
  incluirInactivos?: boolean | undefined;
  /** Momento con el que se calculan edad y pediátrico. Por defecto, ahora. */
  ahora?: Date | undefined;
}

/**
 * `app.buscar_pacientes(texto, limite, incluir_inactivos, ahora)`: buscador por nombre (sin tildes,
 * mayúsculas ni puntuación, la ñ cuenta: igual que `normalizarBusqueda` de @conecta/shared), CI (con
 * o sin puntos, con o sin ceros a la izquierda) o teléfono (en cualquier formato). Todos los
 * términos tienen que aparecer. Orden: CI o teléfono exacto, después los que empiezan una palabra,
 * después el resto; dentro de cada grupo, activos primero y por apellidos, nombres. Un texto sin
 * letras ni dígitos devuelve `[]` (la regla de «menos de 2 caracteres» la aplica la API).
 * Errores: `pacientes_limite` (22023).
 */
export async function buscarPacientes(
  tx: TransaccionConecta,
  texto: string,
  opciones: OpcionesBuscarPacientes = {},
): Promise<PacienteResumen[]> {
  const { rows } = await tx.execute<FilaResumen>(
    sql`select ${COLUMNAS_RESUMEN} from app.buscar_pacientes(${texto}, ${opciones.limite ?? 6}::integer,
          ${opciones.incluirInactivos ?? false}::boolean, ${ahoraSql(opciones.ahora)})`,
  );
  return rows.map(resumen);
}

export interface ConsultaListarPacientes {
  /** Búsqueda opcional (misma regla que `buscarPacientes`). */
  texto?: string | undefined;
  /** Por defecto `todos`. `todos`, `pediatricos` y `con_alerta` muestran solo activos. */
  filtro?: FiltroPacientes | undefined;
  /** `siguienteCursor` de la página anterior. */
  cursor?: string | null | undefined;
  /** 1..1000; por defecto 50. */
  limite?: number | undefined;
  ahora?: Date | undefined;
}

/**
 * `app.listar_pacientes(...)`: una página de la lista, ordenada por apellidos (o, si no tiene, por
 * nombres), nombres e id (sin tildes ni puntuación; la ñ entre la n y la o). `siguienteCursor` es
 * opaco (null si no hay más): lleva la posición de la última fila de la página tal como se vio, y
 * la página siguiente empieza justo después de esa posición, sin repetidos ni saltos, aunque ese
 * paciente (u otro) se renombre o se agreguen pacientes entre una página y la otra. Se pasa tal
 * cual; no se arma ni se interpreta. Errores: `cursor_invalido`, `pacientes_filtro`,
 * `pacientes_limite` (22023).
 */
export async function listarPacientes(
  tx: TransaccionConecta,
  consulta: ConsultaListarPacientes = {},
): Promise<{ items: PacienteResumen[]; siguienteCursor: string | null }> {
  const limite = consulta.limite ?? 50;
  const { rows } = await tx.execute<FilaResumen & { cursor: string }>(
    sql`select ${COLUMNAS_RESUMEN}, cursor from app.listar_pacientes(${consulta.texto ?? null}::text,
          ${consulta.filtro ?? 'todos'}::text, ${consulta.cursor ?? null}::text,
          ${limite + 1}::integer, ${ahoraSql(consulta.ahora)})`,
  );
  const pagina = rows.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  return {
    items: pagina.map(resumen),
    siguienteCursor: rows.length > limite && ultima ? ultima.cursor : null,
  };
}

/**
 * `app.pacientes_con_ci(ci, excluir)`: pacientes de la clínica (activos primero, también inactivos)
 * con esa CI, normalizada como la guarda la base. Para el 409 de CI repetida (`existente`). Con
 * `excluirId`, sin ese paciente (al editar).
 */
export async function pacientesConCi(
  tx: TransaccionConecta,
  ci: string,
  excluirId?: string | null,
): Promise<PacienteResumen[]> {
  const { rows } = await tx.execute<FilaResumen>(
    sql`select ${COLUMNAS_RESUMEN} from app.pacientes_con_ci(${ci}, ${excluirId ?? null}::uuid)`,
  );
  return rows.map(resumen);
}

/** Datos de alta de un paciente: los de `CrearPaciente` sin `confirmarCiDuplicada`. */
export type DatosPaciente = Omit<CrearPaciente, 'confirmarCiDuplicada'>;
/** Cambios de un paciente: los de `EditarPaciente` sin `confirmarCiDuplicada` (null borra). */
export type CambiosPaciente = Omit<EditarPaciente, 'confirmarCiDuplicada'>;

/**
 * Alta de un paciente (INSERT como app_api; `pacientes:crear`). No mira la CI repetida: eso lo hace
 * la API antes con `pacientesConCi`. Devuelve el id. `origen` por defecto `recepcion`.
 * Errores: `pacientes_sin_permiso` (42501), los CHECK de `RESTRICCIONES_PACIENTES` (23514),
 * `paciente_fecha_nac_futura` (23514).
 */
export async function crearPaciente(
  tx: TransaccionConecta,
  datos: DatosPaciente,
  opciones: { origen?: OrigenPaciente } = {},
): Promise<string> {
  const filas = await tx
    .insert(paciente)
    .values({
      clinicaId: sql`app.clinica_actual()`,
      nombres: datos.nombres,
      apellidos: datos.apellidos ?? null,
      ci: datos.ci ?? null,
      ruc: datos.ruc ?? null,
      fechaNac: datos.fechaNac ?? null,
      sexo: datos.sexo ?? null,
      telefono: datos.telefono ?? null,
      email: datos.email ?? null,
      ciudad: datos.ciudad ?? null,
      direccion: datos.direccion ?? null,
      idioma: datos.idioma ?? 'es',
      aceptaWhatsapp: datos.aceptaWhatsapp ?? false,
      origen: opciones.origen ?? 'recepcion',
    })
    .returning({ id: paciente.id });
  return primera(filas, 'insert paciente').id;
}

/**
 * Edición de un paciente (UPDATE como app_api; `pacientes:editar`). Solo cambia lo que viene
 * (`undefined` no toca, `null` borra). `notaInterna`, si viene, se guarda con
 * `guardarNotaInterna` (`ficha_clinica:editar`). Devuelve false si el paciente no es de la clínica.
 */
export async function editarPaciente(
  tx: TransaccionConecta,
  pacienteId: string,
  cambios: CambiosPaciente,
): Promise<boolean> {
  const { notaInterna, ...datos } = cambios;
  const valores: Partial<typeof paciente.$inferInsert> = {};
  const campos = [
    'nombres',
    'apellidos',
    'ci',
    'ruc',
    'fechaNac',
    'sexo',
    'telefono',
    'email',
    'ciudad',
    'direccion',
    'idioma',
    'aceptaWhatsapp',
  ] as const;
  for (const campo of campos) {
    if (datos[campo] !== undefined) Object.assign(valores, { [campo]: datos[campo] });
  }
  const existe = await tx
    .select({ id: paciente.id })
    .from(paciente)
    .where(sql`${paciente.id} = ${pacienteId}::uuid`);
  if (existe.length === 0) return false;
  if (Object.keys(valores).length > 0) {
    await tx
      .update(paciente)
      .set(valores)
      .where(sql`${paciente.id} = ${pacienteId}::uuid`);
  }
  if (notaInterna !== undefined) await guardarNotaInterna(tx, pacienteId, notaInterna);
  return true;
}

/**
 * La ficha completa con la forma de `Paciente` del contrato, o null si no es de la clínica.
 * `notaInterna` es null si el usuario del contexto no tiene `ficha_clinica:ver` (la base no la
 * deja ver) o si no hay nota. `alertas`: las activas. `relaciones`: los vínculos activos vistos
 * desde este paciente. NO registra la lectura: la API llama a
 * `registrarEvento(tx, { accion: 'ver', entidad: 'paciente', entidadId })`.
 */
export async function obtenerPaciente(
  tx: TransaccionConecta,
  pacienteId: string,
  opciones: { ahora?: Date | undefined } = {},
): Promise<Paciente | null> {
  const { rows } = await tx.execute<
    FilaResumen & {
      ruc: string | null;
      email: string | null;
      ciudad: string | null;
      direccion: string | null;
      idioma: IdiomaPaciente;
      acepta_whatsapp: boolean;
      origen: OrigenPaciente;
      motivo_baja: string | null;
      created_at: Date | string;
      nota_interna: string | null;
    }
  >(sql`
    select r.id, r.nombres, r.apellidos, r.ci, r.telefono, r.fecha_nac::text as fecha_nac, r.edad,
           r.pediatrico, r.con_alerta, r.activo, r.sexo,
           p.ruc, p.email, p.ciudad, p.direccion, p.idioma, p.acepta_whatsapp,
           p.origen, p.motivo_baja, p.created_at,
           (select n.texto from app.paciente_nota n
            where n.clinica_id = p.clinica_id and n.paciente_id = p.id) as nota_interna
    from app.resumen_pacientes(${ahoraSql(opciones.ahora)}) r
    join app.paciente p on p.clinica_id = r.clinica_id and p.id = r.id
    where r.id = ${pacienteId}::uuid`);
  const fila = rows[0];
  if (!fila) return null;
  const alertas = await listarAlertas(tx, pacienteId);
  const relaciones = await listarRelaciones(tx, pacienteId, opciones);
  return {
    ...resumen(fila),
    ruc: fila.ruc,
    email: fila.email,
    ciudad: fila.ciudad,
    direccion: fila.direccion,
    idioma: fila.idioma,
    aceptaWhatsapp: fila.acepta_whatsapp,
    origen: fila.origen,
    notaInterna: fila.nota_interna,
    alertas,
    relaciones,
    motivoBaja: fila.motivo_baja,
    creadoEn: fecha(fila.created_at).toISOString(),
  };
}

/**
 * `app.desactivar_paciente(paciente, motivo)`: `pacientes:anular` y motivo obligatorio. `false` si
 * ya estaba inactivo. Errores: `baja_sin_motivo` (23514), `paciente_no_encontrado` (P0002),
 * `paciente_motivo_baja_check` (23514, más de 500 caracteres), `pacientes_sin_permiso` (42501).
 */
export async function desactivarPaciente(
  tx: TransaccionConecta,
  pacienteId: string,
  motivo: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ cambio: boolean }>(
    sql`select app.desactivar_paciente(${pacienteId}::uuid, ${motivo}) as cambio`,
  );
  return primera(rows, 'app.desactivar_paciente').cambio;
}

/**
 * `app.reactivar_paciente(paciente)`: `pacientes:anular`; borra el motivo de baja. `false` si ya
 * estaba activo. Errores: `paciente_no_encontrado` (P0002), `pacientes_sin_permiso` (42501).
 */
export async function reactivarPaciente(
  tx: TransaccionConecta,
  pacienteId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ cambio: boolean }>(
    sql`select app.reactivar_paciente(${pacienteId}::uuid) as cambio`,
  );
  return primera(rows, 'app.reactivar_paciente').cambio;
}

// Grupo familiar ------------------------------------------------------------------------------

export interface DatosRelacion {
  /** Paciente de la ficha (el de la ruta). */
  pacienteId: string;
  familiarId: string;
  /** Qué es el familiar para el paciente («hijo»: el familiar es hijo del paciente). */
  tipo: TipoRelacion;
  /** El paciente es tutor legal del familiar. */
  esTutorLegal?: boolean | undefined;
  /** El paciente paga por el familiar. */
  esResponsablePago?: boolean | undefined;
  /** El familiar es tutor legal del paciente (se guarda en el otro sentido). */
  familiarEsTutorLegal?: boolean | undefined;
  /** El familiar paga por el paciente (se guarda en el otro sentido). */
  familiarEsResponsablePago?: boolean | undefined;
}

type FilaRelacion = {
  id: string;
  familiar_id: string;
  nombre: string;
  edad: number | null;
  tipo: TipoRelacion;
  es_tutor_legal: boolean;
  es_responsable_pago: boolean;
  familiar_es_tutor_legal: boolean;
  familiar_es_responsable_pago: boolean;
};

function relacionDe(f: FilaRelacion): Relacion {
  return {
    id: f.id,
    familiar: { id: f.familiar_id, nombre: f.nombre, edad: f.edad },
    tipo: f.tipo,
    esTutorLegal: f.es_tutor_legal,
    esResponsablePago: f.es_responsable_pago,
    familiarEsTutorLegal: f.familiar_es_tutor_legal,
    familiarEsResponsablePago: f.familiar_es_responsable_pago,
  };
}

function consultaRelaciones(filtro: ReturnType<typeof sql>, ahora: Date | undefined) {
  return sql`
    select r.id, f.id as familiar_id,
           f.nombres || coalesce(' ' || f.apellidos, '') as nombre, f.edad,
           r.tipo, r.es_tutor_legal, r.es_responsable_pago,
           coalesce(e.es_tutor_legal, false) as familiar_es_tutor_legal,
           coalesce(e.es_responsable_pago, false) as familiar_es_responsable_pago
    from app.paciente_relacion r
    join app.resumen_pacientes(${ahoraSql(ahora)}) f on f.clinica_id = r.clinica_id and f.id = r.familiar_id
    left join app.paciente_relacion e
      on e.clinica_id = r.clinica_id and e.paciente_id = r.familiar_id
     and e.familiar_id = r.paciente_id and e.deleted_at is null
    where r.clinica_id = app.clinica_actual() and r.deleted_at is null and ${filtro}
    order by f.orden_apellidos collate "C", f.orden_nombres collate "C", f.id`;
}

/**
 * `app.crear_relacion(...)`: crea el vínculo y su espejo (con el tipo inverso: madre/padre ↔ hijo
 * según el sexo, abuelo ↔ nieto, tutor ↔ tutelado; hermano, pareja y otro iguales) en la misma
 * transacción, con las marcas de los dos lados (`familiarEs*` van en el espejo). El tipo del espejo
 * sigue al sexo: si cambia el sexo del paciente, la base lo recalcula. Devuelve la `Relacion` vista
 * desde `pacienteId`. Permiso de la base: pacientes:editar.
 * Errores: `paciente_relacion_par_activo` (23505, ya están vinculados), `paciente_relacion_consigo_mismo`
 * y `relacion_tipo_sexo` / `relacion_marca_un_sentido` / `relacion_espejo_inconsistente` (23514),
 * `relacion_paciente_inactivo` (22023), `paciente_relacion_paciente_fkey` /
 * `paciente_relacion_familiar_fkey` (23503, paciente de otra clínica o inexistente),
 * `paciente_relacion_tipo_check` (23514), `pacientes_sin_permiso` (42501).
 */
export async function crearRelacion(
  tx: TransaccionConecta,
  datos: DatosRelacion,
): Promise<Relacion> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`select app.crear_relacion(${datos.pacienteId}::uuid, ${datos.familiarId}::uuid, ${datos.tipo},
          ${datos.esTutorLegal ?? false}::boolean, ${datos.esResponsablePago ?? false}::boolean,
          ${datos.familiarEsTutorLegal ?? false}::boolean,
          ${datos.familiarEsResponsablePago ?? false}::boolean) as id`,
  );
  const id = primera(rows, 'app.crear_relacion').id;
  const creada = await tx.execute<FilaRelacion>(
    consultaRelaciones(sql`r.id = ${id}::uuid`, undefined),
  );
  return relacionDe(primera(creada.rows, 'paciente_relacion'));
}

/**
 * `app.editar_relacion(relacion, ...)`: cambia las marcas de un vínculo activo vistas desde el lado
 * `relacionId` (el id de cualquiera de los dos sentidos): `esTutorLegal`/`esResponsablePago` de
 * este lado y `familiarEsTutorLegal`/`familiarEsResponsablePago` del otro; lo que no viene no
 * cambia. Las cuatro se aplican juntas (se puede pasar la tutoría de un lado al otro en un pedido).
 * Devuelve la `Relacion` vista desde `relacionId` (haya cambiado algo o no). Errores:
 * `relacion_no_encontrada` (P0002), `relacion_dada_de_baja` (22023), `relacion_marca_un_sentido`
 * y `relacion_espejo_inconsistente` (23514), `pacientes_sin_permiso` (42501).
 */
export async function editarRelacion(
  tx: TransaccionConecta,
  relacionId: string,
  cambios: EditarRelacion,
): Promise<Relacion> {
  await tx.execute(
    sql`select app.editar_relacion(${relacionId}::uuid, ${cambios.esTutorLegal ?? null}::boolean,
          ${cambios.esResponsablePago ?? null}::boolean, ${cambios.familiarEsTutorLegal ?? null}::boolean,
          ${cambios.familiarEsResponsablePago ?? null}::boolean)`,
  );
  const { rows } = await tx.execute<FilaRelacion>(
    consultaRelaciones(sql`r.id = ${relacionId}::uuid`, undefined),
  );
  return relacionDe(primera(rows, 'paciente_relacion'));
}

/**
 * `app.baja_relacion(relacion, motivo)`: da de baja el vínculo y su espejo (motivo opcional).
 * `false` si ya estaba dado de baja. Errores: `relacion_no_encontrada` (P0002),
 * `pacientes_sin_permiso` (42501).
 */
export async function bajaRelacion(
  tx: TransaccionConecta,
  relacionId: string,
  motivo?: string | null,
): Promise<boolean> {
  const { rows } = await tx.execute<{ cambio: boolean }>(
    sql`select app.baja_relacion(${relacionId}::uuid, ${motivo ?? null}::text) as cambio`,
  );
  return primera(rows, 'app.baja_relacion').cambio;
}

/** Vínculos activos de un paciente, vistos desde su ficha, ordenados por el nombre del familiar. */
export async function listarRelaciones(
  tx: TransaccionConecta,
  pacienteId: string,
  opciones: { ahora?: Date | undefined } = {},
): Promise<Relacion[]> {
  const { rows } = await tx.execute<FilaRelacion>(
    consultaRelaciones(sql`r.paciente_id = ${pacienteId}::uuid`, opciones.ahora),
  );
  return rows.map(relacionDe);
}

// Alertas manuales y nota interna ---------------------------------------------------------------

/** Datos de una alerta manual nueva (`crearAlertaSchema` del contrato). */
export interface DatosAlerta {
  tipo: TipoAlerta;
  texto: string;
}

type FilaAlerta = {
  id: string;
  tipo: TipoAlerta;
  texto: string;
  activa: boolean;
  created_at: Date | string;
  creada_por: string | null;
};

function consultaAlertas(filtro: ReturnType<typeof sql>) {
  return sql`
    select a.id, a.tipo, a.texto, a.activa, a.created_at, u.nombre as creada_por
    from app.paciente_alerta a left join app.usuario u on u.id = a.creada_por
    where a.clinica_id = app.clinica_actual() and ${filtro}
    order by a.created_at, a.id`;
}

function alertaDe(f: FilaAlerta): AlertaManual {
  return {
    id: f.id,
    tipo: f.tipo,
    texto: f.texto,
    activa: f.activa,
    creadaEn: fecha(f.created_at).toISOString(),
    creadaPor: f.creada_por,
  };
}

/**
 * Alertas manuales de un paciente (activas; con `incluirInactivas`, también las inactivas, que la base
 * solo muestra a quien tiene `ficha_clinica:ver`), las más viejas primero. `creadaPor` es el nombre.
 */
export async function listarAlertas(
  tx: TransaccionConecta,
  pacienteId: string,
  opciones: { incluirInactivas?: boolean | undefined } = {},
): Promise<AlertaManual[]> {
  const filtro = opciones.incluirInactivas
    ? sql`a.paciente_id = ${pacienteId}::uuid`
    : sql`a.paciente_id = ${pacienteId}::uuid and a.activa`;
  const { rows } = await tx.execute<FilaAlerta>(consultaAlertas(filtro));
  return rows.map(alertaDe);
}

/** Una alerta por id (o null si no es de la clínica, o si es inactiva y falta `ficha_clinica:ver`). */
export async function obtenerAlerta(
  tx: TransaccionConecta,
  alertaId: string,
): Promise<AlertaManual | null> {
  const { rows } = await tx.execute<FilaAlerta>(consultaAlertas(sql`a.id = ${alertaId}::uuid`));
  return rows[0] ? alertaDe(rows[0]) : null;
}

/**
 * `app.crear_alerta(paciente, tipo, texto)`: alerta manual activa (`ficha_clinica:editar`) de tipo
 * `alergia` o `condicion`. Devuelve la alerta. Errores: `ficha_clinica_sin_permiso` (42501),
 * `paciente_alerta_texto_check` (23514, 3 a 200 caracteres), `paciente_alerta_tipo_check` (23514),
 * `paciente_alerta_paciente_fkey` (23503).
 */
export async function crearAlerta(
  tx: TransaccionConecta,
  pacienteId: string,
  datos: DatosAlerta,
): Promise<AlertaManual> {
  const { rows } = await tx.execute<{ id: string }>(
    sql`select app.crear_alerta(${pacienteId}::uuid, ${datos.tipo}, ${datos.texto}) as id`,
  );
  const alerta = await obtenerAlerta(tx, primera(rows, 'app.crear_alerta').id);
  if (!alerta) throw new Error('app.crear_alerta no dejó ver la alerta creada.');
  return alerta;
}

/**
 * `app.cambiar_alerta(alerta, activa)`: activa o desactiva (`ficha_clinica:editar` y, para
 * desactivar o reactivar, también `ficha_clinica:ver`; desactivar queda en auditoría como «anular»).
 * `false` si ya estaba así. Errores: `alerta_no_encontrada` (P0002; también una inactiva para quien
 * no tiene `ficha_clinica:ver`), `ficha_clinica_sin_permiso` (42501).
 */
export async function cambiarAlerta(
  tx: TransaccionConecta,
  alertaId: string,
  activa: boolean,
): Promise<boolean> {
  const { rows } = await tx.execute<{ cambio: boolean }>(
    sql`select app.cambiar_alerta(${alertaId}::uuid, ${activa}::boolean) as cambio`,
  );
  return primera(rows, 'app.cambiar_alerta').cambio;
}

/**
 * `app.guardar_nota_interna(paciente, texto)`: crea o reemplaza la nota interna; `null` o vacío la
 * borra (`ficha_clinica:editar` y `ficha_clinica:ver`). Errores: `ficha_clinica_sin_permiso` (42501), `paciente_nota_texto_check`
 * (23514, más de 2000 caracteres), `paciente_nota_paciente_fkey` (23503).
 */
export async function guardarNotaInterna(
  tx: TransaccionConecta,
  pacienteId: string,
  texto: string | null,
): Promise<void> {
  await tx.execute(sql`select app.guardar_nota_interna(${pacienteId}::uuid, ${texto}::text)`);
}

/** La nota interna, o null si no hay o si el usuario del contexto no tiene `ficha_clinica:ver`. */
export async function leerNotaInterna(
  tx: TransaccionConecta,
  pacienteId: string,
): Promise<string | null> {
  const { rows } = await tx.execute<{ texto: string | null }>(
    sql`select n.texto from app.paciente_nota n
        where n.clinica_id = app.clinica_actual() and n.paciente_id = ${pacienteId}::uuid`,
  );
  return rows[0]?.texto ?? null;
}

/** `app.tiene_permiso(modulo, accion)`: lo que la base cree del usuario del contexto. */
export async function tienePermisoEnBase(
  tx: TransaccionConecta,
  modulo: Modulo,
  accion: Accion,
): Promise<boolean> {
  const { rows } = await tx.execute<{ tiene: boolean }>(
    sql`select app.tiene_permiso(${modulo}, ${accion}) as tiene`,
  );
  return primera(rows, 'app.tiene_permiso').tiene;
}
