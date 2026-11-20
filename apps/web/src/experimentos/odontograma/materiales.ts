/**
 * Materiales y texturas del odontograma 3D.
 *
 * Copia de `referencia/maqueta/codigo/app.js` (`texBump`, `U`, `realzar`, `matEsmalte`, `matRaiz`,
 * `matEncia`, `matOro`, `matImplante`, `matConducto`, `lienzo`, `TEXFN`, `texMov`, `matSprite`,
 * `matPato`) con los mismos parámetros. En la maqueta las texturas y los materiales de patología
 * eran globales del módulo; acá viven en `Recursos`, uno por motor, que los libera en `dispose()`.
 * Lo único compartido entre motores son los píxeles del relieve del esmalte (un arreglo inmutable).
 */
import * as THREE from 'three';
import { ROM } from './modelo.js';

/* ---------- relieve fino del esmalte (microrrelieve + periquimatos) ---------- */
const S = 256;
let pixelesRelieve: Uint8Array | null = null;
function relieve(): Uint8Array {
  if (pixelesRelieve) return pixelesRelieve;
  const d = new Uint8Array(S * S * 4);
  let sd = 1234567;
  const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
  const oct = (
    [
      [4, 0.5],
      [8, 0.32],
      [16, 0.22],
      [32, 0.14],
    ] as const
  ).map(([f, w]) => ({ f, w, v: Float32Array.from({ length: f * f }, rnd) }));
  const val = (o: { f: number; v: Float32Array }, x: number, y: number) => {
    const f = o.f,
      X = x * f,
      Y = y * f,
      xi = Math.floor(X),
      yi = Math.floor(Y),
      a = X - xi,
      b = Y - yi;
    const h = (i: number, j: number) => o.v[((yi + j) % f) * f + ((xi + i) % f)] as number;
    const u = a * a * (3 - 2 * a),
      v = b * b * (3 - 2 * b);
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let n = 0;
      for (const o of oct) n += (val(o, x / S, y / S) - 0.5) * o.w;
      const per = Math.sin((y / S) * Math.PI * 2 * 14 + n * 5);
      const g = 0.5 + n * 0.85 + per * 0.07;
      const j = (y * S + x) * 4,
        b = Math.max(0, Math.min(255, Math.round(g * 255)));
      d[j] = d[j + 1] = d[j + 2] = b;
      d[j + 3] = 255;
    }
  pixelesRelieve = d;
  return d;
}

/* ---------- texturas de patología (sprites) ---------- */
type Dibujo = (c: CanvasRenderingContext2D, w: number, h: number) => void;
function lienzo(w: number, h: number, fn: Dibujo): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext('2d');
  if (cx) fn(cx, w, h); // sin contexto 2D (jsdom) la textura queda vacía
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEXFN: Record<
  'periapical' | 'fractura' | 'reabsorcion' | 'fistula',
  () => THREE.CanvasTexture
