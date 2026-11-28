import {
  formatoCi,
  pacienteResumenSchema,
  type ErrorApi as CuerpoErrorApi,
  type PacienteResumen,
} from '@conecta/shared';
import { ErrorApi } from '../errores/error-api.js';

type CuerpoCiDuplicada = CuerpoErrorApi & { existente?: PacienteResumen };

const MENSAJE_SIN_NOMBRE =
  'Esa cédula ya está cargada en otro paciente de la clínica. Revisala o, si es otra persona, guardá igual.';

function mensajeCon(existente: PacienteResumen): string {
  const nombre = [existente.nombres, existente.apellidos].filter(Boolean).join(' ');
  return (
    `Ya hay un paciente con la cédula ${formatoCi(existente.ci ?? '')}: ${nombre}. ` +
    'Abrí su ficha o, si es otra persona, guardá igual.'
  );
}

/**
 * 409 por una CI que ya tiene otro paciente de la clínica (contrato: `ciDuplicadaSchema`).
 *
 * Con `existente` (solo si quien pide tiene `pacientes:ver`): además de `errorApiSchema` lleva el
 * paciente que ya la tiene, para que la web ofrezca abrir su ficha o guardar igual con
 * `confirmarCiDuplicada: true`, y el mensaje lo nombra.
 *
 * Sin `existente` (`null`: quien pide no puede ver pacientes, p. ej. un rol con solo
 * `pacientes:crear`): solo `codigo`, `mensaje` y `detalles` con el campo `ci`, y el mensaje no
 * nombra a nadie: el alta no sirve para averiguar quién tiene una cédula.
 */
export class ErrorCiDuplicada extends ErrorApi {
  override name = 'ErrorCiDuplicada';
  readonly existente: PacienteResumen | null;

  constructor(existente: PacienteResumen | null) {
    // Se valida al construirlo (dentro del servicio): si no cumple el contrato, falla el pedido
    // con un 500 en vez de salir un 409 que la web no reconoce.
    const valido = existente === null ? null : pacienteResumenSchema.parse(existente);
    super(409, 'conflicto', valido ? mensajeCon(valido) : MENSAJE_SIN_NOMBRE, [
      { campo: 'ci', mensaje: 'Esta cédula ya está cargada en otro paciente.' },
    ]);
    this.existente = valido;
  }

  override cuerpo(): CuerpoCiDuplicada {
    const base = super.cuerpo();
    return this.existente ? { ...base, existente: this.existente } : base;
  }
}
