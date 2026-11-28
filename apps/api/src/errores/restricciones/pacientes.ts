import type { RestriccionPaciente } from '@conecta/db';
import { errores, type ErrorApi } from '../error-api.js';

/**
 * Mensajes para las restricciones de la base del Sprint 3 (pacientes, grupo familiar, alertas
 * manuales y nota interna; migraciones 0019–0027). Cada una con el código del contrato y un mensaje
 * en voseo que dice qué hacer, sin detalles internos.
 *
 * La API valida antes casi todo (formato de CI, RUC, teléfono, largos, ids de otra clínica): estas
 * traducciones cubren lo que solo la base puede ver y son la red por si algo se escapa.
 */

const pacienteNoEncontrado = (): ErrorApi =>
  errores.noEncontrado('No encontramos ese paciente. Volvé a la lista y buscalo de nuevo.');

const campo = (nombre: string, mensaje: string, detalle = mensaje): ErrorApi =>
  errores.datosInvalidos(mensaje, [{ campo: nombre, mensaje: detalle }]);

/**
 * `relacion_tipo_sexo` sale por dos caminos y la base dice cuál (y qué vínculo chocó) en su mensaje.
 * La API toma de ahí solo `madre` o `padre` y arma su propio texto; nada más del mensaje de la base
 * llega al cliente:
 *   - al cargar el vínculo («El vínculo madre no coincide…»): el tipo elegido no va con el sexo del
 *     familiar → campo `tipo`;
 *   - al cambiar el sexo de un paciente (0026: «Este paciente figura como madre…»): alguien lo cargó
 *     a mano como madre o padre en un vínculo y el sexo nuevo no coincide → campo `sexo`. La base no
 *     cambia sola un tipo que eligió una persona: hay que quitar el vínculo y cargarlo de nuevo.
 */
function tipoSexo(pg: { message: string }): ErrorApi {
  const porSexo = /figura como (madre|padre) /.exec(pg.message)?.[1];
  if (porSexo) {
    const mensaje =
      porSexo === 'madre'
        ? 'Este paciente figura como madre en su grupo familiar y el sexo nuevo no coincide. Quitá ese vínculo y cargalo de nuevo, o revisá el sexo.'
        : 'Este paciente figura como padre en su grupo familiar y el sexo nuevo no coincide. Quitá ese vínculo y cargalo de nuevo, o revisá el sexo.';
    return campo('sexo', mensaje, 'No coincide con su grupo familiar.');
  }
  const tipo = /El vínculo (madre|padre) /.exec(pg.message)?.[1];
  const mensaje =
    tipo === 'madre'
      ? 'Madre tiene que ser una paciente de sexo femenino. Revisá el vínculo o el sexo cargado.'
      : tipo === 'padre'
        ? 'Padre tiene que ser un paciente de sexo masculino. Revisá el vínculo o el sexo cargado.'
        : 'El vínculo no coincide con el sexo cargado del familiar. Revisá el vínculo o el sexo cargado.';
  return campo('tipo', mensaje);
}

/** Reglas de `RESTRICCIONES_PACIENTES` (la lista exhaustiva de la base). */
export const MENSAJES_PACIENTES: Record<
  RestriccionPaciente,
  (pg: { message: string }) => ErrorApi
> = {
  pacientes_sin_permiso: () =>
    errores.sinPermiso(
      'Tu rol no tiene el permiso de Pacientes que hace falta para este cambio. Pedile acceso a quien administra la clínica.',
    ),
  // Desde 0023 también falta `ficha_clinica:ver` (para escribir la nota, cargar o desactivar una
  // alerta, o tocar una inactiva): el mensaje pide los dos.
  ficha_clinica_sin_permiso: () =>
    errores.sinPermiso(
      'Las alertas y la nota interna son de la ficha clínica: para cambiarlas tu rol tiene que poder verla y editarla. Pedíselo a un odontólogo o pedile acceso a quien administra la clínica.',
    ),
  paciente_nace_activo: () =>
    errores.datosInvalidos('Un paciente nuevo se carga activo. Guardalo y desactivalo después.'),
  paciente_fecha_nac_futura: () =>
    campo(
      'fechaNac',
      'La fecha de nacimiento no puede ser futura. Revisá el día, el mes y el año.',
      'No puede ser futura.',
    ),
  paciente_no_encontrado: pacienteNoEncontrado,
  relacion_paciente_inactivo: () =>
    errores.conflicto(
      'Solo se vinculan pacientes activos. Reactivá al paciente inactivo antes de vincularlo.',
    ),
  relacion_tipo_sexo: tipoSexo,
  relacion_espejo_inconsistente: () =>
    errores.conflicto(
      'Ese vínculo no coincide con el que ya está cargado en la ficha del familiar. Revisalo ahí o quitalo antes de cargar este.',
    ),
  relacion_marca_un_sentido: () =>
    errores.datosInvalidos(
      'Tutor legal y responsable de pago van en un solo sentido: marcá quién es tutor (o quién paga) de quién, no los dos. Si querés pasar la marca al otro lado, quitala de este en el mismo cambio.',
    ),
  relacion_dada_de_baja: () =>
    errores.conflicto(
      'Ese vínculo ya se quitó. Para volver a vincularlos, cargá un vínculo nuevo.',
    ),
  relacion_no_encontrada: () =>
    errores.noEncontrado(
      'No encontramos ese vínculo. Puede que ya se haya quitado: recargá la ficha del paciente.',
    ),
  alerta_no_encontrada: () =>
    errores.noEncontrado('No encontramos esa alerta. Recargá la ficha del paciente.'),
  // Desde 0025 el cursor es opaco: uno que no se puede leer vino adulterado o cortado.
  cursor_invalido: () =>
    campo(
      'cursor',
      'No pudimos seguir la lista de pacientes desde ese punto. Volvé a cargarla desde el principio.',
      'Volvé a cargar la lista desde el principio.',
    ),
  pacientes_limite: () =>
    campo('limite', 'Pedí entre 1 y 100 pacientes por página.', 'Entre 1 y 100.'),
  pacientes_filtro: () =>
    campo(
      'filtro',
      'Elegí un filtro válido: todos, pediátricos, con alerta o inactivos.',
      'Elegí uno de los filtros de la lista.',
    ),
};

