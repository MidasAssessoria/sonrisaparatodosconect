import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GuardContexto } from './guard-contexto.js';
import { ResolvedorContexto } from './resolvedor-contexto.js';

/** Registra el guard global: toda ruta pasa por él (negar por defecto). */
@Global()
@Module({
  providers: [ResolvedorContexto, { provide: APP_GUARD, useClass: GuardContexto }],
  exports: [ResolvedorContexto],
})
export class ContextoModule {}
