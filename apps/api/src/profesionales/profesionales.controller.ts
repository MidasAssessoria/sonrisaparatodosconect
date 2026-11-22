import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  bajaSchema,
  crearBloqueoSchema,
  crearProfesionalSchema,
  editarProfesionalSchema,
  reemplazarDisponibilidadSchema,
  type Baja,
  type Bloqueo,
  type CrearBloqueo,
  type CrearProfesional,
  type EditarProfesional,
  type Profesional,
  type ReemplazarDisponibilidad,
} from '@conecta/shared';
import { Permiso } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { IdDeRuta, ValidarCon } from '../errores/validacion.js';
import { ProfesionalesService } from './profesionales.service.js';

/** Campos opcionales donde la web puede mandar cadena vacía para «sin dato». */
const CAMPOS_BORRABLES = ['especialidad', 'registroProf'] as const;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esVacio(valor: unknown): boolean {
  return valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/** Alta: cadena vacía o null en un campo opcional = no mandarlo (queda NULL). */
function prepararAlta(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  const copia = { ...cuerpo };
  for (const campo of [...CAMPOS_BORRABLES, 'membresiaId']) {
    if (esVacio(copia[campo])) delete copia[campo];
  }
  return copia;
}

/** Edición: cadena vacía en un campo opcional = null (borra el dato). */
function prepararEdicion(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  const copia = { ...cuerpo };
  for (const campo of [...CAMPOS_BORRABLES, 'membresiaId']) {
    if (esVacio(copia[campo])) copia[campo] = null;
  }
  return copia;
}

@Controller('profesionales')
export class ProfesionalesController {
  constructor(private readonly profesionales: ProfesionalesService) {}

  @Get()
  @Permiso('personal', 'ver')
  listar(@Ctx() ctx: ContextoPedido): Promise<Profesional[]> {
    return this.profesionales.listar(ctx);
  }

  @Post()
  @Permiso('personal', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(crearProfesionalSchema, prepararAlta)) datos: CrearProfesional,
  ): Promise<Profesional> {
    return this.profesionales.crear(ctx, datos);
  }

  @Get(':id')
  @Permiso('personal', 'ver')
  obtener(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<Profesional> {
    return this.profesionales.obtener(ctx, id);
  }

  @Patch(':id')
  @Permiso('personal', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarProfesionalSchema, prepararEdicion)) datos: EditarProfesional,
  ): Promise<Profesional> {
    return this.profesionales.editar(ctx, id, datos);
  }

  @Put(':id/disponibilidad')
  @Permiso('personal', 'editar')
  reemplazarDisponibilidad(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(reemplazarDisponibilidadSchema)) datos: ReemplazarDisponibilidad,
  ): Promise<Profesional> {
    return this.profesionales.reemplazarDisponibilidad(ctx, id, datos.tramos);
  }

  @Post(':id/bloqueos')
  @Permiso('personal', 'editar')
  crearBloqueo(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(crearBloqueoSchema)) datos: CrearBloqueo,
  ): Promise<Bloqueo> {
    return this.profesionales.crearBloqueo(ctx, id, datos);
  }
}

@Controller('bloqueos')
export class BloqueosController {
  constructor(private readonly profesionales: ProfesionalesService) {}

  @Delete(':id')
  @HttpCode(204)
  @Permiso('personal', 'editar')
  async darDeBaja(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(bajaSchema)) baja: Baja,
  ): Promise<void> {
    await this.profesionales.darDeBajaBloqueo(ctx, id, baja.motivo);
  }
}
