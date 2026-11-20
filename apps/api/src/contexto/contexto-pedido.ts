import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Accion, EstadoSede, Modulo, Permiso } from '@conecta/shared';
import type { ContextoBd } from '../base/servicio-bd.js';
import type { IdentidadToken, NivelAutenticacion } from '../auth/verificador-jwt.js';
import { errores } from '../errores/error-api.js';

export interface SedeVisible {
  id: string;
  nombre: string;
  estado: EstadoSede;
  color: string | null;
}

/** Lo que el guard deja resuelto para cada pedido con sesión. */
export interface ContextoPedido extends ContextoBd {
  membresiaId: string;
  /** `session_id` del token (sesión ya tocada en este pedido). */
  sesionId: string;
  /**
   * Nivel efectivo: aal2 solo si el token es aal2 y es posterior a la última baja del doble factor.
   */
  nivel: NivelAutenticacion;
  /** `email` es texto tal como está guardado (no se revalida como correo). */
  usuario: { id: string; nombre: string; email: string; mfaActivo: boolean };
  clinica: { id: string; nombre: string; zonaHoraria: string };
  /** Clínicas con membresía activa, de la más antigua a la más nueva. */
  clinicas: { id: string; nombre: string }[];
  rol: { id: string; codigo: string; nombre: string; exigeMfa: boolean };
  permisos: Permiso[];
  /** Dato del rol (`rol.todas_las_sedes`): ve todas las sedes de la clínica. */
  todasLasSedes: boolean;
  /** Dato del rol (`rol.inactividad_min`). */
  inactividadMin: number;
  /** Sedes (no dadas de baja) que puede ver. */
  sedes: SedeVisible[];
  sedesPermitidas: string[];
  sedeDefectoId: string | null;
  /** Contrato: puede usar «Todas las sedes» en el selector (ve más de una). */
  puedeVerTodasLasSedes: boolean;
}

const contextos = new WeakMap<object, ContextoPedido>();
const identidades = new WeakMap<object, IdentidadToken>();

export function fijarContexto(req: object, contexto: ContextoPedido): void {
  contextos.set(req, contexto);
}

export function contextoDe(req: object): ContextoPedido {
  const contexto = contextos.get(req);
  // Solo pasa si una ruta pública pide el contexto: es un error de programación.
  if (!contexto) throw errores.interno();
  return contexto;
}

/** Para `@CierreSesion()`: solo la identidad verificada del token. */
export function fijarIdentidad(req: object, identidad: IdentidadToken): void {
  identidades.set(req, identidad);
}

/** `@Ctx() ctx: ContextoPedido` en un handler con sesión. */
export const Ctx = createParamDecorator((_dato: unknown, ejecucion: ExecutionContext) =>
  contextoDe(ejecucion.switchToHttp().getRequest<object>()),
);

/** `@Identidad() identidad: IdentidadToken` en el handler de `@CierreSesion()`. */
export const Identidad = createParamDecorator((_dato: unknown, ejecucion: ExecutionContext) => {
  const identidad = identidades.get(ejecucion.switchToHttp().getRequest<object>());
  if (!identidad) throw errores.interno();
  return identidad;
});

export function tienePermiso(contexto: ContextoPedido, modulo: Modulo, accion: Accion): boolean {
  return contexto.permisos.some((p) => p.modulo === modulo && p.accion === accion);
}

/** Lanza `sede_no_permitida` si el usuario no puede operar sobre la sede. */
export function exigirSede(contexto: ContextoPedido, sedeId: string): void {
  if (contexto.todasLasSedes) return;
  if (!contexto.sedesPermitidas.includes(sedeId)) throw errores.sedeNoPermitida();
}
