import type { ErrorApi } from '../error-api.js';

/**
 * Mensajes para las restricciones de la base del módulo personal (nombre en `constraint`).
 * Cada una con el código del contrato y un mensaje en voseo que dice qué hacer.
 */
export const MENSAJES_PERSONAL: Record<string, () => ErrorApi> = {};
