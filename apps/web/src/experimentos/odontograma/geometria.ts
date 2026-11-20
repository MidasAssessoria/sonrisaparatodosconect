/**
 * Geometría de los dientes generada por código (sin modelos ni texturas externas).
 *
 * Copia de `referencia/maqueta/codigo/app.js` con tipos y sin cambios en los números: `smooth`,
 * `gauss`, `anatomia`, `dSeg`, `corona`, `suavizarNormales`, `cavidad`, `raiz`, `raices`, `collar`,
 * `implanteGeo`, `conductoGeo`, `tachado`, `cruz`, `anilloElipse`, `hash`, `ruido`, `TONO`,
 * `datosCorona`, `kindSurco`.
 *
 * Única diferencia de fondo: la maqueta guardaba la `BufferGeometry` de cada corona y collar en un
 * `Map` global y la compartía. Acá el caché guarda solo los arreglos numéricos (datos inmutables y
 * deterministas, sin GPU); cada motor arma sus propias geometrías y las libera al desmontarse. Así
 * dos visores no se pisan y desmontar uno no rompe al otro.
 */
import * as THREE from 'three';
import type { InfoDiente } from './modelo.js';

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const gauss = (d2: number, s: number): number => Math.exp(-d2 / (2 * s * s));

/** Fracción de raíz que se ve en la vista completa. */
export const KR = 0.56;
/** Inclinación de las coronas hacia la cámara en la vista completa. */
export const TILT = 0.56;

type Seg = readonly [number, number, number, number, number];
interface Anatomia {
  c: readonly (readonly [number, number, number, number])[];
  f: readonly (readonly [number, number, number, number])[];
  s: readonly Seg[];
  r: readonly Seg[];
  cr?: readonly Seg[];
}

