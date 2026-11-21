import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  aceptarInvitacionSchema,
  bajaSchema,
  consultarInvitacionSchema,
  crearInvitacionSchema,
  crearRolSchema,
  editarPersonaSchema,
  editarRolSchema,
  type AceptarInvitacion,
  type Baja,
  type CrearInvitacion,
  type CrearRol,
  type EditarPersona,
  type EditarRol,
  type InvitacionCreada,
  type InvitacionPublica,
  type Persona,
  type Rol,
} from '@conecta/shared';
import type { Request } from 'express';
import { ipDe } from '../comun/pedido.js';
import { Permiso, Publica } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { IdDeRuta, ValidarCon } from '../errores/validacion.js';
import { InvitacionesService, type InvitacionAceptada } from './invitaciones.service.js';
import { LimiteInvitaciones, type RutaPublicaInvitacion } from './limite-invitaciones.js';
import { PersonalService } from './personal.service.js';
import { RolesService } from './roles.service.js';

@Controller('personal')
export class PersonalController {
  constructor(private readonly personal: PersonalService) {}

  @Get()
  @Permiso('personal', 'ver')
  listar(@Ctx() ctx: ContextoPedido): Promise<Persona[]> {
    return this.personal.listar(ctx);
  }

  @Patch(':id')
  @Permiso('personal', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarPersonaSchema)) datos: EditarPersona,
  ): Promise<Persona> {
    return this.personal.editar(ctx, id, datos);
  }

  @Post(':id/desactivar')
  @HttpCode(200)
  @Permiso('personal', 'anular')
  desactivar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    // El motivo es obligatorio por contrato; la base todavÃ­a no lo guarda (ver PersonalService).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se valida, no hay dónde guardarlo
    @Body(new ValidarCon(bajaSchema)) _baja: Baja,
  ): Promise<Persona> {
    return this.personal.desactivar(ctx, id);
  }

  @Post(':id/reactivar')
  @HttpCode(200)
  @Permiso('personal', 'editar')
  reactivar(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<Persona> {
    return this.personal.reactivar(ctx, id);
  }
}

/**
 * LÃ­mite por IP de las rutas pÃºblicas de invitaciÃ³n. Es un guard (corre despuÃ©s del guard global y
 * antes de validar el cuerpo): cuenta tambiÃ©n los pedidos mal formados.
 */
@Injectable()
export class GuardLimiteInvitaciones implements CanActivate {
  constructor(@Inject(LimiteInvitaciones) private readonly limite: LimiteInvitaciones) {}

  canActivate(ejecucion: ExecutionContext): boolean {
    const req = ejecucion.switchToHttp().getRequest<Request>();
    const ruta = ejecucion.getHandler().name as RutaPublicaInvitacion;
    this.limite.exigir(ruta, ipDe(req));
    return true;
  }
}

@Controller('invitaciones')
export class InvitacionesController {
  constructor(private readonly invitaciones: InvitacionesService) {}

  @Post()
  @Permiso('personal', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(crearInvitacionSchema)) datos: CrearInvitacion,
  ): Promise<InvitacionCreada> {
    return this.invitaciones.crear(ctx, datos);
  }

  /** `:id` = la membresÃ­a pendiente (una sola invitaciÃ³n abierta por membresÃ­a). */
  @Post(':id/reenviar')
  @HttpCode(200)
  @Permiso('personal', 'crear')
  reenviar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
  ): Promise<InvitacionCreada> {
    return this.invitaciones.reenviar(ctx, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permiso('personal', 'anular')
  async anular(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(bajaSchema)) baja: Baja,
  ): Promise<void> {
    await this.invitaciones.anular(ctx, id, baja.motivo);
  }

  @Post('consultar')
  @HttpCode(200)
  @Publica()
  @UseGuards(GuardLimiteInvitaciones)
  consultar(
    @Req() req: Request,
    @Body(new ValidarCon(consultarInvitacionSchema)) datos: { token: string },
  ): Promise<InvitacionPublica> {
    return this.invitaciones.consultar(datos.token, ipDe(req));
  }

  /**
   * PÃºblica: la persona todavÃ­a no es miembro. Si trae `Authorization`, el JWT se verifica acÃ¡
   * (no en el guard de contexto) y de Ã©l salen el usuario y el correo. Nada de identidad sale del
   * cuerpo: el esquema solo deja pasar `token` y `clave`.
   */
  @Post('aceptar')
  @HttpCode(200)
  @Publica()
  @UseGuards(GuardLimiteInvitaciones)
  aceptar(
    @Req() req: Request,
    @Body(new ValidarCon(aceptarInvitacionSchema)) datos: AceptarInvitacion,
  ): Promise<InvitacionAceptada> {
    return this.invitaciones.aceptar(datos, req.headers.authorization, ipDe(req));
  }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permiso('personal', 'ver')
  listar(@Ctx() ctx: ContextoPedido): Promise<Rol[]> {
    return this.roles.listar(ctx);
  }

  @Post()
  @Permiso('configuracion', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(crearRolSchema)) datos: CrearRol,
  ): Promise<Rol> {
    return this.roles.crear(ctx, datos);
  }

  @Patch(':id')
  @Permiso('configuracion', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarRolSchema)) datos: EditarRol,
  ): Promise<Rol> {
    return this.roles.editar(ctx, id, datos);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permiso('configuracion', 'anular')
  async desactivar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    // El motivo es obligatorio por contrato; la base todavÃ­a no lo guarda (ver RolesService).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se valida, no hay dónde guardarlo
    @Body(new ValidarCon(bajaSchema)) _baja: Baja,
  ): Promise<void> {
    await this.roles.desactivar(ctx, id);
  }
}
