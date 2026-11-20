import {
  ACCIONES_AUDITORIA,
  type AccionAuditoria,
  type ConsultaAuditoria,
  type EventoAuditoria,
} from '@conecta/shared';
import {
  Boton,
  Campo,
  Chip,
  EncabezadoPagina,
  EstadoVacio,
  HojaInferior,
  TablaLista,
  type Columna,
} from '@conecta/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFechaHora, hastaExclusivo, inicioDelDia } from '../../utilidades/fechas.js';
import {
  ACCION_AUDITORIA,
  camposCambiados,
  ENTIDADES,
  nombreCampo,
  nombreEntidad,
  valorLegible,
} from './diff.js';

export const TAMANO_PAGINA = 50;

interface Filtros {
  entidad: string;
  accion: '' | AccionAuditoria;
  usuarioId: string;
  desde: string;
  hasta: string;
}

const SIN_FILTROS: Filtros = { entidad: '', accion: '', usuarioId: '', desde: '', hasta: '' };

/** Días en la zona de la clínica. `hasta` de la API es exclusivo: el inicio del día siguiente. */
function consultaDesde(f: Filtros, zona: string): Partial<ConsultaAuditoria> {
  return {
    limite: TAMANO_PAGINA,
    ...(f.entidad ? { entidad: f.entidad } : {}),
    ...(f.accion ? { accion: f.accion } : {}),
    ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
    ...(f.desde ? { desde: inicioDelDia(f.desde, zona) } : {}),
    ...(f.hasta ? { hasta: hastaExclusivo(f.hasta, zona) } : {}),
  };
}

function ChipAccion({ accion }: { accion: AccionAuditoria }) {
  const a = ACCION_AUDITORIA[accion];
  return (
    <Chip tono={a.tono} icono={a.icono}>
      {a.texto}
    </Chip>
  );
}

