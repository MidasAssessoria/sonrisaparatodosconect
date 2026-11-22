import type { ConsultaPacientes, Paciente, PacienteResumen } from '@conecta/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEspera } from '../../componentes/useEspera.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';

/** Espera al tipear antes de pedir (lista y buscador). */
export const ESPERA_BUSQUEDA_MS = 300;
/** El buscador global no pide nada con menos caracteres que esto (la API devuelve vacío). */
export const MINIMO_BUSCADOR = 2;

export type FiltroPacientes = ConsultaPacientes['filtro'];

export const claves = {
  lista: (clinicaId: string) => ['pacientes', clinicaId] as const,
  ficha: (clinicaId: string, id: string) => ['paciente', clinicaId, id] as const,
  fichas: (clinicaId: string) => ['paciente', clinicaId] as const,
  buscar: (clinicaId: string, q: string) => ['buscar', clinicaId, q] as const,
};

/**
 * Lista con cursor. `q` viaja tal como se escribió (sin espacios de los costados): la API
 * normaliza tildes, puntos de la CI y formatos de teléfono.
 */
export function useListaPacientes(q: string, filtro: FiltroPacientes) {
  const { api, sesion } = useSesionLista();
  return useInfiniteQuery({
    queryKey: [...claves.lista(sesion.clinica.id), { q, filtro }],
    queryFn: ({ pageParam }) =>
      api.pacientes.listar({
        ...(q ? { q } : {}),
        ...(filtro !== 'todos' ? { filtro } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (pagina) => pagina.siguienteCursor,
    placeholderData: keepPreviousData,
  });
}

/** Ficha completa. Cada apertura queda en auditoría (`ver`) del lado de la API. */
export function usePaciente(id: string) {
  const { api, sesion } = useSesionLista();
  return useQuery({
    queryKey: claves.ficha(sesion.clinica.id, id),
    queryFn: () => api.pacientes.obtener(id),
  });
}

/**
 * Buscador de pacientes (`GET /buscar`): espera corta al tipear y nada con menos de
 * `MINIMO_BUSCADOR` caracteres. `resultados` es `undefined` mientras no haya nada que mostrar
 * (así el buscador no anuncia «sin resultados» antes de tiempo).
 */
export function useBuscarPacientes(texto: string, activo = true) {
  const { api, sesion } = useSesionLista();
  const q = useEspera(texto.trim(), ESPERA_BUSQUEDA_MS);
  const habilitado = activo && q.length >= MINIMO_BUSCADOR;
  const consulta = useQuery({
    queryKey: claves.buscar(sesion.clinica.id, q),
    queryFn: () => api.buscar(q),
    enabled: habilitado,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const visible = activo && texto.trim().length >= MINIMO_BUSCADOR;
  const resultados: PacienteResumen[] | undefined =
    visible && habilitado ? consulta.data : undefined;
  return { resultados, buscando: visible && consulta.isFetching };
}

/**
 * Después de cambiar un paciente: la ficha respondida entra a la caché en el acto; la lista y el
 * buscador se vuelven a pedir por detrás.
 */
export function useActualizarPacientes() {
  const { sesion } = useSesionLista();
  const consultas = useQueryClient();
  const clinica = sesion.clinica.id;
  return {
    /** Guarda la ficha respondida por la API y marca vieja la lista. */
    ficha: (p: Paciente) => {
      consultas.setQueryData(claves.ficha(clinica, p.id), p);
      void consultas.invalidateQueries({ queryKey: claves.lista(clinica) });
      void consultas.invalidateQueries({ queryKey: ['buscar', clinica] });
    },
    /** Cambia la ficha en caché sin pedirla de nuevo (cada `GET` queda en auditoría). */
    cambiarFicha: (id: string, cambio: (p: Paciente) => Paciente) => {
      consultas.setQueryData<Paciente>(claves.ficha(clinica, id), (p) => (p ? cambio(p) : p));
      void consultas.invalidateQueries({ queryKey: claves.lista(clinica) });
    },
    /** Otra ficha quedó desactualizada (p. ej. el espejo de un vínculo): se pide al abrirla. */
    olvidarFicha: (id: string) => {
      consultas.removeQueries({ queryKey: claves.ficha(clinica, id) });
    },
  };
}
