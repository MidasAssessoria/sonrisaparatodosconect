/**
 * Profesionales, su disponibilidad semanal por sede y sus bloqueos (módulo personal). Todo corre en
 * `enContexto` (RLS por clínica) y cada consulta filtra además por la clínica del contexto. Un id de
 * otra clínica no existe para quien pregunta: 404, antes de mirar permisos de sede.
 *
 * Dimensión sede: un profesional es de la clínica (no de una sede) y se lista entero, con toda su
 * disponibilidad. Quien no ve todas las sedes solo puede agregar o quitar tramos en sus sedes: los de
 * otras sedes tienen que volver iguales en el `PUT` (así los devuelve el `GET`).
 *
 * Las altas, ediciones y bajas las audita la base (triggers, módulo `personal`).
 */
import { Injectable } from '@nestjs/common';
import {
  membresia,
  profesional,
  profesionalBloqueo,
  profesionalDisponibilidad,
  sede,
  sedeHorario,
  sillon,
  type TransaccionConecta,
} from '@conecta/db';
import {
  bloqueoSchema,
  profesionalSchema,
  type Bloqueo,
  type CrearBloqueo,
  type CrearProfesional,
  type EditarProfesional,
  type Profesional,
  type TramoDisponibilidad,
} from '@conecta/shared';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores, type DetalleError } from '../errores/error-api.js';
import {
  claveTramo,
  describirFranjas,
  dentroDelHorario,
  horaCorta,
  nombreDia,
  superposiciones,
  unirFranjas,
  type FranjaHorario,
} from './disponibilidad.js';

const columnasProfesional = {
  id: profesional.id,
  membresiaId: profesional.membresiaId,
  nombre: profesional.nombre,
  especialidad: profesional.especialidad,
  color: profesional.color,
  registroProf: profesional.registroProf,
  activo: profesional.activo,
};
type FilaProfesional = Omit<Profesional, 'disponibilidad' | 'bloqueos'>;

const columnasBloqueo = {
  id: profesionalBloqueo.id,
  profesionalId: profesionalBloqueo.profesionalId,
  desde: profesionalBloqueo.desde,
  hasta: profesionalBloqueo.hasta,
  motivo: profesionalBloqueo.motivo,
};

const listaProfesionalesSchema = z.array(profesionalSchema);

const profesionalNoEncontrado = () =>
  errores.noEncontrado('No encontramos ese profesional. Volvé a la lista y probá de nuevo.');
const bloqueoNoEncontrado = () =>
  errores.noEncontrado(
    'No encontramos ese bloqueo. Puede que ya se haya quitado: recargá el profesional.',
  );
const membresiaNoEncontrada = () =>
  errores.noEncontrado(
    'No encontramos esa persona del equipo en esta clínica. Recargá la página y elegí de nuevo.',
  );

function bloqueoDe(fila: { id: string; desde: Date; hasta: Date; motivo: string }): Bloqueo {
  return {
    id: fila.id,
    desde: fila.desde.toISOString(),
    hasta: fila.hasta.toISOString(),
    motivo: fila.motivo,
  };
}

@Injectable()
export class ProfesionalesService {
  constructor(private readonly bd: ServicioBd) {}

  /** Activos primero, después por nombre. */
  listar(ctx: ContextoPedido): Promise<Profesional[]> {
    return this.bd.enContexto(ctx, async (tx) => {
      const filas = await tx
        .select(columnasProfesional)
        .from(profesional)
        .where(eq(profesional.clinicaId, ctx.clinicaId))
        .orderBy(desc(profesional.activo), asc(profesional.nombre), asc(profesional.id));
      return listaProfesionalesSchema.parse(await this.completar(tx, ctx, filas));
    });
  }

  obtener(ctx: ContextoPedido, id: string): Promise<Profesional> {
    return this.bd.enContexto(ctx, async (tx) => {
      const fila = await this.buscar(tx, ctx, id, null);
      return this.uno(tx, ctx, fila);
    });
  }

  crear(ctx: ContextoPedido, datos: CrearProfesional): Promise<Profesional> {
    return this.bd.enContexto(ctx, async (tx) => {
      if (datos.membresiaId !== undefined) await this.exigirMembresia(tx, ctx, datos.membresiaId);
      const [fila] = await tx
        .insert(profesional)
        .values({
          clinicaId: ctx.clinicaId,
          membresiaId: datos.membresiaId ?? null,
          nombre: datos.nombre,
          especialidad: datos.especialidad || null,
          color: datos.color,
          registroProf: datos.registroProf || null,
        })
        .returning(columnasProfesional);
      if (!fila) throw errores.interno();
      return profesionalSchema.parse({ ...fila, disponibilidad: [], bloqueos: [] });
    });
  }

