import { Module } from '@nestjs/common';
import { CONFIG, type Config } from '../config.js';
import { ADMIN_AUTH, adminAuthNoConfigurado, crearAdminAuthSupabase } from './admin-auth.js';
import { InvitacionesService } from './invitaciones.service.js';
import {
  LIMITE_INVITACIONES_POR_MINUTO,
  LIMITE_INVITACIONES_PREDETERMINADO,
  LimiteInvitaciones,
} from './limite-invitaciones.js';
import {
  GuardLimiteInvitaciones,
  InvitacionesController,
  PersonalController,
  RolesController,
} from './personal.controller.js';
import { PersonalService } from './personal.service.js';
import { RolesService } from './roles.service.js';

/** Equipo (membresías), invitaciones y roles. */
@Module({
  controllers: [PersonalController, InvitacionesController, RolesController],
  providers: [
    PersonalService,
    InvitacionesService,
    RolesService,
    LimiteInvitaciones,
    GuardLimiteInvitaciones,
    { provide: LIMITE_INVITACIONES_POR_MINUTO, useValue: LIMITE_INVITACIONES_PREDETERMINADO },
    {
      provide: ADMIN_AUTH,
      inject: [CONFIG],
      useFactory: (config: Config) =>
        config.supabaseSecretKey
          ? crearAdminAuthSupabase(config.supabaseUrl, config.supabaseSecretKey)
          : adminAuthNoConfigurado,
    },
  ],
})
export class PersonalModule {}
