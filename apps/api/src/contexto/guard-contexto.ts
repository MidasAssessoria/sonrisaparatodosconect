/**
 * Guard global (APP_GUARD). Para cada pedido:
 *   ruta sin declaración de acceso → 403 (negar por defecto)
 *   pública → pasa
 *   resto → JWT → clínica y membresía (`ResolvedorContexto`) → doble factor → permiso
 * y deja el `ContextoPedido` disponible para `@Ctx()`.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CABECERA_CLINICA, type Accion, type Modulo } from '@conecta/shared';
import type { Request } from 'express';
import { VERIFICADOR_JWT, tokenDeCabecera, type VerificadorJwt } from '../auth/verificador-jwt.js';
import { ipDe, idPedidoDe } from '../comun/pedido.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import { errores } from '../errores/error-api.js';
import { ACCESO, type Acceso } from './acceso.js';
import { fijarContexto, tienePermiso } from './contexto-pedido.js';
import { ResolvedorContexto } from './resolvedor-contexto.js';

const NOMBRE_MODULO: Record<Modulo, string> = {
  inicio: 'Inicio',
  agenda: 'Agenda',
  pacientes: 'Pacientes',
  ficha_clinica: 'Ficha clínica',
  presupuestos: 'Presupuestos',
  caja: 'Caja',
  contabilidad: 'Contabilidad',
  reportes: 'Reportes',
  personal: 'Personal',
  inventario: 'Inventario',
  mensajeria: 'Mensajería',
  sedes: 'Sedes',
  auditoria: 'Auditoría',
  configuracion: 'Configuración',
};

const VERBO_ACCION: Record<Accion, string> = {
  ver: 'ver',
  crear: 'crear',
  editar: 'editar',
  anular: 'dar de baja',
  exportar: 'exportar',
};

@Injectable()
export class GuardContexto implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(VERIFICADOR_JWT) private readonly verificador: VerificadorJwt,
    private readonly resolvedor: ResolvedorContexto,
    @Inject(REGISTRO) private readonly registro: Registro,
  ) {}

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
    const contexto = await this.resolvedor.resolver(
      identidad,
      req.headers[CABECERA_CLINICA],
      ipDe(req),
      { toleraSinClinica: acceso.tipo === 'sesion' },
    );

    if (acceso.tipo !== 'sesion' && contexto.usuario.mfaActivo && contexto.nivel !== 'aal2') {
      throw errores.mfaRequerido();
    }

    if (acceso.tipo === 'permiso' && !tienePermiso(contexto, acceso.modulo, acceso.accion)) {
      throw errores.sinPermiso(
        `Tu rol no tiene permiso para ${VERBO_ACCION[acceso.accion]} en ${NOMBRE_MODULO[acceso.modulo]}. ` +
          'Pedile acceso a quien administra la clínica.',
      );
    }

    fijarContexto(req, contexto);
    return true;
  }
}
