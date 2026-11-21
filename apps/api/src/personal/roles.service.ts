/**
 * Roles de la clínica y su matriz de permisos. Todo en `enContexto`. La base decide quién puede
 * cambiar qué (`app.proteger_acceso` y los límites de 0015): nadie toca su propio rol ni sus
 * permisos, el rol dueño no se modifica, un rol en uso no se desactiva, nadie deja un rol con
 * permisos (o con todas las sedes) que su propio rol no tiene salvo el dueño, los roles de sistema
 * solo los cambia un dueño y Dueño/a y Administración siempre exigen doble factor. La API traduce
 * sus errores.
 *
 * `GET /roles` devuelve todos los roles: la web calcula cuáles puede asignar quien mira comparando
 * cada rol con el suyo (permisos y `todasLasSedes`, que vienen en la misma lista; el dueño no tiene
 * límite). La base lo vuelve a controlar al asignar.
 *
 * Altas y cambios los audita la base (triggers).
 */
import { Injectable } from '@nestjs/common';
import { desactivarRol, reemplazarPermisosRol, rol, type TransaccionConecta } from '@conecta/db';
import {
  ACCIONES,
  MODULOS,
  rolSchema,
  type CrearRol,
  type EditarRol,
  type Rol,
} from '@conecta/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';

const rolNoEncontrado = () =>
  errores.noEncontrado('No encontramos ese rol. Volvé a la lista de roles y probá de nuevo.');

const filaRolSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  nombre: z.string(),
  es_sistema: z.boolean(),
  activo: z.boolean(),
  todas_las_sedes: z.boolean(),
  exige_mfa: z.boolean(),
  inactividad_min: z.number().int(),
  permisos: z.array(z.object({ modulo: z.enum(MODULOS), accion: z.enum(ACCIONES) })),
  personas: z.number().int(),
});

/** Orden de la matriz: el de los módulos y acciones del contrato. */
function ordenPermiso(p: { modulo: string; accion: string }): number {
  return (
    MODULOS.indexOf(p.modulo as (typeof MODULOS)[number]) * ACCIONES.length +
    ACCIONES.indexOf(p.accion as (typeof ACCIONES)[number])
  );
}

@Injectable()
export class RolesService {
  constructor(private readonly bd: ServicioBd) {}

  listar(ctx: ContextoPedido): Promise<Rol[]> {
    return this.bd.enContexto(ctx, (tx) => this.leer(tx, ctx));
  }

