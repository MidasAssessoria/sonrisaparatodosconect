import { useState, type ReactElement } from 'react';
import type { Idioma } from '../tipos.js';
import { cx } from '../utilidades.js';

export interface SelectorIdiomaProps {
  valor?: Idioma | undefined;
  onCambio?: ((v: Idioma) => void) | undefined;
  className?: string | undefined;
}

const OPCIONES: { id: Idioma; corto: string; largo: string }[] = [
  { id: 'es', corto: 'ES', largo: 'Español' },
  { id: 'gn', corto: 'GN', largo: 'Guaraní' },
];

/** Selector ES · GN de la interfaz: grupo de radio (flechas para cambiar). */
export function SelectorIdioma({ valor, onCambio, className }: SelectorIdiomaProps): ReactElement {
  const [interno, setInterno] = useState<Idioma>(valor ?? 'es');
  const actual = valor ?? interno;
  function elegir(v: Idioma) {
    setInterno(v);
    onCambio?.(v);
  }
  return (
    <div
      className={cx('cn-segmento', 'cn-idioma', className)}
      role="radiogroup"
      aria-label="Idioma de la interfaz"
    >
      {OPCIONES.map((o) => {
        const activo = actual === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-label={o.largo}
            title={o.largo}
            tabIndex={activo ? 0 : -1}
            className={cx('cn-segmento__opcion', activo && 'is-activo')}
            onClick={() => elegir(o.id)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                const otro = OPCIONES.find((x) => x.id !== o.id);
                if (!otro) return;
                elegir(otro.id);
                const hermano = e.currentTarget.parentElement?.querySelector<HTMLElement>(
                  `[aria-label="${otro.largo}"]`,
                );
                hermano?.focus();
              }
            }}
          >
            {o.corto}
          </button>
        );
      })}
    </div>
  );
}
