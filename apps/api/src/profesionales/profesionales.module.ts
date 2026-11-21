import { Module } from '@nestjs/common';
import { BloqueosController, ProfesionalesController } from './profesionales.controller.js';
import { ProfesionalesService } from './profesionales.service.js';

/** Profesionales, su disponibilidad por sede y sus bloqueos (módulo personal). */
@Module({
  controllers: [ProfesionalesController, BloqueosController],
  providers: [ProfesionalesService],
})
export class ProfesionalesModule {}
