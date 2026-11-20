/**
 * Datos asociados a cada pedido HTTP (id de pedido para los logs). Se guardan en un WeakMap para no
 * extender los tipos de Express ni dejar propiedades sueltas en el objeto del pedido.
 */
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

const ids = new WeakMap<object, string>();

const PATRON_ID_PEDIDO = /^[A-Za-z0-9._-]{8,64}$/;

/** Toma el `X-Request-Id` entrante si es seguro de registrar; si no, genera uno. */
export function asignarIdPedido(req: Request): string {
  const entrante = req.headers['x-request-id'];
  const id =
    typeof entrante === 'string' && PATRON_ID_PEDIDO.test(entrante) ? entrante : randomUUID();
  ids.set(req, id);
  return id;
}

export function idPedidoDe(req: object): string | null {
  return ids.get(req) ?? null;
}

/**
 * IP del cliente. Express solo mira X-Forwarded-For si `trust proxy` está activo (TRUST_PROXY).
 * Un valor que no es una IP (cabecera manipulada) se descarta.
 */
export function ipDe(req: Request): string | null {
  const ip = req.ip ?? req.socket.remoteAddress ?? null;
  return ip && isIP(ip) !== 0 ? ip : null;
}
