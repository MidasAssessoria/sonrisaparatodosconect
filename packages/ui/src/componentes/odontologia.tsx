import { useState, type ReactElement, type ReactNode } from 'react';
import { cx } from '../utilidades.js';
import { Giro } from './Boton.js';
import { Icono } from './Icono.js';

/* ---------- LeyendaOdontograma ---------- */
export type MarcaClinica = 'caries' | 'extraccion' | 'periodontal' | 'sano';

const MARCAS: { id: MarcaClinica; nombre: string }[] = [
  { id: 'caries', nombre: 'Caries' },
  { id: 'extraccion', nombre: 'Extracción' },
  { id: 'periodontal', nombre: 'Periodontal' },
  { id: 'sano', nombre: 'Sano' },
];

function GlifoMarca({ tipo }: { tipo: MarcaClinica }): ReactElement {
  let hijo: ReactElement;
  if (tipo === 'caries') hijo = <circle cx={12} cy={12} r={6} className="cn-glifo--caries" />;
  else if (tipo === 'extraccion')
    hijo = <path d="M6 6l12 12M18 6L6 18" className="cn-glifo--extraccion" />;
  else if (tipo === 'periodontal')
    hijo = <path d="M4.5 15c4-5.3 11-5.3 15 0" className="cn-glifo--periodontal" />;
  else hijo = <circle cx={12} cy={12} r={6.5} className="cn-glifo--sano" />;
  return (
    <svg
      className="cn-glifo"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      aria-hidden={true}
      focusable="false"
    >
      {hijo}
    </svg>
  );
}

export interface LeyendaOdontogramaProps {
  seleccion?: MarcaClinica | undefined;
  onElegir?: ((m: MarcaClinica) => void) | undefined;
  /** Solo leyenda, sin botones. */
  soloLeyenda?: boolean | undefined;
  vertical?: boolean | undefined;
  className?: string | undefined;
}

export function LeyendaOdontograma({
  seleccion,
  onElegir,
  soloLeyenda,
  vertical,
  className,
}: LeyendaOdontogramaProps): ReactElement {
  const [interna, setInterna] = useState<MarcaClinica>(seleccion ?? 'caries');
  const sel = seleccion ?? interna;
  const interactiva = !soloLeyenda;
  return (
    <div
      className={cx(
        'cn-leyenda',
        interactiva && 'cn-leyenda--herramientas',
        vertical && 'cn-leyenda--vertical',
        className,
      )}
      role={interactiva ? 'toolbar' : undefined}
      aria-label="Marcar en el odontograma"
      aria-orientation={interactiva ? (vertical ? 'vertical' : 'horizontal') : undefined}
    >
      <span className="cn-leyenda__rotulo">Marcar</span>
      {MARCAS.map((m) => {
        if (!interactiva)
          return (
            <span key={m.id} className="cn-leyenda__item">
              <GlifoMarca tipo={m.id} />
              {m.nombre}
            </span>
          );
        const activo = sel === m.id;
        return (
          <button
            key={m.id}
            type="button"
            className={cx('cn-leyenda__item', activo && 'is-activo')}
            aria-pressed={activo}
            onClick={() => {
              setInterna(m.id);
              onElegir?.(m.id);
            }}
          >
            <GlifoMarca tipo={m.id} />
            {m.nombre}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- MarcoVisor3D ---------- */
export type Denticion = 'adulto' | 'pediatrico';

export interface MarcoVisor3DProps {
  denticion?: Denticion | undefined;
  onDenticion?: ((d: Denticion) => void) | undefined;
  cargando?: boolean | undefined;
  titulo?: ReactNode;
  ayuda?: ReactNode;
  /** El visor 3D real se monta aquí. */
  children?: ReactNode;
  className?: string | undefined;
}

const DENTICIONES: { id: Denticion; texto: string }[] = [
  { id: 'adulto', texto: 'Adulto 11–48' },
  { id: 'pediatrico', texto: 'Pediátrico 51–85' },
];

export function MarcoVisor3D({
  denticion,
  onDenticion,
  cargando,
  titulo,
  ayuda,
  children,
  className,
}: MarcoVisor3DProps): ReactElement {
  const [interna, setInterna] = useState<Denticion>(denticion ?? 'adulto');
  const den = denticion ?? interna;
  function elegir(v: Denticion) {
    setInterna(v);
    onDenticion?.(v);
  }
  return (
    <section className={cx('cn-visor', className)} aria-label="Odontograma">
      <div className="cn-visor__cabecera">
        <p className="cn-visor__titulo">{titulo ?? 'Odontograma'}</p>
        <div className="cn-segmento" role="radiogroup" aria-label="Dentición">
          {DENTICIONES.map((o) => {
            const a = den === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={a}
                className={cx('cn-segmento__opcion', a && 'is-activo')}
                onClick={() => elegir(o.id)}
              >
                {o.texto}
              </button>
            );
          })}
        </div>
      </div>
      <div className="cn-visor__escena">
        <span className="cn-visor__rotulo cn-visor__rotulo--sup">
          <span aria-hidden={true}>▲ </span>Superior
        </span>
        <span className="cn-visor__rotulo cn-visor__rotulo--inf">
          <span aria-hidden={true}>▼ </span>Inferior
        </span>
        <span className="cn-visor__rotulo cn-visor__rotulo--der">Derecha</span>
        <span className="cn-visor__rotulo cn-visor__rotulo--izq">Izquierda</span>
        <div className="cn-visor__lienzo" aria-busy={cargando || undefined}>
          {children ??
            (cargando ? (
              <p className="cn-visor__marcador">
                <Giro />
                Cargando visor…
              </p>
            ) : (
              <p className="cn-visor__marcador">
                <Icono nombre="odontologia" tamano={32} />
                <span className="cn-visor__marcador-titulo">Visor 3D del odontograma</span>
                <span>{den === 'adulto' ? 'Numeración FDI 11–48' : 'Numeración FDI 51–85'}</span>
              </p>
            ))}
        </div>
      </div>
      <p className="cn-visor__ayuda">
        {ayuda ??
          'Tocá la cara del diente: la clase de Black sale sola. Derecha e izquierda del paciente.'}
      </p>
    </section>
  );
}
