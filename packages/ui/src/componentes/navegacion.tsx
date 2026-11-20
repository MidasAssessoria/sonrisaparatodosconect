import {
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { ItemNavegacion, ModuloId, RenderEnlace } from '../tipos.js';
import { cx } from '../utilidades.js';
import { HojaInferior } from './HojaInferior.js';
import { Icono } from './Icono.js';

/** Módulos fijos del design system, en el orden de la barra lateral. */
export const MODULOS: ItemNavegacion<ModuloId>[] = [
  { id: 'inicio', nombre: 'Inicio', icono: 'inicio' },
  { id: 'pacientes', nombre: 'Pacientes', icono: 'pacientes' },
  { id: 'odontologia', nombre: 'Odontología', icono: 'odontologia' },
  { id: 'agenda', nombre: 'Agenda', icono: 'agenda' },
  { id: 'caja', nombre: 'Caja', icono: 'caja' },
  { id: 'personal', nombre: 'Personal', icono: 'personal' },
  { id: 'inventario', nombre: 'Inventario', icono: 'inventario' },
  { id: 'comunitaria', nombre: 'Sonrisa Comunitaria', icono: 'comunitaria' },
  { id: 'estadisticas', nombre: 'Estadísticas', icono: 'estadisticas' },
];

/** Destinos fijos de la barra inferior (el resto va en «Más»). */
export const DESTINOS_MOVIL: ModuloId[] = ['inicio', 'agenda', 'pacientes', 'caja'];

/* ---------- Marca ---------- */
export function Marca({ logo }: { logo?: ReactNode }): ReactElement {
  if (logo) return <div className="cn-marca">{logo}</div>;
  return (
    <div className="cn-marca">
      <span className="cn-marca__sobre">Sonrisa Para Todos</span>
      <span className="cn-marca__nombre">Conecta</span>
    </div>
  );
}

/* ---------- Enlace común ---------- */
interface EnlaceNavegacionProps<I extends string> {
  item: ItemNavegacion<I>;
  activo: boolean;
  className: string;
  rutas?: Partial<Record<string, string>> | undefined;
  onNavegar?: ((id: I) => void) | undefined;
  renderEnlace?: RenderEnlace<I> | undefined;
  /** Se llama después de navegar (p. ej. para cerrar la hoja «Más»). */
  alNavegar?: (() => void) | undefined;
  children: ReactNode;
}

function hrefDe<I extends string>(
  item: ItemNavegacion<I>,
  rutas: Partial<Record<string, string>> | undefined,
): string {
  return item.ruta ?? rutas?.[item.id] ?? `#${item.id}`;
}

function EnlaceNavegacion<I extends string>({
  item,
  activo,
  className,
  rutas,
  onNavegar,
  renderEnlace,
  alNavegar,
  children,
}: EnlaceNavegacionProps<I>): ReactNode {
  const href = hrefDe(item, rutas);
  const clases = cx(className, activo && 'is-activo');
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // Ctrl/Cmd/Shift-clic o botón del medio: que el navegador abra otra pestaña.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (onNavegar) {
      // Con renderEnlace, el router de la app navega; sin él, evitamos recargar.
      if (!renderEnlace) e.preventDefault();
      onNavegar(item.id);
    }
    alNavegar?.();
  }
  const ariaCurrent = activo ? ('page' as const) : undefined;
  if (renderEnlace) {
    return renderEnlace({
      item,
      href,
      className: clases,
      activo,
      'aria-current': ariaCurrent,
      onClick,
      children,
    });
  }
  return (
    <a href={href} className={clases} aria-current={ariaCurrent} onClick={onClick}>
      {children}
    </a>
  );
}

/* ---------- BarraLateral ---------- */
export interface BarraLateralProps<I extends string = ModuloId> {
  activo?: I | undefined;
  /**
   * Destinos de navegación. Por defecto, los módulos fijos del design system (`MODULOS`).
   * La app pasa solo los que el rol puede ver: los demás no aparecen (no se deshabilitan).
   */
  items?: ItemNavegacion<I>[] | undefined;
  /** Filtro adicional por id: solo se muestran estos. Por defecto, todos los `items`. */
  modulos?: I[] | undefined;
  rutas?: Partial<Record<I, string>> | undefined;
  onNavegar?: ((id: I) => void) | undefined;
  /** Dibuja cada enlace con el router de la app (sin recargar la página). */
  renderEnlace?: RenderEnlace<I> | undefined;
  /** Reemplaza la marca tipográfica cuando exista un logo definitivo. */
  logo?: ReactNode;
  pie?: ReactNode;
  className?: string | undefined;
}

