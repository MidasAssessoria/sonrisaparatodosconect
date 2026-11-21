/**
 * Acceso de tipo `archivo` (`@PermisoDeArchivo()`): el guard comprueba sesión, clínica y membresía,
 * pero el permiso depende de la categoría del archivo, que se conoce recién en el handler (viene en
 * el cuerpo al subir, o en la fila de la base al pedir la URL). Negar por defecto se mantiene así:
 *
 *   1. El guard NO deja el `ContextoPedido` para `@Ctx()`: deja un `AccesoPorCategoria`
 *      (`@AccesoArchivo()`). El contexto completo (el que pide `ServicioBd.enContexto` para escribir
 *      y el que lleva los permisos y sedes) solo sale de `exigir()`, que comprueba el permiso
 *      `<modulo de la categoría>:<accion>` y la sede.
 *   2. Antes de exigir, el handler solo tiene `contextoLectura` para LEER la categoría de un
 *      archivo pedido, y solo en una transacción de solo lectura (`ServicioBd.enLectura`): no puede
 *      escribir nada, ni la auditoría. Tampoco le alcanza para responder: `InterceptorAccesoArchivo`
 *      cambia por un 500 cualquier respuesta de una ruta `archivo` que no haya pasado por `exigir()`.
 */
import {
  createParamDecorator,
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CATEGORIAS_ARCHIVO, type CategoriaArchivo } from '@conecta/shared';
import { map, type Observable } from 'rxjs';
import { ContextoLectura } from '../base/servicio-bd.js';
import { idPedidoDe } from '../comun/pedido.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import { errores } from '../errores/error-api.js';
import { ACCESO, type Acceso } from './acceso.js';
import { exigirSede, tienePermiso, type ContextoPedido } from './contexto-pedido.js';
import { mensajeSinPermiso } from './mensajes.js';

export type AccionArchivo = 'crear' | 'ver';

export class AccesoPorCategoria {
  readonly #contexto: ContextoPedido;
  #verificado = false;

  constructor(contexto: ContextoPedido) {
    this.#contexto = contexto;
  }

  /**
   * Clínica (de una membresía activa verificada), usuario e IP del pedido, solo para
   * `ServicioBd.enLectura` (transacción de solo lectura): sirve para leer la categoría del archivo
   * pedido antes de exigir el permiso; no para escribir ni para responder (ver arriba).
   */
  get contextoLectura(): ContextoLectura {
    const { clinicaId, usuarioId, ip } = this.#contexto;
    return new ContextoLectura({ clinicaId, usuarioId, ip });
  }

  /** `true` después de un `exigir()` que pasó. */
  get verificado(): boolean {
    return this.#verificado;
  }

  /**
   * Exige `<modulo de la categoría>:<accion>` y, si el archivo tiene sede, poder operar en ella.
   * Lanza `sin_permiso` / `sede_no_permitida`; si pasa, devuelve el contexto completo del pedido.
   */
  exigir(
    categoria: CategoriaArchivo,
    accion: AccionArchivo,
    sedeId: string | null = null,
  ): ContextoPedido {
    const modulo = CATEGORIAS_ARCHIVO[categoria].modulo;
    if (!tienePermiso(this.#contexto, modulo, accion)) {
      throw errores.sinPermiso(mensajeSinPermiso(modulo, accion));
    }
    if (sedeId !== null) exigirSede(this.#contexto, sedeId);
    this.#verificado = true;
    return this.#contexto;
  }
}

const accesos = new WeakMap<object, AccesoPorCategoria>();

export function fijarAccesoArchivo(req: object, acceso: AccesoPorCategoria): void {
  accesos.set(req, acceso);
}

export function accesoArchivoDe(req: object): AccesoPorCategoria | undefined {
  return accesos.get(req);
}

/** `@AccesoArchivo() acceso: AccesoPorCategoria` en un handler con `@PermisoDeArchivo()`. */
export const AccesoArchivo = createParamDecorator((_dato: unknown, ejecucion: ExecutionContext) => {
  const acceso = accesos.get(ejecucion.switchToHttp().getRequest<object>());
  // Solo pasa si una ruta que no es `archivo` lo pide: es un error de programación.
  if (!acceso) throw errores.interno();
  return acceso;
});

/** Interceptor global: una ruta `archivo` no responde si su handler no exigió el permiso. */
@Injectable()
export class InterceptorAccesoArchivo implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REGISTRO) private readonly registro: Registro,
  ) {}

  intercept(ejecucion: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const acceso = this.reflector.getAllAndOverride<Acceso | undefined>(ACCESO, [
      ejecucion.getHandler(),
      ejecucion.getClass(),
    ]);
    if (ejecucion.getType() !== 'http' || acceso?.tipo !== 'archivo') return siguiente.handle();
    const req = ejecucion.switchToHttp().getRequest<object>();
    return siguiente.handle().pipe(
      map((valor: unknown) => {
        if (accesoArchivoDe(req)?.verificado !== true) {
          this.registro.error('archivo_sin_permiso_verificado', {
            pedido: idPedidoDe(req),
            handler: `${ejecucion.getClass().name}.${ejecucion.getHandler().name}`,
          });
          throw errores.interno();
        }
        return valor;
      }),
    );
  }
}
