import type { RestriccionCola } from '@conecta/db';
import { errores, type ErrorApi } from '../error-api.js';

/**
 * Reglas de `app.encolar` (0018). La API encola dentro de la transacción del pedido, con contexto y
 * con datos que arma ella: si una de estas salta es un error nuestro (se registra, ver
 * `RESTRICCIONES_INESPERADAS` en traducir.ts), pero el mensaje igual dice qué hacer. El cambio que
 * pedía el trabajo se revierte con él.
 */
const noSePudoProgramar = (): ErrorApi =>
  errores.conflicto(
    'No pudimos terminar de guardar el cambio. Probá de nuevo en un momento; si sigue pasando, avisá a soporte.',
  );

export const MENSAJES_COLA: Record<RestriccionCola, () => ErrorApi> = {
  cola_sin_contexto: noSePudoProgramar,
  cola_no_permitida: noSePudoProgramar,
  cola_datos_invalidos: noSePudoProgramar,
};
