import { Module } from '@nestjs/common';
import { ArchivosModule } from './archivos/archivos.module.js';
import { AuditoriaModule } from './auditoria/auditoria.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BaseModule } from './base/base.module.js';
import { CatalogosModule } from './catalogos/catalogos.module.js';
import { ContextoModule } from './contexto/contexto.module.js';
import { PacientesModule } from './pacientes/pacientes.module.js';
import { PersonalModule } from './personal/personal.module.js';
import { ProfesionalesModule } from './profesionales/profesionales.module.js';
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
    PersonalModule,
    ProfesionalesModule,
    CatalogosModule,
    ArchivosModule,
    PacientesModule,
  ],
})
export class AppModule {}
