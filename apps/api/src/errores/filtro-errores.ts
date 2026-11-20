import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { idPedidoDe } from '../comun/pedido.js';
import type { Registro } from '../comun/registro.js';
import { traducirError } from './traducir.js';

function responder(registro: Registro, error: unknown, req: Request, res: Response): void {
  const traducido = traducirError(error);
  if (traducido.registrar) {
    registro.error('error_inesperado', {
      pedido: idPedidoDe(req),
      estado: traducido.estado,
      ...traducido.registrar,
    });
  }
  if (res.headersSent) return;
  for (const [nombre, valor] of Object.entries(traducido.cabeceras ?? {})) {
    res.setHeader(nombre, valor);
  }
  res.status(traducido.estado).json(traducido.cuerpo);
}

/** Filtro global: toda respuesta de error tiene la forma de `errorApiSchema`. */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  constructor(private readonly registro: Registro) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    responder(this.registro, error, http.getRequest<Request>(), http.getResponse<Response>());
  }
}

/** Manejador de errores de Express para lo que falla antes de Nest (parsers del cuerpo). */
export function manejadorErroresExpress(registro: Registro) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }
    responder(registro, error, req, res);
  };
}