// Cara oclusal de posteriores, en coordenadas normalizadas (u: + mesial, w: + vestibular).
function anatomia(i: InfoDiente): Anatomia {
  const { kind, sup, p, nino } = i;
  const RM: Seg[] = [
    [0.82, -0.6, 0.82, 0.6, 0.5],
    [-0.82, -0.6, -0.82, 0.6, 0.5],
  ];
  if (kind === 'pre') {
    if (sup)
      return {
        c: [
          [0, 0.42, p === 4 ? 1.08 : 1, 0.26],
          [0, -0.42, p === 4 ? 0.85 : 0.95, 0.26],
        ],
        f: [
          [0.5, 0, 0.7, 0.13],
          [-0.5, 0, 0.7, 0.13],
        ],
        s: [[0.68, 0, -0.68, 0, 1]],
        r: RM,
      };
    if (p === 4)
      return {
        c: [
          [0, 0.32, 1.2, 0.3],
          [0, -0.52, 0.45, 0.2],
        ],
        f: [
          [0.42, -0.12, 0.6, 0.12],
          [-0.42, -0.12, 0.6, 0.12],
        ],
        s: [[0.5, -0.12, -0.5, -0.12, 0.6]],
        r: RM,
      };
    return {
      c: [
        [0, 0.38, 1.05, 0.28],
        [0.32, -0.45, 0.78, 0.2],
        [-0.35, -0.45, 0.62, 0.2],
      ],
      f: [[0, -0.05, 0.8, 0.12]],
      s: [
        [0.6, 0, -0.6, 0, 1],
        [0, -0.05, -0.02, -0.9, 0.8],
      ],
      r: RM,
    };
  }
  const primero = nino ? p === 5 : p === 6;
  if (sup) {
    if (nino && p === 4)
      return {
        c: [
          [0.35, 0.45, 1, 0.24],
          [-0.4, 0.45, 0.85, 0.22],
          [0.15, -0.42, 0.95, 0.28],
        ],
        f: [[0.05, 0, 0.8, 0.14]],
        s: [
          [0.65, 0, -0.65, 0, 1],
          [-0.05, 0.05, -0.1, 0.95, 0.6],
        ],
        r: RM,
      };
    return {
      c: [
        [0.45, 0.45, 1, 0.22],
        [-0.42, 0.45, 0.9, 0.21],
        [0.38, -0.4, 1.12, 0.27],
        [-0.5, -0.5, primero ? 0.72 : 0.5, 0.2],
      ],
      f: [
        [0.12, 0.02, 1, 0.14],
        [-0.4, -0.12, 0.7, 0.11],
        [0.66, 0, 0.45, 0.1],
      ],
      s: [
        [0.68, 0, 0.12, 0.02, 0.9],
        [0.12, 0.02, 0, 1, 0.85],
        [-0.4, -0.12, 0, -1, 0.8],
      ],
      cr: [[0.38, -0.4, -0.42, 0.45, primero ? 0.55 : 0.35]],
      r: RM,
    };
  }
  if (primero)
    return {
      // primer molar inferior (y segundo temporal): cinco cúspides
      c: [
        [0.55, 0.45, 0.95, 0.2],
        [0, 0.5, 0.9, 0.2],
        [-0.62, 0.3, 0.7, 0.17],
        [0.5, -0.45, 1.05, 0.22],
        [-0.35, -0.45, 1, 0.22],
      ],
      f: [
        [0.05, 0, 1, 0.14],
        [0.62, 0, 0.55, 0.1],
        [-0.6, -0.05, 0.55, 0.1],
      ],
      s: [
        [0.75, 0, -0.75, -0.03, 1],
        [0.28, 0, 0.3, 1, 0.8],
        [-0.35, -0.02, -0.48, 0.95, 0.75],
        [0.08, 0, 0.1, -1, 0.8],
      ],
      r: RM,
    };
  return {
    // segundo y tercer molar inferior, primer molar temporal inferior: cuatro cúspides en cruz
    c: [
      [0.45, 0.45, 1, 0.22],
      [-0.45, 0.45, 0.9, 0.22],
      [0.45, -0.45, 1.05, 0.22],
      [-0.45, -0.45, 0.95, 0.22],
    ],
    f: [
      [0, 0, 1, 0.15],
      [0.62, 0, 0.5, 0.1],
      [-0.62, 0, 0.5, 0.1],
    ],
    s: [
      [0.75, 0, -0.75, 0, 1],
      [0, 0, 0, 1, 0.8],
      [0, 0, 0, -1, 0.8],
    ],
    r: RM,
  };
}

function dSeg(u: number, w: number, s: Seg): number {
  const vx = s[2] - s[0],
    vz = s[3] - s[1],
    l2 = vx * vx + vz * vz;
  const k = Math.max(0, Math.min(1, ((u - s[0]) * vx + (w - s[1]) * vz) / l2));
  return Math.hypot(u - s[0] - k * vx, w - s[1] - k * vz);
}

interface DatosMalla {
  geo: THREE.BufferGeometry;
  reg: Uint8Array;
  tp: Float32Array;
  surco: Float32Array;
  ao: Float32Array;
  cav: Float32Array;
}

