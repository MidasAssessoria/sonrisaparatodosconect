import { Injectable } from '@nestjs/common';
import { respuestaSaludSchema, type RespuestaSalud } from '@conecta/shared';

@Injectable()
export class SaludService {
  estado(): RespuestaSalud {
    return respuestaSaludSchema.parse({ ok: true });
  }
}