> = {
  periapical: () =>
    lienzo(128, 128, (c, w) => {
      const g = c.createRadialGradient(64, 64, 2, 64, 64, 62);
      g.addColorStop(0, 'rgba(40,6,24,.95)');
      g.addColorStop(0.35, 'rgba(84,16,48,.78)');
      g.addColorStop(0.7, 'rgba(107,29,58,.32)');
      g.addColorStop(0.86, 'rgba(107,29,58,.12)');
      g.addColorStop(1, 'rgba(107,29,58,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, w);
      c.beginPath();
      c.arc(64, 64, 50, 0, 7);
      c.lineWidth = 3.5;
      c.strokeStyle = 'rgba(225,120,160,.85)';
      c.setLineDash([7, 6]);
      c.stroke();
    }),
  fractura: () =>
    lienzo(192, 96, (c) => {
      const pts = [
        [8, 30],
        [40, 66],
        [70, 26],
        [100, 70],
        [128, 24],
        [156, 66],
        [184, 34],
      ] as const;
      for (const [lw, col] of [
        [22, '#fff'],
        [13, '#E5197A'],
      ] as const) {
        c.lineWidth = lw;
        c.strokeStyle = col;
        c.lineJoin = 'miter';
        c.miterLimit = 3;
        c.lineCap = 'round';
        c.beginPath();
        pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.stroke();
      }
    }),
  reabsorcion: () =>
    lienzo(128, 128, (c) => {
      for (const [x, y, r] of [
        [22, 34, 17],
        [106, 56, 20],
        [26, 92, 15],
        [100, 108, 12],
      ] as const) {
        c.beginPath();
        c.arc(x, y, r, 0, 7);
        c.fillStyle = '#8B5E34';
        c.fill();
        c.lineWidth = 4;
        c.strokeStyle = '#fff';
        c.stroke();
      }
      c.setLineDash([6, 7]);
      c.lineWidth = 4;
      c.strokeStyle = '#8B5E34';
      c.beginPath();
      c.moveTo(40, 10);
      c.lineTo(40, 120);
      c.moveTo(88, 10);
      c.lineTo(88, 120);
      c.stroke();
    }),
  fistula: () =>
    lienzo(128, 128, (c) => {
      c.lineCap = 'round';
      for (const [lw, col] of [
        [16, '#fff'],
        [9, '#9ACD00'],
      ] as const) {
        c.lineWidth = lw;
        c.strokeStyle = col;
        c.beginPath();
        c.moveTo(94, 34);
        c.bezierCurveTo(94, 78, 56, 84, 16, 116);
        c.stroke();
      }
      c.beginPath();
      c.arc(94, 32, 20, 0, 7);
      c.fillStyle = '#9ACD00';
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = '#fff';
      c.stroke();
      c.beginPath();
      c.arc(94, 32, 8, 0, 7);
      c.fillStyle = '#3B4A00';
      c.fill();
    }),
};
const texMov = (g: number) =>
  lienzo(128, 128, (c) => {
    c.beginPath();
    c.arc(64, 46, 36, 0, 7);
    c.fillStyle = '#00B8D9';
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = '#fff';
    c.stroke();
    c.fillStyle = '#fff';
    c.font = '800 ' + (g === 3 ? 38 : 46) + 'px system-ui,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ROM[g] ?? '', 64, 49);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [lw, col] of [
      [14, '#fff'],
      [7, '#00B8D9'],
    ] as const) {
      c.lineWidth = lw;
      c.strokeStyle = col;
      c.beginPath();
      c.moveTo(16, 108);
      c.lineTo(112, 108);
      c.moveTo(36, 94);
      c.lineTo(16, 108);
      c.lineTo(36, 122);
      c.moveTo(92, 94);
      c.lineTo(112, 108);
      c.lineTo(92, 122);
      c.stroke();
    }
  });

export type IdPato = 'periapical' | 'fractura' | 'reabsorcion' | 'movilidad' | 'fistula';

interface UniformeRim {
  c: { value: THREE.Color };
  k: { value: number };
}

/** Texturas y materiales compartidos por todos los dientes de un mismo motor. */
export class Recursos {
  readonly bump: THREE.DataTexture;
  /** Luz de borde (fresnel) por familia de material; uniformes compartidos. */
  readonly U: { esm: UniformeRim; raiz: UniformeRim; encia: UniformeRim };
  private readonly texPato = new Map<string, THREE.Texture>();
  private readonly matsPato = new Map<string, THREE.SpriteMaterial>();

