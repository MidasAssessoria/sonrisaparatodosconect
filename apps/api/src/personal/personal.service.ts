/**
 * Equipo de la clínica (membresías). Todo corre en `enContexto` (RLS por clínica) y cada consulta
 * filtra además por la clínica del contexto. La defensa contra la autoescalada (editarse a sí
 * mismo, dar el rol dueño sin serlo, tocar el rol dueño, la clínica sin dueño) la hace la base
 * (`app.proteger_acceso`, `app.proteger_ultimo_dueno`); la API traduce sus errores.
 *
 * Las ediciones las audita la base (triggers): la API no escribe en audit_log.
 */
import { Injectable } from '@nestjs/common';
import { listarPersonal, membresia, usuarioSede, type TransaccionConecta } from '@conecta/db';
import { personaSchema, type EditarPersona, type Persona } from '@conecta/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';
import { exigirSedesAsignables, idsUnicos } from './sedes-asignables.js';

const listaPersonasSchema = z.array(personaSchema);

export const personaNoEncontrada = () =>
  errores.noEncontrado(
    'No encontramos a esa persona en el equipo. Volvé a la lista y probá de nuevo.',
  );

interface FilaMembresia {
  id: string;
  estado: 'pendiente' | 'activo' | 'inactivo';
  usuarioId: string | null;
  rolId: string;
  sedeDefectoId: string | null;
}

/** Una persona del equipo con la forma del contrato (después de un cambio en esta transacción). */
export async function personaDe(tx: TransaccionConecta, membresiaId: string): Promise<Persona> {
  const [persona] = await listarPersonal(tx, { membresiaId });
  if (!persona) throw personaNoEncontrada();
  return personaSchema.parse(persona);
}

@Injectable()
export class PersonalService {
  constructor(private readonly bd: ServicioBd) {}

  listar(ctx: ContextoPedido): Promise<Persona[]> {
    return this.bd.enContexto(ctx, async (tx) =>
      listaPersonasSchema.parse(await listarPersonal(tx)),
    );
  }

  /**
   * Rol, sedes y sede por defecto. Las sedes que se asignan tienen que ser visibles para quien
   * edita; las que esa persona ya tenía y quien edita no ve quedan como estaban (nadie cambia lo que
   * no ve). Si se le quita la sede por defecto, la sede por defecto queda vacía: también da acceso.
   */
  editar(ctx: ContextoPedido, id: string, datos: EditarPersona): Promise<Persona> {
    return this.bd.enContexto(ctx, async (tx) => {
      const actual = await this.buscar(tx, ctx, id);
      const filasSede = await tx
        .select({ sedeId: usuarioSede.sedeId, activo: usuarioSede.activo })
        .from(usuarioSede)
        .where(and(eq(usuarioSede.clinicaId, ctx.clinicaId), eq(usuarioSede.membresiaId, id)));
      const activas = new Set(filasSede.filter((f) => f.activo).map((f) => f.sedeId));
      const visible = (sedeId: string) => ctx.todasLasSedes || ctx.sedesPermitidas.includes(sedeId);

      let nuevas = activas;
      if (datos.sedeIds !== undefined) {
        const pedidas = idsUnicos(datos.sedeIds);
        await exigirSedesAsignables(tx, ctx, pedidas, 'sedeIds');
        nuevas = new Set([...pedidas, ...[...activas].filter((s) => !visible(s))]);
      }

      let sedeDefecto = actual.sedeDefectoId;
      if (datos.sedeDefectoId === null) {
        if (sedeDefecto && !visible(sedeDefecto)) throw errores.sedeNoPermitida();
        sedeDefecto = null;
      } else if (datos.sedeDefectoId !== undefined) {
        const pedida = datos.sedeDefectoId.toLowerCase();
        await exigirSedesAsignables(tx, ctx, [pedida], 'sedeDefectoId');
        if (!nuevas.has(pedida)) {
          throw errores.datosInvalidos(
            'La sede por defecto tiene que estar entre las sedes de la persona.',
            [{ campo: 'sedeDefectoId', mensaje: 'Elegí una de las sedes de la persona.' }],
          );
        }
        sedeDefecto = pedida;
      } else if (
        datos.sedeIds !== undefined &&
        sedeDefecto !== null &&
        !nuevas.has(sedeDefecto) &&
        visible(sedeDefecto)
      ) {
        sedeDefecto = null;
      }

      const cambios: Partial<typeof membresia.$inferInsert> = {};
      if (datos.rolId !== undefined && datos.rolId.toLowerCase() !== actual.rolId) {
        cambios.rolId = datos.rolId.toLowerCase();
      }
      if (sedeDefecto !== actual.sedeDefectoId) cambios.sedeDefectoId = sedeDefecto;
      if (Object.keys(cambios).length > 0) {
        await tx
          .update(membresia)
          .set(cambios)
          .where(and(eq(membresia.id, id), eq(membresia.clinicaId, ctx.clinicaId)));
      }

      const agregar = [...nuevas].filter((s) => !activas.has(s));
      const quitar = [...activas].filter((s) => !nuevas.has(s));
      const inactivas = new Set(filasSede.filter((f) => !f.activo).map((f) => f.sedeId));
      const reactivar = agregar.filter((s) => inactivas.has(s));
      const insertar = agregar.filter((s) => !inactivas.has(s));
      const deMembresia = and(
        eq(usuarioSede.clinicaId, ctx.clinicaId),
        eq(usuarioSede.membresiaId, id),
      );
      if (quitar.length > 0) {
        await tx
          .update(usuarioSede)
          .set({ activo: false })
          .where(and(deMembresia, inArray(usuarioSede.sedeId, quitar)));
      }
      if (reactivar.length > 0) {
        await tx
          .update(usuarioSede)
          .set({ activo: true })
          .where(and(deMembresia, inArray(usuarioSede.sedeId, reactivar)));
      }
      if (insertar.length > 0) {
        await tx
          .insert(usuarioSede)
          .values(
            insertar.map((sedeId) => ({ clinicaId: ctx.clinicaId, membresiaId: id, sedeId })),
          );
      }

      return personaDe(tx, id);
    });
  }

