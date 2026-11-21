import { Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from './almacen.js';
import { AlmacenLocal } from './almacen-local.js';
import { AlmacenSupabase } from './almacen-supabase.js';
import { ArchivosController } from './archivos.controller.js';
import { ArchivosService } from './archivos.service.js';
import { ColaArchivos } from './cola-archivos.js';

/** El almacén sale de `config.archivos.almacen` (local en desarrollo y pruebas, supabase en los reales). */
export function crearAlmacen(config: Config): AlmacenArchivos {
  const { almacen, directorio, bucket, secretoFirma } = config.archivos;
  return almacen === 'local'
    ? new AlmacenLocal(directorio, bucket, secretoFirma)
    : new AlmacenSupabase(config.supabaseUrl, config.supabaseSecretKey, bucket);
}

@Module({
  controllers: [ArchivosController],
  providers: [
    ArchivosService,
    ColaArchivos,
    { provide: ALMACEN_ARCHIVOS, useFactory: crearAlmacen, inject: [CONFIG] },
  ],
})
export class ArchivosModule {}