function corona(i: InfoDiente): DatosMalla {
  const { kind, W, D, H, nino, sup, ms, ant } = i;
  const A = ant ? null : anatomia(i);
  const g = new THREE.SphereGeometry(1, 88, 66);
  const pos = g.attributes.position as THREE.BufferAttribute,
    n = pos.count,
    v = new THREE.Vector3();
  const reg = new Uint8Array(n),
    tp = new Float32Array(n),
    surco = new Float32Array(n),
    ao = new Float32Array(n);
  const ex = kind === 'mol' ? 3.4 : kind === 'pre' ? 2.6 : 2.15;
  const mp = kind === 'inc' ? 7 : kind === 'can' ? 3.6 : 3;
  for (let k = 0; k < n; k++) {
    v.fromBufferAttribute(pos, k);
    const t = (v.y + 1) / 2,
      yy = 2 * t - 1;
    const hl = Math.hypot(v.x, v.z);
    const ux = hl > 1e-6 ? v.x / hl : 0,
      uz = hl > 1e-6 ? v.z / hl : 1;
    const sk = Math.pow(Math.pow(Math.abs(ux), ex) + Math.pow(Math.abs(uz), ex), -1 / ex);
    const r = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(yy), mp)), 1 / mp);
    const cuello = ant ? 0.64 + 0.36 * smooth(0, 0.55, t) : 0.72 + 0.28 * smooth(0, 0.5, t);
    const panza = 1 + 0.06 * Math.exp(-((t - 0.35) ** 2) / 0.02);
    const x = (ux * sk * r * cuello * W) / 2;
    let z = (uz * sk * r * cuello * (uz > 0 ? panza : 1) * D) / 2;
    let y = t * H;
    const u = (x * ms) / (W / 2);
    // cara por parámetros de la malla
    const um = ux * ms;
    let rg: number;
    if (t > 0.5 && r < (ant ? 0.88 : 0.82)) rg = 0;
    else if (Math.abs(um) > Math.abs(uz)) rg = um > 0 ? 1 : 2;
    else rg = uz > 0 ? 3 : 4;
    if (A) {
      const top = smooth(0.5, 1, t),
        w = z / (D / 2);
      let b = 0;
      for (const [cu, cw, h, s] of A.c) b += h * gauss((u - cu) ** 2 + (w - cw) ** 2, s);
      b = Math.min(b, 1.2);
      let f = 0;
      for (const [cu, cw, dd, s] of A.f) f += dd * gauss((u - cu) ** 2 + (w - cw) ** 2, s);
      let sg = 0;
      for (const s of A.s) sg = Math.max(sg, s[4] * gauss(dSeg(u, w, s) ** 2, 0.062));
      let cr = 0;
      for (const s of A.r) cr += s[4] * gauss(dSeg(u, w, s) ** 2, 0.09);
      for (const s of A.cr ?? []) cr += s[4] * gauss(dSeg(u, w, s) ** 2, 0.1) * (1 - 0.6 * sg);
      y += top * H * ((nino ? 0.18 : 0.24) * b + 0.07 * cr - 0.09 * f - 0.1 * sg - 0.14);
      surco[k] = top * Math.min(1, sg * 1.05 + f * 0.5);
      ao[k] = top * (1 - smooth(0.12, 0.8, b + 0.6 * cr)) * smooth(0.82, 0.95, t);
    } else {
      const wq = smooth(0.2, 1.0, t);
      z *= 1 - (kind === 'inc' ? 0.72 : 0.5) * wq;
      if (uz < 0) {
        // lingual/palatina: fosa, rebordes marginales y cíngulo
        const fosa = Math.exp(-((t - 0.6) ** 2) / 0.035) * gauss(u * u, 0.33);
        const reb = Math.exp(-((t - 0.6) ** 2) / 0.06) * gauss((Math.abs(u) - 0.72) ** 2, 0.12);
        const cing = Math.exp(-((t - 0.27) ** 2) / 0.012) * gauss(u * u, 0.45);
        z *= 1 - (sup ? 0.34 : 0.16) * fosa + 0.14 * reb;
        z -= cing * D * (sup ? 0.08 : 0.045);
        surco[k] = 0.3 * fosa * (sup ? 1 : 0.5);
        ao[k] = 0.35 * fosa;
      } else if (kind === 'inc') {
        // tres lóbulos vestibulares: dos depresiones suaves
        z *=
          1 -
          0.04 *
            smooth(0.35, 0.95, t) *
            (gauss((u - 0.36) ** 2, 0.08) + gauss((u + 0.36) ** 2, 0.08));
      } else {
        // reborde vestibular del canino
        z *= 1 + 0.09 * gauss(u * u, 0.22) * smooth(0.25, 0.9, t);
      }
      if (kind === 'inc') {
        // ángulo mesio-incisal recto, disto-incisal redondeado
        y -= smooth(0.72, 1, t) * H * (sup ? 0.1 : 0.035) * smooth(0.05, 1, -u);
      } else {
        // canino: punta algo a mesial, vertiente distal más larga
        const ap = 0.12,
          span = u > ap ? 1 - ap : 1 + ap;
        y +=
          smooth(0.45, 1, t) * ((1 - Math.min(1, Math.abs(u - ap) / span)) * H * 0.22 - H * 0.07);
      }
    }
    tp[k] = t;
    reg[k] = rg;
    pos.setXYZ(k, x, y, z);
  }
  g.computeVertexNormals();
  suavizarNormales(g, 88, 66);
  const cav = cavidad(g, 88, 66);
  return { geo: g, reg, tp, surco, ao, cav };
}

