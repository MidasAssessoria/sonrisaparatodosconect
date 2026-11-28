import { FILTROS_PACIENTES, type PacienteResumen } from '@conecta/shared';
import {
  Boton,
  Buscador,
  Chip,
  EncabezadoPagina,
  EstadoVacio,
  TablaLista,
  TarjetaPaciente,
  type Columna,
  type Tono,
} from '@conecta/ui';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEspera } from '../../componentes/useEspera.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { Segmento } from '../personal/componentes.js';
import { AltaPaciente } from './AltaPaciente.js';
import { ESPERA_BUSQUEDA_MS, useListaPacientes, type FiltroPacientes } from './consultas.js';
import { nombreCompleto, textoCi, textoTelefono } from './formato.js';
import './pacientes.css';

type TextosPacientes = ReturnType<typeof useTextos>['pacientes'];

/** Chips de estado de un paciente: color + ícono + texto. */
export function chipsPaciente(
  t: TextosPacientes,
  p: Pick<PacienteResumen, 'pediatrico' | 'conAlerta' | 'activo'>,
): { tono: Tono; texto: string; icono: 'familia' | 'alerta' | 'cerrar' }[] {
  const chips: { tono: Tono; texto: string; icono: 'familia' | 'alerta' | 'cerrar' }[] = [];
  if (!p.activo) chips.push({ tono: 'neutro', texto: t.inactivo, icono: 'cerrar' });
  if (p.conAlerta) chips.push({ tono: 'atencion', texto: t.conAlerta, icono: 'alerta' });
  if (p.pediatrico) chips.push({ tono: 'familia', texto: t.pediatrico, icono: 'familia' });
  return chips;
}

export function ChipsPaciente({
  paciente,
}: {
  paciente: Pick<PacienteResumen, 'pediatrico' | 'conAlerta' | 'activo'>;
}) {
  const t = useTextos().pacientes;
  const chips = chipsPaciente(t, paciente);
  if (!chips.length) return <>{t.sinDato}</>;
  return (
    <span className="w-chips">
      {chips.map((c) => (
        <Chip key={c.texto} tono={c.tono} icono={c.icono}>
          {c.texto}
        </Chip>
      ))}
    </span>
  );
}

export function ListaPacientes() {
  const t = useTextos().pacientes;
  const { puede } = useSesionLista();
  const navegar = useNavigate();
  const puedeCrear = puede('pacientes', 'crear');

  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState<FiltroPacientes>('todos');
  const [alta, setAlta] = useState(false);
  const q = useEspera(texto.trim(), ESPERA_BUSQUEDA_MS);
  const lista = useListaPacientes(q, filtro);

  const pacientes = useMemo(() => lista.data?.pages.flatMap((p) => p.items) ?? [], [lista.data]);
  const buscando = lista.isFetching && !lista.isFetchingNextPage && lista.isPlaceholderData;

  const columnas: Columna<PacienteResumen>[] = [
    {
      clave: 'paciente',
      titulo: t.columnas.paciente,
      render: (p) => (
        <span className="w-paciente-fila">
          <Link className="w-enlace-fila" to={`/pacientes/${p.id}`}>
            {nombreCompleto(p)}
          </Link>
          {p.edad != null ? <span className="w-secundario">{t.edad(p.edad)}</span> : null}
        </span>
      ),
    },
    { clave: 'ci', titulo: t.columnas.ci, render: (p) => textoCi(t, p.ci) ?? t.sinDato },
    {
      clave: 'telefono',
      titulo: t.columnas.telefono,
      render: (p) => textoTelefono(p.telefono) ?? t.sinDato,
    },
    { clave: 'estado', titulo: t.columnas.estado, render: (p) => <ChipsPaciente paciente={p} /> },
  ];

  const vacio = () => {
    if (q) {
      return (
        <EstadoVacio titulo={t.vacioBusqueda(q)} texto={t.vacioBusquedaTexto} ilustracion={false} />
      );
    }
    if (filtro !== 'todos') return <EstadoVacio titulo={t.vacioFiltro} ilustracion={false} />;
    return (
      <EstadoVacio
        titulo={t.vacio}
        texto={puedeCrear ? t.vacioTexto : undefined}
        accion={
          puedeCrear ? (
            <Boton variante="primario" icono="mas" onClick={() => setAlta(true)}>
              {t.nuevo}
            </Boton>
          ) : undefined
        }
      />
    );
  };

  return (
    <div className={puedeCrear ? 'w-pacientes w-pacientes--con-accion' : 'w-pacientes'}>
      <EncabezadoPagina
        titulo={t.titulo}
        acciones={
          puedeCrear ? (
            <Boton
              className="w-pacientes__nuevo"
              variante="primario"
              icono="mas"
              onClick={() => setAlta(true)}
            >
              {t.nuevo}
            </Boton>
          ) : null
        }
      />

      <div className="w-pacientes__busqueda">
        <Buscador
          valor={texto}
          onCambio={setTexto}
          etiqueta={t.buscar}
          placeholder={t.buscarAyuda}
        />
        {buscando ? (
          <p className="w-secundario" role="status">
            {t.buscando}
          </p>
        ) : null}
      </div>
      <Segmento<FiltroPacientes>
        etiqueta={t.filtro}
        valor={filtro}
        onCambio={setFiltro}
        opciones={FILTROS_PACIENTES.map((f) => ({ valor: f, texto: t.filtros[f] }))}
      />

      {lista.isPending ? <Esqueleto filas={5} etiqueta={t.cargando} /> : null}
      {lista.isError && !lista.data ? (
        <MensajeError error={lista.error} onReintentar={() => void lista.refetch()} />
      ) : null}
      {lista.data ? (
        pacientes.length === 0 ? (
          vacio()
        ) : (
          <>
            <ul className="w-pacientes__tarjetas" aria-label={t.tituloTabla}>
              {pacientes.map((p) => (
                <li key={p.id}>
                  <TarjetaPaciente
                    nombre={nombreCompleto(p)}
                    edad={p.edad ?? undefined}
                    documento={textoCi(t, p.ci)}
                    telefono={textoTelefono(p.telefono)}
                    chips={chipsPaciente(t, p)}
                    desactivado={!p.activo}
                    onAbrir={() => void navegar(`/pacientes/${p.id}`)}
                  />
                </li>
              ))}
            </ul>
            <TablaLista<PacienteResumen>
              className="w-pacientes__tabla"
              titulo={t.tituloTabla}
              columnas={columnas}
              filas={pacientes}
              claveFila={(p) => p.id}
            />
            {lista.isFetchNextPageError ? (
              <MensajeError error={lista.error} onReintentar={() => void lista.fetchNextPage()} />
            ) : null}
            {lista.hasNextPage ? (
              <div className="w-cargar-mas">
                <Boton
                  variante="secundario"
                  cargando={lista.isFetchingNextPage}
                  onClick={() => {
                    if (!lista.isFetchingNextPage) void lista.fetchNextPage();
                  }}
                >
                  {t.cargarMas}
                </Boton>
              </div>
            ) : (
              <p className="w-secundario w-fin-lista">{t.finLista}</p>
            )}
          </>
        )
      ) : null}

      {puedeCrear ? <AltaPaciente abierta={alta} onCerrar={() => setAlta(false)} /> : null}
    </div>
  );
}
