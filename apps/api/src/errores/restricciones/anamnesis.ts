import { campoDeError, type CampoDeError, type RestriccionAnamnesis } from '@conecta/db';
import { ErrorApi, errores } from '../error-api.js';

/**
 * Errores de la anamnesis (Sprint 4, migraciones 0028–0030). La base pone el nombre de la regla
 * en `constraint` y el campo del contrato en `column` (`respuestas.<codigo>`, `firmante.ci`,
 * `firmaPng`, `declaracionVeracidad`, `signosVitales.<campo>`, `versionBase`, `preguntas.<codigo>`):
 * se lee con `campoDeError`, nunca del mensaje. Cada validación sale como 400 `datos_invalidos`
 * con un detalle en ese campo, para que la web marque la pregunta o el dato que hay que corregir.
 *
 * `MENSAJES_ANAMNESIS` es la lista exhaustiva de `RESTRICCIONES_ANAMNESIS` (también la usa el
 * traductor global como red). `errorDeAnamnesis` agrega lo que depende del contexto de estas
 * rutas: reglas compartidas con pacientes (`ficha_clinica_sin_permiso`, `cursor_invalido`), el
 * paciente que no existe y los CHECK del catálogo.
 */

/** 409 de `versionBase` vieja: dice qué hacer (texto pedido para el Sprint 4). */
export const MENSAJE_CONFLICTO_VERSION =
  'Alguien guardó otra versión mientras completabas esta. Cargá la versión nueva y revisá tus respuestas.';

/** 409 de `huellaCatalogo` vieja: el cuestionario cambió mientras se completaba. */
export const MENSAJE_CONFLICTO_CATALOGO =
  'El cuestionario cambió mientras lo completabas. Actualizá el cuestionario y revisá las respuestas.';

/** 409 con el campo que distingue los dos conflictos del guardado (contrato). */
const conflictoEn = (campo: string, mensaje: string, detalle: string): ErrorApi =>
  new ErrorApi(409, 'conflicto', mensaje, [{ campo, mensaje: detalle }]);

export const pacienteNoEncontrado = (): ErrorApi =>
  errores.noEncontrado('No encontramos ese paciente. Volvé a la lista y buscalo de nuevo.');

/** 400 con el detalle en el campo que dijo la base (o en `porDefecto` si no dijo ninguno). */
function enCampo(porDefecto: string | null, mensaje: string, detalle: string) {
  return (c: CampoDeError | null): ErrorApi => {
    const campo = c?.campo ?? porDefecto;
    return campo
      ? errores.datosInvalidos(mensaje, [{ campo, mensaje: detalle }])
      : errores.datosInvalidos(mensaje);
  };
}

export const MENSAJES_ANAMNESIS: Record<
  RestriccionAnamnesis,
  (c: CampoDeError | null) => ErrorApi
