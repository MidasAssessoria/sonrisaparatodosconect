/**
 * Modelo del odontograma: numeración FDI, anatomía (medidas), catálogo de marcas y normalizador.
 * Lógica pura (sin three.js ni DOM): se prueba en Node.
 *
 * Portado de `referencia/maqueta/codigo/app.js`: `CARA`, `LETRAS`, `MS`, `nombreCara`, `DIM`,
 * `NOMBRE_A`, `NOMBRE_N`, `info`, `orden`, `MARC`, `PATO`, `MKS`, `conEstado`, `normM`, `canon`.
 */

export type Denticion = 'adulto' | 'pediatrico';
export type Cara = 'O' | 'M' | 'D' | 'V' | 'L';
export type ClaseBlack = 'I' | 'II' | 'III' | 'IV' | 'V';
export type ClaseElegida = 'auto' | ClaseBlack;
export type EstadoHallazgo = 'por_realizar' | 'realizado';

/** Marcadores que la maqueta guarda en `m.mk` (todo lo que no es caries, extracción ni periodontal). */
export type Marcador =
  | 'corona'
  | 'implante'
  | 'endodoncia'
  | 'ausente'
  | 'protesis'
  | 'sellante'
  | 'periapical'
  | 'fractura'
  | 'reabsorcion'
  | 'movilidad'
  | 'fistula';

export interface Lesion {
  cl: ClaseBlack;
  cara: Cara;
}

/**
 * Estado de un diente, igual al de la maqueta (`M`): caries por cara, extracción, periodontal,
 * marcadores, claves «realizado» (`rea`: 'ext', 'per', 'car:O', 'corona'…) y grado de movilidad.
 */
export interface MarcaDiente {
  car: Lesion[];
  ext: boolean;
  per: boolean;
  mk: Marcador[];
  rea: string[];
  mov: number;
}

/** fdi (como texto: «11», «85») → marcas. Un diente sin marcas no figura. */
export type EstadoOdontograma = Record<string, MarcaDiente>;

/** Los 14 tipos de hallazgo del doc 12 (`hallazgo_dental.tipo`). */
export type TipoHallazgo =
  | 'caries'
  | 'extraccion_indicada'
  | 'periodontal'
  | 'corona'
  | 'implante'
  | 'endodoncia'
  | 'ausente'
  | 'protesis'
  | 'sellante'
  | 'lesion_periapical'
  | 'fractura'
  | 'reabsorcion'
  | 'movilidad'
  | 'fistula';

/** Herramienta activa: un tipo de hallazgo o «sano» (quita todo lo del diente). */
export type Herramienta = TipoHallazgo | 'sano';

export const PATO = ['periapical', 'fractura', 'reabsorcion', 'movilidad', 'fistula'] as const;
export const MKS: readonly Marcador[] = [
  'corona',
  'implante',
  'endodoncia',
  'ausente',
  'protesis',
  'sellante',
  ...PATO,
];

export const TIPO_DE_MARCADOR: Readonly<Record<Marcador, TipoHallazgo>> = {
  corona: 'corona',
  implante: 'implante',
  endodoncia: 'endodoncia',
  ausente: 'ausente',
  protesis: 'protesis',
  sellante: 'sellante',
  periapical: 'lesion_periapical',
  fractura: 'fractura',
  reabsorcion: 'reabsorcion',
  movilidad: 'movilidad',
  fistula: 'fistula',
};

export function marcadorDeTipo(t: TipoHallazgo): Marcador | null {
  for (const k of MKS) if (TIPO_DE_MARCADOR[k] === t) return k;
  return null;
}

/** Todos los hallazgos tienen estado de tratamiento, salvo el diente ausente (doc 12). */
export const conEstado = (id: string): boolean => id !== 'ausente';

export const ROM = ['', 'I', 'II', 'III'] as const;
export const CLASES: readonly ClaseBlack[] = ['I', 'II', 'III', 'IV', 'V'];

/* ---------- catálogo visual (barra de herramientas, leyenda, rótulos) ---------- */
export interface EntradaCatalogo {
  nombre: string;
  /** Color propio del marcador. Caries, extracción y periodontal: colores clínicos fijos del design system. */
  color: string;
  descripcion: string;
  /** Contenido SVG en caja -10..10 (constante del código, no texto del usuario). */
  icono: string;
}