function DetalleEvento({
  evento,
  zona,
  nombreSede,
  onCerrar,
}: {
  evento: EventoAuditoria | null;
  zona: string;
  nombreSede: (id: string) => string;
  onCerrar: () => void;
}) {
  const cambios = evento ? camposCambiados(evento.antes, evento.despues) : [];
  return (
    <HojaInferior abierta={evento !== null} titulo="Detalle del registro" onCerrar={onCerrar}>
      {evento ? (
        <div className="w-detalle-evento">
          <dl className="w-datos">
            <div>
              <dt>Fecha</dt>
              <dd>{formatoFechaHora(evento.fecha, zona)}</dd>
            </div>
            <div>
              <dt>Quién</dt>
              <dd>{evento.usuario?.nombre ?? 'Sistema'}</dd>
            </div>
            <div>
              <dt>Qué</dt>
              <dd className="w-datos__sede">
                <span>{nombreEntidad(evento.entidad)}</span>
                <ChipAccion accion={evento.accion} />
              </dd>
            </div>
            {evento.sedeId ? (
              <div>
                <dt>Sede</dt>
                <dd>{nombreSede(evento.sedeId)}</dd>
              </div>
            ) : null}
            {evento.ip ? (
              <div>
                <dt>IP</dt>
                <dd>{evento.ip}</dd>
              </div>
            ) : null}
          </dl>
          <h3 className="w-seccion__titulo">Qué cambió</h3>
          {cambios.length === 0 ? (
            <p className="w-secundario">Este registro no tiene cambios de datos para mostrar.</p>
          ) : (
            <ul className="w-cambios" aria-label="Campos que cambiaron">
              {cambios.map((c) => (
                <li key={c.campo} className="w-cambio">
                  <p className="w-cambio__campo">{nombreCampo(c.campo)}</p>
                  <dl className="w-cambio__valores">
                    <div>
                      <dt>Antes</dt>
                      <dd>{valorLegible(c.antes)}</dd>
                    </div>
                    <div>
                      <dt>Después</dt>
                      <dd>{valorLegible(c.despues)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </HojaInferior>
  );
}

export function Auditoria() {
  const { api, sesion } = useSesionLista();
  const zona = sesion.clinica.zonaHoraria;
  const nombreSede = (id: string) =>
    sesion.sedes.find((s) => s.id === id)?.nombre ?? 'Sede dada de baja o fuera de tu acceso';
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [elegido, setElegido] = useState<EventoAuditoria | null>(null);
  const rangoInvalido = !!filtros.desde && !!filtros.hasta && filtros.desde > filtros.hasta;

  const consulta = useInfiniteQuery({
    queryKey: ['auditoria', sesion.clinica.id, zona, filtros],
    queryFn: ({ pageParam }) =>
      api.auditoria.listar({
        ...consultaDesde(filtros, zona),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (pagina) => pagina.siguienteCursor,
    enabled: !rangoInvalido,
  });

  const eventos = useMemo(
    () => consulta.data?.pages.flatMap((p) => p.items) ?? [],
    [consulta.data],
  );

  // Personas vistas en los registros cargados (el contrato no tiene una lista de usuarios).
  const [personasVistas, setPersonasVistas] = useState<Map<string, string>>(new Map());
  const faltantes = eventos.filter((e) => e.usuario && !personasVistas.has(e.usuario.id));
  if (faltantes.length) {
    const nuevo = new Map(personasVistas);
    for (const e of faltantes) if (e.usuario) nuevo.set(e.usuario.id, e.usuario.nombre);
    setPersonasVistas(nuevo);
  }

  const entidades = useMemo(() => {
    const todas = new Set(Object.keys(ENTIDADES));
    for (const e of eventos) todas.add(e.entidad);
    return [...todas].sort((a, b) => nombreEntidad(a).localeCompare(nombreEntidad(b), 'es'));
  }, [eventos]);

  const columnas: Columna<EventoAuditoria>[] = [
    { clave: 'fecha', titulo: 'Fecha', render: (e) => formatoFechaHora(e.fecha, zona) },
    { clave: 'usuario', titulo: 'Quién', render: (e) => e.usuario?.nombre ?? 'Sistema' },
    { clave: 'entidad', titulo: 'Entidad', render: (e) => nombreEntidad(e.entidad) },
    { clave: 'accion', titulo: 'Acción', render: (e) => <ChipAccion accion={e.accion} /> },
    {
      clave: 'detalle',
      titulo: 'Detalle',
      render: (e) => (
        <Boton variante="fantasma" icono="ojo" onClick={() => setElegido(e)}>
          Ver detalle
        </Boton>
      ),
    },
  ];

  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(SIN_FILTROS);
  const cambiar = (parcial: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...parcial }));

  return (
    <>
      <EncabezadoPagina titulo="Auditoría" />
      <form className="w-filtros" aria-label="Filtros" onSubmit={(e) => e.preventDefault()}>
        <Campo
          etiqueta="Entidad"
          tipo="select"
          value={filtros.entidad}
          opciones={[
            { valor: '', texto: 'Todas' },
            ...entidades.map((e) => ({ valor: e, texto: nombreEntidad(e) })),
          ]}
          onChange={(e) => cambiar({ entidad: e.target.value })}
        />
        <Campo
          etiqueta="Acción"
          tipo="select"
          value={filtros.accion}
          opciones={[
            { valor: '', texto: 'Todas' },
            ...ACCIONES_AUDITORIA.map((a) => ({ valor: a, texto: ACCION_AUDITORIA[a].texto })),
          ]}
          onChange={(e) => cambiar({ accion: e.target.value as Filtros['accion'] })}
        />
        <Campo
          etiqueta="Usuario"
          tipo="select"
          value={filtros.usuarioId}
          opciones={[
            { valor: '', texto: 'Todos' },
            ...[...personasVistas].map(([id, nombre]) => ({ valor: id, texto: nombre })),
          ]}
          onChange={(e) => cambiar({ usuarioId: e.target.value })}
        />
        <Campo
          etiqueta="Desde"
          tipo="date"
          value={filtros.desde}
          onChange={(e) => cambiar({ desde: e.target.value })}
        />
        <Campo
          etiqueta="Hasta"
          tipo="date"
          value={filtros.hasta}
          onChange={(e) => cambiar({ hasta: e.target.value })}
          error={
            rangoInvalido ? 'La fecha «hasta» tiene que ser igual o posterior a «desde».' : null
          }
        />
        {hayFiltros ? (
          <Boton variante="fantasma" icono="cerrar" onClick={() => setFiltros(SIN_FILTROS)}>
            Quitar filtros
          </Boton>
        ) : null}
      </form>

      {!rangoInvalido && consulta.isPending ? (
        <Esqueleto filas={6} etiqueta="Cargando registros" />
      ) : null}
      {consulta.isError && eventos.length === 0 ? (
        <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />
      ) : null}
      {consulta.isSuccess && eventos.length === 0 ? (
        <EstadoVacio
          titulo={hayFiltros ? 'No hay registros con estos filtros.' : 'Todavía no hay registros.'}
          texto={
            hayFiltros
              ? 'Probá con otro rango de fechas o quitá algún filtro.'
              : 'Cada alta, edición y baja va a aparecer acá.'
          }
          accion={
            hayFiltros ? (
              <Boton variante="secundario" onClick={() => setFiltros(SIN_FILTROS)}>
                Quitar filtros
              </Boton>
            ) : undefined
          }
        />
      ) : null}
      {eventos.length > 0 ? (
        <>
          <TablaLista<EventoAuditoria>
            titulo="Registros de auditoría"
            columnas={columnas}
            filas={eventos}
          />
          {consulta.isFetchNextPageError ? (
            <MensajeError
              error={consulta.error}
              onReintentar={() => void consulta.fetchNextPage()}
            />
          ) : null}
          {consulta.hasNextPage ? (
            <div className="w-cargar-mas">
              <Boton
                variante="secundario"
                cargando={consulta.isFetchingNextPage}
                onClick={() => void consulta.fetchNextPage()}
              >
                Cargar más
              </Boton>
            </div>
          ) : (
            <p className="w-secundario w-fin-lista">No hay registros más viejos.</p>
          )}
        </>
      ) : null}

      <DetalleEvento
        evento={elegido}
        zona={zona}
        nombreSede={nombreSede}
        onCerrar={() => setElegido(null)}
      />
    </>
  );
}