export function BarraLateral<I extends string = ModuloId>({
  activo,
  items,
  modulos,
  rutas,
  onNavegar,
  renderEnlace,
  logo,
  pie,
  className,
}: BarraLateralProps<I>): ReactElement {
  const todos = items ?? (MODULOS as unknown as ItemNavegacion<I>[]);
  const visibles = modulos ? todos.filter((m) => modulos.includes(m.id)) : todos;
  return (
    <nav className={cx('cn-lateral', className)} aria-label="Módulos">
      <Marca logo={logo} />
      <ul className="cn-lateral__lista">
        {visibles.map((m) => (
          <li key={m.id}>
            <EnlaceNavegacion
              item={m}
              activo={activo === m.id}
              className="cn-lateral__item"
              rutas={rutas}
              onNavegar={onNavegar}
              renderEnlace={renderEnlace}
            >
              <Icono nombre={m.icono} tamano={22} />
              <span>{m.nombre}</span>
            </EnlaceNavegacion>
          </li>
        ))}
      </ul>
      <p className="cn-lateral__pie">{pie ?? 'Un proyecto de Sonrisa Para Todos'}</p>
    </nav>
  );
}

/* ---------- BarraInferior ---------- */
export interface BarraInferiorProps<I extends string = ModuloId> {
  /** Id activo. `'mas'` resalta «Más» (compatibilidad con el bundle). */
  activo?: I | 'mas' | undefined;
  fija?: boolean | undefined;
  rutas?: Partial<Record<string, string>> | undefined;
  onNavegar?: ((id: I) => void) | undefined;
  /** Todos los destinos permitidos. Por defecto, `MODULOS`. */
  items?: ItemNavegacion<I>[] | undefined;
  /**
   * Ids que van fijos en la barra (hasta 4). Por defecto Inicio, Agenda, Pacientes y Caja;
   * con `items` propios, los de esa lista que estén y, si faltan, los siguientes hasta 4.
   * El resto va en la hoja «Más».
   */
  principales?: I[] | undefined;
  renderEnlace?: RenderEnlace<I> | undefined;
  /** Contenido extra al pie de la hoja «Más» (ES · GN, ajustes, cerrar sesión). */
  contenidoMas?: ReactNode;
  /** Reemplaza la hoja «Más» interna (por ejemplo, para abrir una propia). */
  onMas?: (() => void) | undefined;
  className?: string | undefined;
}

export function BarraInferior<I extends string = ModuloId>({
  activo,
  fija,
  rutas,
  onNavegar,
  items,
  principales,
  renderEnlace,
  contenidoMas,
  onMas,
  className,
}: BarraInferiorProps<I>): ReactElement {
  const [masAbierto, setMasAbierto] = useState(false);
  const todos = items ?? (MODULOS as unknown as ItemNavegacion<I>[]);
  const ids: string[] = principales ?? DESTINOS_MOVIL;
  let fijos = ids
    .map((id) => todos.find((m) => m.id === id))
    .filter((m): m is ItemNavegacion<I> => !!m);
  // Con ítems propios y sin `principales`, se completa hasta 4 con los demás, en orden.
  if (!principales && items && fijos.length < 4) {
    fijos = [...fijos, ...todos.filter((m) => !fijos.includes(m))].slice(0, 4);
  }
  const resto = todos.filter((m) => !fijos.includes(m));
  const conMas = resto.length > 0 || contenidoMas != null || !!onMas;
  const activoEnMas = activo === 'mas' || resto.some((m) => m.id === activo);
  const columnas = fijos.length + (conMas ? 1 : 0);

  return (
    <>
      <nav
        className={cx('cn-inferior', fija && 'cn-inferior--fija', className)}
        aria-label="Navegación principal"
      >
        <ul style={{ '--cn-columnas': columnas } as CSSProperties}>
          {fijos.map((m) => (
            <li key={m.id}>
              <EnlaceNavegacion
                item={m}
                activo={activo === m.id}
                className="cn-inferior__item"
                rutas={rutas}
                onNavegar={onNavegar}
                renderEnlace={renderEnlace}
              >
                <span className="cn-inferior__icono">
                  <Icono nombre={m.icono} tamano={24} />
                </span>
                <span>{m.nombre}</span>
              </EnlaceNavegacion>
            </li>
          ))}
          {conMas && (
            <li>
              <button
                type="button"
                className={cx('cn-inferior__item', activoEnMas && 'is-activo-grupo')}
                aria-haspopup="dialog"
                aria-expanded={onMas ? undefined : masAbierto}
                onClick={() => (onMas ? onMas() : setMasAbierto(true))}
              >
                <span className="cn-inferior__icono">
                  <Icono nombre="menu-mas" tamano={24} />
                </span>
                <span>Más</span>
              </button>
            </li>
          )}
        </ul>
      </nav>
      {!onMas && (
        <HojaInferior abierta={masAbierto} titulo="Más" onCerrar={() => setMasAbierto(false)}>
          {resto.length > 0 && (
            <nav aria-label="Más módulos">
              <ul className="cn-mas__lista">
                {resto.map((m) => (
                  <li key={m.id}>
                    <EnlaceNavegacion
                      item={m}
                      activo={activo === m.id}
                      className="cn-mas__item"
                      rutas={rutas}
                      onNavegar={onNavegar}
                      renderEnlace={renderEnlace}
                      alNavegar={() => setMasAbierto(false)}
                    >
                      <Icono nombre={m.icono} tamano={22} />
                      <span>{m.nombre}</span>
                    </EnlaceNavegacion>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          {contenidoMas != null && <div className="cn-mas__extra">{contenidoMas}</div>}
        </HojaInferior>
      )}
    </>
  );
}
