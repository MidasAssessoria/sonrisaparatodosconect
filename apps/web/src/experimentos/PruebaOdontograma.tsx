/**
 * Página de prueba técnica del odontograma 3D (riesgo R2 del plan). Datos ficticios en memoria:
 * nada se guarda. Muestra el componente controlado, los eventos que emite, el estado resultante y
 * las mediciones (primer cuadro, cuadros por segundo al girar, montajes repetidos).
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import {
  Boton,
  EncabezadoPagina,
  LeyendaOdontograma,
  MarcoVisor3D,
  PieMaqueta,
  type Denticion,
} from '@conecta/ui';
import { EJEMPLO_ADULTO, EJEMPLO_PEDIATRICO } from './datosEjemplo.js';
import { Odontograma3D, type ControlOdontograma, type Vista } from './odontograma/Odontograma3D.js';
import {
  CATALOGO,
  CLASES,
  HERRAMIENTAS,
  info,
  type ClaseElegida,
  type EstadoHallazgo,
  type EstadoOdontograma,
  type Herramienta,
} from './odontograma/modelo.js';
import type { CambioOdontograma } from './odontograma/reglas.js';
import './prueba.css';

const VISTAS: { id: Vista; texto: string }[] = [
  { id: 'completo', texto: 'Completo' },
  { id: 'vestibular', texto: 'Vestibular' },
  { id: 'lingual', texto: 'Palatina · lingual' },
  { id: 'oclusal', texto: 'Oclusal' },
];
const ESTADOS: { id: EstadoHallazgo; texto: string }[] = [
  { id: 'por_realizar', texto: 'Por realizar' },
  { id: 'realizado', texto: 'Realizado' },
];
const AYUDA_CLASE: Record<ClaseElegida, string> = {
  auto: 'Tocá la cara del diente: la clase de Black sale sola.',
  I: 'Clase I: fosas y fisuras (oclusal) · cara palatina de anteriores.',
  II: 'Clase II: caras proximales de premolares y molares.',
  III: 'Clase III: proximales de anteriores, sin el ángulo incisal.',
  IV: 'Clase IV: proximales de anteriores, con el ángulo incisal.',
  V: 'Clase V: tercio cervical, vestibular o lingual.',
};
const MONTAJES = 20;

interface Segmento<T extends string> {
  etiqueta: string;
  opciones: { id: T; texto: string }[];
  valor: T;
  alCambiar: (v: T) => void;
}
function Segmento<T extends string>({
  etiqueta,
  opciones,
  valor,
  alCambiar,
}: Segmento<T>): ReactElement {
  return (
    <div className="cn-segmento" role="radiogroup" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          className={'cn-segmento__opcion' + (valor === o.id ? ' is-activo' : '')}
          onClick={() => alCambiar(o.id)}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

function Glifo({ svg }: { svg: string }): ReactElement {
  // contenido SVG constante del catálogo (no viene del usuario)
  return (
    <svg
      className="cn-glifo"
      viewBox="-10 -10 20 20"
      width={24}
      height={24}
      aria-hidden={true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface Ciclo {
  hechos: number;
  tiempos: number[];
  memoriaAntes: number | null;
  t0: number;
}
interface ResultadoCiclo {
  montajes: number;
  msPromedio: number;
  msTotal: number;
  memoriaAntesMB: number | null;
  memoriaDespuesMB: number | null;
  lienzosVivos: number;
}

const memoriaMB = (): number | null => {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
};

function aplicarEvento(e: EstadoOdontograma, ev: CambioOdontograma): EstadoOdontograma {
  const n = { ...e };
  if (ev.marca) n[ev.fdi] = ev.marca;
  else delete n[ev.fdi];
  return n;
}

export function PruebaOdontograma(): ReactElement {
  const [denticion, setDenticion] = useState<Denticion>('adulto');
  const [estados, setEstados] = useState<Record<Denticion, EstadoOdontograma>>({
    adulto: EJEMPLO_ADULTO,
    pediatrico: EJEMPLO_PEDIATRICO,
  });
  const [herramienta, setHerramienta] = useState<Herramienta>('caries');
  const [estadoNuevo, setEstadoNuevo] = useState<EstadoHallazgo>('por_realizar');
  const [clase, setClase] = useState<ClaseElegida>('auto');
  const [vista, setVista] = useState<Vista>('completo');
  const [eventos, setEventos] = useState<CambioOdontograma[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [segunda, setSegunda] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const [primerCuadro, setPrimerCuadro] = useState<number | null>(null);
  const [medicion, setMedicion] = useState<string | null>(null);
  const [midiendo, setMidiendo] = useState(false);
  const [ciclo, setCiclo] = useState<Ciclo | null>(null);
  const [resultadoCiclo, setResultadoCiclo] = useState<ResultadoCiclo | null>(null);
  const control = useRef<ControlOdontograma | null>(null);

  const estado = estados[denticion];

  const alCambio = useCallback(
    (ev: CambioOdontograma) => {
      setEstados((prev) => ({ ...prev, [denticion]: aplicarEvento(prev[denticion], ev) }));
      setEventos((prev) => [ev, ...prev].slice(0, 30));
      setAviso(ev.mensaje);
    },
    [denticion],
  );

  async function medir() {
    const c = control.current;
    if (!c) return;
    setMidiendo(true);
    setMedicion('Girando la cámara 5 segundos…');
    const r = await c.medirGiro(5000);
    const k = c.medirCosto(30);
    const m = c.metricas();
    setMedicion(
      `${r.fps} cuadros/s al girar (${r.cuadros} cuadros; medio ${r.msMedio} ms, peor ${r.msPeor} ms) · ` +
        `costo por cuadro ${k.msPorCuadro} ms (hasta ${k.fpsPosible} cuadros/s) · ` +
        `${m.llamadas} llamadas de dibujo, ${m.triangulos.toLocaleString('es-PY')} triángulos, ` +
        `${m.geometrias} geometrías, ${m.texturas} texturas, ${m.programas} programas · armado ${Math.round(m.msConstruccion)} ms`,
    );
    setMidiendo(false);
  }

  function empezarCiclo() {
    setResultadoCiclo(null);
    setCiclo({ hechos: 0, tiempos: [], memoriaAntes: memoriaMB(), t0: performance.now() });
  }

  const alPrimerCuadroCiclo = useCallback((ms: number) => {
    // se desmonta en el cuadro siguiente: así cada montaje llega a dibujar
    requestAnimationFrame(() =>
      setCiclo((c) => {
        if (!c) return c;
        const tiempos = [...c.tiempos, ms];
        if (tiempos.length < MONTAJES) return { ...c, hechos: c.hechos + 1, tiempos };
        const total = performance.now() - c.t0;
        // la memoria y los lienzos se leen un momento después, con el último ya desmontado
        setTimeout(() => {
          setResultadoCiclo({
            montajes: tiempos.length,
            msPromedio: Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length),
            msTotal: Math.round(total),
            memoriaAntesMB: c.memoriaAntes,
            memoriaDespuesMB: memoriaMB(),
            lienzosVivos: document.querySelectorAll('canvas').length,
          });
        }, 1500);
        return null;
      }),
    );
  }, []);

  const otraDenticion = (d: Denticion) => {
    setDenticion(d);
    setAviso(null);
  };

  return (
    <div className="pod">
      <EncabezadoPagina titulo="Odontograma 3D · prueba técnica" />
      <p className="pod__intro">
        Paciente de ejemplo: {denticion === 'adulto' ? 'Ana Giménez (34)' : 'Mateo Giménez (7)'}.
        Los cambios quedan solo en esta página.
      </p>
      <div className="pod__rejilla">
        <div className="pod__principal">
          <MarcoVisor3D
            denticion={denticion}
            onDenticion={otraDenticion}
            titulo="Odontograma"
            ayuda={
              herramienta === 'caries'
                ? AYUDA_CLASE[clase]
                : 'Tocá un diente para marcar; otro toque quita la marca. La movilidad sube de grado I a III y después se quita.'
            }
          >
            <Odontograma3D
              className="pod__visor"
              denticion={denticion}
              estado={estado}
              herramienta={herramienta}
              estadoNuevo={estadoNuevo}
              claseCaries={clase}
              vista={vista}
              onCambio={alCambio}
              onRechazo={(m) => setAviso(m)}
              onElegirDiente={(f) => setElegido(f)}
              onPrimerCuadro={(ms) => setPrimerCuadro(Math.round(ms))}
              onControl={(c) => {
                control.current = c;
              }}
            />
          </MarcoVisor3D>
          <p className="pod__aviso" role="status" aria-live="polite">
            {aviso ?? 'Elegí una herramienta y tocá un diente.'}
          </p>
          <div className="pod__controles">
            <Segmento etiqueta="Vista" opciones={VISTAS} valor={vista} alCambiar={setVista} />
            <Segmento
              etiqueta="Estado de los hallazgos nuevos"
              opciones={ESTADOS}
              valor={estadoNuevo}
              alCambiar={setEstadoNuevo}
            />
            <Boton onClick={() => control.current?.centrar()}>Centrar</Boton>
          </div>
          <div
            className="cn-leyenda cn-leyenda--herramientas pod__herramientas"
            role="toolbar"
            aria-label="Marcar en el odontograma"
          >
            <span className="cn-leyenda__rotulo">Marcar</span>
            {[...HERRAMIENTAS, 'sano' as const].map((h) => (
              <button
                key={h}
                type="button"
                className={'cn-leyenda__item' + (herramienta === h ? ' is-activo' : '')}
                aria-pressed={herramienta === h}
                title={h === 'sano' ? 'Quita todas las marcas del diente' : CATALOGO[h].descripcion}
                onClick={() => setHerramienta(h)}
              >
                <Glifo
                  svg={
                    h === 'sano'
                      ? '<circle r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>'
                      : CATALOGO[h].icono
                  }
                />
                {h === 'sano' ? 'Sano' : CATALOGO[h].nombre}
              </button>
            ))}
          </div>
          {herramienta === 'caries' ? (
            <Segmento
              etiqueta="Clase de Black"
              opciones={[
                { id: 'auto', texto: 'Por cara' },
                ...CLASES.map((c) => ({ id: c, texto: c })),
              ]}
              valor={clase}
              alCambiar={setClase}
            />
          ) : null}
          <LeyendaOdontograma soloLeyenda className="pod__leyenda" />
        </div>

        <aside className="pod__panel" aria-label="Eventos y estado">
          <section className="pod__tarjeta">
            <h2 className="pod__titulo">Eventos emitidos ({eventos.length})</h2>
            {eventos.length ? (
              <pre className="pod__json" data-testid="eventos">
                {JSON.stringify(eventos.slice(0, 5), null, 2)}
              </pre>
            ) : (
              <p className="pod__vacio">Todavía no tocaste ningún diente.</p>
            )}
          </section>
          <section className="pod__tarjeta">
            <h2 className="pod__titulo">
              Estado resultante ({Object.keys(estado).length} dientes con marcas)
            </h2>
            <pre className="pod__json pod__json--largo" data-testid="estado">
              {JSON.stringify(estado, null, 1)}
            </pre>
          </section>
          <section className="pod__tarjeta">
            <h2 className="pod__titulo">Mediciones</h2>
            <dl className="pod__datos">
              <div>
                <dt>Primer cuadro</dt>
                <dd data-testid="primer-cuadro">
                  {primerCuadro === null ? '—' : `${primerCuadro} ms`}
                </dd>
              </div>
              <div>
                <dt>Diente elegido (pulsación larga)</dt>
                <dd>{elegido ? `${elegido} · ${info(Number(elegido)).nombre}` : '—'}</dd>
              </div>
            </dl>
            <div className="pod__acciones">
              <Boton onClick={() => void medir()} cargando={midiendo} disabled={midiendo}>
                Medir giro (5 s)
              </Boton>
              <Boton onClick={empezarCiclo} disabled={!!ciclo}>
                Montar y desmontar {MONTAJES} veces
              </Boton>
            </div>
            {medicion ? (
              <p className="pod__medicion" data-testid="medicion">
                {medicion}
              </p>
            ) : null}
            {ciclo ? (
              <p className="pod__medicion">
                Montaje {ciclo.hechos + 1} de {MONTAJES}…
              </p>
            ) : null}
            {resultadoCiclo ? (
              <p className="pod__medicion" data-testid="ciclo">
                {resultadoCiclo.montajes} montajes en {resultadoCiclo.msTotal} ms (primer cuadro
                promedio {resultadoCiclo.msPromedio} ms) · memoria JS{' '}
                {resultadoCiclo.memoriaAntesMB ?? '—'} → {resultadoCiclo.memoriaDespuesMB ?? '—'} MB
                · lienzos en la página: {resultadoCiclo.lienzosVivos}
              </p>
            ) : null}
            {ciclo ? (
              <div className="pod__ciclo" aria-hidden={true}>
                <Odontograma3D
                  key={ciclo.hechos}
                  denticion={denticion}
                  estado={estado}
                  herramienta="caries"
                  estadoNuevo="por_realizar"
                  soloLectura
                  onPrimerCuadro={alPrimerCuadroCiclo}
                />
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      <section className="pod__segunda">
        <div className="pod__acciones">
          <Boton onClick={() => setSegunda((s) => !s)}>
            {segunda ? 'Quitar visor de solo lectura' : 'Montar visor de solo lectura'}
          </Boton>
        </div>
        {segunda ? (
          <MarcoVisor3D
            denticion={denticion}
            onDenticion={otraDenticion}
            titulo="Solo lectura (mismo estado)"
            ayuda="Tocá un diente para elegirlo; no se marca nada."
          >
            <Odontograma3D
              className="pod__visor pod__visor--chico"
              denticion={denticion}
              estado={estado}
              herramienta={herramienta}
              estadoNuevo={estadoNuevo}
              vista="oclusal"
              soloLectura
              rotulosLado
              onElegirDiente={(f) => setElegido(f)}
            />
          </MarcoVisor3D>
        ) : null}
      </section>
      <PieMaqueta />
    </div>
  );
}
