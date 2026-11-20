/**
 * Llamadas tipadas a las funciones SQL que app_api puede ejecutar. Casi todas corren dentro de una
 * transacción con contexto (`conContexto` o `conUsuario`) y actúan sobre el usuario y la clínica
 * del contexto: no reciben el usuario ni la clínica como parámetro. Las dos excepciones son las
 * públicas de invitación (`consultarInvitacion`, `aceptarInvitacion`), que corren sin contexto
 * (`sinContexto`) y resuelven la clínica por el token.
 */
import { createHash } from 'node:crypto';
import type { Accion, EstadoMembresia, Modulo, Persona } from '@conecta/shared';
import { sql } from 'drizzle-orm';
import type { TransaccionConecta } from './contexto.js';
import {
  RESULTADOS_TOCAR_SESION,
  type AccionEvento,
  type ResultadoTocarSesion,
} from './esquema.js';

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
  /** Por defecto, dentro de 7 días. Entre ahora y 30 días. */
  venceEn?: Date | null | undefined;
}

export interface ResultadoCrearInvitacion {
  membresiaId: string;
  invitacionId: string;
  venceEn: Date;
}

/**
 * `app.crear_invitacion(...)` (permiso `personal:crear`, con contexto): crea la membresía pendiente
 * sin usuario (rol, sedes, sede por defecto) y su invitación. Corre como app_api: la base aplica
 * `app.proteger_acceso` y `app.proteger_invitacion`.
 * Errores (campo `constraint`): `acceso_*` (42501), `rol_inactivo` (23514),
 * `invitacion_ya_es_miembro` (23505), `invitacion_abierta_email` (23505, ya hay una invitación
 * abierta para ese correo), `invitacion_vencimiento` / `invitacion_sede_defecto` /
 * `sede_dada_de_baja` (22023), `invitacion_email_check` / `invitacion_nombre_check` /
 * `invitacion_token_hash_check` (23514), FK `membresia_rol_fkey` / `usuario_sede_sede_fkey` (23503).
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
 * nombre. El token viejo deja de servir. Errores: `invitacion_no_encontrada` (P0002),
 * `invitacion_membresia` (42501, la membresía ya no está pendiente), los de `crearInvitacion`.
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
 * contexto): anula la invitación abierta y deja la membresía pendiente sin usuario en `inactivo`.
 * Errores: `invitacion_no_encontrada` (P0002, no hay membresía pendiente sin usuario con ese id),
 * `invitacion_anulacion_check` (22023, motivo vacío), `acceso_*` (42501).
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
  /** Ya hay una cuenta con ese correo: hay que ingresar antes de aceptar (`requiereIngreso`). */
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
   * Id de Supabase Auth VERIFICADO por la API: el `sub` del JWT (si la persona ya tenía cuenta) o
   * el id de la cuenta que la API acaba de crear con la Admin API para el correo de la invitación.
   */
  usuarioId: string;
  /** Correo VERIFICADO de esa cuenta (del JWT o de la cuenta creada). */
  email: string;
}

/**
 * `app.aceptar_invitacion(token_hash, usuario_id, email)`: público, sin contexto (usá
 * `sinContexto`). Crea el usuario si no existe, le pone el usuario a la membresía, la activa y marca
 * la invitación usada; todo auditado en esa clínica con la persona como autora. Devuelve la clínica.
 * Una segunda llamada con el mismo token falla; de varias simultáneas gana una.
 * La base confía en `usuarioId` y `email`: la API tiene que haberlos verificado.
 * Errores (campo `constraint`): `invitacion_no_vigente` (P0002, sin distinguir el motivo),
 * `invitacion_otro_correo` y `invitacion_otra_cuenta` (42501), `membresia_usuario_clinica_key`
 * (23505, ya tiene una membresía en esa clínica), `usuario_email_unico` (23505, carrera con otra
 * cuenta del mismo correo). Si la API creó la cuenta de Auth para este pedido y esto falla, le toca
 * limpiarla.
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
 * reactiva. Devuelve cuántos permisos activos quedan. Permiso de la base: `configuracion:editar`, o
 * `configuracion:crear` si el rol se creó en esta misma transacción por el mismo usuario. Errores:
 * `rol_no_encontrado` (P0002), `acceso_propio` (su propio rol), `acceso_rol_dueno` (el rol dueño),
 * `acceso_sin_permiso` (42501), `rol_permiso_modulo_check` / `rol_permiso_accion_check` (23514).
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
 * Personas (membresías) de la clínica del contexto, con la forma de `personaSchema`. Corre como
 * app_api con RLS: de una membresía activa o inactiva con usuario salen los datos de su usuario;
 * de una pendiente (o anulada) sin usuario, el nombre y el correo de su última invitación (que son
 * de esta clínica). Nunca muestra el perfil de alguien con una membresía pendiente (usuario_ver).
 * `invitacionVenceEn`: solo si su última invitación sigue abierta (aunque esté vencida).
 * `rol.codigo`: solo para roles de sistema. `sedeIds`: las sedes activas de usuario_sede.
 * Con `membresiaId`, solo esa (lista vacía si no es de la clínica).
 */
export async function listarPersonal(
  tx: TransaccionConecta,
  opciones: { membresiaId?: string | undefined } = {},
): Promise<Persona[]> {
  const filtro = opciones.membresiaId ? sql`and m.id = ${opciones.membresiaId}::uuid` : sql``;
  const { rows } = await tx.execute<FilaPersona>(sql`
    select m.id as membresia_id, m.usuario_id, m.estado, m.sede_defecto_id,
           coalesce(u.nombre, i.nombre, '') as nombre,
           coalesce(u.email, i.email, '') as email,
           u.telefono, u.ultimo_acceso, coalesce(u.mfa_activo, false) as mfa_activo,
           r.id as rol_id, case when r.es_sistema then r.codigo end as rol_codigo,
           r.nombre as rol_nombre,
           array(select us.sede_id::text from app.usuario_sede us
                 where us.clinica_id = m.clinica_id and us.membresia_id = m.id and us.activo
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
    where m.clinica_id = app.clinica_actual() ${filtro}
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
