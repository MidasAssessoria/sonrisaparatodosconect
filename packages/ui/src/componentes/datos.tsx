import { useState, type ReactElement, type ReactNode } from 'react';
import type { Tono, TonoColor } from '../tipos.js';
import { cx } from '../utilidades.js';
import { Chip } from './estado.js';
import { Icono, type IconoNombre } from './Icono.js';

/* ---------- TarjetaMetrica ---------- */
export interface TarjetaMetricaProps {
  etiqueta: ReactNode;
  valor: ReactNode;
  cambio?: string | undefined;
  tendencia?: 'sube' | 'baja' | 'igual' | undefined;
  /** Color del cambio según si es bueno o malo (no según la dirección). */
  tono?: 'exito' | 'atencion' | 'neutro' | undefined;
  nota?: string | undefined;
  icono?: IconoNombre | undefined;
  className?: string | undefined;
}

export function TarjetaMetrica({
  etiqueta,
  valor,
  cambio,
  tendencia = 'igual',
  tono = 'neutro',
  nota,
  icono,
  className,
}: TarjetaMetricaProps): ReactElement {
  return (
    <div className={cx('cn-metrica', className)}>
      <p className="cn-metrica__etiqueta">
        {icono ? <Icono nombre={icono} tamano={20} /> : null}
        {etiqueta}
      </p>
      <p className="cn-metrica__valor">{valor}</p>
      {cambio ? (
        <p className={cx('cn-metrica__cambio', `cn-metrica__cambio--${tono}`)}>
          {tendencia !== 'igual' ? (
            <Icono nombre={tendencia === 'sube' ? 'sube' : 'baja'} tamano={18} />
          ) : null}
          <span>{cambio}</span>
          {nota ? <span className="cn-metrica__nota"> {nota}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- GraficoBarras ---------- */
export interface DatoGrafico {
  etiqueta: string;
  valor: number;
  tono?: TonoColor | undefined;
  nota?: string | undefined;
  notaTono?: Tono | undefined;
}

export interface GraficoBarrasProps {
  titulo: ReactNode;
  datos: DatoGrafico[];
  tono?: TonoColor | undefined;
  maximo?: number | undefined;
  formato?: ((v: number) => string) | undefined;
  columnaEtiqueta?: string | undefined;
  columnaValor?: string | undefined;
  pie?: ReactNode;
  className?: string | undefined;
}

/** Barras horizontales con el valor escrito y «Ver como tabla». */
export function GraficoBarras({
  titulo,
  datos,
  tono,
  maximo,
  formato,
  columnaEtiqueta,
  columnaValor,
  pie,
  className,
}: GraficoBarrasProps): ReactElement {
  const [tabla, setTabla] = useState(false);
  const lista = datos ?? [];
  const max = maximo || Math.max(...lista.map((d) => d.valor), 1);
  const fmt = formato ?? ((v: number) => String(v));
  return (
    <figure className={cx('cn-grafico', className)}>
      <figcaption className="cn-grafico__cabecera">
        <span className="cn-grafico__titulo">{titulo}</span>
        <button
          type="button"
          className="cn-grafico__alternar"
          aria-pressed={tabla}
          onClick={() => setTabla(!tabla)}
        >
          <Icono nombre={tabla ? 'estadisticas' : 'tabla'} tamano={18} />
          {tabla ? 'Ver gráfico' : 'Ver como tabla'}
        </button>
      </figcaption>
      {tabla ? (
        <table className="cn-grafico__tabla">
          <thead>
            <tr>
              <th scope="col">{columnaEtiqueta ?? 'Dato'}</th>
              <th scope="col" className="is-fin">
                {columnaValor ?? 'Valor'}
              </th>
            </tr>
          </thead>
          <tbody>
            {lista.map((d, i) => (
              <tr key={i}>
                <th scope="row">{d.etiqueta}</th>
                <td className="is-fin">{fmt(d.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="cn-grafico__barras">
          {lista.map((d, i) => {
            const pct = Math.max(2, Math.round((d.valor / max) * 100));
            return (
              <li key={i} className="cn-grafico__fila">
                <span className="cn-grafico__etiqueta">{d.etiqueta}</span>
                <span className="cn-grafico__pista" aria-hidden={true}>
                  <span
                    className={`cn-grafico__barra cn-grafico__barra--${d.tono ?? tono ?? 'turquesa'}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="cn-grafico__valor">{fmt(d.valor)}</span>
                {d.nota ? <Chip tono={d.notaTono ?? 'atencion'}>{d.nota}</Chip> : null}
              </li>
            );
          })}
        </ul>
      )}
      {pie ? <p className="cn-grafico__pie">{pie}</p> : null}
    </figure>
  );
}