// SphereGeometry duplica la costura y los polos: se promedian las normales para que no se vea la junta.
function suavizarNormales(g: THREE.BufferGeometry, nx: number, ny: number): void {
  const nor = g.attributes.normal as THREE.BufferAttribute,
    W1 = nx + 1,
    v = new THREE.Vector3(),
    w = new THREE.Vector3();
  for (let iy = 0; iy <= ny; iy++) {
    const a = iy * W1;
    if (iy === 0 || iy === ny) {
      v.set(0, 0, 0);
      for (let ix = 0; ix <= nx; ix++) v.add(w.fromBufferAttribute(nor, a + ix));
      v.normalize();
      for (let ix = 0; ix <= nx; ix++) nor.setXYZ(a + ix, v.x, v.y, v.z);
    } else {
      v.fromBufferAttribute(nor, a)
        .add(w.fromBufferAttribute(nor, a + nx))
        .normalize();
      nor.setXYZ(a, v.x, v.y, v.z);
      nor.setXYZ(a + nx, v.x, v.y, v.z);
    }
  }
}

// Mapa de cavidad (laplaciano sobre la rejilla): + en surcos, fosas y cuello; − en crestas y cúspides.
function cavidad(g: THREE.BufferGeometry, nx: number, ny: number, K = 2): Float32Array {
  const pos = g.attributes.position as THREE.BufferAttribute,
    nor = g.attributes.normal as THREE.BufferAttribute,
    W1 = nx + 1;
  const cav = new Float32Array(pos.count),
    p = new THREE.Vector3(),
    q = new THREE.Vector3(),
    a = new THREE.Vector3(),
    nn = new THREE.Vector3();
  const id = (ix: number, iy: number) =>
    Math.min(ny, Math.max(0, iy)) * W1 + (((ix % nx) + nx) % nx);
  for (let iy = 1; iy < ny; iy++)
    for (let ix = 0; ix <= nx; ix++) {
      const k = iy * W1 + ix;
      p.fromBufferAttribute(pos, k);
      nn.fromBufferAttribute(nor, k);
      a.set(0, 0, 0);
      for (const [dx, dy] of [
        [K, 0],
        [-K, 0],
        [0, K],
        [0, -K],
      ] as const)
        a.add(q.fromBufferAttribute(pos, id(ix + dx, iy + dy)));
      cav[k] = a.multiplyScalar(0.25).sub(p).dot(nn);
    }
  return cav;
}

