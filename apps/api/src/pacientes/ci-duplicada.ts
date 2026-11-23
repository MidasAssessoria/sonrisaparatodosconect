import {
  formatoCi,
  pacienteResumenSchema,
  type ErrorApi as CuerpoErrorApi,
  type PacienteResumen,
} from '@conecta/shared';
import { ErrorApi } from '../errores/error-api.js';

type CuerpoCiDuplicada = CuerpoErrorApi & { existente: PacienteResumen };

/**
 * 409 por una CI que ya tiene otro paciente de la clínica (contrato: `ciDuplicadaSchema`). Además
 * de `errorApiSchema` lleva el paciente que ya la tiene en `existente`, para que la web ofrezca
 * abrir su ficha o guardar igual con `confirmarCiDuplicada: true`.
 */
export class ErrorCiDuplicada extends ErrorApi {
  override name = 'ErrorCiDuplicada';
  readonly existente: PacienteResumen;

  constructor(existente: PacienteResumen) {
    // Se valida al construirlo (dentro del servicio): si no cumple el contrato, falla el pedido
    // con un 500 en vez de salir un 409 que la web no reconoce.
    const valido = pacienteResumenSchema.parse(existente);
    const nombre = [valido.nombres, valido.apellidos].filter(Boolean).join(' ');
    super(
      409,
      'conflicto',
      `Ya hay un paciente con la cédula ${formatoCi(valido.ci ?? '')}: ${nombre}. ` +
        'Abrí su ficha o, si es otra persona, guardá igual.',
      [{ campo: 'ci', mensaje: 'Esta cédula ya está cargada en otro paciente.' }],
    );
    this.existente = valido;
  }

  override cuerpo(): CuerpoCiDuplicada {
    return { ...super.cuerpo(), existente: this.existente };
  }
}