  editar(ctx: ContextoPedido, id: string, datos: EditarProfesional): Promise<Profesional> {
    return this.bd.enContexto(ctx, async (tx) => {
      let fila = await this.buscar(tx, ctx, id, 'update');
      const cambios: Partial<typeof profesional.$inferInsert> = {};
      if (datos.membresiaId !== undefined && datos.membresiaId !== fila.membresiaId) {
        if (datos.membresiaId !== null) await this.exigirMembresia(tx, ctx, datos.membresiaId);
        cambios.membresiaId = datos.membresiaId;
      }
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.especialidad !== undefined) cambios.especialidad = datos.especialidad || null;
      if (datos.color !== undefined) cambios.color = datos.color;
      if (datos.registroProf !== undefined) cambios.registroProf = datos.registroProf || null;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      if (Object.keys(cambios).length > 0) {
        const [actualizado] = await tx
          .update(profesional)
          .set(cambios)
          .where(and(eq(profesional.id, id), eq(profesional.clinicaId, ctx.clinicaId)))
          .returning(columnasProfesional);
        if (!actualizado) throw profesionalNoEncontrado();
        fila = actualizado;
      }
      return this.uno(tx, ctx, fila);
    });
  }

  /**
   * Reemplaza toda la disponibilidad. Los tramos iguales se conservan (misma fila), los que ya no
   * están se desactivan y los nuevos se insertan.
   *
   * Concurrencia: el profesional se bloquea con `FOR UPDATE NOWAIT`. Si otra persona está guardando
   * lo mismo en ese momento, este pedido falla enseguida con `conflicto` («probá de nuevo») en vez de
   * mezclar las dos versiones: gana uno solo. La restricción de exclusión de la base
   * (`profesional_disponibilidad_superpuesta`) queda de última defensa.
   */
  reemplazarDisponibilidad(
    ctx: ContextoPedido,
    id: string,
    tramos: TramoDisponibilidad[],
  ): Promise<Profesional> {
    return this.bd.enContexto(ctx, async (tx) => {
      const fila = await this.buscar(tx, ctx, id, 'nowait');

      // 1. Sedes y sillones del pedido: de esta clínica o 404. FOR SHARE: nadie da de baja la sede ni
      //    cambia su horario (que bloquea la sede) mientras se valida y se guarda.
      const idsSede = [...new Set(tramos.map((t) => t.sedeId))];
      const sedes =
        idsSede.length === 0
          ? []
          : await tx
              .select({ id: sede.id, nombre: sede.nombre, deletedAt: sede.deletedAt })
              .from(sede)
              .where(and(inArray(sede.id, idsSede), eq(sede.clinicaId, ctx.clinicaId)))
              .for('share');
      const sedePorId = new Map(sedes.map((s) => [s.id, s]));
      if (idsSede.some((s) => !sedePorId.has(s))) {
        throw errores.noEncontrado(
          'No encontramos una de las sedes elegidas. Recargá la página y elegí de nuevo.',
        );
      }
      const idsSillon = [
        ...new Set(tramos.flatMap((t) => (t.sillonId === null ? [] : [t.sillonId]))),
      ];
      const sillones =
        idsSillon.length === 0
          ? []
          : await tx
              .select({
                id: sillon.id,
                sedeId: sillon.sedeId,
                nombre: sillon.nombre,
                activo: sillon.activo,
                sedeNombre: sede.nombre,
              })
              .from(sillon)
              .innerJoin(
                sede,
                and(eq(sede.id, sillon.sedeId), eq(sede.clinicaId, sillon.clinicaId)),
              )
              .where(and(inArray(sillon.id, idsSillon), eq(sillon.clinicaId, ctx.clinicaId)));
      const sillonPorId = new Map(sillones.map((s) => [s.id, s]));
      if (idsSillon.some((s) => !sillonPorId.has(s))) {
        throw errores.noEncontrado(
          'No encontramos uno de los sillones elegidos. Recargá la página y elegí de nuevo.',
        );
      }

      // 2. Qué cambia respecto de lo guardado.
      const actuales = await tx
        .select({
          id: profesionalDisponibilidad.id,
          sedeId: profesionalDisponibilidad.sedeId,
          diaSemana: profesionalDisponibilidad.diaSemana,
          horaInicio: profesionalDisponibilidad.horaInicio,
          horaFin: profesionalDisponibilidad.horaFin,
          sillonId: profesionalDisponibilidad.sillonId,
          sedeDeBaja: sql<boolean>`${sede.deletedAt} is not null`,
        })
        .from(profesionalDisponibilidad)
        .innerJoin(
          sede,
          and(
            eq(sede.id, profesionalDisponibilidad.sedeId),
            eq(sede.clinicaId, profesionalDisponibilidad.clinicaId),
          ),
        )
        .where(
          and(
            eq(profesionalDisponibilidad.profesionalId, id),
            eq(profesionalDisponibilidad.clinicaId, ctx.clinicaId),
            eq(profesionalDisponibilidad.activo, true),
          ),
        );
      const pendientes = new Map<string, { indice: number; t: TramoDisponibilidad }>();
      tramos.forEach((t, indice) => {
        if (!pendientes.has(claveTramo(t))) pendientes.set(claveTramo(t), { indice, t });
      });
      const quitar: typeof actuales = [];
      for (const actual of actuales) {
        const k = claveTramo({
          sedeId: actual.sedeId,
          diaSemana: actual.diaSemana,
          horaInicio: horaCorta(actual.horaInicio),
          horaFin: horaCorta(actual.horaFin),
          sillonId: actual.sillonId,
        });
        if (pendientes.has(k)) pendientes.delete(k);
        else quitar.push(actual);
      }
      const nuevos = [...pendientes.values()];

      // 3. Dimensión sede: solo se agregan o quitan tramos en sedes propias. Los tramos de sedes ya
      //    dadas de baja se pueden quitar siempre (esas sedes no existen para nadie).
      if (!ctx.todasLasSedes) {
        const tocadas = new Set<string>();
        for (const { t } of nuevos) {
          if (!sedePorId.get(t.sedeId)?.deletedAt) tocadas.add(t.sedeId);
        }
        for (const q of quitar) if (!q.sedeDeBaja) tocadas.add(q.sedeId);
        for (const sedeId of tocadas) {
          if (!ctx.sedesPermitidas.includes(sedeId)) throw errores.sedeNoPermitida();
        }
      }

      // 4. Validaciones con mensajes que dicen qué tramo y por qué.
      const nombreSede = (sedeId: string) => `«${sedePorId.get(sedeId)?.nombre ?? 'otra sede'}»`;
      const describir = (t: TramoDisponibilidad) =>
        `del ${nombreDia(t.diaSemana)} de ${t.horaInicio} a ${t.horaFin}`;
      const detalles: DetalleError[] = [];
      tramos.forEach((t, indice) => {
        if (sedePorId.get(t.sedeId)?.deletedAt) {
          detalles.push({
            campo: `tramos.${String(indice)}.sedeId`,
            mensaje: `La sede ${nombreSede(t.sedeId)} está dada de baja: quitá el tramo ${describir(t)}.`,
          });
        }
      });
      detalles.push(...superposiciones(tramos, nombreSede));

      // Sillón y horario se controlan en los tramos nuevos: los que se conservan no se tocan.
      const horarios = await this.horariosDe(
        tx,
        ctx,
        [...new Set(nuevos.map(({ t }) => t.sedeId))].filter((s) => !sedePorId.get(s)?.deletedAt),
      );
      for (const { indice, t } of nuevos) {
        if (sedePorId.get(t.sedeId)?.deletedAt) continue;
        if (t.sillonId !== null) {
          const s = sillonPorId.get(t.sillonId);
          if (s && s.sedeId !== t.sedeId) {
            detalles.push({
              campo: `tramos.${String(indice)}.sillonId`,
              mensaje: `El sillón «${s.nombre}» es de «${s.sedeNombre}», no de ${nombreSede(t.sedeId)}: elegí un sillón de esa sede para el tramo ${describir(t)}.`,
            });
          } else if (s && !s.activo) {
            detalles.push({
              campo: `tramos.${String(indice)}.sillonId`,
              mensaje: `El sillón «${s.nombre}» está desactivado: elegí otro para el tramo ${describir(t)} o dejalo sin sillón.`,
            });
          }
        }
        const franjas = horarios.get(`${t.sedeId}|${String(t.diaSemana)}`) ?? [];
        if (franjas.length === 0) {
          detalles.push({
            campo: `tramos.${String(indice)}`,
            mensaje: `El ${nombreDia(t.diaSemana)} la sede ${nombreSede(t.sedeId)} no atiende: quitá el tramo de ${t.horaInicio} a ${t.horaFin} o cargá primero el horario de la sede.`,
          });
        } else if (!dentroDelHorario(t, franjas)) {
          detalles.push({
            campo: `tramos.${String(indice)}`,
            mensaje: `El ${nombreDia(t.diaSemana)} la sede ${nombreSede(t.sedeId)} atiende ${describirFranjas(franjas)}: el tramo de ${t.horaInicio} a ${t.horaFin} queda fuera de ese horario.`,
          });
        }
      }
      if (detalles.length > 0) {
        const primero = detalles[0];
        throw errores.datosInvalidos(
          detalles.length === 1 && primero
            ? `${primero.mensaje} Corregilo y guardá de nuevo.`
            : `Hay tramos para corregir: ${detalles.map((d) => d.mensaje).join(' ')} Corregilos y guardá de nuevo.`,
          detalles,
        );
      }

      // 5. Guardar: primero se desactivan los quitados (para que no choquen con los nuevos).
      if (quitar.length > 0) {
        await tx
          .update(profesionalDisponibilidad)
          .set({ activo: false })
          .where(
            and(
              inArray(
                profesionalDisponibilidad.id,
                quitar.map((q) => q.id),
              ),
              eq(profesionalDisponibilidad.clinicaId, ctx.clinicaId),
            ),
          );
      }
      if (nuevos.length > 0) {
        await tx.insert(profesionalDisponibilidad).values(
          nuevos.map(({ t }) => ({
            clinicaId: ctx.clinicaId,
            profesionalId: id,
            sedeId: t.sedeId,
            diaSemana: t.diaSemana,
            horaInicio: t.horaInicio,
            horaFin: t.horaFin,
            sillonId: t.sillonId,
          })),
        );
      }
      return this.uno(tx, ctx, fila);
    });
  }

  crearBloqueo(ctx: ContextoPedido, profesionalId: string, datos: CrearBloqueo): Promise<Bloqueo> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.buscar(tx, ctx, profesionalId, null);
      const [fila] = await tx
        .insert(profesionalBloqueo)
        .values({
          clinicaId: ctx.clinicaId,
          profesionalId,
          desde: new Date(datos.desde),
          hasta: new Date(datos.hasta),
          motivo: datos.motivo,
        })
        .returning(columnasBloqueo);
      if (!fila) throw errores.interno();
      return bloqueoSchema.parse(bloqueoDe(fila));
    });
  }

  darDeBajaBloqueo(ctx: ContextoPedido, id: string, motivo: string): Promise<void> {
    return this.bd.enContexto(ctx, async (tx) => {
      const filas = await tx
        .update(profesionalBloqueo)
        // deleted_at y deleted_by los fija la base; acá solo se pide la baja.
        .set({ deletedAt: sql`now()`, motivoBaja: motivo })
        .where(
          and(
            eq(profesionalBloqueo.id, id),
            eq(profesionalBloqueo.clinicaId, ctx.clinicaId),
            isNull(profesionalBloqueo.deletedAt),
          ),
        )
        .returning({ id: profesionalBloqueo.id });
      if (filas.length === 0) throw bloqueoNoEncontrado();
    });
  }

  /** Profesional de la clínica del contexto, o 404. */
  private async buscar(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
    bloqueo: 'update' | 'nowait' | null,
  ): Promise<FilaProfesional> {
    const consulta = tx
      .select(columnasProfesional)
      .from(profesional)
      .where(and(eq(profesional.id, id), eq(profesional.clinicaId, ctx.clinicaId)));
    const [fila] =
      bloqueo === 'nowait'
        ? await consulta.for('update', { noWait: true })
        : bloqueo === 'update'
          ? await consulta.for('update')
          : await consulta;
    if (!fila) throw profesionalNoEncontrado();
    return fila;
  }

  /** La membresía tiene que ser de esta clínica (si no, 404 como cualquier id ajeno). */
  private async exigirMembresia(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    membresiaId: string,
  ): Promise<void> {
    const [fila] = await tx
      .select({ id: membresia.id, estado: membresia.estado })
      .from(membresia)
      .where(and(eq(membresia.id, membresiaId), eq(membresia.clinicaId, ctx.clinicaId)));
    if (!fila) throw membresiaNoEncontrada();
    if (fila.estado === 'inactivo') {
      throw errores.conflicto(
        'Esa persona del equipo está desactivada. Reactivala primero o dejá el profesional sin usuario.',
      );
    }
  }

  /** Franjas activas (unidas) del horario de cada sede, por `sedeId|dia`. */
  private async horariosDe(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    sedeIds: string[],
  ): Promise<Map<string, FranjaHorario[]>> {
    const resultado = new Map<string, FranjaHorario[]>();
    if (sedeIds.length === 0) return resultado;
    const filas = await tx
      .select({
        sedeId: sedeHorario.sedeId,
        diaSemana: sedeHorario.diaSemana,
        horaInicio: sedeHorario.horaInicio,
        horaFin: sedeHorario.horaFin,
      })
      .from(sedeHorario)
      .where(
        and(
          inArray(sedeHorario.sedeId, sedeIds),
          eq(sedeHorario.clinicaId, ctx.clinicaId),
          eq(sedeHorario.activo, true),
        ),
      );
    const crudas = new Map<string, FranjaHorario[]>();
    for (const f of filas) {
      const k = `${f.sedeId}|${String(f.diaSemana)}`;
      const lista = crudas.get(k) ?? [];
      lista.push({ horaInicio: horaCorta(f.horaInicio), horaFin: horaCorta(f.horaFin) });
      crudas.set(k, lista);
    }
    for (const [k, lista] of crudas) resultado.set(k, unirFranjas(lista));
    return resultado;
  }

  private async uno(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    fila: FilaProfesional,
  ): Promise<Profesional> {
    const [completo] = await this.completar(tx, ctx, [fila]);
    return profesionalSchema.parse(completo);
  }

  /**
   * Agrega a cada profesional su disponibilidad activa (sin las sedes dadas de baja), por día y hora,
   * y sus bloqueos que todavía no terminaron, del más cercano al más lejano.
   */
  private async completar(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    filas: FilaProfesional[],
  ): Promise<Profesional[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((f) => f.id);
    const tramos = await tx
      .select({
        profesionalId: profesionalDisponibilidad.profesionalId,
        sedeId: profesionalDisponibilidad.sedeId,
        diaSemana: profesionalDisponibilidad.diaSemana,
        horaInicio: profesionalDisponibilidad.horaInicio,
        horaFin: profesionalDisponibilidad.horaFin,
        sillonId: profesionalDisponibilidad.sillonId,
      })
      .from(profesionalDisponibilidad)
      .innerJoin(
        sede,
        and(
          eq(sede.id, profesionalDisponibilidad.sedeId),
          eq(sede.clinicaId, profesionalDisponibilidad.clinicaId),
        ),
      )
      .where(
        and(
          inArray(profesionalDisponibilidad.profesionalId, ids),
          eq(profesionalDisponibilidad.clinicaId, ctx.clinicaId),
          eq(profesionalDisponibilidad.activo, true),
          isNull(sede.deletedAt),
        ),
      )
      .orderBy(
        asc(profesionalDisponibilidad.diaSemana),
        asc(profesionalDisponibilidad.horaInicio),
        asc(profesionalDisponibilidad.id),
      );
    const bloqueos = await tx
      .select(columnasBloqueo)
      .from(profesionalBloqueo)
      .where(
        and(
          inArray(profesionalBloqueo.profesionalId, ids),
          eq(profesionalBloqueo.clinicaId, ctx.clinicaId),
          isNull(profesionalBloqueo.deletedAt),
          gt(profesionalBloqueo.hasta, sql`now()`),
        ),
      )
      .orderBy(asc(profesionalBloqueo.desde), asc(profesionalBloqueo.id));

    return filas.map((f) => ({
      ...f,
      disponibilidad: tramos
        .filter((t) => t.profesionalId === f.id)
        .map((t) => ({
          sedeId: t.sedeId,
          diaSemana: t.diaSemana,
          horaInicio: horaCorta(t.horaInicio),
          horaFin: horaCorta(t.horaFin),
          sillonId: t.sillonId,
        })),
      bloqueos: bloqueos.filter((b) => b.profesionalId === f.id).map(bloqueoDe),
    }));
  }
}
