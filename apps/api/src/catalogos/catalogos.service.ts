/**
 * Catálogo de tratamientos (módulo configuracion) y configuración de agenda por sede (módulo sedes).
 * Todo corre en `enContexto` (RLS por clínica) y cada consulta filtra además por la clínica del
 * contexto. Altas y ediciones las audita la base (triggers).
 *
 * Precio: `bigint` en la base, leído como número (Drizzle `mode: 'number'`). El contrato lo limita a
 * 999.999.999, muy por debajo de `Number.MAX_SAFE_INTEGER`: no se pierde precisión. Por las dudas,
 * una fila fuera de rango no cumple `tratamientoSchema` y no sale.
 */
import { Injectable } from '@nestjs/common';
import { agendaConfig, sede, tratamiento, type TransaccionConecta } from '@conecta/db';
import {
  agendaConfigSchema,
  tratamientoSchema,
  type AgendaConfig,
  type CrearTratamiento,
  type EditarTratamiento,
  type GuardarAgendaConfig,
  type Tratamiento,
} from '@conecta/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import { exigirSede, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';

const columnasTratamiento = {
  id: tratamiento.id,
  nombre: tratamiento.nombre,
  categoria: tratamiento.categoria,
  precio: tratamiento.precio,
  iva: tratamiento.iva,
  duracionMin: tratamiento.duracionMin,
  activo: tratamiento.activo,
};

const listaTratamientosSchema = z.array(tratamientoSchema);

/** Sin fila en `agenda_config`, la sede usa estos valores (contrato). */
export const AGENDA_POR_DEFECTO: Omit<AgendaConfig, 'sedeId'> = {
  anticipacionMin: 120,
  diasAdelante: 14,
  reservaOnlineActiva: false,
};

const tratamientoNoEncontrado = () =>
  errores.noEncontrado('No encontramos ese tratamiento. Volvé al catálogo y probá de nuevo.');
const sedeNoEncontrada = () =>
  errores.noEncontrado(
    'No encontramos esa sede. Puede que se haya dado de baja: volvé a la lista.',
  );

@Injectable()
export class CatalogosService {
  constructor(private readonly bd: ServicioBd) {}

  /** Activos primero; después por categoría (sin categoría al final) y nombre. */
  listarTratamientos(ctx: ContextoPedido): Promise<Tratamiento[]> {
    return this.bd.enContexto(ctx, async (tx) => {
      const filas = await tx
        .select(columnasTratamiento)
        .from(tratamiento)
        .where(eq(tratamiento.clinicaId, ctx.clinicaId))
        .orderBy(
          desc(tratamiento.activo),
          sql`${tratamiento.categoria} asc nulls last`,
          asc(tratamiento.nombre),
          asc(tratamiento.id),
        );
      return listaTratamientosSchema.parse(filas);
    });
  }

  crearTratamiento(ctx: ContextoPedido, datos: CrearTratamiento): Promise<Tratamiento> {
    return this.bd.enContexto(ctx, async (tx) => {
      const [fila] = await tx
        .insert(tratamiento)
        .values({
          clinicaId: ctx.clinicaId,
          nombre: datos.nombre,
          categoria: datos.categoria || null,
          precio: datos.precio,
          iva: datos.iva,
          duracionMin: datos.duracionMin,
        })
        .returning(columnasTratamiento);
      if (!fila) throw errores.interno();
      return tratamientoSchema.parse(fila);
    });
  }

  editarTratamiento(
    ctx: ContextoPedido,
    id: string,
    datos: EditarTratamiento,
  ): Promise<Tratamiento> {
    return this.bd.enContexto(ctx, async (tx) => {
      const [actual] = await tx
        .select(columnasTratamiento)
        .from(tratamiento)
        .where(and(eq(tratamiento.id, id), eq(tratamiento.clinicaId, ctx.clinicaId)))
        .for('update');
      if (!actual) throw tratamientoNoEncontrado();

      const cambios: Partial<typeof tratamiento.$inferInsert> = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.categoria !== undefined) cambios.categoria = datos.categoria || null;
      if (datos.precio !== undefined) cambios.precio = datos.precio;
      if (datos.iva !== undefined) cambios.iva = datos.iva;
      if (datos.duracionMin !== undefined) cambios.duracionMin = datos.duracionMin;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      if (Object.keys(cambios).length === 0) return tratamientoSchema.parse(actual);

      const [fila] = await tx
        .update(tratamiento)
        .set(cambios)
        .where(and(eq(tratamiento.id, id), eq(tratamiento.clinicaId, ctx.clinicaId)))
        .returning(columnasTratamiento);
      if (!fila) throw tratamientoNoEncontrado();
      return tratamientoSchema.parse(fila);
    });
  }

  obtenerAgenda(ctx: ContextoPedido, sedeId: string): Promise<AgendaConfig> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.buscarSede(tx, ctx, sedeId, false);
      const [fila] = await tx
        .select({
          sedeId: agendaConfig.sedeId,
          anticipacionMin: agendaConfig.anticipacionMin,
          diasAdelante: agendaConfig.diasAdelante,
          reservaOnlineActiva: agendaConfig.reservaOnlineActiva,
        })
        .from(agendaConfig)
        .where(and(eq(agendaConfig.sedeId, sedeId), eq(agendaConfig.clinicaId, ctx.clinicaId)));
      return agendaConfigSchema.parse(fila ?? { sedeId, ...AGENDA_POR_DEFECTO });
    });
  }

  /** Reemplaza la configuración (`INSERT … ON CONFLICT (clinica_id, sede_id) DO UPDATE`). */
  guardarAgenda(
    ctx: ContextoPedido,
    sedeId: string,
    datos: GuardarAgendaConfig,
  ): Promise<AgendaConfig> {
    return this.bd.enContexto(ctx, async (tx) => {
      // FOR SHARE: nadie da de baja la sede mientras se guarda su configuración.
      await this.buscarSede(tx, ctx, sedeId, true);
      const valores = {
        anticipacionMin: datos.anticipacionMin,
        diasAdelante: datos.diasAdelante,
        reservaOnlineActiva: datos.reservaOnlineActiva,
      };
      await tx
        .insert(agendaConfig)
        .values({ clinicaId: ctx.clinicaId, sedeId, ...valores })
        .onConflictDoUpdate({
          target: [agendaConfig.clinicaId, agendaConfig.sedeId],
          set: valores,
        });
      return agendaConfigSchema.parse({ sedeId, ...valores });
    });
  }

  /** Sede viva de la clínica del contexto, o 404. Después exige que el usuario pueda operar en ella. */
  private async buscarSede(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
    bloquear: boolean,
  ): Promise<void> {
    const consulta = tx
      .select({ id: sede.id })
      .from(sede)
      .where(and(eq(sede.id, id), eq(sede.clinicaId, ctx.clinicaId), isNull(sede.deletedAt)));
    const [fila] = bloquear ? await consulta.for('share') : await consulta;
    if (!fila) throw sedeNoEncontrada();
    exigirSede(ctx, fila.id);
  }
}
