import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
import type { Sesion } from '@conecta/shared';
import { AccesoSesion, SoloMiembro } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { SesionService } from './sesion.service.js';

@Controller('sesion')
export class SesionController {
  constructor(private readonly sesion: SesionService) {}

  @Get()
  @AccesoSesion()
  obtener(@Ctx() ctx: ContextoPedido): Promise<Sesion> {
    return this.sesion.obtener(ctx);
  }

  @Delete('mfa')
  @HttpCode(204)
  @SoloMiembro()
  desactivarMfa(@Ctx() ctx: ContextoPedido): Promise<void> {
    return this.sesion.desactivarMfa(ctx);
  }
}
