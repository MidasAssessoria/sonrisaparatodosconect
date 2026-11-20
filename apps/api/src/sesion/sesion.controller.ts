import { Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Sesion } from '@conecta/shared';
import type { Request } from 'express';
import type { IdentidadToken } from '../auth/verificador-jwt.js';
import { ipDe } from '../comun/pedido.js';
import { AccesoSesion, CierreSesion, SoloMiembro } from '../contexto/acceso.js';
import { Ctx, Identidad, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { SesionService } from './sesion.service.js';

@Controller('sesion')
export class SesionController {
  constructor(private readonly sesion: SesionService) {}

  @Get()
  @AccesoSesion()
  obtener(@Ctx() ctx: ContextoPedido): Promise<Sesion> {
    return this.sesion.obtener(ctx);
  }

  @Post('cerrar')
  @HttpCode(204)
  @CierreSesion()
  async cerrar(@Identidad() identidad: IdentidadToken, @Req() req: Request): Promise<void> {
    await this.sesion.cerrar(identidad, ipDe(req));
  }

  @Delete('mfa')
  @HttpCode(204)
  @SoloMiembro()
  desactivarMfa(@Ctx() ctx: ContextoPedido): Promise<void> {
    return this.sesion.desactivarMfa(ctx);
  }
}
