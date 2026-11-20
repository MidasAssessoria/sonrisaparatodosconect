import type { ReactElement } from 'react';
import { cx } from '../utilidades.js';
import { Boton, Giro } from './Boton.js';
import { Icono, type IconoNombre } from './Icono.js';
import { useDesplegable } from './useDesplegable.js';

export type FormatoExportar = 'pdf' | 'excel' | 'imprimir';

const FORMATOS: { id: FormatoExportar; nombre: string; icono: IconoNombre }[] = [
  { id: 'pdf', nombre: 'PDF', icono: 'archivo' },
  { id: 'excel', nombre: 'Excel / CSV', icono: 'tabla' },
  { id: 'imprimir', nombre: 'Imprimir', icono: 'imprimir' },
];

export interface MenuExportarProps {
  /** inactivo | preparando («Preparando archivo…») | listo | error */
  estado?: 'inactivo' | 'preparando' | 'listo' | 'error' | undefined;
  onElegir?: ((formato: FormatoExportar) => void) | undefined;
  /** En móvil: solo el ícono, con aria-label «Exportar». */
  soloIcono?: boolean | undefined;
  /** Abierto al montar. */
  abierto?: boolean | undefined;
  /** Menú alineado a la derecha del botón (encabezado de página). */
  alinearDerecha?: boolean | undefined;
  className?: string | undefined;
}

export function MenuExportar({
  estado = 'inactivo',
  onElegir,
  soloIcono,
  abierto: abiertoInicial,
  alinearDerecha,
  className,
}: MenuExportarProps): ReactElement {
  const { abierto, idMenu, refRaiz, refBoton, refMenu, alternar, cerrar, alTecla } =
    useDesplegable(!!abiertoInicial);
  return (
    <div ref={refRaiz} className={cx('cn-exportar', className)} onKeyDown={alTecla}>
      <Boton
        ref={refBoton}
        variante="secundario"
        icono={estado === 'preparando' ? null : 'exportar'}
        cargando={estado === 'preparando'}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        aria-label={soloIcono ? 'Exportar' : undefined}
        onClick={alternar}
      >
        {soloIcono ? null : 'Exportar'}
      </Boton>
      {abierto && (
        <ul
          ref={refMenu}
          id={idMenu}
          role="menu"
          aria-label="Formatos para exportar"
          className={cx('cn-menu', alinearDerecha && 'cn-menu--derecha')}
        >
          {FORMATOS.map((f) => (
            <li key={f.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="cn-menu__item"
                onClick={() => {
                  cerrar(true);
                  onElegir?.(f.id);
                }}
              >
                <Icono nombre={f.icono} tamano={20} />
                {f.nombre}
              </button>
            </li>
          ))}
        </ul>
      )}
      {estado !== 'inactivo' && (
        <p className={cx('cn-exportar__estado', `cn-exportar__estado--${estado}`)} role="status">
          {estado === 'preparando' ? (
            <Giro />
          ) : (
            <Icono nombre={estado === 'error' ? 'alerta' : 'check'} tamano={18} />
          )}
          {estado === 'preparando'
            ? 'Preparando archivo…'
            : estado === 'error'
              ? 'No se pudo preparar. Probá de nuevo.'
              : 'Listo · ya podés descargarlo'}
        </p>
      )}
    </div>
  );
}