  crear(ctx: ContextoPedido, datos: CrearRol): Promise<Rol> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.exigirNombreLibre(tx, ctx, datos.nombre, null);
      const [fila] = await tx
        .insert(rol)
        .values({
          clinicaId: ctx.clinicaId,
          nombre: datos.nombre,
          todasLasSedes: datos.todasLasSedes,
          exigeMfa: datos.exigeMfa,
          inactividadMin: datos.inactividadMin,
        })
        .returning({ id: rol.id });
      if (!fila) throw errores.interno();
      // La base deja cargar la matriz inicial con configuracion:crear (rol creado en esta transacción).
      if (datos.permisos.length > 0) await reemplazarPermisosRol(tx, fila.id, datos.permisos);
      return this.uno(tx, ctx, fila.id);
    });
  }

  /**
   * `permisos`, si viene, reemplaza la matriz completa (lo que falta queda revocado). El control de
   * «no dar lo que no tenés» (`rol_limite_actor`, `rol_permiso_limite_actor`) se difiere al COMMIT:
   * mira el rol como queda después de TODOS los cambios del pedido (p. ej. quitar un permiso ajeno y
   * renombrar en el mismo pedido no falla por el estado intermedio).
   */
  editar(ctx: ContextoPedido, id: string, datos: EditarRol): Promise<Rol> {
    return this.bd.enContexto(ctx, async (tx) => {
      await tx.execute(
        sql`set constraints app.rol_limite_actor, app.rol_permiso_limite_actor deferred`,
      );
      await this.bloquear(tx, ctx, id);
      if (datos.nombre !== undefined) await this.exigirNombreLibre(tx, ctx, datos.nombre, id);
      const cambios: Partial<typeof rol.$inferInsert> = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.todasLasSedes !== undefined) cambios.todasLasSedes = datos.todasLasSedes;
      if (datos.exigeMfa !== undefined) cambios.exigeMfa = datos.exigeMfa;
      if (datos.inactividadMin !== undefined) cambios.inactividadMin = datos.inactividadMin;
      if (Object.keys(cambios).length > 0) {
        await tx
          .update(rol)
          .set(cambios)
          .where(and(eq(rol.id, id), eq(rol.clinicaId, ctx.clinicaId)));
      }
      if (datos.permisos !== undefined) await reemplazarPermisosRol(tx, id, datos.permisos);
      return this.uno(tx, ctx, id);
    });
  }

  /** Desactiva el rol (nada se borra) con su motivo (`rol.motivo_baja`, queda en la auditoría). */
  desactivar(ctx: ContextoPedido, id: string, motivo: string): Promise<void> {
    return this.bd.enContexto(ctx, async (tx) => {
      const actual = await this.bloquear(tx, ctx, id);
      if (!actual.activo) {
        throw errores.conflicto('Ese rol ya está desactivado. Recargá la lista de roles.');
      }
      await desactivarRol(tx, id, motivo);
    });
  }

  private async uno(tx: TransaccionConecta, ctx: ContextoPedido, id: string): Promise<Rol> {
    const [encontrado] = await this.leer(tx, ctx, id);
    if (!encontrado) throw rolNoEncontrado();
    return encontrado;
  }

  /** Roles de la clínica (o uno), con permisos activos y cuántas personas activas o pendientes lo usan. */
  private async leer(tx: TransaccionConecta, ctx: ContextoPedido, id?: string): Promise<Rol[]> {
    const filtro = id === undefined ? sql`` : sql`and r.id = ${id}`;
    const { rows } = await tx.execute(sql`
      select r.id, r.codigo, r.nombre, r.es_sistema, r.activo, r.todas_las_sedes, r.exige_mfa,
             r.inactividad_min,
             coalesce((
               select json_agg(json_build_object('modulo', p.modulo, 'accion', p.accion))
               from app.rol_permiso p
               where p.clinica_id = r.clinica_id and p.rol_id = r.id and p.activo
             ), '[]'::json) as permisos,
             (select count(*)::integer from app.membresia m
              where m.clinica_id = r.clinica_id and m.rol_id = r.id
                and m.estado in ('activo', 'pendiente')) as personas
      from app.rol r
      where r.clinica_id = ${ctx.clinicaId} ${filtro}
      order by r.es_sistema desc, lower(r.nombre), r.id`);
    return rows.map((f) => {
      const fila = filaRolSchema.parse(f);
      return rolSchema.parse({
        id: fila.id,
        // El código de un rol de la clínica es interno: el contrato lo muestra solo si es de sistema.
        codigo: fila.es_sistema ? fila.codigo : null,
        nombre: fila.nombre,
        esSistema: fila.es_sistema,
        activo: fila.activo,
        todasLasSedes: fila.todas_las_sedes,
        exigeMfa: fila.exige_mfa,
        inactividadMin: fila.inactividad_min,
        permisos: [...fila.permisos].sort((x, y) => ordenPermiso(x) - ordenPermiso(y)),
        personas: fila.personas,
      });
    });
  }

  /** Rol de la clínica del contexto, bloqueado hasta el final de la transacción, o 404. */
  private async bloquear(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
  ): Promise<{ id: string; activo: boolean }> {
    const [fila] = await tx
      .select({ id: rol.id, activo: rol.activo })
      .from(rol)
      .where(and(eq(rol.id, id), eq(rol.clinicaId, ctx.clinicaId)))
      .for('update');
    if (!fila) throw rolNoEncontrado();
    return fila;
  }

  /** Dos roles activos con el mismo nombre (sin distinguir mayúsculas) confunden al elegir. */
  private async exigirNombreLibre(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    nombre: string,
    excepto: string | null,
  ): Promise<void> {
    const otro = excepto === null ? sql`` : sql`and r.id <> ${excepto}`;
    const { rows } = await tx.execute(sql`
      select 1 as hay from app.rol r
      where r.clinica_id = ${ctx.clinicaId} and r.activo
        and lower(btrim(r.nombre)) = lower(btrim(${nombre})) ${otro}
      limit 1`);
    if (rows.length > 0) {
      throw errores.conflicto('Ya hay un rol activo con ese nombre. Elegí otro nombre.');
    }
  }
}
