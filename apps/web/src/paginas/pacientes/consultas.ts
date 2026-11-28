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
  /** Todo lo de la anamnesis de un paciente (versiones, `requiereTutor`, cada versión). */
  anamnesis: (clinicaId: string, id: string) => ['anamnesis', clinicaId, id] as const,
  historial: (clinicaId: string, id: string) => ['historial', clinicaId, id] as const,
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

/** Elementos por página del selector de familiar (`GET /pacientes`). */
export const LIMITE_FAMILIAR = 20;

/**
 * Selector de familiar: `GET /pacientes?q=…&limite=…` con cursor, en vez del buscador global (que
 * devuelve 6 y, sacando la propia ficha y los ya vinculados, podía quedar vacío aunque hubiera
 * más). Nada con menos de `MINIMO_BUSCADOR` caracteres.
 */
export function useBuscarFamiliar(texto: string, activo = true) {
  const { api, sesion } = useSesionLista();
  const q = useEspera(texto.trim(), ESPERA_BUSQUEDA_MS);
  const habilitado = activo && q.length >= MINIMO_BUSCADOR;
  const consulta = useInfiniteQuery({
    queryKey: [...claves.lista(sesion.clinica.id), 'familiar', q],
    queryFn: ({ pageParam }) =>
      api.pacientes.listar({
        q,
        limite: LIMITE_FAMILIAR,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (pagina) => pagina.siguienteCursor,
    enabled: habilitado,
    staleTime: 10_000,
  });
  const visible = activo && texto.trim().length >= MINIMO_BUSCADOR && q === texto.trim();
  const resultados: PacienteResumen[] | undefined =
    visible && habilitado && consulta.data
      ? consulta.data.pages.flatMap((p) => p.items)
      : undefined;
  return {
    q,
    resultados,
    buscando: activo && texto.trim().length >= MINIMO_BUSCADOR && !resultados && !consulta.isError,
    hayMas: visible && consulta.hasNextPage,
    cargandoMas: consulta.isFetchingNextPage,
    cargarMas: () => {
      if (!consulta.isFetchingNextPage) void consulta.fetchNextPage();
    },
    error: visible ? consulta.error : null,
  };
}

/**
 * Después de cambiar un paciente: la ficha respondida entra a la caché en el acto; la lista y el
 * buscador global (chip «Con alerta», nombre) se vuelven a pedir por detrás.
 */
export function useActualizarPacientes() {
  const { sesion } = useSesionLista();
  const consultas = useQueryClient();
  const clinica = sesion.clinica.id;
  const listas = () => {
    void consultas.invalidateQueries({ queryKey: claves.lista(clinica) });
    void consultas.invalidateQueries({ queryKey: ['buscar', clinica] });
  };
  /** Cualquier cambio de la ficha deja un evento nuevo en el historial. */
  const historial = (id: string) =>
    void consultas.invalidateQueries({ queryKey: claves.historial(clinica, id) });
  return {
    /**
     * Guarda la ficha respondida por la API y marca viejas la lista, el buscador y el historial.
     * Si cambió el nombre o la CI, las fichas de sus familiares (que lo muestran en el grupo
     * familiar, con su CI para firmar como tutor) se vuelven a pedir al abrirlas. Si cambió la
     * fecha de nacimiento o el sexo, la anamnesis también (`requiereTutor`, pregunta de embarazo).
     */
    ficha: (p: Paciente) => {
      const antes = consultas.getQueryData<Paciente>(claves.ficha(clinica, p.id));
      consultas.setQueryData(claves.ficha(clinica, p.id), p);
      historial(p.id);
      if (antes && (antes.fechaNac !== p.fechaNac || antes.sexo !== p.sexo)) {
        void consultas.invalidateQueries({ queryKey: claves.anamnesis(clinica, p.id) });
      }
      if (
        antes &&
        (antes.nombres !== p.nombres || antes.apellidos !== p.apellidos || antes.ci !== p.ci)
      ) {
        const familiares = new Set(
          [...antes.relaciones, ...p.relaciones].map((r) => r.familiar.id),
        );
        for (const id of familiares)
          consultas.removeQueries({ queryKey: claves.ficha(clinica, id) });
      }
      listas();
    },
    /** Cambia la ficha en caché sin pedirla de nuevo (cada `GET` queda en auditoría). */
    cambiarFicha: (id: string, cambio: (p: Paciente) => Paciente) => {
      consultas.setQueryData<Paciente>(claves.ficha(clinica, id), (p) => (p ? cambio(p) : p));
      historial(id);
      listas();
    },
    /** Otra ficha quedó desactualizada (p. ej. el espejo de un vínculo): se pide al abrirla. */
    olvidarFicha: (id: string) => {
      consultas.removeQueries({ queryKey: claves.ficha(clinica, id) });
    },
  };
}
