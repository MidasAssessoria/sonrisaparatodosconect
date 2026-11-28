import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  bajaSchema,
  consultaBuscarSchema,
  consultaPacientesSchema,
  crearAlertaSchema,
  crearPacienteSchema,
  crearRelacionSchema,
  editarAlertaSchema,
  editarPacienteSchema,
  editarRelacionSchema,
  type AlertaManual,
  type Baja,
  type ConsultaPacientes,
  type CrearPaciente,
  type CrearRelacion,
  type EditarPaciente,
  type EditarRelacion,
  type Paciente,
  type Relacion,
  type paginaPacientesSchema,
  type resultadoBuscarSchema,
} from '@conecta/shared';
import type { z } from 'zod';
import { Permiso } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { IdDeRuta, ValidarCon } from '../errores/validacion.js';
import { PacientesService, type CrearAlerta } from './pacientes.service.js';

/** Datos opcionales donde la web puede mandar cadena vacía para «sin dato». */
const CAMPOS_BORRABLES = [
  'apellidos',
  'ci',
  'ruc',
  'fechaNac',
  'sexo',
  'telefono',
  'email',
  'ciudad',
  'direccion',
] as const;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esVacio(valor: unknown): boolean {
  return valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/** Alta: cadena vacía o null en un dato opcional = no mandarlo (queda sin cargar). */
function prepararAlta(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  const copia = { ...cuerpo };
  for (const campo of CAMPOS_BORRABLES) if (esVacio(copia[campo])) delete copia[campo];
  return copia;
}

/** Edición: cadena vacía en un dato opcional = null (borra el dato). */
function prepararEdicion(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  const copia = { ...cuerpo };
  for (const campo of CAMPOS_BORRABLES) if (esVacio(copia[campo])) copia[campo] = null;
  return copia;
}

@Controller('pacientes')
export class PacientesController {
  constructor(private readonly pacientes: PacientesService) {}

  @Get()
  @Permiso('pacientes', 'ver')
  listar(
    @Ctx() ctx: ContextoPedido,
    @Query(new ValidarCon(consultaPacientesSchema)) consulta: ConsultaPacientes,
  ): Promise<z.infer<typeof paginaPacientesSchema>> {
    return this.pacientes.listar(ctx, consulta);
  }

  @Post()
  @Permiso('pacientes', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(crearPacienteSchema, prepararAlta)) datos: CrearPaciente,
  ): Promise<Paciente> {
    return this.pacientes.crear(ctx, datos);
  }

  /** Toda respuesta con la ficha completa queda en auditoría como `ver` (lo hace el servicio). */
  @Get(':id')
  @Permiso('pacientes', 'ver')
  obtener(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<Paciente> {
    return this.pacientes.obtener(ctx, id);
  }

  /**
   * Responde la ficha completa: exige además `pacientes:ver` (y `ficha_clinica:editar` y `ver` si
   * trae `notaInterna`); lo controla el servicio.
   */
  @Patch(':id')
  @Permiso('pacientes', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarPacienteSchema, prepararEdicion)) datos: EditarPaciente,
  ): Promise<Paciente> {
    return this.pacientes.editar(ctx, id, datos);
  }

  /** Responde la ficha completa: exige además `pacientes:ver` (lo controla el servicio). */
  @Post(':id/desactivar')
  @HttpCode(200)
  @Permiso('pacientes', 'anular')
  desactivar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(bajaSchema)) baja: Baja,
  ): Promise<Paciente> {
    return this.pacientes.desactivar(ctx, id, baja.motivo);
  }

  /** Responde la ficha completa: exige además `pacientes:ver` (lo controla el servicio). */
  @Post(':id/reactivar')
  @HttpCode(200)
  @Permiso('pacientes', 'anular')
  reactivar(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<Paciente> {
    return this.pacientes.reactivar(ctx, id);
  }

  /** Responde los datos del familiar: exige además `pacientes:ver` (lo controla el servicio). */
  @Post(':id/relaciones')
  @Permiso('pacientes', 'editar')
  crearRelacion(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(crearRelacionSchema)) datos: CrearRelacion,
  ): Promise<Relacion> {
    return this.pacientes.crearRelacion(ctx, id, datos);
  }

  @Post(':id/alertas')
  @Permiso('ficha_clinica', 'editar')
  crearAlerta(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(crearAlertaSchema)) datos: CrearAlerta,
  ): Promise<AlertaManual> {
    return this.pacientes.crearAlerta(ctx, id, datos);
  }
}

/** Buscador global de la barra superior. */
@Controller('buscar')
export class BuscarController {
  constructor(private readonly pacientes: PacientesService) {}

  @Get()
  @Permiso('pacientes', 'ver')
  buscar(
    @Ctx() ctx: ContextoPedido,
    @Query(new ValidarCon(consultaBuscarSchema)) consulta: { q: string },
  ): Promise<z.infer<typeof resultadoBuscarSchema>> {
    return this.pacientes.buscar(ctx, consulta.q);
  }
}

@Controller('relaciones')
export class RelacionesController {
  constructor(private readonly pacientes: PacientesService) {}

  /**
   * Cambia las marcas del vínculo vistas desde el lado `:id`. Responde los datos del familiar:
   * exige además `pacientes:ver` (lo controla el servicio).
   */
  @Patch(':id')
  @Permiso('pacientes', 'editar')
  editar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarRelacionSchema)) datos: EditarRelacion,
  ): Promise<Relacion> {
    return this.pacientes.editarRelacion(ctx, id, datos);
  }

  /** Sin cuerpo: da de baja el vínculo y su espejo. */
  @Delete(':id')
  @HttpCode(204)
  @Permiso('pacientes', 'editar')
  async quitar(@Ctx() ctx: ContextoPedido, @Param('id', IdDeRuta) id: string): Promise<void> {
    await this.pacientes.quitarRelacion(ctx, id);
  }
}

@Controller('alertas')
export class AlertasController {
  constructor(private readonly pacientes: PacientesService) {}

  /** Responde la alerta: exige poder verla (lo controla el servicio). */
  @Patch(':id')
  @Permiso('ficha_clinica', 'editar')
  cambiar(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(editarAlertaSchema)) datos: { activa: boolean },
  ): Promise<AlertaManual> {
    return this.pacientes.cambiarAlerta(ctx, id, datos.activa);
  }
}
