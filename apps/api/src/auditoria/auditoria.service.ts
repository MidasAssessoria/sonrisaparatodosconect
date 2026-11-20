/**
 * `GET /auditoria`. Tener `auditoria:ver` no alcanza para ver cualquier cosa: el alcance va en la
 * misma consulta (antes de paginar), no después:
 *   - módulo: solo eventos de módulos donde el rol tiene `ver`; los eventos sin módulo (filas viejas
 *     de entidades que no son tablas) solo con `configuracion:ver`;
 *   - sede: eventos sin sede, o de una sede que el usuario puede ver (un rol con
 *     `todas_las_sedes` ve todas, también las dadas de baja).
 * Paginación por cursor (fecha, id) descendente, sobre el índice
 * `audit_log_clinica_fecha_idx (clinica_id, fecha DESC, id DESC)`.
 */
import { Injectable } from '@nestjs/common';
import { auditLog, type TransaccionConecta } from '@conecta/db';
import {
  MODULOS,
  paginaAuditoriaSchema,
  type ConsultaAuditoria,
  type Modulo,
  type PaginaAuditoria,
} from '@conecta/shared';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { ServicioBd } from '../base/servicio-bd.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { codificarCursor, decodificarCursor, type PosicionCursor } from './cursor.js';

/** Fecha en UTC con microsegundos: para mostrar y para el cursor. */
const fechaTexto = sql<string>`to_char(${auditLog.fecha} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Lo que define el alcance de quien consulta (sale del contexto del pedido, nunca del pedido). */
export type AlcanceAuditoria = Pick<
  ContextoPedido,
  'clinicaId' | 'permisos' | 'todasLasSedes' | 'sedesPermitidas'
>;

/** Condiciones de alcance: módulos con `ver` y sedes visibles. */
export function condicionesDeAlcance(alcance: AlcanceAuditoria): SQL[] {
  const modulos = [
    ...new Set(alcance.permisos.filter((p) => p.accion === 'ver').map((p) => p.modulo)),
  ].filter((m): m is Modulo => (MODULOS as readonly string[]).includes(m));
  const condiciones: SQL[] = [];

  const porModulo = modulos.length > 0 ? inArray(auditLog.modulo, modulos) : sql`false`;
  condiciones.push(
    modulos.includes('configuracion')
      ? (or(porModulo, isNull(auditLog.modulo)) ?? porModulo)
      : porModulo,
  );

  if (!alcance.todasLasSedes) {
    condiciones.push(
      alcance.sedesPermitidas.length > 0
        ? (or(isNull(auditLog.sedeId), inArray(auditLog.sedeId, alcance.sedesPermitidas)) ??
            isNull(auditLog.sedeId))
        : isNull(auditLog.sedeId),
    );
  }
  return condiciones;
}

/**
 * Arma la consulta de una página (sin ejecutarla). Exportada para que una prueba verifique con
 * EXPLAIN que usa el índice de paginación.
 */
export function consultaPagina(
  tx: Pick<TransaccionConecta, 'select'>,
  alcance: AlcanceAuditoria,
  consulta: ConsultaAuditoria,
  posicion: PosicionCursor | null,
) {
  const condiciones: SQL[] = [
    eq(auditLog.clinicaId, alcance.clinicaId),
    ...condicionesDeAlcance(alcance),
  ];
  if (consulta.entidad !== undefined) condiciones.push(eq(auditLog.entidad, consulta.entidad));
  if (consulta.entidadId !== undefined)
    condiciones.push(eq(auditLog.entidadId, consulta.entidadId));
  if (consulta.usuarioId !== undefined)
    condiciones.push(eq(auditLog.usuarioId, consulta.usuarioId));
  if (consulta.accion !== undefined) condiciones.push(eq(auditLog.accion, consulta.accion));
  // `desde` inclusivo, `hasta` exclusivo.
  if (consulta.desde !== undefined) {
    condiciones.push(sql`${auditLog.fecha} >= ${consulta.desde}::timestamptz`);
  }
  if (consulta.hasta !== undefined) {
    condiciones.push(sql`${auditLog.fecha} < ${consulta.hasta}::timestamptz`);
  }
  if (posicion) {
    // `fecha <=` le da al índice el punto de partida; la comparación de filas desempata por id.
    condiciones.push(
      sql`${auditLog.fecha} <= ${posicion.fecha}::timestamptz`,
      sql`(${auditLog.fecha}, ${auditLog.id}) < (${posicion.fecha}::timestamptz, ${posicion.id}::uuid)`,
    );
  }

  return tx
    .select({
      id: auditLog.id,
      fecha: fechaTexto,
      usuarioId: auditLog.usuarioId,
      usuarioNombre: auditLog.usuarioNombre,
      modulo: auditLog.modulo,
      sedeId: auditLog.sedeId,
      entidad: auditLog.entidad,
      entidadId: auditLog.entidadId,
      accion: auditLog.accion,
      antes: auditLog.antes,
      despues: auditLog.despues,
      ip: sql<string | null>`host(${auditLog.ip})`,
    })
    .from(auditLog)
    .where(and(...condiciones))
    .orderBy(desc(auditLog.fecha), desc(auditLog.id))
    .limit(consulta.limite + 1);
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly bd: ServicioBd) {}

  /** Del más nuevo al más viejo, paginado por (fecha, id). */
  listar(ctx: ContextoPedido, consulta: ConsultaAuditoria): Promise<PaginaAuditoria> {
    const posicion = consulta.cursor ? decodificarCursor(consulta.cursor) : null;
    return this.bd.enContexto(ctx, async (tx) => {
      const filas = await consultaPagina(tx, ctx, consulta, posicion);

      const pagina = filas.slice(0, consulta.limite);
      const ultimo = pagina[pagina.length - 1];
      const siguienteCursor =
        filas.length > consulta.limite && ultimo
          ? codificarCursor({ fecha: ultimo.fecha, id: ultimo.id })
          : null;

      return paginaAuditoriaSchema.parse({
        items: pagina.map((f) => ({
          id: f.id,
          fecha: f.fecha,
          // El nombre que la persona tenía en el momento del evento (congelado por la base).
          usuario: f.usuarioId
            ? { id: f.usuarioId, nombre: f.usuarioNombre ?? 'Usuario sin nombre registrado' }
            : null,
          modulo: f.modulo,
          sedeId: f.sedeId,
          entidad: f.entidad,
          entidadId: f.entidadId,
          accion: f.accion,
          antes: (f.antes ?? null) as Record<string, unknown> | null,
          despues: (f.despues ?? null) as Record<string, unknown> | null,
          ip: f.ip,
        })),
        siguienteCursor,
      } satisfies PaginaAuditoria);
    });
  }
}