export const CATALOGO: Readonly<Record<TipoHallazgo, EntradaCatalogo>> = {
  caries: {
    nombre: 'Caries',
    color: '#16161A',
    descripcion: 'Mancha negra sobre la cara afectada (clase de Black I a V).',
    icono: '<path d="M-7,0 C-7,-6 -1,-8 3,-6 C8,-4 8,4 2,6 C-4,8 -7,4 -7,0Z" fill="#16161A"/>',
  },
  extraccion_indicada: {
    nombre: 'Extracción indicada',
    color: '#1A5FB4',
    descripcion: 'Cruz azul sobre el diente, que se vuelve translúcido.',
    icono:
      '<g stroke="#1A5FB4" stroke-width="3.6" stroke-linecap="round"><path d="M-7,-7 L7,7"/><path d="M7,-7 L-7,7"/></g>',
  },
  periodontal: {
    nombre: 'Periodontal',
    color: '#D7262B',
    descripcion: 'Anillo rojo en el cuello y encía enrojecida.',
    icono:
      '<path d="M-9,4 Q0,-8 9,4" fill="none" stroke="#D7262B" stroke-width="4" stroke-linecap="round"/>',
  },
  corona: {
    nombre: 'Corona',
    color: '#E0A100',
    descripcion: 'Casquete dorado metálico sobre la corona.',
    icono:
      '<path d="M-8,5 L-8,-3 L-4,-7 L0,-3 L4,-7 L8,-3 L8,5Z" fill="#E0A100" stroke="#8A6200" stroke-width="1.2" stroke-linejoin="round"/>',
  },
  implante: {
    nombre: 'Implante',
    color: '#0E9F8E',
    descripcion: 'Tornillo turquesa en lugar de la raíz.',
    icono:
      '<g fill="none" stroke="#0E9F8E" stroke-width="2.6" stroke-linecap="round"><path d="M-5,-7 H5"/><path d="M-4,-2 H4"/><path d="M-3,3 H3"/><path d="M0,6 V8"/></g>',
  },
  endodoncia: {
    nombre: 'Endodoncia',
    color: '#8E3FD6',
    descripcion: 'Conducto violeta visible dentro de la raíz.',
    icono:
      '<path d="M-5,-8 C-2,-2 -2,3 0,8 C2,3 2,-2 5,-8" fill="none" stroke="#8E3FD6" stroke-width="3.2" stroke-linecap="round"/>',
  },
  ausente: {
    nombre: 'Ausente',
    color: '#6B7280',
    descripcion: 'Diente fantasma con círculo tachado gris.',
    icono:
      '<g fill="none" stroke="#6B7280" stroke-width="2.8" stroke-linecap="round"><circle r="7"/><path d="M-5,-5 L5,5"/></g>',
  },
  protesis: {
    nombre: 'Prótesis',
    color: '#F26B1D',
    descripcion: 'Banda naranja alrededor de la corona y tinte cálido.',
    icono:
      '<g fill="none" stroke="#F26B1D" stroke-width="3.4" stroke-linecap="round"><path d="M-8,-1 H8"/><path d="M-8,5 H8" opacity=".55"/></g>',
  },
  sellante: {
    nombre: 'Sellante',
    color: '#2FB344',
    descripcion: 'Capa verde sobre fosas y fisuras de la cara oclusal.',
    icono:
      '<g fill="#2FB344"><circle cx="-4" cy="-2" r="3"/><circle cx="4" cy="-2" r="3"/><circle cx="0" cy="4" r="3"/></g>',
  },
  lesion_periapical: {
    nombre: 'Lesión periapical',
    color: '#6B1D3A',
    descripcion: 'Halo oscuro en el ápice de la raíz.',
    icono:
      '<circle r="8.5" fill="#6B1D3A" opacity=".3"/><circle r="5" fill="#6B1D3A" opacity=".6"/><circle r="2.4" fill="#6B1D3A"/>',
  },
  fractura: {
    nombre: 'Fractura',
    color: '#E5197A',
    descripcion: 'Línea en zigzag rosa atravesando la corona.',
    icono:
      '<path d="M-8,-3 L-4,3 L0,-3 L4,3 L8,-3" fill="none" stroke="#E5197A" stroke-width="2.8" stroke-linejoin="miter" stroke-linecap="round"/>',
  },
  reabsorcion: {
    nombre: 'Reabsorción radicular',
    color: '#8B5E34',
    descripcion: 'Muescas marrones en el borde de la raíz.',
    icono:
      '<g fill="#8B5E34"><circle cx="-6" cy="-3" r="3.2"/><circle cx="6" cy="1" r="3.6"/><circle cx="-5" cy="5.5" r="2.8"/></g>',
  },
  movilidad: {
    nombre: 'Movilidad',
    color: '#00B8D9',
    descripcion:
      'Flechas celestes con el grado (I, II o III). Cada toque sube el grado; tras el III se quita.',
    icono:
      '<g fill="none" stroke="#00B8D9" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M-8,0 H8"/><path d="M-4.5,-3.5 L-8,0 L-4.5,3.5"/><path d="M4.5,-3.5 L8,0 L4.5,3.5"/></g>',
  },
  fistula: {
    nombre: 'Fístula',
    color: '#9ACD00',
    descripcion: 'Orificio verde lima en la encía con su trayecto hacia el ápice.',
    icono:
      '<g><circle cx="3" cy="-3" r="3.8" fill="#9ACD00"/><path d="M3,0 C3,4 -2,5 -6,8" fill="none" stroke="#9ACD00" stroke-width="2.2" stroke-linecap="round"/></g>',
  },
};

