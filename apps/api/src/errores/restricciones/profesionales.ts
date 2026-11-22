import { errores, type ErrorApi } from '../error-api.js';

/**
 * Mensajes para las restricciones de la base del módulo profesionales (nombre en `constraint`).
 * Cada una con el código del contrato y un mensaje en voseo que dice qué hacer.
 *
 * La API valida antes casi todo (con mensajes que dicen qué tramo choca); estas traducciones cubren
 * lo que solo la base puede ver, como dos guardados simultáneos.
 */
export const MENSAJES_PROFESIONALES: Record<string, () => ErrorApi> = {
  profesional_disponibilidad_superpuesta: () =>
    errores.conflicto(
      'Ese profesional ya tiene guardado un tramo que se superpone con uno de los nuevos (puede ser en otra sede): quizás otra persona cambió su disponibilidad recién. Recargá la disponibilidad, revisala y guardá de nuevo.',
    ),
  profesional_disponibilidad_sillon_fkey: () =>
    errores.datosInvalidos(
      'El sillón elegido no es de la sede de ese tramo. Elegí un sillón de esa sede o dejalo sin sillón.',
    ),
  profesional_disponibilidad_sede_fkey: () =>
    errores.conflicto(
      'Una de las sedes elegidas no está disponible en esta clínica. Recargá la página y elegí de nuevo.',
    ),
  profesional_disponibilidad_profesional_fkey: () =>
    errores.noEncontrado('No encontramos ese profesional. Volvé a la lista y probá de nuevo.'),
  profesional_disponibilidad_dia_check: () =>
    errores.datosInvalidos('El día de la semana va de 0 (domingo) a 6 (sábado).'),
  profesional_disponibilidad_rango_check: () =>
    errores.datosInvalidos('En cada tramo, la hora de fin tiene que ser posterior a la de inicio.'),
  profesional_membresia_fkey: () =>
    errores.conflicto(
      'La persona del equipo elegida no está disponible en esta clínica. Recargá la página y elegí de nuevo.',
    ),
  profesional_membresia_key: () =>
    errores.conflicto(
      'Esa persona del equipo ya tiene un profesional asociado. Editá ese profesional o elegí otra persona.',
    ),
  profesional_nombre_check: () => errores.datosInvalidos('Poné el nombre del profesional.'),
  profesional_color_check: () =>
    errores.datosInvalidos('Elegí un color válido (por ejemplo, #1A7F5A).'),
  profesional_bloqueo_profesional_fkey: () =>
    errores.noEncontrado('No encontramos ese profesional. Volvé a la lista y probá de nuevo.'),
  profesional_bloqueo_rango_check: () =>
    errores.datosInvalidos('El fin del bloqueo tiene que ser posterior al inicio.'),
  profesional_bloqueo_motivo_check: () =>
    errores.datosInvalidos('Contanos el motivo del bloqueo (vacaciones, congreso…).'),
  profesional_bloqueo_baja_check: () =>
    errores.datosInvalidos('Contanos el motivo para quitar el bloqueo.'),
};
