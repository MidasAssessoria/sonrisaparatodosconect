import { Controller, Get, Query } from '@nestjs/common';
import {
  consultaAuditoriaSchema,
  type ConsultaAuditoria,
  type PaginaAuditoria,
} from '@conecta/shared';
import { Permiso } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { ValidarCon } from '../errores/validacion.js';
import { AuditoriaService } from './auditoria.service.js';

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  @Permiso('auditoria', 'ver')
  listar(
    @Ctx() ctx: ContextoPedido,
    @Query(new ValidarCon(consultaAuditoriaSchema)) consulta: ConsultaAuditoria,
  ): Promise<PaginaAuditoria> {
    return this.auditoria.listar(ctx, consulta);
  }
}