/** Orden de la barra de herramientas: los tres clínicos primero, después los marcadores y la patología. */
export const HERRAMIENTAS: readonly TipoHallazgo[] = [
  'caries',
  'extraccion_indicada',
  'periodontal',
  'corona',
  'implante',
  'endodoncia',
  'ausente',
  'protesis',
  'sellante',
  'lesion_periapical',
  'fractura',
  'reabsorcion',
  'movilidad',
  'fistula',
];

/* ---------- caras ---------- */
// 0 oclusal/incisal · 1 mesial · 2 distal · 3 vestibular · 4 lingual/palatina
export const CARA: Readonly<Record<Cara, number>> = { O: 0, M: 1, D: 2, V: 3, L: 4 };
export const LETRAS: readonly Cara[] = ['O', 'M', 'D', 'V', 'L'];
/** Hacia dónde queda mesial en x local, por cuadrante. */
const MS: Readonly<Record<number, number>> = { 1: -1, 2: 1, 3: -1, 4: 1, 5: -1, 6: 1, 7: -1, 8: 1 };

/* ---------- anatomía (mm aproximados: [ancho M-D, ancho V-L, alto corona, largo raíz]) ---------- */
type Medidas = readonly [number, number, number, number];
const DIM: Readonly<Record<'U' | 'L' | 'u' | 'l', Readonly<Record<number, Medidas>>>> = {
  U: {
    1: [8.6, 7.0, 10.6, 13],
    2: [6.6, 6.2, 9.0, 13],
    3: [7.6, 8.0, 10.0, 17],
    4: [7.0, 9.0, 8.4, 14],
    5: [6.6, 9.0, 7.8, 14],
    6: [10.2, 11, 7.4, 12.5],
    7: [9.2, 11, 7.0, 11.5],
    8: [8.6, 10, 6.6, 10.5],
  },
  L: {
    1: [5.2, 6.0, 9.0, 12.5],
    2: [5.8, 6.4, 9.4, 14],
    3: [7.0, 7.6, 10.8, 16],
    4: [7.0, 7.6, 8.4, 14],
    5: [7.2, 8.0, 8.0, 14.5],
    6: [11.0, 10.4, 7.4, 13.5],
    7: [10.4, 10.0, 7.0, 13],
    8: [10.0, 9.6, 6.8, 11],
  },
  u: {
    1: [6.6, 5.2, 6.2, 10],
    2: [5.2, 4.4, 5.6, 10.5],
    3: [7.0, 7.0, 6.6, 13],
    4: [7.2, 8.6, 5.2, 8.5],
    5: [9.0, 10, 5.6, 9.5],
  },
  l: {
    1: [4.2, 4.0, 5.0, 9],
    2: [4.6, 4.2, 5.2, 10],
    3: [5.2, 5.4, 6.0, 11.5],
    4: [8.0, 7.2, 5.6, 9],
    5: [10, 9.0, 5.8, 10],
  },
};
const NOMBRE_A: Readonly<Record<number, string>> = {
  1: 'Incisivo central',
  2: 'Incisivo lateral',
  3: 'Canino',
  4: 'Primer premolar',
  5: 'Segundo premolar',
  6: 'Primer molar',
  7: 'Segundo molar',
  8: 'Tercer molar',
};
const NOMBRE_N: Readonly<Record<number, string>> = {
  1: 'Incisivo central temporal',
  2: 'Incisivo lateral temporal',
  3: 'Canino temporal',
  4: 'Primer molar temporal',
  5: 'Segundo molar temporal',
};

