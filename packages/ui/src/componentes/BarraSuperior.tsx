import type { ReactElement, ReactNode } from 'react';
import type { AccionUsuario, Idioma, PacienteResultado, Sede, UsuarioBarra } from '../tipos.js';
import { cx } from '../utilidades.js';
import { Avatar } from './Avatar.js';
import { Buscador } from './Buscador.js';
import { Icono } from './Icono.js';
import { Marca } from './navegacion.js';
import { SelectorIdioma } from './SelectorIdioma.js';
import { useDesplegable } from './useDesplegable.js';

export const TEXTO_TODAS_LAS_SEDES = 'Todas las sedes';

export interface BarraSuperiorProps {
  idioma?: Idioma | undefined;
  onIdioma?: ((v: Idioma) => void) | undefined;
  /** Sede como texto fijo (sin selector). */
  sede?: string | undefined;
  /** Sedes que el usuario puede elegir. Con `onSede`, la sede pasa a ser un menú. */
  sedes?: Sede[] | undefined;
  /** Id de la sede activa; `null` = «Todas las sedes». */
  sedeActiva?: string | null | undefined;
  onSede?: ((id: string | null) => void) | undefined;
  /** Agrega «Todas las sedes» al selector (p. ej. dueños o roles con permiso en todas). */
  permitirTodas?: boolean | undefined;
  notificaciones?: number | undefined;
  onNotificaciones?: (() => void) | undefined;
  usuario?: UsuarioBarra | undefined;
  /** Con esta función, el perfil abre un menú con «Cerrar sesión». */
  onCerrarSesion?: (() => void) | undefined;
  /** Acciones extra del menú de usuario, antes de «Cerrar sesión». */
  accionesUsuario?: AccionUsuario[] | undefined;
  resultados?: PacienteResultado[] | undefined;
  onElegirPaciente?: ((p: PacienteResultado) => void) | undefined;
  /** Buscador controlado (búsqueda en el servidor): valor + onBusqueda. */
  valorBusqueda?: string | undefined;
  onBusqueda?: ((v: string) => void) | undefined;
  /** Muestra la marca (cuando no hay barra lateral, p. ej. tablet). */
  conMarca?: boolean | undefined;
  /** Versión celular: sin ES · GN y con menos relleno. */
  compacta?: boolean | undefined;
  logo?: ReactNode;
  className?: string | undefined;
}

