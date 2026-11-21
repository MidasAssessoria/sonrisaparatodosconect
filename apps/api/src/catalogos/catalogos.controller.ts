import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  crearTratamientoSchema,
  editarTratamientoSchema,
  guardarAgendaConfigSchema,
  type AgendaConfig,
  type CrearTratamiento,
  type EditarTratamiento,
  type GuardarAgendaConfig,
  type Tratamiento,
} from '@conecta/shared';
import { Permiso } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { IdDeRuta, ValidarCon } from '../errores/validacion.js';
import { CatalogosService } from './catalogos.service.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esVacio(valor: unknown): boolean {
  return valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/** Alta: categoría vacía o null = sin categoría. */
function prepararAlta(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  const copia = { ...cuerpo };
  if (esVacio(copia['categoria'])) delete copia['categoria'];
  return copia;
}

/** Edición: categoría vacía = null (borra el dato). */
function prepararEdicion(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  const copia = { ...cuerpo };
  if (esVacio(copia['categoria'])) copia['categoria'] = null;
  return copia;
}

@Controller('tratamientos')
export class TratamientosController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get()
  @Permiso('configuracion', 'ver')
  listar(@Ctx() ctx: ContextoPedido): Promise<Tratamiento[]> {
    return this.catalogos.listarTratamientos(ctx);
  }

  @Post()
  @Permiso('configuracion', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(crearTratamientoSchema, prepararAlta)) datos: CrearTratamiento,
  ): Promise<Tratamiento> {
    return this.catalogos.crearTratamiento(ctx, datos);
  }

  @Patch(':id')
  @Permiso('configuracion', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarTratamientoSchema, prepararEdicion)) datos: EditarTratamiento,
  ): Promise<Tratamiento> {
    return this.catalogos.editarTratamiento(ctx, id, datos);
  }
}

/** `/sedes/:id/agenda`: vive acá (módulo catalogos) pero usa los permisos de `sedes`. */
@Controller('sedes')
export class AgendaController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get(':id/agenda')
  @Permiso('sedes', 'ver')
  obtener(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<AgendaConfig> {
    return this.catalogos.obtenerAgenda(ctx, id);
  }

  @Put(':id/agenda')
  @Permiso('sedes', 'editar')
  guardar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(guardarAgendaConfigSchema)) datos: GuardarAgendaConfig,
  ): Promise<AgendaConfig> {
    return this.catalogos.guardarAgenda(ctx, id, datos);
  }
}
