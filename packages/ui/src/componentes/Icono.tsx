import type { ReactElement } from 'react';
import { cx } from '../utilidades.js';

/* Íconos lineales: trazo 2px, puntas y uniones redondeadas, caja de 24, en currentColor. */
type Forma =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number; relleno?: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number; rx: number };

const P = (d: string): Forma => ({ t: 'path', d });
const C = (x: number, y: number, r: number, relleno = false): Forma => ({
  t: 'circle',
  cx: x,
  cy: y,
  r,
  relleno,
});
const Q = (x: number, y: number, w: number, h: number, rx: number): Forma => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  rx,
});

const ICONOS = {
  inicio: [P('M4 11.5 12 5l8 6.5'), P('M6 10v9.5h12V10'), P('M10 19.5v-5h4v5')],
  agenda: [Q(3, 5, 18, 16, 3), P('M3 10h18'), P('M8 3v4'), P('M16 3v4')],
  pacientes: [
    C(9, 8, 3.5),
    P('M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6'),
    C(17, 9, 2.5),
    P('M17.5 14c2 .3 3.5 2 3.5 4.2'),
  ],
  caja: [Q(3, 6, 18, 14, 3), P('M3 10.5h18'), P('M15.5 15h2.5')],
  odontologia: [
    P(
      'M12 6.2C10.6 4.8 9.1 4 7.6 4 5.1 4 3.5 6 3.5 8.6c0 2 .8 3.5 1.3 5.2.6 2 .9 6.2 2.7 6.2 1.8 0 1.8-4.6 4.5-4.6s2.7 4.6 4.5 4.6c1.8 0 2.1-4.2 2.7-6.2.5-1.7 1.3-3.2 1.3-5.2C20.5 6 18.9 4 16.4 4c-1.5 0-3 .8-4.4 2.2z',
    ),
  ],
  personal: [Q(4, 3, 16, 18, 3), C(12, 10, 2.5), P('M8 17c.6-1.8 2.2-3 4-3s3.4 1.2 4 3')],
  inventario: [
    P('M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z'),
    P('M3.5 7.5 12 12l8.5-4.5'),
    P('M12 12v9'),
  ],
  comunitaria: [
    P('M12 20s-7.5-4.4-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.6 12 20 12 20z'),
  ],
  estadisticas: [P('M4 20h16'), P('M7 16v-5'), P('M12 16V6'), P('M17 16v-8')],
  buscar: [C(11, 11, 6.5), P('M20 20l-4.3-4.3')],
  campana: [P('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z'), P('M10 20.5a2 2 0 0 0 4 0')],
  mas: [P('M12 5v14'), P('M5 12h14')],
  'menu-mas': [C(5, 12, 1.4, true), C(12, 12, 1.4, true), C(19, 12, 1.4, true)],
  check: [P('M5 12.5l4.5 4.5L19 7.5')],
  cerrar: [P('M6 6l12 12'), P('M18 6L6 18')],
  alerta: [
    P('M10.3 4.9 3 17.5A2 2 0 0 0 4.7 20.5h14.6a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z'),
    P('M12 9.5v4.5'),
    P('M12 17.2v.1'),
  ],
  info: [C(12, 12, 9), P('M12 11v5.5'), P('M12 7.8v.1')],
  exportar: [P('M12 4v11'), P('M7.5 10.5 12 15l4.5-4.5'), P('M5 19.5h14')],
  candado: [Q(5, 10.5, 14, 10, 2.5), P('M8 10.5V8a4 4 0 0 1 8 0v2.5')],
  'sin-conexion': [
    P('M3 3l18 18'),
    P('M8.5 16.3a5 5 0 0 1 5.6-.9'),
    P('M5 12.8a10 10 0 0 1 4-2.4'),
    P('M14.6 10.3a10 10 0 0 1 4.4 2.5'),
    P('M2 9.3a15 15 0 0 1 4.2-2.7'),
    P('M10.5 5.6A15 15 0 0 1 22 9.3'),
    C(12, 19.8, 1, true),
  ],
  idioma: [
    C(12, 12, 9),
    P('M3 12h18'),
    P('M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z'),
  ],
  chevron: [P('M9 6l6 6-6 6')],
  'chevron-abajo': [P('M6 9l6 6 6-6')],
  telefono: [
    P(
      'M5 4h3.5L10 8l-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    ),
  ],
  mensaje: [
    P('M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z'),
  ],
  reloj: [C(12, 12, 9), P('M12 7v5l3.5 2')],
  ojo: [P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z'), C(12, 12, 3)],
  'ojo-cerrado': [
    P('M3 3l18 18'),
    P('M10.6 6A9.9 9.9 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-2.7 3.5'),
    P('M6.5 7.2C4 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1'),
    P('M9.9 10a3 3 0 0 0 4.1 4.1'),
  ],
  imprimir: [P('M7 9V4h10v5'), Q(3.5, 9, 17, 8, 2), P('M7 14h10v6H7z')],
  archivo: [P('M6 3h8l4 4v14H6z'), P('M14 3v4h4')],
  familia: [
    C(8, 7, 2.5),
    C(16, 7, 2.5),
    C(12, 14, 2),
    P('M3.5 20c0-3 2-5 4.5-5'),
    P('M20.5 20c0-3-2-5-4.5-5'),
    P('M9 21c0-1.7 1.3-3 3-3s3 1.3 3 3'),
  ],
  sube: [P('M4 16l5-5 4 4 7-7'), P('M15 8h5v5')],
  baja: [P('M4 8l5 5 4-4 7 7'), P('M15 16h5v-5')],
  sincronizar: [
    P('M20 11a8 8 0 0 0-14.3-4.3L4 8.5'),
    P('M4 4v4.5h4.5'),
    P('M4 13a8 8 0 0 0 14.3 4.3L20 15.5'),
    P('M20 20v-4.5h-4.5'),
  ],
  sede: [
    P('M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16'),
    P('M16 9h2a2 2 0 0 1 2 2v10'),
    P('M3 21h18'),
    P('M8 7h4'),
    P('M8 11h4'),
    P('M8 15h4'),
  ],
  tabla: [Q(3, 4, 18, 16, 2.5), P('M3 9.5h18'), P('M3 14.5h18'), P('M9.5 9.5V20')],
  /* Agregado en @conecta/ui (mismo trazo, forma de Lucide «log-out»): «Cerrar sesión». */
  salir: [
    P('M9 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9'),
    P('M16 16.5 20.5 12 16 7.5'),
    P('M20.5 12H9'),
  ],
} satisfies Record<string, Forma[]>;

export type IconoNombre = keyof typeof ICONOS;

/** Nombres de todos los íconos del set. */
export const NOMBRES_ICONOS = Object.keys(ICONOS) as IconoNombre[];

export interface IconoProps {
  nombre: IconoNombre;
  tamano?: number | undefined;
  /** Con título el ícono se anuncia; sin título es decorativo (aria-hidden). */
  titulo?: string | undefined;
  className?: string | undefined;
}

export function Icono({ nombre, tamano = 24, titulo, className }: IconoProps): ReactElement {
  const formas: Forma[] = (ICONOS as Record<string, Forma[]>)[nombre] ?? ICONOS.info;
  return (
    <svg
      className={cx('cn-icono', className)}
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={titulo ? 'img' : undefined}
      aria-label={titulo || undefined}
      aria-hidden={titulo ? undefined : true}
    >
      {formas.map((f, i) => {
        if (f.t === 'path') return <path key={i} d={f.d} />;
        if (f.t === 'circle')
          return (
            <circle
              key={i}
              cx={f.cx}
              cy={f.cy}
              r={f.r}
              fill={f.relleno ? 'currentColor' : 'none'}
            />
          );
        return <rect key={i} x={f.x} y={f.y} width={f.w} height={f.h} rx={f.rx} />;
      })}
    </svg>
  );
}

Icono.nombres = NOMBRES_ICONOS;
