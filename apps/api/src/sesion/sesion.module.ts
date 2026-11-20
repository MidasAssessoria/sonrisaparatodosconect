import { Module } from '@nestjs/common';
import { SesionController } from './sesion.controller.js';
import { SesionService } from './sesion.service.js';

@Module({
  controllers: [SesionController],
  providers: [SesionService],
})
export class SesionModule {}
