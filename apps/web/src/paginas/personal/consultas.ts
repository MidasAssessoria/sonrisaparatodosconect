import type { Persona, Rol, Sesion } from '@conecta/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorConecta, mensajeDeError } from '../../api/errores.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFecha, formatoFechaHora } from '../../utilidades/fechas.js';

export function clavePersonal(clinicaId: string) {
  return ['personal', clinicaId] as const;
}

export function claveRoles(clinicaId: string) {
  return ['roles', clinicaId] as const;
}

export function usePersonal() {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: clavePersonal(sesion.clinica.id),
    queryFn: () => api.personal.listar(),
  });
}

export function useRoles(activa = true) {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: claveRoles(sesion.clinica.id),
    queryFn: () => api.roles.listar(),
    enabled: activa,
  });
}

/**
 * Después de cambiar una persona: la respuesta de la API (la `Persona` actualizada) entra a la
 * caché en el acto; la lista y el conteo de roles se vuelven a pedir por detrás, sin esperar.
 */
export function useActualizarEquipo() {
  const { sesion } = useSesionLista();
  const consultas = useQueryClient();
  return (persona?: Persona): Promise<void> => {
    if (persona) {
      consultas.setQueryData<Persona[]>(clavePersonal(sesion.clinica.id), (lista) =>
        lista?.some((p) => p.membresiaId === persona.membresiaId)
          ? lista.map((p) => (p.membresiaId === persona.membresiaId ? persona : p))
          : lista && [...lista, persona],
      );
    }
    void consultas.invalidateQueries({ queryKey: clavePersonal(sesion.clinica.id) });
    void consultas.invalidateQueries({ queryKey: claveRoles(sesion.clinica.id) });
    return Promise.resolve();
  };
}

/*
 * Límites de quien administra (contrato/personal.ts). La base los impone; la pantalla los refleja
 * para no ofrecer lo que la API va a rechazar:
 *   - nadie da (a un rol o a una persona) permisos que no tiene, incluido «todas las sedes»;
 *   - los roles de sistema solo los edita un dueño; Dueño/a y Administración siempre exigen
 *     doble factor;
 *   - quien no ve todas las sedes solo actúa sobre personas cuyas sedes ve todas.
 * El dueño no tiene límite.
 */

/** Roles que siempre exigen doble factor, sin importar lo que diga el formulario. */
export const ROLES_CON_MFA_FIJO = new Set(['dueno', 'administracion']);

export function esDueno(sesion: Sesion): boolean {
  return sesion.rol.codigo === 'dueno';
}

export interface Limites {
  /** Sin límite (Dueño/a). */
  dueno: boolean;
  /** Permisos de quien actúa, como «modulo:accion». */
  permisos: Set<string>;
  /** Su rol ve todas las sedes (sale de la lista de roles; sin ella, se asume que no). */
  todasLasSedes: boolean;
}

export function limitesDe(sesion: Sesion, roles: Rol[] = []): Limites {
  return {
    dueno: esDueno(sesion),
    permisos: new Set(sesion.permisos.map((p) => `${p.modulo}:${p.accion}`)),
    todasLasSedes: roles.find((r) => r.id === sesion.rol.id)?.todasLasSedes ?? false,
  };
}

/** ¿Quien actúa tiene todo lo que da este rol (permisos y «todas las sedes»)? */
export function rolDentroDeLimites(
  rol: Pick<Rol, 'permisos' | 'todasLasSedes'>,
  l: Limites,
): boolean {
  if (l.dueno) return true;
  if (rol.todasLasSedes && !l.todasLasSedes) return false;
  return rol.permisos.every((p) => l.permisos.has(`${p.modulo}:${p.accion}`));
}

/**
 * Roles que se pueden asignar al invitar o editar: activos, Dueño/a solo si quien asigna es
 * Dueño/a, y ninguno que dé más de lo que tiene quien asigna.
 */
export function rolesAsignables(roles: Rol[], sesion: Sesion): Rol[] {
  const l = limitesDe(sesion, roles);
  return roles.filter(
    (r) => r.activo && (r.codigo !== 'dueno' || l.dueno) && rolDentroDeLimites(r, l),
  );
}

/** ¿Quien actúa ve todas las sedes de esta persona? Si no, no ve acciones sobre ella. */
export function personaAlAlcance(persona: Pick<Persona, 'sedeIds'>, sesion: Sesion): boolean {
  if (esDueno(sesion)) return true;
  const propias = new Set(sesion.sedes.map((s) => s.id));
  return persona.sedeIds.every((s) => propias.has(s));
}

/**
 * Mensaje de un rechazo de la API en Equipo y Roles: si la API dijo por qué (p. ej. «No podés
 * dar un permiso que no tenés»), se muestra eso y no el genérico de «sin acceso».
 */
export function mensajeRechazo(error: unknown): string {
  if (error instanceof ErrorConecta && error.message) return error.message;
  return mensajeDeError(error);
}

/**
 * ¿El correo coincide con el enmascarado de la invitación («ma***@gmail.com»)? Mismo dominio y
 * misma parte visible al principio. No reemplaza el control de la API: solo evita intentos obvios.
 */
export function coincideConMascara(email: string, mascara: string): boolean {
  const [local = '', dominio = ''] = email.trim().toLowerCase().split('@');
  const [mLocal = '', mDominio = ''] = mascara.trim().toLowerCase().split('@');
  if (!local || !dominio || dominio !== mDominio) return false;
  const corte = mLocal.indexOf('*');
  if (corte === -1) return local === mLocal;
  return local.startsWith(mLocal.slice(0, corte)) && local.length >= corte;
}

/** Fecha y hora en la zona de la clínica (o Asunción sin sesión). */
export function fechaHora(iso: string, zona?: string): string {
  return formatoFechaHora(iso, zona);
}

export function fecha(iso: string, zona?: string): string {
  return formatoFecha(iso, zona);
}

/** Enlace completo a partir de la ruta relativa que da la API. */
export function enlaceCompleto(enlace: string): string {
  if (/^https?:\/\//.test(enlace)) return enlace;
  return `${window.location.origin}${enlace.startsWith('/') ? '' : '/'}${enlace}`;
}
