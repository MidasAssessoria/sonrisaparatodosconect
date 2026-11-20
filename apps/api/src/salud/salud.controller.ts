import { Controller, Get } from '@nestjs/common';
import type { RespuestaSalud } from '@conecta/shared';
import { SaludService } from './salud.service.js';

@Controller('salud')
export class SaludController {
  // Inyección por tipo: depende de la metadata de decoradores (emitDecoratorMetadata).
  constructor(private readonly salud: SaludService) {}

  @Get()
  obtener(): RespuestaSalud {
    return this.salud.estado();
  }
}
