import { Injectable } from '@nestjs/common';
import { usuario } from '@conecta/db';
import { sesionSchema, type Sesion } from '@conecta/shared';
import { eq, sql } from 'drizzle-orm';
import { ServicioBd } from '../base/servicio-bd.js';
import {
  INACTIVIDAD_MIN_POR_ROL,
  INACTIVIDAD_MIN_PREDETERMINADA,
  ROLES_CON_MFA,
  type ContextoPedido,
} from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';

@Injectable()
export class SesionService {
  constructor(private readonly bd: ServicioBd) {}

  /** `GET /sesion`: arma la respuesta con lo que resolvió el guard y actualiza `ultimo_acceso`. */
  async obtener(ctx: ContextoPedido): Promise<Sesion> {
    await this.bd.enContexto(ctx, (tx) =>
      tx
        .update(usuario)
        .set({ ultimoAcceso: sql`now()` })
        .where(eq(usuario.id, ctx.usuarioId)),
    );
    return sesionSchema.parse({
      usuario: ctx.usuario,
      nivelAutenticacion: ctx.nivel,
      debeActivarMfa: ROLES_CON_MFA.includes(ctx.rol.codigo) && !ctx.usuario.mfaActivo,
      clinicas: ctx.clinicas,
      clinica: ctx.clinica,
      rol: ctx.rol,
      permisos: ctx.permisos,
      sedes: ctx.sedes,
      sedeDefectoId: ctx.sedeDefectoId,
      puedeVerTodasLasSedes: ctx.puedeVerTodasLasSedes,
      inactividadMin: INACTIVIDAD_MIN_POR_ROL[ctx.rol.codigo] ?? INACTIVIDAD_MIN_PREDETERMINADA,
    } satisfies Sesion);
  }

  /** `DELETE /sesion/mfa`: exige aal2 (la web lo llama después de quitar el factor en Supabase). */
  async desactivarMfa(ctx: ContextoPedido): Promise<void> {
    if (ctx.nivel !== 'aal2') {
      throw errores.mfaRequerido(
        'Para desactivar el doble factor, confirmá primero el código de tu aplicación.',
      );
    }
    await this.bd.enContexto(ctx, (tx) =>
      tx.update(usuario).set({ mfaActivo: false }).where(eq(usuario.id, ctx.usuarioId)),
    );
  }
}