  /**
   * Corta el acceso: el pedido siguiente de esa persona ya no encuentra su membresía activa. El
   * motivo se valida pero la base todavía no tiene dónde guardarlo (ver el reporte del Sprint 2).
   */
  desactivar(ctx: ContextoPedido, id: string): Promise<Persona> {
    return this.bd.enContexto(ctx, async (tx) => {
      const actual = await this.buscar(tx, ctx, id);
      if (actual.estado === 'pendiente') {
        throw errores.conflicto(
          'Esa persona todavía no aceptó la invitación. Anulá la invitación en vez de desactivarla.',
        );
      }
      if (actual.estado === 'inactivo') {
        throw errores.conflicto('Esa persona ya está desactivada. Recargá la lista del equipo.');
      }
      await tx
        .update(membresia)
        .set({ estado: 'inactivo' })
        .where(and(eq(membresia.id, id), eq(membresia.clinicaId, ctx.clinicaId)));
      return personaDe(tx, id);
    });
  }

  reactivar(ctx: ContextoPedido, id: string): Promise<Persona> {
    return this.bd.enContexto(ctx, async (tx) => {
      const actual = await this.buscar(tx, ctx, id);
      if (actual.estado === 'activo') {
        throw errores.conflicto('Esa persona ya está activa. Recargá la lista del equipo.');
      }
      if (actual.estado === 'pendiente') {
        throw errores.conflicto(
          'Esa persona todavía no aceptó la invitación. Reenviale el enlace para que la acepte.',
        );
      }
      if (actual.usuarioId === null) {
        throw errores.conflicto(
          'La invitación de esa persona se anuló antes de que la aceptara. Invitala de nuevo.',
        );
      }
      await tx
        .update(membresia)
        .set({ estado: 'activo' })
        .where(and(eq(membresia.id, id), eq(membresia.clinicaId, ctx.clinicaId)));
      return personaDe(tx, id);
    });
  }

  /** Membresía de la clínica del contexto, bloqueada hasta el final de la transacción, o 404. */
  private async buscar(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
  ): Promise<FilaMembresia> {
    const [fila] = await tx
      .select({
        id: membresia.id,
        estado: membresia.estado,
        usuarioId: membresia.usuarioId,
        rolId: membresia.rolId,
        sedeDefectoId: membresia.sedeDefectoId,
      })
      .from(membresia)
      .where(and(eq(membresia.id, id), eq(membresia.clinicaId, ctx.clinicaId)))
      .for('update');
    if (!fila) throw personaNoEncontrada();
    return fila;
  }
}
