import { Icono } from '@conecta/ui';
import { useId, type ReactNode } from 'react';
import './catalogos.css';

/**
 * Interruptor sí/no (`role="switch"`). Falta en @conecta/ui: convendría pasarlo allá.
 * El estado se lee con color + ícono + texto («Sí» / «No»), sin depender del hover.
 */
export function Interruptor({
  etiqueta,
  ayuda,
  activo,
  onCambiar,
  textoSi = 'Sí',
  textoNo = 'No',
  deshabilitado,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  activo: boolean;
  onCambiar: (activo: boolean) => void;
  textoSi?: string;
  textoNo?: string;
  deshabilitado?: boolean;
}) {
  const id = useId();
  return (
    <div className="w-interruptor">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={activo}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        className="w-interruptor__control"
        disabled={deshabilitado}
        onClick={() => onCambiar(!activo)}
      >
        <span className="w-interruptor__texto">{etiqueta}</span>
        <span className="w-interruptor__pista" aria-hidden="true">
          <span className="w-interruptor__perilla">
            <Icono nombre={activo ? 'check' : 'cerrar'} tamano={14} />
          </span>
        </span>
        <span className="w-interruptor__estado">{activo ? textoSi : textoNo}</span>
      </button>
      {ayuda ? (
        <p id={`${id}-ayuda`} className="w-secundario">
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}
