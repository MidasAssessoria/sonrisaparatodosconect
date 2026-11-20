import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  bajaSchema,
  crearSedeSchema,
  crearSillonSchema,
  editarSedeSchema,
  editarSillonSchema,
  reemplazarHorariosSchema,
  type Baja,
  type CrearSede,
  type CrearSillon,
  type EditarSede,
  type EditarSillon,
  type ReemplazarHorarios,
  type Sede,
  type Sillon,
} from '@conecta/shared';
import { Permiso } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { IdDeRuta, ValidarCon } from '../errores/validacion.js';
import { SedesService } from './sedes.service.js';

/** Campos opcionales donde la web puede mandar cadena vacía para «sin dato». */
const CAMPOS_BORRABLES = ['direccion', 'telefono', 'color'] as const;

function esVacio(valor: unknown): boolean {
  return valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/** Alta: cadena vacía o null en un campo opcional = no mandarlo (queda NULL). */
function prepararAlta(cuerpo: unknown): unknown {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return cuerpo;
  const copia: Record<string, unknown> = { ...(cuerpo as Record<string, unknown>) };
  for (const campo of CAMPOS_BORRABLES) if (esVacio(copia[campo])) delete copia[campo];
  return copia;
}

/** Edición: cadena vacía en un campo opcional = null (borra el dato). */
function prepararEdicion(cuerpo: unknown): unknown {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return cuerpo;
  const copia: Record<string, unknown> = { ...(cuerpo as Record<string, unknown>) };
  for (const campo of CAMPOS_BORRABLES) if (esVacio(copia[campo])) copia[campo] = null;
  return copia;
}

@Controller('sedes')
export class SedesController {
  constructor(private readonly sedes: SedesService) {}

  @Get()
  @Permiso('sedes', 'ver')
  listar(@Ctx() ctx: ContextoPedido): Promise<Sede[]> {
    return this.sedes.listar(ctx);
  }

  @Post()
  @Permiso('sedes', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(crearSedeSchema, prepararAlta)) datos: CrearSede,
  ): Promise<Sede> {
    return this.sedes.crear(ctx, datos);
  }

  @Get(':id')
  @Permiso('sedes', 'ver')
  obtener(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<Sede> {
    return this.sedes.obtener(ctx, id);
  }

  @Patch(':id')
  @Permiso('sedes', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarSedeSchema, prepararEdicion)) datos: EditarSede,
  ): Promise<Sede> {
    return this.sedes.editar(ctx, id, datos);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permiso('sedes', 'anular')
  async darDeBaja(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(bajaSchema)) baja: Baja,
  ): Promise<void> {
    await this.sedes.darDeBaja(ctx, id, baja.motivo);
  }

  @Put(':id/horarios')
  @Permiso('sedes', 'editar')
  reemplazarHorarios(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(reemplazarHorariosSchema)) datos: ReemplazarHorarios,
  ): Promise<Sede> {
    return this.sedes.reemplazarHorarios(ctx, id, datos.horarios);
  }

  @Post(':id/sillones')
  @Permiso('sedes', 'crear')
  crearSillon(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(crearSillonSchema)) datos: CrearSillon,
  ): Promise<Sillon> {
    return this.sedes.crearSillon(ctx, id, datos);
  }
}

@Controller('sillones')
export class SillonesController {
  constructor(private readonly sedes: SedesService) {}

  @Patch(':id')
  @Permiso('sedes', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarSillonSchema)) datos: EditarSillon,
  ): Promise<Sillon> {
    return this.sedes.editarSillon(ctx, id, datos);
  }
}
