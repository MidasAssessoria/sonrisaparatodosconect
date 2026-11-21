import { Module } from '@nestjs/common';
import { AgendaController, TratamientosController } from './catalogos.controller.js';
import { CatalogosService } from './catalogos.service.js';

/** Catálogo de tratamientos y configuración de agenda por sede. */
@Module({
  controllers: [TratamientosController, AgendaController],
  providers: [CatalogosService],
})
export class CatalogosModule {}
