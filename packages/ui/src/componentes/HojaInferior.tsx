import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { cx, enfocables } from '../utilidades.js';
import { Icono } from './Icono.js';

export interface HojaInferiorProps {
  abierta: boolean;
  titulo: ReactNode;
  onCerrar?: (() => void) | undefined;
  acciones?: ReactNode;
  children?: ReactNode;
  /** Sin fondo ni posición fija (documentación). */
  enLinea?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Hoja inferior en el celular y modal centrado desde 768px.
 * Al abrir toma el foco y lo mantiene adentro; Escape o tocar el fondo cierran;
 * al cerrar devuelve el foco a donde estaba.
 */
export function HojaInferior({
  abierta,
  titulo,
  onCerrar,
  acciones,
  children,
  enLinea,
  className,
}: HojaInferiorProps): ReactElement | null {
  const id = useId();
  const refHoja = useRef<HTMLDivElement>(null);
  const refCerrar = useRef(onCerrar);
  useEffect(() => {
    refCerrar.current = onCerrar;
  });

  useEffect(() => {
    if (!abierta) return;
    const modal = !enLinea;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let overflowPrevio = '';
    if (modal) {
      refHoja.current?.focus();
      overflowPrevio = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    function tecla(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape' && refCerrar.current) {
        e.preventDefault();
        refCerrar.current();
        return;
      }
      if (e.key === 'Tab' && modal && refHoja.current) {
        const lista = enfocables(refHoja.current);
        const primero = lista[0];
        const ultimo = lista[lista.length - 1];
        if (!primero || !ultimo) {
          e.preventDefault();
          return;
        }
        const activo = document.activeElement;
        if (e.shiftKey && (activo === primero || activo === refHoja.current)) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && activo === ultimo) {
          e.preventDefault();
          primero.focus();
        } else if (!refHoja.current.contains(activo)) {
          e.preventDefault();
          primero.focus();
        }
      }
    }
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      if (modal) {
        document.body.style.overflow = overflowPrevio;
        if (previo && previo.isConnected) previo.focus();
      }
    };
  }, [abierta, enLinea]);

  if (!abierta) return null;
  return (
    <div
      className={cx('cn-hoja-fondo', enLinea && 'cn-hoja-fondo--en-linea')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar?.();
      }}
    >
      <div
        ref={refHoja}
        className={cx('cn-hoja', className)}
        role="dialog"
        aria-modal={enLinea ? undefined : true}
        aria-labelledby={id}
        tabIndex={-1}
      >
        <span className="cn-hoja__asa" aria-hidden={true} />
        <div className="cn-hoja__cabecera">
          <h2 id={id} className="cn-hoja__titulo">
            {titulo}
          </h2>
          {onCerrar && (
            <button
              type="button"
              className="cn-hoja__cerrar"
              aria-label="Cerrar"
              onClick={onCerrar}
            >
              <Icono nombre="cerrar" tamano={22} />
            </button>
          )}
        </div>
        <div className="cn-hoja__cuerpo">{children}</div>
        {acciones ? <div className="cn-hoja__acciones">{acciones}</div> : null}
      </div>
    </div>
  );
}
