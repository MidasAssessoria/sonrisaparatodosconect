import { errores, type ErrorApi } from '../error-api.js';

/**
 * Mensajes para las restricciones de la base del módulo catalogos (nombre en `constraint`).
 * Cada una con el código del contrato y un mensaje en voseo que dice qué hacer.
 */
export const MENSAJES_CATALOGOS: Record<string, () => ErrorApi> = {
  tratamiento_nombre_unico: () =>
    errores.conflicto(
      'Ya hay un tratamiento activo con ese nombre (sin contar mayúsculas, tildes ni espacios). Elegí otro nombre o desactivá el otro primero.',
    ),
  tratamiento_nombre_check: () => errores.datosInvalidos('Poné el nombre del tratamiento.'),
  tratamiento_precio_check: () =>
    errores.datosInvalidos('El precio va en guaraníes enteros y no puede ser negativo.'),
  tratamiento_iva_check: () =>
    errores.datosInvalidos('Elegí una tasa de IVA válida: 10, 5 o 0 (exento).'),
  tratamiento_duracion_check: () =>
    errores.datosInvalidos('La duración va de 5 a 480 minutos, en pasos de 5.'),
  agenda_config_sede_key: () =>
    errores.conflicto(
      'Otra persona guardó la configuración de agenda de esta sede recién. Recargá la página y probá de nuevo.',
    ),
  agenda_config_sede_fkey: () =>
    errores.noEncontrado(
      'No encontramos esa sede. Puede que se haya dado de baja: volvé a la lista.',
    ),
  agenda_config_anticipacion_check: () =>
    errores.datosInvalidos('La anticipación mínima va de 0 a 2880 minutos (dos días).'),
  agenda_config_dias_adelante_check: () =>
    errores.datosInvalidos('Se puede reservar online de 1 a 90 días adelante.'),
};