  constructor() {
    this.bump = new THREE.DataTexture(relieve(), S, S, THREE.RGBAFormat);
    this.bump.wrapS = this.bump.wrapT = THREE.RepeatWrapping;
    this.bump.repeat.set(5, 4);
    this.bump.anisotropy = 8;
    this.bump.colorSpace = THREE.NoColorSpace;
    this.bump.magFilter = THREE.LinearFilter;
    this.bump.minFilter = THREE.LinearMipmapLinearFilter;
    this.bump.generateMipmaps = true;
    this.bump.needsUpdate = true;
    this.U = {
      esm: { c: { value: new THREE.Color(0x9ec4ff) }, k: { value: 0.34 } },
      raiz: { c: { value: new THREE.Color(0xffe9c4) }, k: { value: 0.14 } },
      encia: { c: { value: new THREE.Color(0xff8e8e) }, k: { value: 0.2 } },
    };
  }

  private realzar<T extends THREE.MeshStandardMaterial>(mat: T, fade: boolean, u: UniformeRim): T {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = u.c;
      sh.uniforms.uRimK = u.k;
      if (fade) {
        sh.uniforms.uFade = mat.userData.uFade as THREE.IUniform;
        sh.uniforms.uL = mat.userData.uL as THREE.IUniform;
      }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vRY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRY = position.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uRim; uniform float uRimK; varying float vRY;' +
            (fade ? '\nuniform float uFade; uniform float uL;' : ''),
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n{ float fr = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.4); totalEmissiveRadiance += uRim * uRimK * fr; }',
        )
        .replace(
          '#include <opaque_fragment>',
          (fade
            ? 'diffuseColor.a *= 1.0 - 0.72 * uFade * smoothstep(0.5 * uL, 1.0 * uL, -vRY);\n'
            : '') + '#include <opaque_fragment>',
        );
    };
    mat.customProgramCacheKey = () => 'dent' + (fade ? 'F' : '');
    return mat;
  }

  esmalte(): THREE.MeshPhysicalMaterial {
    return this.realzar(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.1,
        sheen: 0.4,
        sheenRoughness: 0.5,
        sheenColor: 0xfff1dc,
        ior: 1.6,
        bumpMap: this.bump,
        bumpScale: 0.45,
      }),
      false,
      this.U.esm,
    );
  }

  raiz(L: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.62,
      bumpMap: this.bump,
      bumpScale: 0.5,
      transparent: false,
    });
    m.userData.uFade = { value: 0 };
    m.userData.uL = { value: L };
    return this.realzar(m, true, this.U.raiz);
  }

  encia(): THREE.MeshPhysicalMaterial {
    return this.realzar(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 0.52,
        clearcoat: 0.22,
        clearcoatRoughness: 0.4,
        sheen: 0.35,
        sheenRoughness: 0.6,
        sheenColor: 0xffb8b4,
        bumpMap: this.bump,
        bumpScale: 0.7,
      }),
      false,
      this.U.encia,
    );
  }

  /** Material de sprite de patología, compartido por clave (tipo + grado + estado). */
  pato(id: IdPato, g: number, rea: boolean): THREE.SpriteMaterial {
    const k = id + (g || '') + (rea ? 'R' : 'P'),
      kt = id + (g || '');
    let m = this.matsPato.get(k);
    if (m) return m;
    let t = this.texPato.get(kt);
    if (!t) {
      t = id === 'movilidad' ? texMov(g) : TEXFN[id]();
      this.texPato.set(kt, t);
    }
    m = new THREE.SpriteMaterial({
      color: rea ? 0xa9c4ff : 0xffb3b3,
      map: t,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.matsPato.set(k, m);
    return m;
  }

  dispose(): void {
    this.bump.dispose();
    for (const t of this.texPato.values()) t.dispose();
    for (const m of this.matsPato.values()) m.dispose();
    this.texPato.clear();
    this.matsPato.clear();
  }
}

export const matOro = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: 0xe2ae1c,
    metalness: 0.9,
    roughness: 0.24,
    envMapIntensity: 1.35,
    emissive: 0x3a2500,
    emissiveIntensity: 0.25,
  });
export const matImplante = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: 0x14b3a3,
    metalness: 0.65,
    roughness: 0.32,
    emissive: 0x04332e,
    emissiveIntensity: 0.35,
  });
export const matConducto = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    color: 0xa45cff,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
  });
