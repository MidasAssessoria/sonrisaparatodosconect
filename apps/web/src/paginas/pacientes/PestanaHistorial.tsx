import type { Paciente } from '@conecta/shared';
import { Boton, Chip, EstadoVacio, type IconoNombre, type Tono } from '@conecta/ui';
import type { z } from 'zod';
import type { eventoHistorialSchema } from '@conecta/shared';
import { Link } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFechaHora } from '../../utilidades/fechas.js';
import { useHistorial } from './consultasAnamnesis.js';
import './anamnesis.css';

type Evento = z.infer<typeof eventoHistorialSchema>;
type TipoEvento = Evento['tipo'];

/** Cada tipo con su tono e ícono (estado = color + ícono + texto). */
const ESTILO: Record<TipoEvento, { tono: Tono; icono: IconoNombre }> = {
  alta: { tono: 'info', icono: 'mas' },
  datos_editados: { tono: 'neutro', icono: 'archivo' },
  baja: { tono: 'neutro', icono: 'cerrar' },
  reactivacion: { tono: 'exito', icono: 'check' },
  anamnesis: { tono: 'info', icono: 'archivo' },
  alerta_creada: { tono: 'atencion', icono: 'alerta' },
  alerta_desactivada: { tono: 'neutro', icono: 'alerta' },
  vinculo_agregado: { tono: 'familia', icono: 'familia' },
  vinculo_quitado: { tono: 'familia', icono: 'familia' },
};

/** Enlace al origen del evento, si lo tiene y quien mira puede abrirlo. */
function EnlaceEvento({ evento: e, paciente }: { evento: Evento; paciente: Paciente }) {
  const t = useTextos().pacientes.historial;
  const { puede } = useSesionLista();
  const ref = e.referencia;
  if (!ref) return null;
  if (e.tipo === 'anamnesis' && puede('ficha_clinica', 'ver') && /^\d+$/.test(ref)) {
    return (
      <Link
        className="w-historial__enlace"
        to={`/pacientes/${paciente.id}/anamnesis?version=${ref}`}
      >
        {t.verVersion(ref)}
      </Link>
    );
  }
  if (e.tipo === 'vinculo_agregado' || e.tipo === 'vinculo_quitado') {
    return (
      <Link className="w-historial__enlace" to={`/pacientes/${encodeURIComponent(ref)}`}>
        {t.verFamiliar}
      </Link>
    );
  }
  if (e.tipo === 'alerta_creada' || e.tipo === 'alerta_desactivada') {
    return (
      <Link className="w-historial__enlace" to={`/pacientes/${paciente.id}`}>
        {t.verAlertas}
      </Link>
    );
  }
  return null;
}

/** Pestaña «Historial»: línea de tiempo del paciente, del más nuevo al más viejo. */
export function PestanaHistorial({ paciente }: { paciente: Paciente }) {
  const t = useTextos().pacientes.historial;
  const { sesion } = useSesionLista();
  const zona = sesion.clinica.zonaHoraria;
  const historial = useHistorial(paciente.id);

  if (historial.isPending) return <Esqueleto filas={5} etiqueta={t.cargando} />;
  if (!historial.data) {
    return <MensajeError error={historial.error} onReintentar={() => void historial.refetch()} />;
  }
  // El orden es el de la API (más nuevo primero); las páginas siguientes van debajo.
  const eventos = historial.data.pages.flatMap((p) => p.eventos);

  return (
    <section className="w-tarjeta" aria-labelledby="w-historial-titulo">
      <div className="w-tarjeta__cabecera">
        <h2 id="w-historial-titulo" className="w-seccion-ficha__titulo">
          {t.titulo}
        </h2>
      </div>
      <p className="w-secundario w-seccion-ficha__ayuda">{t.ayuda}</p>
      {eventos.length === 0 ? (
        <EstadoVacio titulo={t.vacio} ilustracion={false} />
      ) : (
        <ol className="w-historial" aria-labelledby="w-historial-titulo">
          {eventos.map((e, i) => {
            const estilo = ESTILO[e.tipo];
            return (
              <li
                key={`${e.fecha}-${e.tipo}-${e.referencia ?? ''}-${i}`}
                className="w-historial__evento"
              >
                <span className="w-historial__punto" aria-hidden="true" />
                <div className="w-historial__cuerpo">
                  <p className="w-historial__cabecera">
                    <time dateTime={e.fecha} className="w-historial__fecha">
                      {formatoFechaHora(e.fecha, zona)}
                    </time>
                    <Chip tono={estilo.tono} icono={estilo.icono}>
                      {t.tipos[e.tipo]}
                    </Chip>
                  </p>
                  <p className="w-historial__texto">{e.descripcion}</p>
                  {e.autor ? <p className="w-secundario">{t.autor(e.autor)}</p> : null}
                  <EnlaceEvento evento={e} paciente={paciente} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {historial.isFetchNextPageError ? (
        <MensajeError error={historial.error} onReintentar={() => void historial.fetchNextPage()} />
      ) : null}
      {historial.hasNextPage ? (
        <div className="w-cargar-mas">
          <Boton
            variante="secundario"
            cargando={historial.isFetchingNextPage}
            onClick={() => {
              if (!historial.isFetchingNextPage) void historial.fetchNextPage();
            }}
          >
            {t.cargarMas}
          </Boton>
        </div>
      ) : eventos.length ? (
        <p className="w-secundario w-fin-lista">{t.fin}</p>
      ) : null}
    </section>
  );
}
