import { useQuery } from '@tanstack/react-query';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claveSedes } from '../sedes/consultas.js';
import { claves, useApiCatalogos } from './api.js';

export function useProfesionales() {
  const api = useApiCatalogos();
  const { sesion } = useSesionLista();
  return useQuery({
    queryKey: claves.profesionales(sesion.clinica.id),
    queryFn: () => api.profesionales.listar(),
  });
}

export function useProfesional(id: string) {
  const api = useApiCatalogos();
  const { sesion } = useSesionLista();
  return useQuery({
    queryKey: claves.profesional(sesion.clinica.id, id),
    queryFn: () => api.profesionales.obtener(id),
  });
}

/** Personas del equipo para asociar a un profesional (solo con `personal:ver`). */
export function usePersonal() {
  const api = useApiCatalogos();
  const { sesion, puede } = useSesionLista();
  return useQuery({
    queryKey: claves.personal(sesion.clinica.id),
    queryFn: () => api.personal.listar(),
    enabled: puede('personal', 'ver'),
  });
}

/** Sedes con horarios y sillones (misma clave que la pantalla de Sedes). Solo con `sedes:ver`. */
export function useSedesDetalle() {
  const { api, sesion, puede } = useSesionLista();
  return useQuery({
    queryKey: claveSedes(sesion.clinica.id),
    queryFn: () => api.sedes.listar(),
    enabled: puede('sedes', 'ver'),
  });
}

export function useTratamientos() {
  const api = useApiCatalogos();
  const { sesion } = useSesionLista();
  return useQuery({
    queryKey: claves.tratamientos(sesion.clinica.id),
    queryFn: () => api.tratamientos.listar(),
  });
}
