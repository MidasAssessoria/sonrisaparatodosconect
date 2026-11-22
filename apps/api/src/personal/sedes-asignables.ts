import { sede, type TransaccionConecta } from '@conecta/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { exigirSede, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';

/** Ids en minúsculas y sin repetir. */
export function idsUnicos(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/**
 * Sedes que alguien puede asignar a otra persona (al invitarla o al editarla): tienen que ser de
 * la clínica del contexto, no estar dadas de baja y estar entre las sedes que ve quien asigna
 * (salvo que su rol vea todas). Una sede de otra clínica responde igual que una inexistente.
 */
export async function exigirSedesAsignables(
  tx: TransaccionConecta,
  ctx: ContextoPedido,
  ids: readonly string[],
  campo: string,
): Promise<void> {
  const unicas = idsUnicos(ids);
  if (unicas.length === 0) return;
  const filas = await tx
    .select({ id: sede.id })
    .from(sede)
    .where(
      and(eq(sede.clinicaId, ctx.clinicaId), inArray(sede.id, unicas), isNull(sede.deletedAt)),
    );
  if (filas.length !== unicas.length) {
    throw errores.datosInvalidos(
      'Alguna de las sedes elegidas no existe o está dada de baja. Recargá la página y elegilas de nuevo.',
      [{ campo, mensaje: 'Elegí sedes de la lista.' }],
    );
  }
  for (const id of unicas) exigirSede(ctx, id);
}
