import { Controller, Get } from '@nestjs/common';
import type { RespuestaSalud } from '@conecta/shared';
import { Publica } from '../contexto/acceso.js';
import { SaludService } from './salud.service.js';

@Controller('salud')
export class SaludController {
  // Inyección por tipo: depende de la metadata de decoradores (emitDecoratorMetadata).
  constructor(private readonly salud: SaludService) {}

  @Get()
  @Publica()
  obtener(): RespuestaSalud {
    return this.salud.estado();
  }
}
