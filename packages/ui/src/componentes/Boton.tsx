import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { cx } from '../utilidades.js';
import { Icono, type IconoNombre } from './Icono.js';

/** Indicador de carga (gira; con «reducir movimiento» gira más lento). */
export function Giro(): ReactElement {
  return <span className="cn-giro" aria-hidden={true} />;
}

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primario: una vez por vista. secundario (por defecto), fantasma, peligro. */
  variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro' | undefined;
  /** md = 48px, lg = 56px (sillón, acción principal en móvil). */
  tamano?: 'md' | 'lg' | undefined;
  icono?: IconoNombre | null | undefined;
  iconoFinal?: IconoNombre | null | undefined;
  cargando?: boolean | undefined;
  bloque?: boolean | undefined;
}

export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  {
    variante = 'secundario',
    tamano = 'md',
    icono,
    iconoFinal,
    cargando,
    bloque,
    className,
    children,
    disabled,
    type = 'button',
    ...resto
  },
  ref,
) {
  const conTexto = children != null && children !== false;
  return (
    <button
      ref={ref}
      type={type}
      {...resto}
      className={cx(
        'cn-boton',
        `cn-boton--${variante}`,
        `cn-boton--${tamano}`,
        bloque && 'cn-boton--bloque',
        !conTexto && 'cn-boton--icono',
        className,
      )}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
    >
      {cargando ? <Giro /> : icono ? <Icono nombre={icono} tamano={20} /> : null}
      {conTexto ? <span>{children}</span> : null}
      {iconoFinal && !cargando ? <Icono nombre={iconoFinal} tamano={20} /> : null}
    </button>
  );
});
