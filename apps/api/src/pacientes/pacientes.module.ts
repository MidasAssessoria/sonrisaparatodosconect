import { Module } from '@nestjs/common';
import {
  AlertasController,
  BuscarController,
  PacientesController,
  RelacionesController,
} from './pacientes.controller.js';
import { PacientesService } from './pacientes.service.js';

/** Pacientes, buscador global, grupo familiar y alertas manuales (Sprint 3). */
@Module({
  controllers: [PacientesController, BuscarController, RelacionesController, AlertasController],
  providers: [PacientesService],
})
export class PacientesModule {}
