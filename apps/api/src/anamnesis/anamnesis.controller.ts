import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  type PipeTransform,
} from '@nestjs/common';
import {
  consultaHistorialSchema,
  crearAnamnesisSchema,
  reemplazarPreguntasSchema,
  type Anamnesis,
  type catalogoPreguntasSchema,
  type CrearAnamnesis,
  type paginaHistorialSchema,
  type Pregunta,
  type versionesAnamnesisSchema,
} from '@conecta/shared';
import type { z } from 'zod';
import { Permiso } from '../contexto/acceso.js';
import { Ctx, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';
import { IdDeRuta, ValidarCon } from '../errores/validacion.js';
import {
  AnamnesisService,
  type ConsultaHistorial,
  type VersionPedida,
} from './anamnesis.service.js';

type Catalogo = z.infer<typeof catalogoPreguntasSchema>;

/**
 * `:version` de la ruta: un número de versión (1, 2, 3…) o `vigente`. Otra cosa no puede existir:
 * 404, sin llegar a la base (como `IdDeRuta`).
 */
@Injectable()
export class VersionDeRuta implements PipeTransform<unknown, VersionPedida> {
  transform(valor: unknown): VersionPedida {
    if (valor === 'vigente') return 'vigente';
    if (typeof valor === 'string' && /^[1-9][0-9]{0,8}$/.test(valor)) return Number(valor);
    throw errores.noEncontrado(
      'No encontramos esa versión de la anamnesis. Volvé a la lista de versiones del paciente.',
    );
  }
}

/**
 * Sin firma (o firma `null`): cadena vacía, así el contrato responde su propio mensaje
 * («Falta la firma.») en `firmaPng` en lugar de «Completá este dato».
 */
function prepararAnamnesis(cuerpo: unknown): unknown {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return cuerpo;
  const copia = { ...(cuerpo as Record<string, unknown>) };
  if (copia['firmaPng'] === undefined || copia['firmaPng'] === null) copia['firmaPng'] = '';
  return copia;
}

/** Catálogo del cuestionario. El texto de las preguntas no es dato de ningún paciente. */
@Controller('anamnesis/preguntas')
export class PreguntasController {
  constructor(private readonly anamnesis: AnamnesisService) {}

  /** Activas, ordenadas, para el formulario. */
  @Get()
  @Permiso('ficha_clinica', 'ver')
  activas(@Ctx() ctx: ContextoPedido): Promise<Catalogo> {
    return this.anamnesis.preguntas(ctx, false);
  }

  /** Completo, con las inactivas, para el editor (Administración, sin ver fichas). */
  @Get('catalogo')
  @Permiso('configuracion', 'editar')
  catalogo(@Ctx() ctx: ContextoPedido): Promise<Catalogo> {
    return this.anamnesis.preguntas(ctx, true);
  }

  /** Reemplaza el cuestionario; responde el catálogo completo. */
  @Put()
  @Permiso('configuracion', 'editar')
  reemplazar(
    @Ctx() ctx: ContextoPedido,
    @Body(new ValidarCon(reemplazarPreguntasSchema)) cuerpo: { preguntas: Pregunta[] },
  ): Promise<Catalogo> {
    return this.anamnesis.reemplazarPreguntas(ctx, cuerpo.preguntas);
  }
}

/** Anamnesis e historial de un paciente. */
@Controller('pacientes')
export class AnamnesisPacienteController {
  constructor(private readonly anamnesis: AnamnesisService) {}

  @Get(':id/anamnesis')
  @Permiso('ficha_clinica', 'ver')
  versiones(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
  ): Promise<z.infer<typeof versionesAnamnesisSchema>> {
    return this.anamnesis.versiones(ctx, id);
  }

  /** Responde la versión completa: exige además `ficha_clinica:ver` (lo controla el servicio). */
  @Post(':id/anamnesis')
  @HttpCode(201)
  @Permiso('ficha_clinica', 'crear')
  crear(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Body(new ValidarCon(crearAnamnesisSchema, prepararAnamnesis)) datos: CrearAnamnesis,
  ): Promise<Anamnesis> {
    return this.anamnesis.crear(ctx, id, datos);
  }

  /** Una versión (`vigente` o el número), con la URL de la firma. Queda `ver` en la auditoría. */
  @Get(':id/anamnesis/:version')
  @Permiso('ficha_clinica', 'ver')
  version(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Param('version', VersionDeRuta) version: VersionPedida,
  ): Promise<Anamnesis> {
    return this.anamnesis.obtener(ctx, id, version);
  }

  /** Línea de tiempo; sin `ficha_clinica:ver` la base no incluye los eventos clínicos. */
  @Get(':id/historial')
  @Permiso('pacientes', 'ver')
  historial(
    @Ctx() ctx: ContextoPedido,
    @Param('id', IdDeRuta) id: string,
    @Query(new ValidarCon(consultaHistorialSchema)) consulta: ConsultaHistorial,
  ): Promise<z.infer<typeof paginaHistorialSchema>> {
    return this.anamnesis.historial(ctx, id, consulta);
  }
}
