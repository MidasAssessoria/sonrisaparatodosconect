/**
 * Llamadas tipadas a las funciones SQL que app_api puede ejecutar. Todas corren dentro de una
 * transacción con contexto (`conContexto` o `conUsuario`) y actúan sobre el usuario y la clínica
 * del contexto: ninguna recibe el usuario ni la clínica como parámetro.
 */
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