export type TipoDiente = 'inc' | 'can' | 'pre' | 'mol';

export interface InfoDiente {
  fdi: number;
  /** Cuadrante 1–8. */
  q: number;
  /** Posición dentro del cuadrante. */
  p: number;
  nino: boolean;
  sup: boolean;
  der: boolean;
  kind: TipoDiente;
  /** Anterior: incisivo o canino. */
  ant: boolean;
  ms: number;
  W: number;
  D: number;
  H: number;
  L: number;
  nombre: string;
}

/** Numeración FDI de dos dígitos: adultos 11–48 (cuadrantes 1–4, posiciones 1–8); temporales 51–85 (5–8, 1–5). */
export function esFdiValido(fdi: number | string): boolean {
  const n = typeof fdi === 'string' ? (/^\d{2}$/.test(fdi) ? Number(fdi) : NaN) : fdi;
  if (!Number.isInteger(n)) return false;
  const q = Math.floor(n / 10),
    p = n % 10;
  if (q >= 1 && q <= 4) return p >= 1 && p <= 8;
  if (q >= 5 && q <= 8) return p >= 1 && p <= 5;
  return false;
}

export function denticionDe(fdi: number): Denticion {
  return Math.floor(fdi / 10) >= 5 ? 'pediatrico' : 'adulto';
}

export function info(fdi: number): InfoDiente {
  if (!esFdiValido(fdi)) throw new RangeError(`Número FDI inválido: ${fdi}`);
  const q = Math.floor(fdi / 10),
    p = fdi % 10;
  const nino = q >= 5;
  const sup = [1, 2, 5, 6].includes(q);
  const der = [1, 4, 5, 8].includes(q);
  const kind: TipoDiente = nino
    ? p <= 2
      ? 'inc'
      : p === 3
        ? 'can'
        : 'mol'
    : p <= 2
      ? 'inc'
      : p === 3
        ? 'can'
        : p <= 5
          ? 'pre'
          : 'mol';
  const medidas = DIM[nino ? (sup ? 'u' : 'l') : sup ? 'U' : 'L'][p] as Medidas;
  const [W, D, H, L] = medidas;
  const nombre = `${(nino ? NOMBRE_N : NOMBRE_A)[p] ?? ''} ${sup ? 'superior' : 'inferior'} ${der ? 'derecho' : 'izquierdo'}`;
  return {
    fdi,
    q,
    p,
    nino,
    sup,
    der,
    kind,
    ant: kind === 'inc' || kind === 'can',
    ms: MS[q] ?? 1,
    W,
    D,
    H,
    L,
    nombre,
  };
}

/** Nombre de la cara según el diente (incisal/oclusal, palatina/lingual). */
export function nombreCara(i: Pick<InfoDiente, 'ant' | 'sup'>, r: number): string {
  return (
    [
      i.ant ? 'incisal' : 'oclusal',
      'mesial',
      'distal',
      'vestibular',
      i.sup ? 'palatina' : 'lingual',
    ][r] ?? ''
  );
}

/** Orden de los dientes en pantalla: superior e inferior, de la derecha del paciente a la izquierda. */
export function orden(nino: boolean): { sup: number[]; inf: number[] } {
  const P = nino ? [5, 4, 3, 2, 1] : [8, 7, 6, 5, 4, 3, 2, 1];
  const [a, b, c, d] = nino ? [5, 6, 8, 7] : [1, 2, 4, 3];
  const desc = (q: number) => P.map((p) => q * 10 + p);
  const asc = (q: number) => [...P].reverse().map((p) => q * 10 + p);
  return { sup: [...desc(a), ...asc(b)], inf: [...desc(c), ...asc(d)] };
}

