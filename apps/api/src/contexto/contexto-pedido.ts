import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Accion, EstadoSede, Modulo, Permiso } from '@conecta/shared';
import type { ContextoBd } from '../base/servicio-bd.js';
import type { NivelAutenticacion } from '../auth/verificador-jwt.js';
import { errores } from '../errores/error-api.js';

/**
 * Roles que ven todas las sedes de la clínica (también las que se creen después). El resto ve las
 * de `usuario_sede` más su sede por defecto.
 */
export const ROLES_TODAS_LAS_SEDES: readonly string[] = ['dueno', 'administracion'];

/** Roles a los que se les pide activar el doble factor. */
export const ROLES_CON_MFA: readonly string[] = ['dueno', 'administracion'];

/** Minutos de inactividad antes de que la web cierre la sesión, por código de rol. */
export const INACTIVIDAD_MIN_POR_ROL: Readonly<Record<string, number>> = { recepcion: 15 };
export const INACTIVIDAD_MIN_PREDETERMINADA = 30;

export interface SedeVisible {
  id: string;
  nombre: string;
  estado: EstadoSede;
  color: string | null;
}

/** Lo que el guard deja resuelto para cada pedido con sesión. */
export interface ContextoPedido extends ContextoBd {
  membresiaId: string;
  nivel: NivelAutenticacion;
  usuario: { id: string; nombre: string; email: string; mfaActivo: boolean };
  clinica: { id: string; nombre: string; zonaHoraria: string };
  /** Clínicas con membresía activa, de la más antigua a la más nueva. */
  clinicas: { id: string; nombre: string }[];
  rol: { id: string; codigo: string; nombre: string };
  permisos: Permiso[];
  /** El rol ve todas las sedes de la clínica (dueno, administracion). */
  todasLasSedes: boolean;
  /** Sedes (no dadas de baja) que puede ver. */
  sedes: SedeVisible[];
  sedesPermitidas: string[];
  sedeDefectoId: string | null;
  /** Contrato: puede usar «Todas las sedes» en el selector (ve más de una). */
  puedeVerTodasLasSedes: boolean;
}

const contextos = new WeakMap<object, ContextoPedido>();

export function fijarContexto(req: object, contexto: ContextoPedido): void {
  contextos.set(req, contexto);
}

export function contextoDe(req: object): ContextoPedido {
  const contexto = contextos.get(req);
  // Solo pasa si una ruta pública pide el contexto: es un error de programación.
  if (!contexto) throw errores.interno();
  return contexto;
}

/** `@Ctx() ctx: ContextoPedido` en un handler con sesión. */
export const Ctx = createParamDecorator((_dato: unknown, ejecucion: ExecutionContext) =>
  contextoDe(ejecucion.switchToHttp().getRequest<object>()),
);

export function tienePermiso(contexto: ContextoPedido, modulo: Modulo, accion: Accion): boolean {
  return contexto.permisos.some((p) => p.modulo === modulo && p.accion === accion);
}

/** Lanza `sede_no_permitida` si el usuario no puede operar sobre la sede. */
export function exigirSede(contexto: ContextoPedido, sedeId: string): void {
  if (contexto.todasLasSedes) return;
  if (!contexto.sedesPermitidas.includes(sedeId)) throw errores.sedeNoPermitida();
}
