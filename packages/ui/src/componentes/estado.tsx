import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import type { Tono } from '../tipos.js';
import { cx } from '../utilidades.js';
import { Icono, type IconoNombre } from './Icono.js';

/* ---------- Chip ---------- */
const ICONO_TONO: Record<Tono, IconoNombre | null> = {
  exito: 'check',
  atencion: 'alerta',
  progreso: 'reloj',
  info: 'info',
  categoria: null,
  familia: 'familia',
  neutro: null,
};

export interface ChipProps {
  tono?: Tono | undefined;
  /** `null` quita el ícono; sin valor usa el del tono. */
  icono?: IconoNombre | null | undefined;
  children?: ReactNode;
  className?: string | undefined;
}

export function Chip({ tono = 'neutro', icono, children, className }: ChipProps): ReactElement {
  const i = icono === undefined ? ICONO_TONO[tono] : icono;
  return (
    <span className={cx('cn-chip', `cn-chip--${tono}`, className)}>
      {i ? <Icono nombre={i} tamano={16} /> : null}
      <span>{children}</span>
    </span>
  );
}

/* ---------- AlertaClinica ---------- */
export interface AlertaClinicaProps {
  alertas: { tipo: 'alergia' | 'condicion'; texto: string }[];
  compacta?: boolean | undefined;
  className?: string | undefined;
}

export function AlertaClinica({ alertas, compacta, className }: AlertaClinicaProps): ReactElement {
  const lista = alertas ?? [];
  if (!lista.length) {
    return (
      <div className={cx('cn-alertas', 'cn-alertas--vacia', className)}>
        <Icono nombre="check" tamano={18} />
        <span>Sin alertas clínicas registradas</span>
      </div>
    );
  }
  return (
    <section
      className={cx('cn-alertas', compacta && 'cn-alertas--compacta', className)}
      aria-label="Alertas clínicas"
    >
      {compacta ? null : <span className="cn-alertas__titulo">Alertas clínicas</span>}
      <ul className="cn-alertas__lista">
        {lista.map((a, i) => {
          const tipo = a.tipo === 'alergia' ? 'alergia' : 'condicion';
          return (
            <li key={i} className={`cn-alerta cn-alerta--${tipo}`}>
              <Icono nombre={tipo === 'alergia' ? 'alerta' : 'info'} tamano={18} />
              <span>{a.texto}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- AvisoExito ---------- */
export interface AvisoExitoProps {
  titulo: ReactNode;
  texto?: ReactNode;
  accion?: ReactNode;
  onCerrar?: (() => void) | undefined;
  /** En el celular, sobre la BarraInferior. Sin `accion`, se cierra solo a los 6 s. */
  flotante?: boolean | undefined;
  className?: string | undefined;
}

export function AvisoExito({
  titulo,
  texto,
  accion,
  onCerrar,
  flotante,
  className,
}: AvisoExitoProps): ReactElement {
  const refCerrar = useRef(onCerrar);
  useEffect(() => {
    refCerrar.current = onCerrar;
  });
  const autoCierre = !!flotante && !accion && !!onCerrar;
  useEffect(() => {
    if (!autoCierre) return;
    const t = setTimeout(() => refCerrar.current?.(), 6000);
    return () => clearTimeout(t);
  }, [autoCierre]);
  return (
    <div className={cx('cn-aviso', flotante && 'cn-aviso--flotante', className)} role="status">
      <span className="cn-aviso__sello" aria-hidden={true}>
        <Icono nombre="check" tamano={22} />
      </span>
      <div className="cn-aviso__cuerpo">
        <p className="cn-aviso__titulo">{titulo}</p>
        {texto ? <p className="cn-aviso__texto">{texto}</p> : null}
        {accion ? <div className="cn-aviso__accion">{accion}</div> : null}
      </div>
      {onCerrar && (
        <button
          type="button"
          className="cn-aviso__cerrar"
          aria-label="Cerrar aviso"
          onClick={onCerrar}
        >
          <Icono nombre="cerrar" tamano={20} />
        </button>
      )}
    </div>
  );
}

/* ---------- AvisoConexion ---------- */
const CONEXION = {
  'sin-conexion': { icono: 'sin-conexion', texto: 'Sin conexión · se guardará y sincronizará' },
  sincronizando: { icono: 'sincronizar', texto: 'Sincronizando…' },
  sincronizado: { icono: 'check', texto: 'Sincronizado' },
} as const satisfies Record<string, { icono: IconoNombre; texto: string }>;

export interface AvisoConexionProps {
  estado?: keyof typeof CONEXION | undefined;
  pendientes?: number | undefined;
  className?: string | undefined;
}

export function AvisoConexion({
  estado = 'sin-conexion',
  pendientes,
  className,
}: AvisoConexionProps): ReactElement {
  const d = CONEXION[estado];
  return (
    <p className={cx('cn-conexion', `cn-conexion--${estado}`, className)} role="status">
      <Icono nombre={d.icono} tamano={20} />
      <span>{d.texto}</span>
      {pendientes ? (
        <span className="cn-conexion__cuenta">
          {pendientes} {pendientes === 1 ? 'registro pendiente' : 'registros pendientes'}
        </span>
      ) : null}
    </p>
  );
}

/* ---------- EstadoVacio ---------- */
function IlustracionVacia(): ReactElement {
  return (
    <svg
      className="cn-vacio__ilustracion"
      viewBox="0 0 120 120"
      width={120}
      height={120}
      aria-hidden={true}
      focusable="false"
    >
      <circle cx={60} cy={60} r={56} className="cn-vacio__fondo" />
      <path
        className="cn-vacio__diente"
        d="M60 39c-5-4.7-10.2-7-15.4-7C36 32 30.5 38.8 30.5 47.6c0 6.9 2.8 12 4.5 17.8 2 6.9 3 21.3 9.3 21.3 6.2 0 6.2-15.8 15.7-15.8s9.5 15.8 15.7 15.8c6.3 0 7.3-14.4 9.3-21.3 1.7-5.8 4.5-10.9 4.5-17.8C89.5 38.8 84 32 75.4 32c-5.2 0-10.4 2.3-15.4 7z"
      />
      <path className="cn-vacio__sonrisa" d="M50 55c5.5 5 14.5 5 20 0" />
    </svg>
  );
}

export interface EstadoVacioProps {
  titulo: ReactNode;
  texto?: ReactNode;
  accion?: ReactNode;
  /** false para quitarla; o un nodo propio. */
  ilustracion?: ReactNode | false;
  className?: string | undefined;
}

export function EstadoVacio({
  titulo,
  texto,
  accion,
  ilustracion,
  className,
}: EstadoVacioProps): ReactElement {
  return (
    <div className={cx('cn-vacio', className)}>
      {ilustracion === false ? null : (ilustracion ?? <IlustracionVacia />)}
      <p className="cn-vacio__titulo">{titulo}</p>
      {texto ? <p className="cn-vacio__texto">{texto}</p> : null}
      {accion ? <div className="cn-vacio__accion">{accion}</div> : null}
    </div>
  );
}

/* ---------- PieMaqueta ---------- */
export interface PieMaquetaProps {
  texto?: ReactNode;
  className?: string | undefined;
}

export function PieMaqueta({ texto, className }: PieMaquetaProps): ReactElement {
  return (
    <p className={cx('cn-pie', className)}>
      {texto ?? 'Maqueta de concepto · los datos son un ejemplo'}
    </p>
  );
}
