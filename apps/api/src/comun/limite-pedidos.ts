/**
 * Límite de pedidos con ventana fija de un minuto, en memoria (una instancia de la API). Se aplica
 * dos veces: por IP a todo pedido (middleware, antes de verificar nada) y por usuario autenticado
 * (en el guard, después de verificar el token y antes de tocar la base). El límite por usuario es
 * el que importa en una clínica donde todo el personal sale a internet por la misma IP.
 * Con varias instancias detrás de un balanceador, cada una cuenta por separado.
 */
import type { NextFunction, Request, Response } from 'express';
import { errores } from '../errores/error-api.js';
import { traducirError } from '../errores/traducir.js';
import { ipDe } from './pedido.js';

const VENTANA_MS = 60_000;

interface Cuenta {
  inicio: number;
  pedidos: number;
}

/** Contador por clave con ventana fija de un minuto. */
export class ContadorPorMinuto {
  private readonly cuentas = new Map<string, Cuenta>();
  private ultimaLimpieza: number;

  constructor(
    private readonly porMinuto: number,
    private readonly ahora: () => number = Date.now,
  ) {
    this.ultimaLimpieza = ahora();
  }

  /** Cuenta un pedido. Devuelve `null` si entra, o los segundos que hay que esperar si no. */
  contar(clave: string): number | null {
    const momento = this.ahora();
    if (momento - this.ultimaLimpieza > VENTANA_MS) {
      for (const [c, cuenta] of this.cuentas) {
        if (momento - cuenta.inicio >= VENTANA_MS) this.cuentas.delete(c);
      }
      this.ultimaLimpieza = momento;
    }
    let cuenta = this.cuentas.get(clave);
    if (!cuenta || momento - cuenta.inicio >= VENTANA_MS) {
      cuenta = { inicio: momento, pedidos: 0 };
      this.cuentas.set(clave, cuenta);
    }
    cuenta.pedidos++;
    if (cuenta.pedidos <= this.porMinuto) return null;
    return Math.max(1, Math.ceil((cuenta.inicio + VENTANA_MS - momento) / 1000));
  }

  /** Lanza `demasiados_pedidos` (429 con `Retry-After`) si la clave se pasó del límite. */
  exigir(clave: string): void {
    const espera = this.contar(clave);
    if (espera !== null) throw errores.demasiadosPedidos(espera);
  }
}

export interface OpcionesLimite {
  porMinuto: number;
  /** Rutas que no cuentan (p. ej. el chequeo de salud del orquestador). */
  excluir?: (req: Request) => boolean;
  ahora?: () => number;
}

/** Middleware de límite por IP. */
export function limitePedidos(opciones: OpcionesLimite) {
  const contador = new ContadorPorMinuto(opciones.porMinuto, opciones.ahora);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (opciones.excluir?.(req)) {
      next();
      return;
    }
    const espera = contador.contar(ipDe(req) ?? 'desconocida');
    if (espera === null) {
      next();
      return;
    }
    const traducido = traducirError(errores.demasiadosPedidos(espera));
    for (const [nombre, valor] of Object.entries(traducido.cabeceras ?? {})) {
      res.setHeader(nombre, valor);
    }
    res.status(traducido.estado).json(traducido.cuerpo);
  };
}