/** Restricciones reales (CHECK, únicos y FK) de las tablas de pacientes con mensaje propio. */
export const MENSAJES_PACIENTES_COLUMNAS: Record<string, () => ErrorApi> = {
  // paciente
  paciente_nombres_check: () =>
    campo('nombres', 'Poné el nombre del paciente (de 2 a 80 letras).', 'De 2 a 80 letras.'),
  paciente_apellidos_check: () =>
    campo(
      'apellidos',
      'Los apellidos pueden tener hasta 80 letras. Revisalos.',
      'Hasta 80 letras.',
    ),
  paciente_ci_check: () =>
    campo(
      'ci',
      'La cédula va con 5 a 9 números. Revisala o dejala vacía si el paciente no tiene.',
      'De 5 a 9 números.',
    ),
  paciente_ruc_check: () =>
    campo(
      'ruc',
      'Revisá el RUC: va con guion y su dígito verificador, por ejemplo 80012345-6.',
      'Con guion y dígito verificador.',
    ),
  paciente_fecha_nac_check: () =>
    campo(
      'fechaNac',
      'La fecha de nacimiento tiene que ser desde 1900. Revisá el año.',
      'Desde 1900.',
    ),
  paciente_sexo_check: () => campo('sexo', 'Elegí el sexo: F o M, o dejalo sin cargar.'),
  paciente_telefono_check: () =>
    campo(
      'telefono',
      'Escribí un teléfono válido, por ejemplo 0981 123 456 (de otro país, con + y el código).',
      'Por ejemplo 0981 123 456.',
    ),
  paciente_email_check: () =>
    campo('email', 'Escribí un correo válido, por ejemplo nombre@correo.com.', 'Revisá el correo.'),
  paciente_ciudad_check: () =>
    campo('ciudad', 'La ciudad puede tener hasta 80 letras. Revisala.', 'Hasta 80 letras.'),
  paciente_direccion_check: () =>
    campo('direccion', 'La dirección puede tener hasta 200 letras. Resumila.', 'Hasta 200 letras.'),
  paciente_idioma_check: () => campo('idioma', 'Elegí el idioma: español o guaraní.'),
  paciente_origen_check: () =>
    errores.datosInvalidos(
      'El origen del paciente no es válido. Recargá la página y probá de nuevo.',
    ),
  paciente_motivo_baja_check: () =>
    campo(
      'motivo',
      'El motivo puede tener hasta 500 caracteres. Resumilo.',
      'Hasta 500 caracteres.',
    ),

  // paciente_relacion
  paciente_relacion_tipo_check: () =>
    campo('tipo', 'Elegí el vínculo de la lista (madre, padre, hijo, hermano…).'),
  paciente_relacion_consigo_mismo: () =>
    campo(
      'familiarId',
      'Un paciente no se puede vincular consigo mismo. Elegí a otro paciente.',
      'Elegí a otro paciente.',
    ),
  paciente_relacion_motivo_baja_check: () =>
    campo(
      'motivo',
      'El motivo puede tener hasta 500 caracteres. Resumilo.',
      'Hasta 500 caracteres.',
    ),
  paciente_relacion_par_activo: () =>
    errores.conflicto(
      'Esos dos pacientes ya están vinculados. Si querés cambiar el vínculo, quitá el actual y cargá uno nuevo.',
    ),
  paciente_relacion_paciente_fkey: pacienteNoEncontrado,
  paciente_relacion_familiar_fkey: () =>
    errores.noEncontrado(
      'No encontramos a ese familiar entre los pacientes de la clínica. Buscalo de nuevo.',
    ),

  // paciente_alerta y paciente_nota
  paciente_alerta_tipo_check: () =>
    campo(
      'tipo',
      'Elegí el tipo de alerta: alergia o condición (embarazo, anticoagulantes, diabetes…).',
      'Alergia o condición.',
    ),
  paciente_alerta_texto_check: () =>
    campo(
      'texto',
      'La alerta va de 3 a 200 caracteres. Escribila de nuevo.',
      'De 3 a 200 caracteres.',
    ),
  paciente_alerta_paciente_fkey: pacienteNoEncontrado,
  paciente_nota_texto_check: () =>
    campo(
      'notaInterna',
      'La nota interna puede tener hasta 2000 caracteres. Resumila.',
      'Hasta 2000 caracteres.',
    ),
  paciente_nota_paciente_fkey: pacienteNoEncontrado,
};
