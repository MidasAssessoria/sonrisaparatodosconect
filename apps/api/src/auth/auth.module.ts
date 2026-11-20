import { Global, Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { VERIFICADOR_JWT, crearVerificadorSupabase } from './verificador-jwt.js';

@Global()
@Module({
  providers: [
    {
      provide: VERIFICADOR_JWT,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        crearVerificadorSupabase(config.supabaseJwksUrl, config.emisorJwt),
    },
  ],
  exports: [VERIFICADOR_JWT],
})
export class AuthModule {}
