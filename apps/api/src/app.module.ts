import { Module } from '@nestjs/common';
import { AuditoriaModule } from './auditoria/auditoria.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BaseModule } from './base/base.module.js';
import { ContextoModule } from './contexto/contexto.module.js';
import { SaludModule } from './salud/salud.module.js';
import { SedesModule } from './sedes/sedes.module.js';
import { SesionModule } from './sesion/sesion.module.js';

@Module({
  imports: [
    BaseModule,
    AuthModule,
    ContextoModule,
    SaludModule,
    SesionModule,
    SedesModule,
    AuditoriaModule,
  ],
})
export class AppModule {}