export function fdisDe(denticion: Denticion): number[] {
  const o = orden(denticion === 'pediatrico');
  return [...o.sup, ...o.inf];
}

/* ---------- normalizador ---------- */
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const esCara = (x: unknown): x is Cara =>
  typeof x === 'string' && (LETRAS as readonly string[]).includes(x);
const esClase = (x: unknown): x is ClaseBlack =>
  typeof x === 'string' && (CLASES as readonly string[]).includes(x);
const esMarcador = (x: unknown): x is Marcador =>
  typeof x === 'string' && (MKS as readonly string[]).includes(x);

/**
 * Normaliza un diente (`normM` de la maqueta). Cambios respecto de la maqueta, para que el dato que
 * sale sea válido: se descartan caries con clase o cara inválidas, una cara tiene a lo sumo una
 * caries (queda la última, doc 12 regla 2) y los marcadores repetidos se quitan.
 */
export function normM(x: unknown): MarcaDiente {
  const o = esObjeto(x) ? x : {};
  const car: Lesion[] = [];
  if (Array.isArray(o.car))
    for (const l of o.car as unknown[]) {
      if (!esObjeto(l) || !esClase(l.cl) || !esCara(l.cara)) continue;
      const cara = l.cara;
      const k = car.findIndex((c) => c.cara === cara);
      if (k >= 0) car.splice(k, 1);
      car.push({ cl: l.cl, cara });
    }
  const mk: Marcador[] = [];
  if (Array.isArray(o.mk))
    for (const k of o.mk as unknown[]) if (esMarcador(k) && !mk.includes(k)) mk.push(k);
  const ext = !!o.ext,
    per = !!o.per;
  const rea: string[] = [];
  if (Array.isArray(o.rea))
    for (const k of o.rea as unknown[]) {
      if (typeof k !== 'string' || rea.includes(k)) continue;
      const vale =
        k === 'ext'
          ? ext
          : k === 'per'
            ? per
            : k.startsWith('car:')
              ? car.some((l) => 'car:' + l.cara === k)
              : conEstado(k) && esMarcador(k) && mk.includes(k);
      if (vale) rea.push(k);
    }
  const movCrudo = typeof o.mov === 'number' ? o.mov : parseInt(String(o.mov), 10);
  const mov = mk.includes('movilidad')
    ? Math.min(3, Math.max(1, Number.isFinite(movCrudo) ? Math.trunc(movCrudo) : 1))
    : 0;
  return { car, ext, per, mk, rea, mov };
}

export const estaSano = (m: MarcaDiente): boolean =>
  !m.car.length && !m.ext && !m.per && !m.mk.length;

/** Forma canónica para comparar dos estados de un diente (`canon` de la maqueta). */
export function canon(m: MarcaDiente): string {
  return JSON.stringify({
    car: m.car.map((x) => `${x.cara}${x.cl}`).sort(),
    ext: m.ext,
    per: m.per,
    mk: m.mk.slice().sort(),
    mov: m.mov,
    rea: m.rea.slice().sort(),
  });
}

/** Normaliza un estado completo: quita fdi inválidos o de otra dentición y dientes sin marcas. */
export function normEstado(e: unknown, denticion?: Denticion): EstadoOdontograma {
  const out: EstadoOdontograma = {};
  if (!esObjeto(e)) return out;
  for (const [k, v] of Object.entries(e)) {
    if (!esFdiValido(k)) continue;
    if (denticion && denticionDe(Number(k)) !== denticion) continue;
    const m = normM(v);
    if (!estaSano(m)) out[k] = m;
  }
  return out;
}

/** fdi con marcas distintas entre dos estados (base de «comparar», doc 12 regla 8). */
export function dientesDistintos(a: EstadoOdontograma, b: EstadoOdontograma): number[] {
  const fs = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...fs]
    .filter((f) => canon(normM(a[f])) !== canon(normM(b[f])))
    .map(Number)
    .sort((x, y) => x - y);
}
