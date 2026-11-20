/**
 * Sedes, horarios y sillones. Todo corre en `enContexto` (RLS por clínica); además cada consulta
 * filtra por la clínica del contexto, como defensa en profundidad. Una sede de otra clínica (o dada
 * de baja) no existe para quien pregunta: 404 antes de mirar permisos de sede.
 *
 * Las altas, ediciones y bajas las audita la base (triggers): la API no escribe en audit_log.
 */
import { Injectable } from '@nestjs/common';
import { sede, sedeHorario, sillon, type TransaccionConecta } from '@conecta/db';
import {
  sedeSchema,
  sillonSchema,
  type CrearSede,
  type CrearSillon,
  type EditarSede,
  type EditarSillon,
  type HorarioSede,
  type Sede,
  type Sillon,
} from '@conecta/shared';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import { exigirSede, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';
import { horaCorta, validarTramos } from './horarios.js';

const columnasSede = {
  id: sede.id,
  nombre: sede.nombre,
  direccion: sede.direccion,
  telefono: sede.telefono,
  estado: sede.estado,
  color: sede.color,
};
type FilaSede = Omit<Sede, 'horarios' | 'sillones'>;

const columnasSillon = {
  id: sillon.id,
  sedeId: sillon.sedeId,
  nombre: sillon.nombre,
  activo: sillon.activo,
};

const listaSedesSchema = z.array(sedeSchema);

const sedeNoEncontrada = () =>
  errores.noEncontrado(
    'No encontramos esa sede. Puede que se haya dado de baja: volvé a la lista.',
  );
const sillonNoEncontrado = () =>
  errores.noEncontrado('No encontramos ese sillón. Volvé a la sede y probá de nuevo.');

@Injectable()
export class SedesService {
  constructor(private readonly bd: ServicioBd) {}

  listar(ctx: ContextoPedido): Promise<Sede[]> {
    return this.bd.enContexto(ctx, async (tx) => {
      const condiciones: SQL[] = [eq(sede.clinicaId, ctx.clinicaId), isNull(sede.deletedAt)];
      if (!ctx.todasLasSedes) {
        if (ctx.sedesPermitidas.length === 0) return [];
        condiciones.push(inArray(sede.id, ctx.sedesPermitidas));
      }
      const filas = await tx
        .select(columnasSede)
        .from(sede)
        .where(and(...condiciones))
        .orderBy(asc(sede.nombre), asc(sede.id));
      return listaSedesSchema.parse(await this.completar(tx, ctx, filas));
    });
  }

  obtener(ctx: ContextoPedido, id: string): Promise<Sede> {
    return this.bd.enContexto(ctx, async (tx) => {
      const fila = await this.buscar(tx, ctx, id, false);
      return this.una(tx, ctx, fila);
    });
  }

  crear(ctx: ContextoPedido, datos: CrearSede): Promise<Sede> {
    return this.bd.enContexto(ctx, async (tx) => {
      const [fila] = await tx
        .insert(sede)
        .values({
          clinicaId: ctx.clinicaId,
          nombre: datos.nombre,
          direccion: datos.direccion ?? null,
          telefono: datos.telefono ?? null,
          estado: datos.estado,
          color: datos.color ?? null,
        })
        .returning(columnasSede);
      if (!fila) throw errores.interno();
      return sedeSchema.parse({ ...fila, horarios: [], sillones: [] });
    });
  }

  editar(ctx: ContextoPedido, id: string, datos: EditarSede): Promise<Sede> {
    return this.bd.enContexto(ctx, async (tx) => {
      let fila = await this.buscar(tx, ctx, id, true);
      const cambios: Partial<typeof sede.$inferInsert> = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.direccion !== undefined) cambios.direccion = datos.direccion || null;
      if (datos.telefono !== undefined) cambios.telefono = datos.telefono || null;
      if (datos.estado !== undefined) cambios.estado = datos.estado;
      if (datos.color !== undefined) cambios.color = datos.color || null;
      if (Object.keys(cambios).length > 0) {
        const [actualizada] = await tx
          .update(sede)
          .set(cambios)
          .where(and(eq(sede.id, id), eq(sede.clinicaId, ctx.clinicaId), isNull(sede.deletedAt)))
          .returning(columnasSede);
        if (!actualizada) throw sedeNoEncontrada();
        fila = actualizada;
      }
      return this.una(tx, ctx, fila);
    });
  }

  darDeBaja(ctx: ContextoPedido, id: string, motivo: string): Promise<void> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.buscar(tx, ctx, id, true);
      const filas = await tx
        .update(sede)
        // deleted_at y deleted_by los fija la base; acá solo se pide la baja.
        .set({ deletedAt: sql`now()`, motivoBaja: motivo })
        .where(and(eq(sede.id, id), eq(sede.clinicaId, ctx.clinicaId), isNull(sede.deletedAt)))
        .returning({ id: sede.id });
      if (filas.length === 0) throw sedeNoEncontrada();
    });
  }

  /**
   * Reemplaza el horario completo. Solo toca lo que cambió: los tramos que siguen iguales se
   * conservan, los que ya no están se desactivan (no se borran) y los nuevos se insertan.
   */
  reemplazarHorarios(ctx: ContextoPedido, id: string, horarios: HorarioSede[]): Promise<Sede> {
    validarTramos(horarios);
    return this.bd.enContexto(ctx, async (tx) => {
      const fila = await this.buscar(tx, ctx, id, true);
      const actuales = await tx
        .select({
          id: sedeHorario.id,
          diaSemana: sedeHorario.diaSemana,
          horaInicio: sedeHorario.horaInicio,
          horaFin: sedeHorario.horaFin,
          intervaloMin: sedeHorario.intervaloMin,
        })
        .from(sedeHorario)
        .where(
          and(
            eq(sedeHorario.sedeId, id),
            eq(sedeHorario.clinicaId, ctx.clinicaId),
            eq(sedeHorario.activo, true),
          ),
        );

      const clave = (h: HorarioSede) =>
        `${String(h.diaSemana)}|${h.horaInicio}|${h.horaFin}|${String(h.intervaloMin)}`;
      const pendientes = new Map<string, HorarioSede>(horarios.map((h) => [clave(h), h]));
      const quitar: string[] = [];
      for (const actual of actuales) {
        const k = clave({
          diaSemana: actual.diaSemana,
          horaInicio: horaCorta(actual.horaInicio),
          horaFin: horaCorta(actual.horaFin),
          intervaloMin: actual.intervaloMin,
        });
        if (pendientes.has(k)) pendientes.delete(k);
        else quitar.push(actual.id);
      }

      if (quitar.length > 0) {
        await tx
          .update(sedeHorario)
          .set({ activo: false })
          .where(and(inArray(sedeHorario.id, quitar), eq(sedeHorario.clinicaId, ctx.clinicaId)));
      }
      const nuevos = [...pendientes.values()];
      if (nuevos.length > 0) {
        await tx.insert(sedeHorario).values(
          nuevos.map((h) => ({
            clinicaId: ctx.clinicaId,
            sedeId: id,
            diaSemana: h.diaSemana,
            horaInicio: h.horaInicio,
            horaFin: h.horaFin,
            intervaloMin: h.intervaloMin,
          })),
        );
      }
      return this.una(tx, ctx, fila);
    });
  }

  crearSillon(ctx: ContextoPedido, sedeId: string, datos: CrearSillon): Promise<Sillon> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.buscar(tx, ctx, sedeId, true);
      const [fila] = await tx
        .insert(sillon)
        .values({ clinicaId: ctx.clinicaId, sedeId, nombre: datos.nombre })
        .returning(columnasSillon);
      if (!fila) throw errores.interno();
      return sillonSchema.parse(fila);
    });
  }

  editarSillon(ctx: ContextoPedido, id: string, datos: EditarSillon): Promise<Sillon> {
    return this.bd.enContexto(ctx, async (tx) => {
      const [actual] = await tx
        .select(columnasSillon)
        .from(sillon)
        .innerJoin(sede, and(eq(sede.id, sillon.sedeId), eq(sede.clinicaId, sillon.clinicaId)))
        .where(and(eq(sillon.id, id), eq(sillon.clinicaId, ctx.clinicaId), isNull(sede.deletedAt)))
        // Bloquea el sillón y su sede hasta el final: nadie da de baja la sede en el medio.
        .for('update');
      if (!actual) throw sillonNoEncontrado();
      exigirSede(ctx, actual.sedeId);

      const cambios: Partial<typeof sillon.$inferInsert> = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      if (Object.keys(cambios).length === 0) return sillonSchema.parse(actual);
      const [fila] = await tx
        .update(sillon)
        .set(cambios)
        .where(and(eq(sillon.id, id), eq(sillon.clinicaId, ctx.clinicaId)))
        .returning(columnasSillon);
      if (!fila) throw sillonNoEncontrado();
      return sillonSchema.parse(fila);
    });
  }

  /** Sede viva de la clínica del contexto, o 404. Después exige que el usuario pueda operar en ella. */
  private async buscar(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
    bloquear: boolean,
  ): Promise<FilaSede> {
    const consulta = tx
      .select(columnasSede)
      .from(sede)
      .where(and(eq(sede.id, id), eq(sede.clinicaId, ctx.clinicaId), isNull(sede.deletedAt)));
    const [fila] = bloquear ? await consulta.for('update') : await consulta;
    if (!fila) throw sedeNoEncontrada();
    exigirSede(ctx, fila.id);
    return fila;
  }

  private async una(tx: TransaccionConecta, ctx: ContextoPedido, fila: FilaSede): Promise<Sede> {
    const [completa] = await this.completar(tx, ctx, [fila]);
    return sedeSchema.parse(completa);
  }

  /** Agrega horarios activos y sillones (activos e inactivos) a cada sede. */
  private async completar(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    filas: FilaSede[],
  ): Promise<Sede[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((f) => f.id);
    const horarios = await tx
      .select({
        sedeId: sedeHorario.sedeId,
        diaSemana: sedeHorario.diaSemana,
        horaInicio: sedeHorario.horaInicio,
        horaFin: sedeHorario.horaFin,
        intervaloMin: sedeHorario.intervaloMin,
      })
      .from(sedeHorario)
      .where(
        and(
          inArray(sedeHorario.sedeId, ids),
          eq(sedeHorario.clinicaId, ctx.clinicaId),
          eq(sedeHorario.activo, true),
        ),
      )
      .orderBy(asc(sedeHorario.diaSemana), asc(sedeHorario.horaInicio));
    const sillones = await tx
      .select(columnasSillon)
      .from(sillon)
      .where(and(inArray(sillon.sedeId, ids), eq(sillon.clinicaId, ctx.clinicaId)))
      .orderBy(asc(sillon.createdAt), asc(sillon.id));

    return filas.map((f) => ({
      ...f,
      horarios: horarios
        .filter((h) => h.sedeId === f.id)
        .map((h) => ({
          diaSemana: h.diaSemana,
          horaInicio: horaCorta(h.horaInicio),
          horaFin: horaCorta(h.horaFin),
          intervaloMin: h.intervaloMin,
        })),
      sillones: sillones.filter((s) => s.sedeId === f.id),
    }));
  }
}
