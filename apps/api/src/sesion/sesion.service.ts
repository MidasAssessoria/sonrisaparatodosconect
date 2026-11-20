import { Injectable } from '@nestjs/common';
import { desactivarMfa, usuario } from '@conecta/db';
import { sesionSchema, type Sesion } from '@conecta/shared';
import { eq, sql } from 'drizzle-orm';
import type { IdentidadToken } from '../auth/verificador-jwt.js';
import { ServicioBd } from '../base/servicio-bd.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { ResolvedorContexto } from '../contexto/resolvedor-contexto.js';
import { errores } from '../errores/error-api.js';

@Injectable()
export class SesionService {
  constructor(
    private readonly bd: ServicioBd,
    private readonly resolvedor: ResolvedorContexto,
  ) {}

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
      clinicas: ctx.clinicas,
      clinica: ctx.clinica,
      rol: ctx.rol,
      permisos: ctx.permisos,
      sedes: ctx.sedes,
      sedeDefectoId: ctx.sedeDefectoId,
      puedeVerTodasLasSedes: ctx.puedeVerTodasLasSedes,
      inactividadMin: ctx.inactividadMin,
    } satisfies Sesion);
  }

  /**
   * `DELETE /sesion/mfa`: exige aal2 (la web lo llama justo después de quitar el factor en
   * Supabase). Desde ese momento, los tokens aal2 emitidos antes no cuentan como aal2.
   */
  async desactivarMfa(ctx: ContextoPedido): Promise<void> {
    if (ctx.nivel !== 'aal2') {
      throw errores.mfaRequerido(
        'Para desactivar el doble factor, confirmá primero el código de tu aplicación.',
      );
    }
    await this.bd.enContexto(ctx, (tx) => desactivarMfa(tx));
  }

  /** `POST /sesion/cerrar`: a partir de acá el token de esta sesión no sirve más. */
  cerrar(identidad: IdentidadToken, ip: string | null): Promise<void> {
    return this.resolvedor.cerrarSesion(identidad, ip);
  }
}
