import { Global, Module } from '@nestjs/common';
import { CONFIG, cargarConfig, type Config } from '../config.js';
import { REGISTRO, crearRegistroConsola, registroSilencioso } from '../comun/registro.js';
import { ServicioBd } from './servicio-bd.js';

/** Configuración, registro y base de datos: disponibles en toda la app. */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => cargarConfig() },
    {
      provide: REGISTRO,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        config.entorno === 'test' ? registroSilencioso : crearRegistroConsola(),
    },
    ServicioBd,
  ],
  exports: [CONFIG, REGISTRO, ServicioBd],
})
export class BaseModule {}
