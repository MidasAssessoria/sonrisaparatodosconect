import type { Sede } from '@conecta/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';

export function claveSedes(clinicaId: string) {
  return ['sedes', clinicaId] as const;
}

export function claveSede(clinicaId: string, id: string) {
  return ['sedes', clinicaId, id] as const;
}

export function useSedes() {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: claveSedes(sesion.clinica.id),
    queryFn: () => api.sedes.listar(),
  });
}

/** `activa: false` deja de pedirla (p. ej. justo después de darla de baja). */
export function useSede(id: string, activa = true) {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: claveSede(sesion.clinica.id, id),
    queryFn: () => api.sedes.obtener(id),
    enabled: activa,
  });
}

/** Después de cambiar una sede: caché del detalle, la lista y la sesión (selector de sede). */
export function useActualizarSede() {
  const { sesion, recargarSesion } = useSesionLista();
  const consultas = useQueryClient();
  return async (sede?: Sede) => {
    if (sede) consultas.setQueryData(claveSede(sesion.clinica.id, sede.id), sede);
    await consultas.invalidateQueries({ queryKey: claveSedes(sesion.clinica.id), exact: true });
    await recargarSesion();
  };
}
