import { Injectable } from '@nestjs/common';
import { auditLog, usuario } from '@conecta/db';
import {
  paginaAuditoriaSchema,
  type ConsultaAuditoria,
  type PaginaAuditoria,
} from '@conecta/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { ServicioBd } from '../base/servicio-bd.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { codificarCursor, decodificarCursor } from './cursor.js';

/** Fecha en UTC con microsegundos: para mostrar y para el cursor. */
const fechaTexto = sql<string>`to_char(${auditLog.fecha} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

@Injectable()
export class AuditoriaService {
  constructor(private readonly bd: ServicioBd) {}

  /** Del más nuevo al más viejo, paginado por (fecha, id). */
  listar(ctx: ContextoPedido, consulta: ConsultaAuditoria): Promise<PaginaAuditoria> {
    const posicion = consulta.cursor ? decodificarCursor(consulta.cursor) : null;
    return this.bd.enContexto(ctx, async (tx) => {
      const condiciones: SQL[] = [eq(auditLog.clinicaId, ctx.clinicaId)];
      if (consulta.entidad !== undefined) condiciones.push(eq(auditLog.entidad, consulta.entidad));
      if (consulta.entidadId !== undefined) {
        condiciones.push(eq(auditLog.entidadId, consulta.entidadId));
      }
      if (consulta.usuarioId !== undefined) {
        condiciones.push(eq(auditLog.usuarioId, consulta.usuarioId));
      }
      if (consulta.accion !== undefined) condiciones.push(eq(auditLog.accion, consulta.accion));
      if (consulta.desde !== undefined) {
        condiciones.push(sql`${auditLog.fecha} >= ${consulta.desde}::timestamptz`);
      }
      if (consulta.hasta !== undefined) {
        condiciones.push(sql`${auditLog.fecha} <= ${consulta.hasta}::timestamptz`);
      }
      if (posicion) {
        condiciones.push(
          sql`(${auditLog.fecha}, ${auditLog.id}) < (${posicion.fecha}::timestamptz, ${posicion.id}::uuid)`,
        );
      }

      const filas = await tx
        .select({
          id: auditLog.id,
          fecha: fechaTexto,
          usuarioId: auditLog.usuarioId,
          usuarioNombre: usuario.nombre,
          entidad: auditLog.entidad,
          entidadId: auditLog.entidadId,
          accion: auditLog.accion,
          antes: auditLog.antes,
          despues: auditLog.despues,
          ip: sql<string | null>`host(${auditLog.ip})`,
        })
        .from(auditLog)
        .leftJoin(usuario, eq(usuario.id, auditLog.usuarioId))
        .where(and(...condiciones))
        .orderBy(desc(auditLog.fecha), desc(auditLog.id))
        .limit(consulta.limite + 1);

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
          usuario: f.usuarioId
            ? { id: f.usuarioId, nombre: f.usuarioNombre ?? 'Usuario sin acceso a esta clínica' }
            : null,
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
