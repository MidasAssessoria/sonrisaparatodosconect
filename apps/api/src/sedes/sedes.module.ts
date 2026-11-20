import { Module } from '@nestjs/common';
import { SedesController, SillonesController } from './sedes.controller.js';
import { SedesService } from './sedes.service.js';

@Module({
  controllers: [SedesController, SillonesController],
  providers: [SedesService],
})
export class SedesModule {}
