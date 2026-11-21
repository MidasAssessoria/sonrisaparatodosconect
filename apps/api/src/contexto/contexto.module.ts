import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { InterceptorAccesoArchivo } from './acceso-archivo.js';
import { GuardContexto } from './guard-contexto.js';
import { ResolvedorContexto } from './resolvedor-contexto.js';

/**
 * Registra el guard global: toda ruta pasa por él (negar por defecto). El interceptor global solo
 * actúa en las rutas `archivo`: no deja responder si el handler no exigió el permiso.
 */
@Global()
@Module({
  providers: [
    ResolvedorContexto,
    { provide: APP_GUARD, useClass: GuardContexto },
    { provide: APP_INTERCEPTOR, useClass: InterceptorAccesoArchivo },
  ],
  exports: [ResolvedorContexto],
})
export class ContextoModule {}