// Raíz: torneada, con curvatura apical, canal longitudinal en los lados proximales y color cemento→dentina.
export function raiz(
  r0: number,
  L: number,
  sz: number,
  bend = 0,
  surco = 0.07,
): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0, 1.2)];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const r = r0 * (1 - 0.82 * Math.pow(u, 1.35)) * (1 + 0.05 * Math.sin(u * Math.PI));
    pts.push(new THREE.Vector2(Math.max(r, 0.05), 0.8 - u * (L + 0.8)));
  }
  pts.push(new THREE.Vector2(0, -L - 0.35));
  const g = new THREE.LatheGeometry(pts, 44);
  g.scale(1, 1, sz);
  const pos = g.attributes.position as THREE.BufferAttribute,
    col = new Float32Array(pos.count * 3),
    c = new THREE.Color();
  const cTop = new THREE.Color(0xcba96c),
    cMid = new THREE.Color(0xe4cb98),
    cTip = new THREE.Color(0xefddb2);
  for (let k = 0; k < pos.count; k++) {
    let x = pos.getX(k);
    const y = pos.getY(k),
      z = pos.getZ(k);
    const d = Math.min(1, Math.max(0, -y / L));
    if (surco) {
      const a = Math.atan2(z / sz, x);
      x *=
        1 -
        surco * Math.pow(Math.abs(Math.cos(a)), 6) * smooth(0.05, 0.4, d) * (1 - smooth(0.8, 1, d));
    }
    if (bend) x += bend * L * d * d;
    pos.setX(k, x);
    c.copy(cTop)
      .lerp(cMid, smooth(0, 0.3, d))
      .lerp(cTip, smooth(0.35, 1, d));
    c.multiplyScalar(1 + (ruido(x * 0.8 + 5, y * 0.3, z * 0.8) - 0.5) * 0.14);
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export interface DatosRaiz {
  x: number;
  z: number;
  r: number;
  l: number;
  sz: number;
  rx: number;
  rz: number;
  bend: number;
}

export function raices(t: InfoDiente): DatosRaiz[] {
  const { kind, W, D, L, sup, p, nino } = t;
  const ab = nino ? 0.3 : 0.13; // raíces temporales más abiertas
  if (kind === 'mol' && sup)
    return [
      { x: 0.24 * W, z: 0.2 * D, r: 0.17 * W, l: L, sz: 1.2, rx: -ab, rz: ab, bend: 0.06 },
      {
        x: -0.24 * W,
        z: 0.2 * D,
        r: 0.16 * W,
        l: L * 0.94,
        sz: 1.2,
        rx: -ab,
        rz: -ab,
        bend: -0.06,
      },
      { x: 0, z: -0.24 * D, r: 0.2 * W, l: L * 1.05, sz: 1.1, rx: ab * 1.2, rz: 0, bend: 0.02 },
    ];
  if (kind === 'mol')
    return [
      { x: 0.27 * W, z: 0, r: 0.16 * W, l: L, sz: 2.3, rx: 0, rz: ab, bend: -0.06 },
      { x: -0.27 * W, z: 0, r: 0.15 * W, l: L * 0.93, sz: 2.2, rx: 0, rz: -ab, bend: 0.06 },
    ];
  if (kind === 'pre' && sup && p === 4)
    return [
      { x: 0, z: 0.2 * D, r: 0.22 * W, l: L, sz: 1.1, rx: -0.07, rz: 0, bend: 0.03 },
      { x: 0, z: -0.2 * D, r: 0.21 * W, l: L * 0.95, sz: 1.1, rx: 0.07, rz: 0, bend: 0.03 },
    ];
  const r = (kind === 'can' ? 0.34 : kind === 'pre' ? 0.31 : 0.3) * W;
  return [
    {
      x: 0,
      z: 0,
      r,
      l: L,
      sz: Math.max(1, D / W) * (kind === 'pre' ? 1.25 : 1.05),
      rx: 0,
      rz: 0,
      bend: -0.085 * t.ms,
    },
  ];
}

export const kindSurco = (i: InfoDiente): number =>
  i.kind === 'mol' ? 0 : i.kind === 'pre' && i.sup && i.p === 4 ? 0.04 : 0.07;

interface ArreglosCollar {
  pos: Float32Array;
  col: Float32Array;
  uv: Float32Array;
  nor: Float32Array;
  idx: number[];
}

// Collar gingival: banda festoneada (papilas hacia mesial y distal) que abraza el cuello y se desvanece sobre la raíz.
function collar(i: InfoDiente): ArreglosCollar {
  const { W, D, H, L, kind, ant, nino } = i;
  const ex = kind === 'mol' ? 3.4 : kind === 'pre' ? 2.6 : 2.15,
    mp = kind === 'inc' ? 7 : kind === 'can' ? 3.6 : 3;
  const rs = raices(i);
  const rrx = Math.max(...rs.map((r) => Math.abs(r.x) + r.r)) / (W / 2),
    rrz = Math.max(...rs.map((r) => Math.abs(r.z) + r.r * r.sz)) / (D / 2);
  const N = 64,
    M = 12,
    nv = (N + 1) * (M + 1);
  const pos = new Float32Array(nv * 3),
    col = new Float32Array(nv * 4),
    uv = new Float32Array(nv * 2),
    idx: number[] = [];
  const cA = new THREE.Color(0xefafaa),
    cB = new THREE.Color(0xdd9094),
    cC = new THREE.Color(0xc27780),
    c = new THREE.Color();
  const rc = (y: number) => {
    const t = Math.min(1, Math.max(0, y / H)),
      yy = 2 * t - 1;
    return (
      Math.pow(Math.max(0, 1 - Math.pow(Math.abs(yy), mp)), 1 / mp) *
      (ant ? 0.64 + 0.36 * smooth(0, 0.55, t) : 0.72 + 0.28 * smooth(0, 0.5, t))
    );
  };
  const alt = nino ? 0.75 : 1,
    yBot = -Math.min(L * 0.2, nino ? 1.8 : 2.7);
  for (let a = 0; a <= N; a++) {
    const th = (a / N) * Math.PI * 2,
      ux = Math.cos(th),
      uz = Math.sin(th);
    const sk = Math.pow(Math.pow(Math.abs(ux), ex) + Math.pow(Math.abs(uz), ex), -1 / ex);
    const yTop = 0.5 + (ant ? 1.7 : 1.25) * alt * Math.pow(Math.abs(ux), 2.2),
      hRim = rc(Math.max(0, yTop));
    for (let j = 0; j <= M; j++) {
      const s = j / M,
        y = yTop + (yBot - yTop) * s,
        k = a * (M + 1) + j;
      const dep = Math.max(0, -y) / L,
        tap = Math.max(0.35, 1 - 0.82 * Math.pow(dep, 1.35));
      const h = rc(Math.max(0, y)),
        e = smooth(0, 0.45, s); // el borde abraza la corona y se abre hacia abajo para cubrir las raíces
      const crx = Math.max(h, hRim + (Math.max(hRim, rrx * tap) - hRim) * e),
        crz = Math.max(h, hRim + (Math.max(hRim, rrz * tap) - hRim) * e);
      const bul =
        0.13 * smooth(0, 0.16, s) * (1 - 0.7 * smooth(0.35, 1, s)) -
        0.04 * (1 - smooth(0, 0.07, s));
      pos[k * 3] = (ux * sk * (crx + bul) * W) / 2;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = (uz * sk * (crz + bul) * D) / 2;
      c.copy(cA)
        .lerp(cB, smooth(0, 0.22, s))
        .lerp(cC, smooth(0.5, 1, s));
      col[k * 4] = c.r;
      col[k * 4 + 1] = c.g;
      col[k * 4 + 2] = c.b;
      col[k * 4 + 3] = 0.96 * (1 - smooth(0.38, 1, s));
      uv[k * 2] = (a / N) * 4;
      uv[k * 2 + 1] = s * 1.5;
    }
  }
  for (let a = 0; a < N; a++)
    for (let j = 0; j < M; j++) {
      const p = a * (M + 1) + j,
        q = (a + 1) * (M + 1) + j;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal as THREE.BufferAttribute,
    v = new THREE.Vector3(),
    w = new THREE.Vector3();
  for (let j = 0; j <= M; j++) {
    const e = N * (M + 1) + j;
    v.fromBufferAttribute(nor, j).add(w.fromBufferAttribute(nor, e)).normalize();
    nor.setXYZ(j, v.x, v.y, v.z);
    nor.setXYZ(e, v.x, v.y, v.z);
  }
  const arr = { pos, col, uv, nor: nor.array as Float32Array, idx };
  g.dispose();
  return arr;
}

// tornillo de implante: cuello liso y cuerpo roscado que se afina hacia el ápice
export function implanteGeo(i: InfoDiente): THREE.BufferGeometry {
  const r0 = Math.min(2.15, i.W * 0.24),
    Li = Math.min(i.L, 13) * 0.92,
    N = 9,
    pts = [
      new THREE.Vector2(0, 0.7),
      new THREE.Vector2(r0 * 0.92, 0.7),
      new THREE.Vector2(r0 * 1.05, 0.05),
    ];
  for (let k = 0; k < N; k++) {
    const u0 = k / N,
      u1 = (k + 0.5) / N,
      y0 = -u0 * Li - 0.5,
      y1 = -u1 * Li - 0.5,
      tp = 1 - 0.32 * u1;
    pts.push(new THREE.Vector2(r0 * tp * 1.06, y0), new THREE.Vector2(r0 * tp * 0.74, y1));
  }
  pts.push(new THREE.Vector2(r0 * 0.5, -Li - 0.5), new THREE.Vector2(0, -Li - 0.9));
  return new THREE.LatheGeometry(pts, 28);
}

// conducto radicular (obturación de endodoncia): tubo que sigue la raíz, incluida su curvatura
export function conductoGeo(r0: number, L: number, bend: number, H: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 9; k++) {
    const d = k / 9;
    pts.push(new THREE.Vector3(bend * L * d * d, H * 0.32 - d * (L * 0.9 + H * 0.32), 0));
  }
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts),
    28,
    Math.max(0.28, r0 * 0.15),
    8,
    false,
  );
}