> = {
  configuracion_sin_permiso: () =>
    errores.sinPermiso(
      'Tu rol no puede editar el cuestionario de la anamnesis. Pedile «editar» en Configuración a quien administra la clínica.',
    ),
  anamnesis_catalogo_invalido: enCampo(
    'preguntas',
    'El cuestionario tiene que tener de 1 a 500 preguntas. Revisalo y guardá de nuevo.',
    'De 1 a 500 preguntas.',
  ),
  anamnesis_pregunta_invalida: enCampo(
    'preguntas',
    'Una pregunta del cuestionario está incompleta. Revisala y guardá de nuevo.',
    'Pregunta incompleta.',
  ),
  anamnesis_pregunta_repetida: enCampo(
    'preguntas',
    'Hay dos preguntas con el mismo código. Cambiá el código de una de las dos.',
    'Código repetido.',
  ),
  anamnesis_conflicto_version: () =>
    conflictoEn('versionBase', MENSAJE_CONFLICTO_VERSION, 'Hay una versión más nueva.'),
  anamnesis_conflicto_catalogo: () =>
    conflictoEn('huellaCatalogo', MENSAJE_CONFLICTO_CATALOGO, 'El cuestionario cambió.'),
  anamnesis_catalogo_lleno: enCampo(
    'preguntas',
    'El cuestionario llegó al máximo de 500 preguntas, contando las inactivas. Reusá una pregunta inactiva en lugar de crear otra.',
    'Hasta 500 preguntas, contando las inactivas.',
  ),
  archivo_firma_en_uso: () =>
    errores.conflicto(
      'Ese archivo es la firma de una anamnesis y no se puede dar de baja: la versión firmada tiene que conservarla.',
    ),
  anamnesis_paciente_inactivo: () =>
    errores.datosInvalidos(
      'Este paciente está inactivo. Reactivá su ficha para cargarle la anamnesis.',
    ),
  anamnesis_pregunta_desconocida: enCampo(
    'respuestas',
    'Una respuesta es de una pregunta que ya no está en el cuestionario. Recargá el formulario y revisá tus respuestas.',
    'Esta pregunta ya no está en el cuestionario.',
  ),
  anamnesis_respuesta_repetida: enCampo(
    'respuestas',
    'Hay dos respuestas para la misma pregunta. Recargá el formulario y respondé de nuevo.',
    'Respondé una sola vez.',
  ),
  anamnesis_respuesta_invalida: enCampo(
    'respuestas',
    'Una respuesta no tiene el formato de su pregunta. Revisala y guardá de nuevo.',
    'Revisá esta respuesta.',
  ),
  anamnesis_opcion_desconocida: enCampo(
    'respuestas',
    'Marcaste una opción que la pregunta ya no tiene. Recargá el formulario y elegí de nuevo.',
    'Elegí una opción de la lista.',
  ),
  anamnesis_numero_fuera_de_rango: enCampo(
    'respuestas',
    'Un número está fuera del rango que acepta la pregunta. Revisalo y guardá de nuevo.',
    'Fuera del rango aceptado.',
  ),
  anamnesis_obligatoria_sin_responder: enCampo(
    'respuestas',
    'Falta responder una pregunta obligatoria. Completala y guardá de nuevo.',
    'Respondé esta pregunta.',
  ),
  anamnesis_pregunta_no_aplica: enCampo(
    'respuestas',
    'La pregunta de embarazo o lactancia no corresponde a este paciente. Dejala sin responder.',
    'No corresponde a este paciente.',
  ),
  anamnesis_firmante_nombre: enCampo(
    'firmante.nombre',
    'Escribí el nombre de quien firma (de 3 a 120 letras).',
    'De 3 a 120 letras.',
  ),
  anamnesis_firmante_ci: enCampo(
    'firmante.ci',
    'La cédula de quien firma va con 5 a 9 números. Revisala.',
    'De 5 a 9 números.',
  ),
  anamnesis_tutor_requerido: enCampo(
    'firmante.esTutor',
    'El paciente es menor de edad: tiene que firmar su tutor o tutora, con nombre y cédula.',
    'Firma el tutor o la tutora.',
  ),
  anamnesis_tutor_sin_ci: enCampo(
    'firmante.ci',
    'Escribí la cédula del tutor o tutora.',
    'Escribí la cédula del tutor o tutora.',
  ),
  anamnesis_sin_firma: enCampo(
    'firmaPng',
    'Falta la firma. Pedile a quien firma que lo haga en la pantalla.',
    'Falta la firma.',
  ),
  anamnesis_firma_invalida: enCampo(
    'firmaPng',
    'La firma no es válida para esta anamnesis: borrala y firmá de nuevo.',
    'Firmá de nuevo.',
  ),
  anamnesis_sin_declaracion: enCampo(
    'declaracionVeracidad',
    'Marcá «Declaro que la información es verdadera» para guardar.',
    'Marcá la declaración.',
  ),
  anamnesis_signos_vitales: enCampo(
    'signosVitales',
    'Un signo vital está fuera de rango. Revisá la presión, el pulso y el peso.',
    'Fuera de rango.',
  ),
  anamnesis_inmutable: () =>
    errores.conflicto(
      'Una anamnesis firmada no se cambia. Para corregirla, guardá una versión nueva con «Actualizar».',
    ),
  historial_limite: enCampo('limite', 'Pedí entre 1 y 100 eventos por página.', 'Entre 1 y 100.'),
};

/** Para el traductor global (red): recibe el error de Postgres tal cual. */
export const MENSAJES_ANAMNESIS_GLOBAL: Record<string, (pg: unknown) => ErrorApi> =
  Object.fromEntries(
    Object.entries(MENSAJES_ANAMNESIS).map(([restriccion, mensaje]) => [
      restriccion,
      (pg: unknown) => mensaje(campoDeError(pg)),
    ]),
  );

/**
 * El `ErrorApi` de un error de la base en las rutas de anamnesis, catálogo e historial, o null si
 * no es uno de los suyos (lo traduce el filtro global).
 */
export function errorDeAnamnesis(error: unknown): ErrorApi | null {
  const c = campoDeError(error);
  if (!c) return null;
  switch (c.restriccion) {
    case 'ficha_clinica_sin_permiso':
      return errores.sinPermiso(
        'Para guardar la anamnesis tu rol tiene que poder ver y cargar la ficha clínica. Pedíselo a un odontólogo o pedile acceso a quien administra la clínica.',
      );
    case 'paciente_no_encontrado':
    case 'archivo_paciente_fkey':
      return pacienteNoEncontrado();
    case 'cursor_invalido':
      return errores.datosInvalidos(
        'No pudimos seguir el historial desde ese punto. Volvé a cargarlo desde el principio.',
        [{ campo: 'cursor', mensaje: 'Volvé a cargar el historial desde el principio.' }],
      );
    default:
      break;
  }
  if (c.restriccion && Object.hasOwn(MENSAJES_ANAMNESIS, c.restriccion)) {
    return MENSAJES_ANAMNESIS[c.restriccion as RestriccionAnamnesis](c);
  }
  // CHECK de la tabla del catálogo al reemplazarlo (column = preguntas.<codigo>).
  if (c.campo?.startsWith('preguntas') && /^(23514|22P02|22001|22003)$/.test(c.codigoPg)) {
    return errores.datosInvalidos(
      'Una pregunta del cuestionario no es válida: revisá su tipo, sus opciones, sus alertas y su rango.',
      [{ campo: c.campo, mensaje: 'Revisá esta pregunta.' }],
    );
  }
  return null;
}
