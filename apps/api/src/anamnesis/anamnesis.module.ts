import { Module } from '@nestjs/common';
import { ArchivosModule } from '../archivos/archivos.module.js';
import { AnamnesisPacienteController, PreguntasController } from './anamnesis.controller.js';
import { AnamnesisService } from './anamnesis.service.js';

/**
 * Anamnesis versionada con firma, catálogo de preguntas e historial del paciente (Sprint 4). Usa el
 * almacén privado de archivos (la firma es un archivo `firma_paciente`).
 */
@Module({
  imports: [ArchivosModule],
  controllers: [PreguntasController, AnamnesisPacienteController],
  providers: [AnamnesisService],
})
export class AnamnesisModule {}
