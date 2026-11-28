import { Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from './almacen.js';
import { AlmacenLocal } from './almacen-local.js';
import { AlmacenSupabase } from './almacen-supabase.js';
import { ArchivosController } from './archivos.controller.js';
import { ArchivosService } from './archivos.service.js';

/**
 * El almacén sale de `config.archivos.almacen` (local en desarrollo y pruebas, supabase en los
 * reales). El local arma URLs absolutas con el origen público de la API.
 */
export function crearAlmacen(config: Config): AlmacenArchivos {
  const { almacen, directorio, bucket, secretoFirma } = config.archivos;
  if (almacen === 'supabase') {
    return new AlmacenSupabase(config.supabaseUrl, config.supabaseSecretKey, bucket);
  }
  // cargarConfig lo exige con el almacén local (en desarrollo y pruebas tiene valor por defecto).
  if (!config.apiOrigenPublico) throw new Error('Falta API_ORIGEN_PUBLICO para el almacén local.');
  return new AlmacenLocal(directorio, bucket, secretoFirma, config.apiOrigenPublico);
}

@Module({
  controllers: [ArchivosController],
  providers: [
    ArchivosService,
    { provide: ALMACEN_ARCHIVOS, useFactory: crearAlmacen, inject: [CONFIG] },
  ],
  // La anamnesis (Sprint 4) guarda la firma del paciente en el mismo almacén.
  exports: [ALMACEN_ARCHIVOS],
})
export class ArchivosModule {}