/* ---------- Selector de sede ---------- */
function SelectorSede({
  sedes,
  sedeActiva,
  onSede,
  permitirTodas,
}: {
  sedes: Sede[];
  sedeActiva: string | null | undefined;
  onSede: (id: string | null) => void;
  permitirTodas: boolean;
}): ReactElement {
  const { abierto, idMenu, refRaiz, refBoton, refMenu, alternar, cerrar, alTecla } =
    useDesplegable();
  const opciones: { id: string | null; nombre: string }[] = [
    ...(permitirTodas ? [{ id: null, nombre: TEXTO_TODAS_LAS_SEDES }] : []),
    ...sedes,
  ];
  const actual =
    sedeActiva === null && permitirTodas
      ? TEXTO_TODAS_LAS_SEDES
      : (sedes.find((s) => s.id === sedeActiva)?.nombre ??
        (permitirTodas ? TEXTO_TODAS_LAS_SEDES : (sedes[0]?.nombre ?? '')));
  const idActual =
    sedeActiva === undefined ? (permitirTodas ? null : (sedes[0]?.id ?? null)) : sedeActiva;
  return (
    <div ref={refRaiz} className="cn-desplegable" onKeyDown={alTecla}>
      <button
        ref={refBoton}
        type="button"
        className="cn-superior__sede"
        aria-label={`Sede: ${actual}. Cambiar sede`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={alternar}
      >
        <Icono nombre="sede" tamano={20} />
        <span>{actual}</span>
        <Icono nombre="chevron-abajo" tamano={18} />
      </button>
      {abierto && (
        <ul
          ref={refMenu}
          id={idMenu}
          role="menu"
          aria-label="Sedes"
          className="cn-menu cn-menu--derecha"
        >
          {opciones.map((o) => {
            const elegida = o.id === idActual;
            return (
              <li key={o.id ?? '*'} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={elegida}
                  tabIndex={-1}
                  className="cn-menu__item"
                  onClick={() => {
                    cerrar(true);
                    if (!elegida) onSede(o.id);
                  }}
                >
                  {elegida ? (
                    <Icono nombre="check" tamano={20} />
                  ) : (
                    <span className="cn-menu__marca" aria-hidden={true} />
                  )}
                  {o.nombre}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- Menú de usuario ---------- */
function MenuUsuario({
  usuario,
  onCerrarSesion,
  acciones,
}: {
  usuario: UsuarioBarra;
  onCerrarSesion: (() => void) | undefined;
  acciones: AccionUsuario[];
}): ReactElement {
  const { abierto, idMenu, refRaiz, refBoton, refMenu, alternar, cerrar, alTecla } =
    useDesplegable();
  return (
    <div ref={refRaiz} className="cn-desplegable" onKeyDown={alTecla}>
      <button
        ref={refBoton}
        type="button"
        className="cn-superior__perfil"
        aria-label={`Perfil de ${usuario.nombre}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={alternar}
      >
        <Avatar nombre={usuario.nombre} tamano="sm" decorativo={true} />
        <span className="cn-superior__perfil-texto">
          <span className="cn-superior__perfil-nombre">{usuario.nombre}</span>
          {usuario.rol ? <span className="cn-superior__perfil-rol">{usuario.rol}</span> : null}
        </span>
      </button>
      {abierto && (
        <ul
          ref={refMenu}
          id={idMenu}
          role="menu"
          aria-label={`Opciones de ${usuario.nombre}`}
          className="cn-menu cn-menu--derecha"
        >
          <li role="none" className="cn-menu__cabecera">
            <span className="cn-menu__cabecera-nombre">{usuario.nombre}</span>
            {usuario.rol ? <span className="cn-menu__cabecera-rol">{usuario.rol}</span> : null}
          </li>
          {acciones.map((a) => (
            <li key={a.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="cn-menu__item"
                onClick={() => {
                  cerrar(true);
                  a.onElegir();
                }}
              >
                {a.icono ? (
                  <Icono nombre={a.icono} tamano={20} />
                ) : (
                  <span className="cn-menu__marca" aria-hidden={true} />
                )}
                {a.texto}
              </button>
            </li>
          ))}
          {onCerrarSesion && (
            <>
              <li role="separator" className="cn-menu__separador" />
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="cn-menu__item"
                  onClick={() => {
                    cerrar(false);
                    onCerrarSesion();
                  }}
                >
                  <Icono nombre="salir" tamano={20} />
                  Cerrar sesión
                </button>
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  );
}

/** Barra superior: buscador global, ES · GN, sede, notificaciones y perfil. */
export function BarraSuperior({
  idioma,
  onIdioma,
  sede,
  sedes,
  sedeActiva,
  onSede,
  permitirTodas,
  notificaciones,
  onNotificaciones,
  usuario,
  onCerrarSesion,
  accionesUsuario,
  resultados,
  onElegirPaciente,
  valorBusqueda,
  onBusqueda,
  conMarca,
  compacta,
  logo,
  className,
}: BarraSuperiorProps): ReactElement {
  const conSelector =
    !!onSede && !!sedes && (sedes.length > 1 || (!!permitirTodas && sedes.length > 0));
  const sedeFija =
    sede ?? (sedes && sedes.length > 0 && !conSelector ? sedes[0]?.nombre : undefined);
  const conMenuUsuario = !!onCerrarSesion || (accionesUsuario?.length ?? 0) > 0;

  return (
    <header className={cx('cn-superior', compacta && 'cn-superior--compacta', className)}>
      {conMarca && <Marca logo={logo} />}
      <Buscador
        compacto={true}
        resultados={resultados}
        onElegir={onElegirPaciente}
        valor={valorBusqueda}
        onCambio={onBusqueda}
      />
      <div className="cn-superior__acciones">
        <SelectorIdioma valor={idioma} onCambio={onIdioma} />
        {conSelector && sedes && onSede ? (
          <SelectorSede
            sedes={sedes}
            sedeActiva={sedeActiva}
            onSede={onSede}
            permitirTodas={!!permitirTodas}
          />
        ) : sedeFija ? (
          <span
            className="cn-superior__sede cn-superior__sede--fija"
            role="img"
            aria-label={`Sede: ${sedeFija}`}
          >
            <Icono nombre="sede" tamano={20} />
            <span>{sedeFija}</span>
          </span>
        ) : null}
        <button
          type="button"
          className="cn-superior__campana"
          aria-label={
            notificaciones ? `Notificaciones: ${notificaciones} sin leer` : 'Notificaciones'
          }
          onClick={onNotificaciones}
        >
          <Icono nombre="campana" tamano={22} />
          {notificaciones ? (
            <span className="cn-punto" aria-hidden={true}>
              {notificaciones}
            </span>
          ) : null}
        </button>
        {usuario &&
          (conMenuUsuario ? (
            <MenuUsuario
              usuario={usuario}
              onCerrarSesion={onCerrarSesion}
              acciones={accionesUsuario ?? []}
            />
          ) : (
            <span
              className="cn-superior__perfil"
              role="img"
              aria-label={`Perfil de ${usuario.nombre}`}
            >
              <Avatar nombre={usuario.nombre} tamano="sm" decorativo={true} />
              <span className="cn-superior__perfil-texto">
                <span className="cn-superior__perfil-nombre">{usuario.nombre}</span>
                {usuario.rol ? (
                  <span className="cn-superior__perfil-rol">{usuario.rol}</span>
                ) : null}
              </span>
            </span>
          ))}
      </div>
    </header>
  );
}
