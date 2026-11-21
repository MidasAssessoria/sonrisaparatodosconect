import type { Persona, Rol } from '@conecta/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { reaccionPorCodigo, type ErrorConecta } from '../../api/errores.js';
import { useSesion, useSesionLista, type ValorSesion } from '../../sesion/ProveedorSesion.js';
import { formatoFecha, formatoFechaHora } from '../../utilidades/fechas.js';
import { crearApiPersonal, type ApiPersonal } from './api.js';

/**
 * Cliente de estos endpoints con la sesión actual. Sirve en cualquier fase (la invitación se abre
 * también sin sesión). Las reacciones globales imitan las de `ProveedorSesion` con lo que el
 * contexto expone: `mfa_requerido` se resuelve volviendo a pedir la sesión, que dispara la reacción
 * del proveedor.
 */
/** Puente entre el contexto (que cambia en cada render) y el cliente (que se crea una vez). */
class PuenteSesion {
  constructor(public valor: ValorSesion) {}
  fijar(v: ValorSesion) {
    this.valor = v;
  }
}

export function useApiPersonal(): ApiPersonal {
  const v = useSesion();
  const [puente] = useState(() => new PuenteSesion(v));
  useEffect(() => {
    puente.fijar(v);
  });
  const [api] = useState(() =>
    crearApiPersonal({
      obtenerToken: () => puente.valor.auth.obtenerToken(),
      obtenerClinicaId: () => puente.valor.sesion?.clinica.id ?? null,
      alError: (e: ErrorConecta) => {
        const actual = puente.valor;
        if (actual.estado.fase !== 'lista') return;
        switch (reaccionPorCodigo(e.codigo).tipo) {
          case 'cerrar_sesion':
            void actual.cerrarSesion({ tipo: 'vencida' });
            return;
          case 'sin_membresia':
            void actual.cerrarSesion({ tipo: 'sin_membresia' });
            return;
          case 'segundo_factor':
            void actual.recargarSesion();
            return;
          case 'elegir_clinica':
            actual.irAElegirClinica();
            return;
          default:
            return;
        }
      },
    }),
  );
  return api;
}

export function clavePersonal(clinicaId: string) {
  return ['personal', clinicaId] as const;
}

export function claveRoles(clinicaId: string) {
  return ['roles', clinicaId] as const;
}

export function usePersonal() {
  const { sesion } = useSesionLista();
  const api = useApiPersonal();
  return useQuery({
    queryKey: clavePersonal(sesion.clinica.id),
    queryFn: () => api.personal.listar(),
  });
}

export function useRoles(activa = true) {
  const { sesion } = useSesionLista();
  const api = useApiPersonal();
  return useQuery({
    queryKey: claveRoles(sesion.clinica.id),
    queryFn: () => api.roles.listar(),
    enabled: activa,
  });
}

/** Después de cambiar una persona: lista del equipo y conteo de roles. */
export function useActualizarEquipo() {
  const { sesion } = useSesionLista();
  const consultas = useQueryClient();
  return async (persona?: Persona) => {
    if (persona) {
      consultas.setQueryData<Persona[]>(clavePersonal(sesion.clinica.id), (lista) =>
        lista?.map((p) => (p.membresiaId === persona.membresiaId ? persona : p)),
      );
    }
    await Promise.all([
      consultas.invalidateQueries({ queryKey: clavePersonal(sesion.clinica.id) }),
      consultas.invalidateQueries({ queryKey: claveRoles(sesion.clinica.id) }),
    ]);
  };
}

/** Roles que se pueden asignar: activos, y Dueño/a solo si quien asigna es Dueño/a. */
export function rolesAsignables(roles: Rol[], codigoRolPropio: string): Rol[] {
  return roles.filter((r) => r.activo && (r.codigo !== 'dueno' || codigoRolPropio === 'dueno'));
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
