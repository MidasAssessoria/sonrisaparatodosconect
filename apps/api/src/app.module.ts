import { Module } from '@nestjs/common';
import { CONFIG, cargarConfig } from './config.js';
import { SaludModule } from './salud/salud.module.js';

@Module({
  imports: [SaludModule],
  providers: [{ provide: CONFIG, useFactory: () => cargarConfig() }],
  exports: [CONFIG],
})
export class AppModule {}
