import type { Anamnesis } from '@conecta/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogoPreguntas, NuevaAnamnesis, VersionesAnamnesis } from '../../api/cliente.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claves, useActualizarPacientes } from './consultas.js';

/** Eventos por página del historial. */
export const LIMITE_HISTORIAL = 30;

/**
 * La firma llega como URL firmada que vence a los 5 minutos: una versión se considera fresca
 * menos que eso (y cada `GET` de una versión queda en auditoría: no se pide de más).
 */
const FRESCURA_VERSION_MS = 4 * 60_000;

export const clavesAnamnesis = {
  preguntas: (clinicaId: string) => ['anamnesis-preguntas', clinicaId] as const,
  catalogo: (clinicaId: string) => ['anamnesis-preguntas', clinicaId, 'catalogo'] as const,
  paciente: (clinicaId: string, pid: string) => claves.anamnesis(clinicaId, pid),
  versiones: (clinicaId: string, pid: string) =>
    ['anamnesis', clinicaId, pid, 'versiones'] as const,
  version: (clinicaId: string, pid: string, version: number) =>
    ['anamnesis', clinicaId, pid, 'version', version] as const,
  historial: (clinicaId: string, pid: string) => claves.historial(clinicaId, pid),
};

/** Catálogo activo del cuestionario (`ficha_clinica:ver`). */
export function usePreguntas(habilitada = true) {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: clavesAnamnesis.preguntas(sesion.clinica.id),
    queryFn: () => api.anamnesis.preguntas(),
    enabled: habilitada,
    staleTime: 5 * 60_000,
  });
}

/** Catálogo completo con las inactivas, para el editor (`configuracion:editar`). */
export function useCatalogoCompleto() {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: clavesAnamnesis.catalogo(sesion.clinica.id),
    queryFn: () => api.anamnesis.catalogo(),
  });
}

/** Versiones del paciente, de la más nueva a la más vieja, y si firma un tutor. */
export function useVersionesAnamnesis(pid: string) {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: clavesAnamnesis.versiones(sesion.clinica.id, pid),
    queryFn: () => api.anamnesis.versiones(pid),
  });
}

/** Una versión completa (`null` = ninguna todavía). Queda en auditoría como `ver`. */
export function useVersionAnamnesis(pid: string, version: number | null) {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: clavesAnamnesis.version(sesion.clinica.id, pid, version ?? 0),
    queryFn: () => api.anamnesis.obtener(pid, version ?? 'vigente'),
    enabled: version !== null,
    staleTime: FRESCURA_VERSION_MS,
  });
}

/** Línea de tiempo con cursor. */
export function useHistorial(pid: string) {
  const { api, sesion } = useSesionLista();
  return useInfiniteQuery({
    queryKey: clavesAnamnesis.historial(sesion.clinica.id, pid),
    queryFn: ({ pageParam }) =>
      api.historial(pid, {
        limite: LIMITE_HISTORIAL,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (pagina) => pagina.siguienteCursor,
  });
}

/**
 * Guardar una versión nueva: la respuesta entra a la caché (versión y alerta médica de la ficha) y
 * se vuelven a pedir la lista de versiones y el historial. La ficha no se vuelve a pedir (cada
 * `GET` queda en auditoría): se le cambian las alertas médicas con las de la respuesta.
 */
export function useGuardarAnamnesis(pid: string) {
  const { api, sesion } = useSesionLista();
  const consultas = useQueryClient();
  const actualizar = useActualizarPacientes();
  const clinica = sesion.clinica.id;
  return async (datos: NuevaAnamnesis): Promise<Anamnesis> => {
    const a = await api.anamnesis.crear(pid, datos);
    consultas.setQueryData(clavesAnamnesis.version(clinica, pid, a.version), a);
    // La nueva entra a la lista en el acto (así no se abre un momento la que era vigente).
    consultas.setQueryData<VersionesAnamnesis>(clavesAnamnesis.versiones(clinica, pid), (previa) =>
      previa
        ? {
            ...previa,
            versiones: [
              {
                version: a.version,
                fecha: a.fecha,
                registradaPor: a.registradaPor,
                firmante: { nombre: a.firmante.nombre, esTutor: a.firmante.esTutor },
                alertas: a.alertasMedicas.length,
              },
              ...previa.versiones.filter((v) => v.version !== a.version),
            ],
          }
        : previa,
    );
    void consultas.invalidateQueries({ queryKey: clavesAnamnesis.versiones(clinica, pid) });
    void consultas.invalidateQueries({ queryKey: clavesAnamnesis.historial(clinica, pid) });
    actualizar.cambiarFicha(pid, (p) => ({
      ...p,
      alertasMedicas: a.alertasMedicas,
      conAlerta: p.alertas.some((x) => x.activa) || a.alertasMedicas.length > 0,
    }));
    return a;
  };
}

/** Versiones actuales pedidas de nuevo (tras un conflicto): la más nueva, o `null`. */
export function useRecargarVersiones(pid: string) {
  const { api, sesion } = useSesionLista();
  const consultas = useQueryClient();
  return async (): Promise<number | null> => {
    const r = await api.anamnesis.versiones(pid);
    consultas.setQueryData(clavesAnamnesis.versiones(sesion.clinica.id, pid), r);
    return r.versiones[0]?.version ?? null;
  };
}

/** Una versión completa pedida en el acto (tras un conflicto); entra a la caché. */
export function useTraerVersion(pid: string) {
  const { api, sesion } = useSesionLista();
  const consultas = useQueryClient();
  return async (version: number): Promise<Anamnesis> => {
    const a = await api.anamnesis.obtener(pid, version);
    consultas.setQueryData(clavesAnamnesis.version(sesion.clinica.id, pid, a.version), a);
    return a;
  };
}

/** El catálogo activo pedido de nuevo (cambió mientras se completaba); entra a la caché. */
export function useRecargarPreguntas() {
  const { api, sesion } = useSesionLista();
  const consultas = useQueryClient();
  return async (): Promise<CatalogoPreguntas> => {
    const c = await api.anamnesis.preguntas();
    consultas.setQueryData(clavesAnamnesis.preguntas(sesion.clinica.id), c);
    return c;
  };
}
