/**
 * Límite de pedidos propio de las rutas públicas de invitación (`consultar` y `aceptar`): por IP y
 * por ruta, más estricto que el límite general por IP del middleware (que sigue aplicándose antes).
 * Un token tiene 256 bits y no se adivina, pero estas rutas no tienen usuario que limitar y
 * consultan la Admin API de Supabase (que tiene sus propios límites): no se las deja martillar.
 *
 * El contador es el mismo de `comun/limite-pedidos.ts` (ventana fija de un minuto, en memoria, por
 * instancia de la API).
 */
import { Inject, Injectable } from '@nestjs/common';
import { ContadorPorMinuto } from '../comun/limite-pedidos.js';

/** Pedidos por minuto, por IP y por ruta. Las pruebas lo reemplazan. */
export const LIMITE_INVITACIONES_POR_MINUTO = Symbol('LIMITE_INVITACIONES_POR_MINUTO');
export const LIMITE_INVITACIONES_PREDETERMINADO = 20;

export type RutaPublicaInvitacion = 'consultar' | 'aceptar';

@Injectable()
export class LimiteInvitaciones {
  private readonly contador: ContadorPorMinuto;

  constructor(@Inject(LIMITE_INVITACIONES_POR_MINUTO) porMinuto: number) {
    this.contador = new ContadorPorMinuto(porMinuto);
  }

  /** Lanza `demasiados_pedidos` (429 con `Retry-After`) si esa IP se pasó en esa ruta. */
  exigir(ruta: RutaPublicaInvitacion, ip: string | null): void {
    this.contador.exigir(`${ruta}:${ip ?? 'desconocida'}`);
  }
}
