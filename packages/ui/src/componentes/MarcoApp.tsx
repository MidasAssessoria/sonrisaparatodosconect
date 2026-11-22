import { useId, type ReactElement, type ReactNode } from 'react';
import type {
  AccionUsuario,
  Idioma,
  ItemNavegacion,
  PacienteResultado,
  RenderEnlace,
  Sede,
  UsuarioBarra,
} from '../tipos.js';
import { cx } from '../utilidades.js';
import { BarraSuperior } from './BarraSuperior.js';
import { BarraInferior, BarraLateral } from './navegacion.js';
import { SelectorIdioma } from './SelectorIdioma.js';

export interface MarcoAppProps<I extends string = string> {
  /** Destinos que el rol puede ver, en orden. Los que no estén no aparecen. */
  items: ItemNavegacion<I>[];
  activo?: I | undefined;
  /** Destinos fijos de la barra inferior del celular (el resto va en «Más»). */
  principalesMovil?: I[] | undefined;
  onNavegar?: ((id: I) => void) | undefined;
  renderEnlace?: RenderEnlace<I> | undefined;
  rutas?: Partial<Record<I, string>> | undefined;

  usuario?: UsuarioBarra | undefined;
  onCerrarSesion?: (() => void) | undefined;
  accionesUsuario?: AccionUsuario[] | undefined;

  sede?: string | undefined;
  sedes?: Sede[] | undefined;
  sedeActiva?: string | null | undefined;
  onSede?: ((id: string | null) => void) | undefined;
  permitirTodas?: boolean | undefined;

  idioma?: Idioma | undefined;
  onIdioma?: ((v: Idioma) => void) | undefined;
  notificaciones?: number | undefined;
  onNotificaciones?: (() => void) | undefined;

  /** `false` quita el buscador global de la barra superior. Por defecto se muestra. */
  conBuscador?: boolean | undefined;
  resultados?: PacienteResultado[] | undefined;
  onElegirPaciente?: ((p: PacienteResultado) => void) | undefined;
  valorBusqueda?: string | undefined;
  onBusqueda?: ((v: string) => void) | undefined;

  logo?: ReactNode;
  pieLateral?: ReactNode;
  /** Acción principal fija al pie en el celular (Boton primario lg bloque). */
  accionMovil?: ReactNode;
  /** Contenido extra de la hoja «Más», debajo del selector ES · GN. */
  contenidoMas?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
}

/**
 * Armazón responsivo de la aplicación (README «Layout»).
 * Escritorio/tablet (≥ 768px): BarraLateral + BarraSuperior + contenido hasta `contenido-max`.
 * Celular: BarraSuperior compacta (buscador) + contenido + BarraInferior fija con «Más».
 * El cambio es solo CSS (media queries): no depende de JS ni de medir la ventana.
 */
export function MarcoApp<I extends string = string>({
  items,
  activo,
  principalesMovil,
  onNavegar,
  renderEnlace,
  rutas,
  usuario,
  onCerrarSesion,
  accionesUsuario,
  sede,
  sedes,
  sedeActiva,
  onSede,
  permitirTodas,
  idioma,
  onIdioma,
  notificaciones,
  onNotificaciones,
  conBuscador,
  resultados,
  onElegirPaciente,
  valorBusqueda,
  onBusqueda,
  logo,
  pieLateral,
  accionMovil,
  contenidoMas,
  children,
  className,
}: MarcoAppProps<I>): ReactElement {
  const idContenido = useId();
  return (
    <div className={cx('cn-marco', accionMovil != null && 'cn-marco--con-accion', className)}>
      <a className="cn-saltar" href={`#${idContenido}`}>
        Ir al contenido
      </a>
      <div className="cn-marco__lateral">
        <BarraLateral
          items={items}
          activo={activo}
          rutas={rutas}
          onNavegar={onNavegar}
          renderEnlace={renderEnlace}
          logo={logo}
          pie={pieLateral}
        />
      </div>
      <div className="cn-marco__principal">
        <BarraSuperior
          className="cn-marco__superior"
          idioma={idioma}
          onIdioma={onIdioma}
          sede={sede}
          sedes={sedes}
          sedeActiva={sedeActiva}
          onSede={onSede}
          permitirTodas={permitirTodas}
          notificaciones={notificaciones}
          onNotificaciones={onNotificaciones}
          usuario={usuario}
          onCerrarSesion={onCerrarSesion}
          accionesUsuario={accionesUsuario}
          conBuscador={conBuscador}
          resultados={resultados}
          onElegirPaciente={onElegirPaciente}
          valorBusqueda={valorBusqueda}
          onBusqueda={onBusqueda}
        />
        <main id={idContenido} className="cn-marco__contenido" tabIndex={-1}>
          <div className="cn-marco__ancho">{children}</div>
        </main>
      </div>
      {accionMovil != null && <div className="cn-marco__accion-movil">{accionMovil}</div>}
      <div className="cn-marco__inferior">
        <BarraInferior
          fija={true}
          items={items}
          activo={activo}
          principales={principalesMovil}
          rutas={rutas}
          onNavegar={onNavegar}
          renderEnlace={renderEnlace}
          contenidoMas={
            <>
              <span className="cn-mas__rotulo">Idioma de la interfaz</span>
              <SelectorIdioma valor={idioma} onCambio={onIdioma} />
              {contenidoMas}
            </>
          }
        />
      </div>
    </div>
  );
}

/* ---------- EncabezadoPagina ---------- */
export interface EncabezadoPaginaProps {
  titulo: ReactNode;
  /** MenuExportar y la acción primaria, a la derecha. */
  acciones?: ReactNode;
  className?: string | undefined;
}

/** Encabezado de página: título (h1) a la izquierda y acciones a la derecha. */
export function EncabezadoPagina({
  titulo,
  acciones,
  className,
}: EncabezadoPaginaProps): ReactElement {
  return (
    <div className={cx('cn-encabezado', className)}>
      <h1 className="cn-encabezado__titulo">{titulo}</h1>
      {acciones ? <div className="cn-encabezado__acciones">{acciones}</div> : null}
    </div>
  );
}
