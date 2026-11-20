import type { ReactElement, ReactNode } from 'react';
import { cx } from '../utilidades.js';

export interface Columna<F> {
  clave: string;
  titulo: string;
  alinear?: 'inicio' | 'fin' | undefined;
  render?: ((fila: F) => ReactNode) | undefined;
}

export interface TablaListaProps<F = Record<string, unknown>> {
  titulo?: string | undefined;
  columnas: Columna<F>[];
  filas: F[];
  /** Clave estable de cada fila (por defecto `fila.id` o el índice). */
  claveFila?: ((fila: F, indice: number) => string | number) | undefined;
  className?: string | undefined;
}

/** Tabla que se vuelve lista de tarjetas cuando el contenedor mide menos de 640px. */
export function TablaLista<F = Record<string, unknown>>({
  titulo,
  columnas,
  filas,
  claveFila,
  className,
}: TablaListaProps<F>): ReactElement {
  const cols = columnas ?? [];
  const lista = filas ?? [];
  const celda = (c: Columna<F>, f: F): ReactNode =>
    c.render ? c.render(f) : ((f as Record<string, unknown>)[c.clave] as ReactNode);
  const clave = (f: F, i: number): string | number => {
    if (claveFila) return claveFila(f, i);
    const id = (f as Record<string, unknown>)['id'];
    return typeof id === 'string' || typeof id === 'number' ? id : i;
  };
  const principal = cols[0];
  const fin = (c: Columna<F>) => (c.alinear === 'fin' ? 'is-fin' : undefined);
  return (
    <div className={cx('cn-tabla', className)}>
      <table className="cn-tabla__tabla">
        {titulo ? <caption className="cn-oculto">{titulo}</caption> : null}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.clave} scope="col" className={fin(c)}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lista.map((f, i) => (
            <tr key={clave(f, i)}>
              {cols.map((c, j) =>
                j === 0 ? (
                  <th key={c.clave} scope="row" className={fin(c)}>
                    {celda(c, f)}
                  </th>
                ) : (
                  <td key={c.clave} className={fin(c)}>
                    {celda(c, f)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="cn-tabla__tarjetas" aria-label={titulo}>
        {lista.map((f, i) => (
          <li key={clave(f, i)} className="cn-tabla__tarjeta">
            <p className="cn-tabla__principal">{principal ? celda(principal, f) : null}</p>
            <dl>
              {cols.slice(1).map((c) => (
                <div key={c.clave} className="cn-tabla__par">
                  <dt>{c.titulo}</dt>
                  <dd>{celda(c, f)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
