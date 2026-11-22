/**
 * Guard global (APP_GUARD). Para cada pedido:
 *   ruta sin declaración de acceso → 403 (negar por defecto)
 *   pública → pasa
 *   resto → JWT (con `session_id`) → límite de pedidos por usuario →
 *     cierre de sesión: solo la identidad (sin clínica, sin membresía, con aal1)
 *     resto: clínica, membresía, sesión y doble factor (`ResolvedorContexto`) → permiso
 *     (en las rutas `archivo`, el permiso lo exige el handler: ver acceso-archivo.ts)
 * y deja el `ContextoPedido` disponible para `@Ctx()` (o la identidad para `@Identidad()`).
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CABECERA_CLINICA } from '@conecta/shared';
import type { Request } from 'express';
import { VERIFICADOR_JWT, tokenDeCabecera, type VerificadorJwt } from '../auth/verificador-jwt.js';
import { CONFIG, type Config } from '../config.js';
import { ContadorPorMinuto } from '../comun/limite-pedidos.js';
import { ipDe, idPedidoDe } from '../comun/pedido.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import { errores } from '../errores/error-api.js';
import { ACCESO, type Acceso } from './acceso.js';
import { AccesoPorCategoria, fijarAccesoArchivo } from './acceso-archivo.js';
import { fijarContexto, fijarIdentidad, tienePermiso } from './contexto-pedido.js';
import { mensajeSinPermiso } from './mensajes.js';
import { ResolvedorContexto } from './resolvedor-contexto.js';

@Injectable()
export class GuardContexto implements CanActivate {
  private readonly limitePorUsuario: ContadorPorMinuto;

  constructor(
    private readonly reflector: Reflector,
    @Inject(VERIFICADOR_JWT) private readonly verificador: VerificadorJwt,
    private readonly resolvedor: ResolvedorContexto,
    @Inject(REGISTRO) private readonly registro: Registro,
    @Inject(CONFIG) config: Config,
  ) {
    this.limitePorUsuario = new ContadorPorMinuto(config.limitePedidosPorUsuario);
  }

  async canActivate(ejecucion: ExecutionContext): Promise<boolean> {
    if (ejecucion.getType() !== 'http') return false;
    const req = ejecucion.switchToHttp().getRequest<Request>();

    const acceso = this.reflector.getAllAndOverride<Acceso | undefined>(ACCESO, [
      ejecucion.getHandler(),
      ejecucion.getClass(),
    ]);
    if (!acceso) {
      this.registro.error('ruta_sin_acceso_declarado', {
        pedido: idPedidoDe(req),
        handler: `${ejecucion.getClass().name}.${ejecucion.getHandler().name}`,
      });
      throw errores.sinPermiso('Esta acción no está habilitada. Avisá a soporte.');
    }
    if (acceso.tipo === 'publica') return true;

    const identidad = await this.verificador.verificar(tokenDeCabecera(req.headers.authorization));
    // Antes de tocar la base: quien manda demasiados pedidos no llega a abrir transacciones.
    this.limitePorUsuario.exigir(identidad.usuarioId);

    if (acceso.tipo === 'cierre') {
      fijarIdentidad(req, identidad);
      return true;
    }

    const contexto = await this.resolvedor.resolver(
      identidad,
      req.headers[CABECERA_CLINICA],
      ipDe(req),
      { toleraSinClinica: acceso.tipo === 'sesion' },
    );

    if (acceso.tipo === 'permiso' && !tienePermiso(contexto, acceso.modulo, acceso.accion)) {
      throw errores.sinPermiso(mensajeSinPermiso(acceso.modulo, acceso.accion));
    }

    // Archivos: el permiso lo exige el handler según la categoría (ver acceso-archivo.ts); hasta
    // entonces no hay ContextoPedido para @Ctx().
    if (acceso.tipo === 'archivo') {
      fijarAccesoArchivo(req, new AccesoPorCategoria(contexto));
      return true;
    }

    fijarContexto(req, contexto);
    return true;
  }
}