export const matMarca = (c: THREE.ColorRepresentation): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.5,
    emissive: c,
    emissiveIntensity: 0.18,
  });

// círculo tachado (ausente / extraído)
export function tachado(R: number, rad: number, color: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, rad, 14, 56), matMarca(color)));
  const s = new THREE.Mesh(
    new THREE.CapsuleGeometry(rad, Math.max(0.1, 2 * R - 2 * rad), 6, 14),
    matMarca(color),
  );
  s.rotation.z = Math.PI / 4;
  g.add(s);
  return g;
}

export function cruz(
  w: number,
  h: number,
  rad: number,
  color: THREE.ColorRepresentation,
): THREE.Group {
  const g = new THREE.Group();
  const len = Math.hypot(w, h),
    ang = Math.atan2(h, w);
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len - 2 * rad, 6, 14), matMarca(color));
    m.rotation.z = s * (Math.PI / 2 - ang);
    g.add(m);
  }
  return g;
}

export function anilloElipse(
  a: number,
  b: number,
  tubo: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial> {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(t) * a, 0, Math.sin(t) * b));
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, tubo, 10, true),
    matMarca(color),
  );
}

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
export function ruido(x: number, y: number, z: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const a = x - xi,
    b = y - yi,
    c = z - zi;
  const u = a * a * (3 - 2 * a),
    v = b * b * (3 - 2 * b),
    w = c * c * (3 - 2 * c);
  const l = (p: number, q: number, t: number) => p + (q - p) * t,
    h = (i: number, j: number, k: number) => hash(xi + i, yi + j, zi + k);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v),
    w,
  );
}

