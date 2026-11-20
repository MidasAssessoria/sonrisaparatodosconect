/**
 * Límite de pedidos por IP con ventana fija de un minuto, en memoria (una instancia de la API).
 * Con varias instancias detrás de un balanceador, cada una cuenta por separado.
 */
import type { NextFunction, Request, Response } from 'express';
import { errores } from '../errores/error-api.js';
import { ipDe } from './pedido.js';

const VENTANA_MS = 60_000;

interface Cuenta {
  inicio: number;
  pedidos: number;
}

export interface OpcionesLimite {
  porMinuto: number;
  /** Rutas que no cuentan (p. ej. el chequeo de salud del orquestador). */
  excluir?: (req: Request) => boolean;
  ahora?: () => number;
}

export function limitePedidos(opciones: OpcionesLimite) {
  const cuentas = new Map<string, Cuenta>();
  const ahora = opciones.ahora ?? Date.now;
  let ultimaLimpieza = ahora();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (opciones.excluir?.(req)) {
      next();
      return;
    }
    const momento = ahora();
    if (momento - ultimaLimpieza > VENTANA_MS) {
      for (const [clave, cuenta] of cuentas) {
        if (momento - cuenta.inicio >= VENTANA_MS) cuentas.delete(clave);
      }
      ultimaLimpieza = momento;
    }

    const clave = ipDe(req) ?? 'desconocida';
    let cuenta = cuentas.get(clave);
    if (!cuenta || momento - cuenta.inicio >= VENTANA_MS) {
      cuenta = { inicio: momento, pedidos: 0 };
      cuentas.set(clave, cuenta);
    }
    cuenta.pedidos++;

    if (cuenta.pedidos > opciones.porMinuto) {
      const espera = Math.max(1, Math.ceil((cuenta.inicio + VENTANA_MS - momento) / 1000));
      res.setHeader('Retry-After', String(espera));
      // El contrato no tiene un código para esto (ver reporte): se usa error_interno con 429.
      const error = errores.interno();
      res.status(429).json({
        ...error.cuerpo(),
        mensaje: `Hiciste demasiados pedidos seguidos. Esperá ${String(espera)} segundos y probá de nuevo.`,
      });
      return;
    }
    next();
  };
}