/* ---------- colores base del esmalte ---------- */
const tono = (h: number) => new THREE.Color(h);
const TONO = {
  adulto: {
    cuello: tono(0xdfc48f),
    medio: tono(0xf3e8d0),
    punta: tono(0xfcf8ee),
    borde: tono(0xbfd0e4),
    surco: tono(0x5a3e22),
    sombra: tono(0xc4a874),
  },
  nino: {
    cuello: tono(0xecddbb),
    medio: tono(0xfaf5ea),
    punta: tono(0xfffdf8),
    borde: tono(0xd0deee),
    surco: tono(0x7a6446),
    sombra: tono(0xddceaa),
  },
} as const;

/** Arreglos de la corona de un diente (inmutables; se comparten entre motores). */
export interface ArreglosCorona {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  idx: Uint16Array | Uint32Array;
  reg: Uint8Array;
  tp: Float32Array;
  surco: Float32Array;
  /** Color base por vértice (veteado, borde incisal, surcos). */
  base: Float32Array;
}

const CACHE_CORONA = new Map<number, ArreglosCorona>();
const CACHE_COLLAR = new Map<number, ArreglosCollar>();

/** Corona + colores base por diente; se calculan una sola vez por fdi en toda la sesión. */
export function datosCorona(i: InfoDiente): ArreglosCorona {
  const previo = CACHE_CORONA.get(i.fdi);
  if (previo) return previo;
  const cr = corona(i),
    n = cr.reg.length,
    T = i.nino ? TONO.nino : TONO.adulto,
    c = new THREE.Color();
  const pos = cr.geo.attributes.position as THREE.BufferAttribute,
    base = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const t = cr.tp[k] as number,
      px = pos.getX(k),
      py = pos.getY(k),
      pz = pos.getZ(k);
    c.copy(T.cuello)
      .lerp(T.medio, smooth(0.04, 0.5, t))
      .lerp(T.punta, 0.6 * smooth(0.55, 1, t));
    c.multiplyScalar(1 + (ruido(px * 0.5 + 3.1, py * 0.5, pz * 0.5) - 0.5) * 0.08); // veteado sutil
    if (i.ant)
      c.lerp(T.borde, 0.62 * smooth(0.8, 1, t) * (1 - 0.35 * smooth(0.97, 1, t))); // borde incisal translúcido
    else c.lerp(T.borde, 0.1 * smooth(0.86, 1, t));
    c.lerp(T.sombra, 0.22 * (1 - smooth(0, 0.16, t))); // línea cervical
    const ao = cr.ao[k] as number,
      su = cr.surco[k] as number,
      cv = cr.cav[k] as number;
    if (ao > 0.01) c.lerp(T.sombra, Math.min(0.85, ao));
    if (su > 0.01) c.lerp(T.surco, Math.min(0.85, su * 0.95));
    if (cv > 0) c.lerp(T.surco, Math.min(0.5, cv * 1.1) * smooth(0.12, 0.5, t));
    else c.lerp(T.punta, Math.min(0.28, -cv * 0.7) * smooth(0.3, 0.7, t));
    base[k * 3] = c.r;
    base[k * 3 + 1] = c.g;
    base[k * 3 + 2] = c.b;
  }
  const g = cr.geo;
  const d: ArreglosCorona = {
    pos: (g.attributes.position as THREE.BufferAttribute).array as Float32Array,
    nor: (g.attributes.normal as THREE.BufferAttribute).array as Float32Array,
    uv: (g.attributes.uv as THREE.BufferAttribute).array as Float32Array,
    idx: (g.index as THREE.BufferAttribute).array as Uint16Array | Uint32Array,
    reg: cr.reg,
    tp: cr.tp,
    surco: cr.surco,
    base,
  };
  g.dispose();
  CACHE_CORONA.set(i.fdi, d);
  return d;
}

/** Geometría nueva de la corona sobre los arreglos compartidos (posición, normal, uv e índice). */
export function geometriaCorona(d: ArreglosCorona): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(d.idx, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  return geo;
}

export function geometriaCollar(i: InfoDiente): THREE.BufferGeometry {
  let a = CACHE_COLLAR.get(i.fdi);
  if (!a) {
    a = collar(i);
    CACHE_COLLAR.set(i.fdi, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.col, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
  g.setIndex(a.idx);
  return g;
}
