// Odontograma 3D (maqueta de concepto) · Sonrisa Para Todos Conecta
// Dientes modelados por código (sin IA): corona anatómica por tipo (cúspides, surcos, fosas, rebordes, cíngulo),
// raíces torneadas, caras O/M/D/V/L y caries por clase de Black (I a V) pintada sobre la cara. Numeración FDI.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const COL = { ext: 0x1A5FB4, per: 0xD7262B };
// ---------- marcadores clínicos (leyenda única: barra de herramientas, leyenda, hoja impresa) ----------
const MARC = {
  car: { n: 'Caries', c: '#16161A', d: 'Mancha negra sobre la cara afectada (clase de Black I a V).', ic: '<path d="M-7,0 C-7,-6 -1,-8 3,-6 C8,-4 8,4 2,6 C-4,8 -7,4 -7,0Z" fill="#16161A"/>' },
  ext: { n: 'Extracción indicada', c: '#1A5FB4', d: 'Cruz azul sobre el diente, que se vuelve translúcido.', ic: '<g stroke="#1A5FB4" stroke-width="3.6" stroke-linecap="round"><path d="M-7,-7 L7,7"/><path d="M7,-7 L-7,7"/></g>' },
  per: { n: 'Periodontal', c: '#D7262B', d: 'Anillo rojo en el cuello y encía enrojecida.', ic: '<path d="M-9,4 Q0,-8 9,4" fill="none" stroke="#D7262B" stroke-width="4" stroke-linecap="round"/>' },
  corona: { n: 'Corona', c: '#E0A100', d: 'Casquete dorado metálico sobre la corona.', ic: '<path d="M-8,5 L-8,-3 L-4,-7 L0,-3 L4,-7 L8,-3 L8,5Z" fill="#E0A100" stroke="#8A6200" stroke-width="1.2" stroke-linejoin="round"/>' },
  implante: { n: 'Implante', c: '#0E9F8E', d: 'Tornillo turquesa en lugar de la raíz.', ic: '<g fill="none" stroke="#0E9F8E" stroke-width="2.6" stroke-linecap="round"><path d="M-5,-7 H5"/><path d="M-4,-2 H4"/><path d="M-3,3 H3"/><path d="M0,6 V8"/></g>' },
  endodoncia: { n: 'Endodoncia', c: '#8E3FD6', d: 'Conducto violeta visible dentro de la raíz.', ic: '<path d="M-5,-8 C-2,-2 -2,3 0,8 C2,3 2,-2 5,-8" fill="none" stroke="#8E3FD6" stroke-width="3.2" stroke-linecap="round"/>' },
  ausente: { n: 'Ausente / extraído', c: '#6B7280', d: 'Diente fantasma con círculo tachado gris.', ic: '<g fill="none" stroke="#6B7280" stroke-width="2.8" stroke-linecap="round"><circle r="7"/><path d="M-5,-5 L5,5"/></g>' },
  protesis: { n: 'Prótesis', c: '#F26B1D', d: 'Banda naranja alrededor de la corona y tinte cálido.', ic: '<g fill="none" stroke="#F26B1D" stroke-width="3.4" stroke-linecap="round"><path d="M-8,-1 H8"/><path d="M-8,5 H8" opacity=".55"/></g>' },
  sellante: { n: 'Sellante', c: '#2FB344', d: 'Capa verde sobre fosas y fisuras de la cara oclusal.', ic: '<g fill="#2FB344"><circle cx="-4" cy="-2" r="3"/><circle cx="4" cy="-2" r="3"/><circle cx="0" cy="4" r="3"/></g>' },
  // patología oral a nivel del diente (grupo «Patología» de la barra)
  periapical: { n: 'Lesión periapical', c: '#6B1D3A', d: 'Halo oscuro en el ápice de la raíz.', ic: '<circle r="8.5" fill="#6B1D3A" opacity=".3"/><circle r="5" fill="#6B1D3A" opacity=".6"/><circle r="2.4" fill="#6B1D3A"/>' },
  fractura: { n: 'Fractura', c: '#E5197A', d: 'Línea en zigzag rosa atravesando la corona.', ic: '<path d="M-8,-3 L-4,3 L0,-3 L4,3 L8,-3" fill="none" stroke="#E5197A" stroke-width="2.8" stroke-linejoin="miter" stroke-linecap="round"/>' },
  reabsorcion: { n: 'Reabsorción radicular', c: '#8B5E34', d: 'Muescas marrones en el borde de la raíz.', ic: '<g fill="#8B5E34"><circle cx="-6" cy="-3" r="3.2"/><circle cx="6" cy="1" r="3.6"/><circle cx="-5" cy="5.5" r="2.8"/></g>' },
  movilidad: { n: 'Movilidad', c: '#00B8D9', d: 'Flechas celestes con el grado (I, II o III). Cada toque sube el grado; tras el III se quita.', ic: '<g fill="none" stroke="#00B8D9" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M-8,0 H8"/><path d="M-4.5,-3.5 L-8,0 L-4.5,3.5"/><path d="M4.5,-3.5 L8,0 L4.5,3.5"/></g>' },
  fistula: { n: 'Fístula', c: '#9ACD00', d: 'Orificio verde lima en la encía con su trayecto hacia el ápice.', ic: '<g><circle cx="3" cy="-3" r="3.8" fill="#9ACD00"/><path d="M3,0 C3,4 -2,5 -6,8" fill="none" stroke="#9ACD00" stroke-width="2.2" stroke-linecap="round"/></g>' },
};
const PATO = ['periapical', 'fractura', 'reabsorcion', 'movilidad', 'fistula'];
const ROM = ['', 'I', 'II', 'III'];
const ROJO = '#D7262B', AZUL = '#1A5FB4';
const conEstado = id => id !== 'ausente';   // todos los hallazgos tienen estado de tratamiento, salvo el diente ausente
const MKS = ['corona', 'implante', 'endodoncia', 'ausente', 'protesis', 'sellante', ...PATO];   // marcadores que se guardan en m.mk
const C_SELLA = new THREE.Color(0x2FB344), C_PROT = new THREE.Color(0xF26B1D);
const C_PEND = new THREE.Color(0xD7262B), C_REST = new THREE.Color(0x1A5FB4);   // estado de tratamiento: rojo = por realizar, azul = realizado
const C_CARIES = new THREE.Color(0x161418), C_HOVER = new THREE.Color(0x2E9BEC);
const EJE_X = new THREE.Vector3(1, 0, 0), EJE_Z = new THREE.Vector3(0, 0, 1);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const gauss = (d2, s) => Math.exp(-d2 / (2 * s * s));
const KR = 0.56;      // fracción de raíz que se ve en la vista completa (se acorta y se desvanece para agrandar las coronas)
const TILT = 0.56;    // inclinación de las coronas hacia la cámara en la vista completa (deja ver la cara oclusal)
let sucio = true;       // hay que volver a dibujar (se renderiza bajo demanda: ahorra batería y GPU en reposo)

// caras: 0 oclusal/incisal · 1 mesial · 2 distal · 3 vestibular · 4 lingual/palatina
const CARA = { O: 0, M: 1, D: 2, V: 3, L: 4 };
const LETRAS = ['O', 'M', 'D', 'V', 'L'];
const MS = { 1: -1, 2: 1, 3: -1, 4: 1, 5: -1, 6: 1, 7: -1, 8: 1 };   // hacia dónde queda mesial en x local, por cuadrante
const nombreCara = (i, r) => [i.ant ? 'incisal' : 'oclusal', 'mesial', 'distal', 'vestibular', i.sup ? 'palatina' : 'lingual'][r];

// ---------- anatomía (mm aproximados: [ancho M-D, ancho V-L, alto corona, largo raíz]) ----------
const DIM = {
  U: { 1: [8.6, 7.0, 10.6, 13], 2: [6.6, 6.2, 9.0, 13], 3: [7.6, 8.0, 10.0, 17], 4: [7.0, 9.0, 8.4, 14], 5: [6.6, 9.0, 7.8, 14], 6: [10.2, 11, 7.4, 12.5], 7: [9.2, 11, 7.0, 11.5], 8: [8.6, 10, 6.6, 10.5] },
  L: { 1: [5.2, 6.0, 9.0, 12.5], 2: [5.8, 6.4, 9.4, 14], 3: [7.0, 7.6, 10.8, 16], 4: [7.0, 7.6, 8.4, 14], 5: [7.2, 8.0, 8.0, 14.5], 6: [11.0, 10.4, 7.4, 13.5], 7: [10.4, 10.0, 7.0, 13], 8: [10.0, 9.6, 6.8, 11] },
  u: { 1: [6.6, 5.2, 6.2, 10], 2: [5.2, 4.4, 5.6, 10.5], 3: [7.0, 7.0, 6.6, 13], 4: [7.2, 8.6, 5.2, 8.5], 5: [9.0, 10, 5.6, 9.5] },
  l: { 1: [4.2, 4.0, 5.0, 9], 2: [4.6, 4.2, 5.2, 10], 3: [5.2, 5.4, 6.0, 11.5], 4: [8.0, 7.2, 5.6, 9], 5: [10, 9.0, 5.8, 10] },
};
const NOMBRE_A = { 1: 'Incisivo central', 2: 'Incisivo lateral', 3: 'Canino', 4: 'Primer premolar', 5: 'Segundo premolar', 6: 'Primer molar', 7: 'Segundo molar', 8: 'Tercer molar' };
const NOMBRE_N = { 1: 'Incisivo central temporal', 2: 'Incisivo lateral temporal', 3: 'Canino temporal', 4: 'Primer molar temporal', 5: 'Segundo molar temporal' };

function info(fdi) {
  const q = Math.floor(fdi / 10), p = fdi % 10;
  const nino = q >= 5;
  const sup = [1, 2, 5, 6].includes(q);
  const der = [1, 4, 5, 8].includes(q);
  const kind = nino ? (p <= 2 ? 'inc' : p === 3 ? 'can' : 'mol') : (p <= 2 ? 'inc' : p === 3 ? 'can' : p <= 5 ? 'pre' : 'mol');
  const [W, D, H, L] = DIM[nino ? (sup ? 'u' : 'l') : (sup ? 'U' : 'L')][p];
  const nombre = `${(nino ? NOMBRE_N : NOMBRE_A)[p]} ${sup ? 'superior' : 'inferior'} ${der ? 'derecho' : 'izquierdo'}`;
  return { fdi, q, p, nino, sup, der, kind, ant: kind === 'inc' || kind === 'can', ms: MS[q], W, D, H, L, nombre };
}

// Cara oclusal de posteriores, en coordenadas normalizadas (u: + mesial, w: + vestibular).
// c: cúspides [u, w, alto, ancho] · f: fosas [u, w, profundidad, ancho] · s: surcos [u1, w1, u2, w2, peso] · r: rebordes marginales · cr: reborde oblicuo
function anatomia(i) {
  const { kind, sup, p, nino } = i;
  const RM = [[.82, -.6, .82, .6, .5], [-.82, -.6, -.82, .6, .5]];
  if (kind === 'pre') {
    if (sup) return { c: [[0, .42, p === 4 ? 1.08 : 1, .26], [0, -.42, p === 4 ? .85 : .95, .26]], f: [[.5, 0, .7, .13], [-.5, 0, .7, .13]], s: [[.68, 0, -.68, 0, 1]], r: RM };
    if (p === 4) return { c: [[0, .32, 1.2, .3], [0, -.52, .45, .2]], f: [[.42, -.12, .6, .12], [-.42, -.12, .6, .12]], s: [[.5, -.12, -.5, -.12, .6]], r: RM };
    return { c: [[0, .38, 1.05, .28], [.32, -.45, .78, .2], [-.35, -.45, .62, .2]], f: [[0, -.05, .8, .12]], s: [[.6, 0, -.6, 0, 1], [0, -.05, -.02, -.9, .8]], r: RM };
  }
  const primero = nino ? p === 5 : p === 6;
  if (sup) {
    if (nino && p === 4) return { c: [[.35, .45, 1, .24], [-.4, .45, .85, .22], [.15, -.42, .95, .28]], f: [[.05, 0, .8, .14]], s: [[.65, 0, -.65, 0, 1], [-.05, .05, -.1, .95, .6]], r: RM };
    return {
      c: [[.45, .45, 1, .22], [-.42, .45, .9, .21], [.38, -.4, 1.12, .27], [-.5, -.5, primero ? .72 : .5, .2]],
      f: [[.12, .02, 1, .14], [-.4, -.12, .7, .11], [.66, 0, .45, .1]],
      s: [[.68, 0, .12, .02, .9], [.12, .02, 0, 1, .85], [-.4, -.12, 0, -1, .8]],
      cr: [[.38, -.4, -.42, .45, primero ? .55 : .35]], r: RM };
  }
  if (primero) return {   // primer molar inferior (y segundo temporal): cinco cúspides
    c: [[.55, .45, .95, .2], [0, .5, .9, .2], [-.62, .3, .7, .17], [.5, -.45, 1.05, .22], [-.35, -.45, 1, .22]],
    f: [[.05, 0, 1, .14], [.62, 0, .55, .1], [-.6, -.05, .55, .1]],
    s: [[.75, 0, -.75, -.03, 1], [.28, 0, .3, 1, .8], [-.35, -.02, -.48, .95, .75], [.08, 0, .1, -1, .8]], r: RM };
  return {   // segundo y tercer molar inferior, primer molar temporal inferior: cuatro cúspides en cruz
    c: [[.45, .45, 1, .22], [-.45, .45, .9, .22], [.45, -.45, 1.05, .22], [-.45, -.45, .95, .22]],
    f: [[0, 0, 1, .15], [.62, 0, .5, .1], [-.62, 0, .5, .1]],
    s: [[.75, 0, -.75, 0, 1], [0, 0, 0, 1, .8], [0, 0, 0, -1, .8]], r: RM };
}

function dSeg(u, w, s) {
  const vx = s[2] - s[0], vz = s[3] - s[1], l2 = vx * vx + vz * vz;
  const k = Math.max(0, Math.min(1, ((u - s[0]) * vx + (w - s[1]) * vz) / l2));
  return Math.hypot(u - s[0] - k * vx, w - s[1] - k * vz);
}

function corona(i) {
  const { kind, W, D, H, nino, sup, ms, ant } = i;
  const A = ant ? null : anatomia(i);
  const g = new THREE.SphereGeometry(1, 88, 66);
  const pos = g.attributes.position, n = pos.count, v = new THREE.Vector3();
  const reg = new Uint8Array(n), tp = new Float32Array(n), surco = new Float32Array(n), ao = new Float32Array(n);
  const ex = kind === 'mol' ? 3.4 : kind === 'pre' ? 2.6 : 2.15;
  const mp = kind === 'inc' ? 7 : kind === 'can' ? 3.6 : 3;
  for (let k = 0; k < n; k++) {
    v.fromBufferAttribute(pos, k);
    const t = (v.y + 1) / 2, yy = 2 * t - 1;
    const hl = Math.hypot(v.x, v.z);
    const ux = hl > 1e-6 ? v.x / hl : 0, uz = hl > 1e-6 ? v.z / hl : 1;
    const sk = Math.pow(Math.pow(Math.abs(ux), ex) + Math.pow(Math.abs(uz), ex), -1 / ex);
    const r = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(yy), mp)), 1 / mp);
    const cuello = ant ? 0.64 + 0.36 * smooth(0, 0.55, t) : 0.72 + 0.28 * smooth(0, 0.5, t);
    const panza = 1 + 0.06 * Math.exp(-((t - 0.35) ** 2) / 0.02);
    let x = ux * sk * r * cuello * W / 2;
    let z = uz * sk * r * cuello * (uz > 0 ? panza : 1) * D / 2;
    let y = t * H;
    const u = (x * ms) / (W / 2);
    // cara por parámetros de la malla
    const um = ux * ms;
    let rg;
    if (t > 0.5 && r < (ant ? 0.88 : 0.82)) rg = 0;
    else if (Math.abs(um) > Math.abs(uz)) rg = um > 0 ? 1 : 2;
    else rg = uz > 0 ? 3 : 4;
    if (A) {
      const top = smooth(0.5, 1, t), w = z / (D / 2);
      let b = 0; for (const [cu, cw, h, s] of A.c) b += h * gauss((u - cu) ** 2 + (w - cw) ** 2, s);
      b = Math.min(b, 1.2);
      let f = 0; for (const [cu, cw, dd, s] of A.f) f += dd * gauss((u - cu) ** 2 + (w - cw) ** 2, s);
      let sg = 0; for (const s of A.s) sg = Math.max(sg, s[4] * gauss(dSeg(u, w, s) ** 2, 0.062));
      let cr = 0; for (const s of A.r) cr += s[4] * gauss(dSeg(u, w, s) ** 2, 0.09);
      for (const s of (A.cr || [])) cr += s[4] * gauss(dSeg(u, w, s) ** 2, 0.1) * (1 - 0.6 * sg);
      y += top * H * ((nino ? 0.18 : 0.24) * b + 0.07 * cr - 0.09 * f - 0.1 * sg - 0.14);
      surco[k] = top * Math.min(1, sg * 1.05 + f * 0.5);
      ao[k] = top * (1 - smooth(0.12, 0.8, b + 0.6 * cr)) * smooth(0.82, 0.95, t);
    } else {
      const wq = smooth(0.2, 1.0, t);
      z *= 1 - (kind === 'inc' ? 0.72 : 0.5) * wq;
      if (uz < 0) {          // lingual/palatina: fosa, rebordes marginales y cíngulo
        const fosa = Math.exp(-((t - 0.6) ** 2) / 0.035) * gauss(u * u, 0.33);
        const reb = Math.exp(-((t - 0.6) ** 2) / 0.06) * gauss((Math.abs(u) - 0.72) ** 2, 0.12);
        const cing = Math.exp(-((t - 0.27) ** 2) / 0.012) * gauss(u * u, 0.45);
        z *= 1 - (sup ? 0.34 : 0.16) * fosa + 0.14 * reb;
        z -= cing * D * (sup ? 0.08 : 0.045);
        surco[k] = 0.3 * fosa * (sup ? 1 : 0.5);
        ao[k] = 0.35 * fosa;
      } else if (kind === 'inc') {   // tres lóbulos vestibulares: dos depresiones suaves
        z *= 1 - 0.04 * smooth(0.35, 0.95, t) * (gauss((u - 0.36) ** 2, 0.08) + gauss((u + 0.36) ** 2, 0.08));
      } else {                       // reborde vestibular del canino
        z *= 1 + 0.09 * gauss(u * u, 0.22) * smooth(0.25, 0.9, t);
      }
      if (kind === 'inc') {          // ángulo mesio-incisal recto, disto-incisal redondeado
        y -= smooth(0.72, 1, t) * H * (sup ? 0.1 : 0.035) * smooth(0.05, 1, -u);
      } else {                       // canino: punta algo a mesial, vertiente distal más larga
        const ap = 0.12, span = u > ap ? 1 - ap : 1 + ap;
        y += smooth(0.45, 1, t) * ((1 - Math.min(1, Math.abs(u - ap) / span)) * H * 0.22 - H * 0.07);
      }
    }
    tp[k] = t; reg[k] = rg;
    pos.setXYZ(k, x, y, z);
  }
  g.computeVertexNormals();
  suavizarNormales(g, 88, 66);
  const cav = cavidad(g, 88, 66);
  return { geo: g, reg, tp, surco, ao, cav };
}

// SphereGeometry duplica la costura y los polos: se promedian las normales para que no se vea la junta ni la estrella del polo.
function suavizarNormales(g, nx, ny) {
  const nor = g.attributes.normal, W1 = nx + 1, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let iy = 0; iy <= ny; iy++) {
    const a = iy * W1;
    if (iy === 0 || iy === ny) {
      v.set(0, 0, 0);
      for (let ix = 0; ix <= nx; ix++) v.add(w.fromBufferAttribute(nor, a + ix));
      v.normalize();
      for (let ix = 0; ix <= nx; ix++) nor.setXYZ(a + ix, v.x, v.y, v.z);
    } else {
      v.fromBufferAttribute(nor, a).add(w.fromBufferAttribute(nor, a + nx)).normalize();
      nor.setXYZ(a, v.x, v.y, v.z); nor.setXYZ(a + nx, v.x, v.y, v.z);
    }
  }
}

// Mapa de cavidad (laplaciano sobre la rejilla): + en surcos, fosas y cuello; − en crestas y cúspides.
function cavidad(g, nx, ny, K = 2) {
  const pos = g.attributes.position, nor = g.attributes.normal, W1 = nx + 1;
  const cav = new Float32Array(pos.count), p = new THREE.Vector3(), q = new THREE.Vector3(), a = new THREE.Vector3(), nn = new THREE.Vector3();
  const id = (ix, iy) => Math.min(ny, Math.max(0, iy)) * W1 + (((ix % nx) + nx) % nx);
  for (let iy = 1; iy < ny; iy++) for (let ix = 0; ix <= nx; ix++) {
    const k = iy * W1 + ix;
    p.fromBufferAttribute(pos, k); nn.fromBufferAttribute(nor, k); a.set(0, 0, 0);
    for (const [dx, dy] of [[K, 0], [-K, 0], [0, K], [0, -K]]) a.add(q.fromBufferAttribute(pos, id(ix + dx, iy + dy)));
    cav[k] = a.multiplyScalar(0.25).sub(p).dot(nn);
  }
  return cav;
}

// Raíz: torneada, con curvatura apical, canal longitudinal en los lados proximales y color cemento→dentina.
function raiz(r0, L, sz, bend = 0, surco = 0.07) {
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
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  const cTop = new THREE.Color(0xCBA96C), cMid = new THREE.Color(0xE4CB98), cTip = new THREE.Color(0xEFDDB2);
  for (let k = 0; k < pos.count; k++) {
    let x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const d = Math.min(1, Math.max(0, -y / L));
    if (surco) { const a = Math.atan2(z / sz, x); x *= 1 - surco * Math.pow(Math.abs(Math.cos(a)), 6) * smooth(0.05, 0.4, d) * (1 - smooth(0.8, 1, d)); }
    if (bend) x += bend * L * d * d;
    pos.setX(k, x);
    c.copy(cTop).lerp(cMid, smooth(0, 0.3, d)).lerp(cTip, smooth(0.35, 1, d));
    c.multiplyScalar(1 + (ruido(x * 0.8 + 5, y * 0.3, z * 0.8) - 0.5) * 0.14);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function raices(t) {
  const { kind, W, D, L, sup, p, nino } = t;
  const ab = nino ? 0.3 : 0.13;           // raíces temporales más abiertas
  if (kind === 'mol' && sup) return [
    { x: 0.24 * W, z: 0.2 * D, r: 0.17 * W, l: L, sz: 1.2, rx: -ab, rz: ab, bend: 0.06 },
    { x: -0.24 * W, z: 0.2 * D, r: 0.16 * W, l: L * 0.94, sz: 1.2, rx: -ab, rz: -ab, bend: -0.06 },
    { x: 0, z: -0.24 * D, r: 0.2 * W, l: L * 1.05, sz: 1.1, rx: ab * 1.2, rz: 0, bend: 0.02 }];
  if (kind === 'mol') return [
    { x: 0.27 * W, z: 0, r: 0.16 * W, l: L, sz: 2.3, rx: 0, rz: ab, bend: -0.06 },
    { x: -0.27 * W, z: 0, r: 0.15 * W, l: L * 0.93, sz: 2.2, rx: 0, rz: -ab, bend: 0.06 }];
  if (kind === 'pre' && sup && p === 4) return [
    { x: 0, z: 0.2 * D, r: 0.22 * W, l: L, sz: 1.1, rx: -0.07, rz: 0, bend: 0.03 },
    { x: 0, z: -0.2 * D, r: 0.21 * W, l: L * 0.95, sz: 1.1, rx: 0.07, rz: 0, bend: 0.03 }];
  const r = (kind === 'can' ? 0.34 : kind === 'pre' ? 0.31 : 0.3) * W;
  return [{ x: 0, z: 0, r, l: L, sz: Math.max(1, D / W) * (kind === 'pre' ? 1.25 : 1.05), rx: 0, rz: 0, bend: -0.085 * t.ms }];
}

// Collar gingival: banda festoneada (papilas hacia mesial y distal) que abraza el cuello y se desvanece sobre la raíz.
function collar(i) {
  const { W, D, H, L, kind, ant, nino } = i;
  const ex = kind === 'mol' ? 3.4 : kind === 'pre' ? 2.6 : 2.15, mp = kind === 'inc' ? 7 : kind === 'can' ? 3.6 : 3;
  const rs = raices(i);
  const rrx = Math.max(...rs.map(r => Math.abs(r.x) + r.r)) / (W / 2), rrz = Math.max(...rs.map(r => Math.abs(r.z) + r.r * r.sz)) / (D / 2);
  const N = 64, M = 12, nv = (N + 1) * (M + 1);
  const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 4), uv = new Float32Array(nv * 2), idx = [];
  const cA = new THREE.Color(0xEFAFAA), cB = new THREE.Color(0xDD9094), cC = new THREE.Color(0xC27780), c = new THREE.Color();
  const rc = y => {
    const t = Math.min(1, Math.max(0, y / H)), yy = 2 * t - 1;
    return Math.pow(Math.max(0, 1 - Math.pow(Math.abs(yy), mp)), 1 / mp) * (ant ? 0.64 + 0.36 * smooth(0, 0.55, t) : 0.72 + 0.28 * smooth(0, 0.5, t));
  };
  const alt = nino ? 0.75 : 1, yBot = -Math.min(L * 0.2, nino ? 1.8 : 2.7);
  for (let a = 0; a <= N; a++) {
    const th = a / N * Math.PI * 2, ux = Math.cos(th), uz = Math.sin(th);
    const sk = Math.pow(Math.pow(Math.abs(ux), ex) + Math.pow(Math.abs(uz), ex), -1 / ex);
    const yTop = 0.5 + (ant ? 1.7 : 1.25) * alt * Math.pow(Math.abs(ux), 2.2), hRim = rc(Math.max(0, yTop));
    for (let j = 0; j <= M; j++) {
      const s = j / M, y = yTop + (yBot - yTop) * s, k = a * (M + 1) + j;
      const dep = Math.max(0, -y) / L, tap = Math.max(0.35, 1 - 0.82 * Math.pow(dep, 1.35));
      const h = rc(Math.max(0, y)), e = smooth(0, 0.45, s);     // el borde abraza la corona y se abre hacia abajo para cubrir las raíces
      const crx = Math.max(h, hRim + (Math.max(hRim, rrx * tap) - hRim) * e), crz = Math.max(h, hRim + (Math.max(hRim, rrz * tap) - hRim) * e);
      const bul = 0.13 * smooth(0, 0.16, s) * (1 - 0.7 * smooth(0.35, 1, s)) - 0.04 * (1 - smooth(0, 0.07, s));
      pos[k * 3] = ux * sk * (crx + bul) * W / 2; pos[k * 3 + 1] = y; pos[k * 3 + 2] = uz * sk * (crz + bul) * D / 2;
      c.copy(cA).lerp(cB, smooth(0, 0.22, s)).lerp(cC, smooth(0.5, 1, s));
      col[k * 4] = c.r; col[k * 4 + 1] = c.g; col[k * 4 + 2] = c.b; col[k * 4 + 3] = 0.96 * (1 - smooth(0.38, 1, s));
      uv[k * 2] = a / N * 4; uv[k * 2 + 1] = s * 1.5;
    }
  }
  for (let a = 0; a < N; a++) for (let j = 0; j < M; j++) {
    const p = a * (M + 1) + j, q = (a + 1) * (M + 1) + j;
    idx.push(p, q, p + 1, q, q + 1, p + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let j = 0; j <= M; j++) { const e = N * (M + 1) + j; v.fromBufferAttribute(nor, j).add(w.fromBufferAttribute(nor, e)).normalize(); nor.setXYZ(j, v.x, v.y, v.z); nor.setXYZ(e, v.x, v.y, v.z); }
  return g;
}

// ---------- materiales y colores ----------
const tono = (h) => new THREE.Color(h);
const TONO = {
  adulto: { cuello: tono(0xDFC48F), medio: tono(0xF3E8D0), punta: tono(0xFCF8EE), borde: tono(0xBFD0E4), surco: tono(0x5A3E22), sombra: tono(0xC4A874) },
  nino: { cuello: tono(0xECDDBB), medio: tono(0xFAF5EA), punta: tono(0xFFFDF8), borde: tono(0xD0DEEE), surco: tono(0x7A6446), sombra: tono(0xDDCEAA) },
};

// Textura de relieve fino del esmalte (microrrelieve + periquimatos), generada por código y compartida.
let TEXB = null;
function texBump() {
  if (TEXB) return TEXB;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d'), im = cx.createImageData(S, S), d = im.data;
  let sd = 1234567; const rnd = () => (sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296;
  const oct = [[4, 0.5], [8, 0.32], [16, 0.22], [32, 0.14]].map(([f, w]) => ({ f, w, v: Float32Array.from({ length: f * f }, rnd) }));
  const val = (o, x, y) => {
    const f = o.f, X = x * f, Y = y * f, xi = Math.floor(X), yi = Math.floor(Y), a = X - xi, b = Y - yi;
    const h = (i, j) => o.v[((yi + j) % f) * f + ((xi + i) % f)];
    const u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b);
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let n = 0; for (const o of oct) n += (val(o, x / S, y / S) - 0.5) * o.w;
    const per = Math.sin((y / S) * Math.PI * 2 * 14 + n * 5);
    const g = 0.5 + n * 0.85 + per * 0.07;
    const j = (y * S + x) * 4; d[j] = d[j + 1] = d[j + 2] = Math.max(0, Math.min(255, g * 255)); d[j + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  TEXB = new THREE.CanvasTexture(cv);
  TEXB.wrapS = TEXB.wrapT = THREE.RepeatWrapping; TEXB.repeat.set(5, 4); TEXB.anisotropy = 8; TEXB.colorSpace = THREE.NoColorSpace;
  return TEXB;
}

// Luz de borde (fresnel) tipo esmalte translúcido + desvanecimiento de la raíz; uniformes compartidos por familia de material.
const U = {
  esm: { c: { value: new THREE.Color(0x9EC4FF) }, k: { value: 0.34 } },
  raiz: { c: { value: new THREE.Color(0xFFE9C4) }, k: { value: 0.14 } },
  encia: { c: { value: new THREE.Color(0xFF8E8E) }, k: { value: 0.2 } },
};
function realzar(mat, fade, u = U.esm) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRim = u.c; sh.uniforms.uRimK = u.k;
    if (fade) { sh.uniforms.uFade = mat.userData.uFade; sh.uniforms.uL = mat.userData.uL; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimK; varying float vRY;' + (fade ? '\nuniform float uFade; uniform float uL;' : ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float fr = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.4); totalEmissiveRadiance += uRim * uRimK * fr; }')
      .replace('#include <opaque_fragment>', (fade ? 'diffuseColor.a *= 1.0 - 0.72 * uFade * smoothstep(0.5 * uL, 1.0 * uL, -vRY);\n' : '') + '#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'dent' + (fade ? 'F' : '');
  return mat;
}
const matEsmalte = () => realzar(new THREE.MeshPhysicalMaterial({
  color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.1,
  sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0xFFF1DC, ior: 1.6, bumpMap: texBump(), bumpScale: 0.45 }));
const matRaiz = (L) => {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, bumpMap: texBump(), bumpScale: 0.5, transparent: false });
  m.userData.uFade = { value: 0 }; m.userData.uL = { value: L };
  return realzar(m, true, U.raiz);
};
const matEncia = () => realzar(new THREE.MeshPhysicalMaterial({
  color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.52, clearcoat: 0.22, clearcoatRoughness: 0.4,
  sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0xFFB8B4, bumpMap: texBump(), bumpScale: 0.7 }), false, U.encia);
const matMarca = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.18 });

const matOro = () => new THREE.MeshStandardMaterial({ color: 0xE2AE1C, metalness: 0.9, roughness: 0.24, envMapIntensity: 1.35, emissive: 0x3A2500, emissiveIntensity: 0.25 });
const matImplante = () => new THREE.MeshStandardMaterial({ color: 0x14B3A3, metalness: 0.65, roughness: 0.32, emissive: 0x04332E, emissiveIntensity: 0.35 });
const matConducto = () => new THREE.MeshBasicMaterial({ color: 0xA45CFF, transparent: true, opacity: 0.96, depthTest: false });
const sinRayo = o => { o.raycast = () => {}; return o; };

// ---- patología: sprites con textura de canvas (siempre de frente a la cámara, sin tocar el rayo de selección) ----
const TEX_PATO = {};
function lienzo(w, h, fn) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; fn(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
const TEXFN = {
  periapical: () => lienzo(128, 128, (c, w) => { const g = c.createRadialGradient(64, 64, 2, 64, 64, 62); g.addColorStop(0, 'rgba(40,6,24,.95)'); g.addColorStop(.35, 'rgba(84,16,48,.78)'); g.addColorStop(.7, 'rgba(107,29,58,.32)'); g.addColorStop(.86, 'rgba(107,29,58,.12)'); g.addColorStop(1, 'rgba(107,29,58,0)'); c.fillStyle = g; c.fillRect(0, 0, w, w); c.beginPath(); c.arc(64, 64, 50, 0, 7); c.lineWidth = 3.5; c.strokeStyle = 'rgba(225,120,160,.85)'; c.setLineDash([7, 6]); c.stroke(); }),
  fractura: () => lienzo(192, 96, (c) => { const pts = [[8, 30], [40, 66], [70, 26], [100, 70], [128, 24], [156, 66], [184, 34]]; for (const [lw, col] of [[22, '#fff'], [13, '#E5197A']]) { c.lineWidth = lw; c.strokeStyle = col; c.lineJoin = 'miter'; c.miterLimit = 3; c.lineCap = 'round'; c.beginPath(); pts.forEach(([x, y], k) => k ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); } }),
  reabsorcion: () => lienzo(128, 128, (c) => { for (const [x, y, r] of [[22, 34, 17], [106, 56, 20], [26, 92, 15], [100, 108, 12]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = '#8B5E34'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#fff'; c.stroke(); } c.setLineDash([6, 7]); c.lineWidth = 4; c.strokeStyle = '#8B5E34'; c.beginPath(); c.moveTo(40, 10); c.lineTo(40, 120); c.moveTo(88, 10); c.lineTo(88, 120); c.stroke(); }),
  fistula: () => lienzo(128, 128, (c) => { c.lineCap = 'round'; for (const [lw, col] of [[16, '#fff'], [9, '#9ACD00']]) { c.lineWidth = lw; c.strokeStyle = col; c.beginPath(); c.moveTo(94, 34); c.bezierCurveTo(94, 78, 56, 84, 16, 116); c.stroke(); } c.beginPath(); c.arc(94, 32, 20, 0, 7); c.fillStyle = '#9ACD00'; c.fill(); c.lineWidth = 5; c.strokeStyle = '#fff'; c.stroke(); c.beginPath(); c.arc(94, 32, 8, 0, 7); c.fillStyle = '#3B4A00'; c.fill(); }),
};
const texMov = g => lienzo(128, 128, (c) => {
  c.beginPath(); c.arc(64, 46, 36, 0, 7); c.fillStyle = '#00B8D9'; c.fill(); c.lineWidth = 7; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = '#fff'; c.font = '800 ' + (g === 3 ? 38 : 46) + 'px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ROM[g], 64, 49);
  c.lineCap = 'round'; c.lineJoin = 'round'; for (const [lw, col] of [[14, '#fff'], [7, '#00B8D9']]) { c.lineWidth = lw; c.strokeStyle = col; c.beginPath(); c.moveTo(16, 108); c.lineTo(112, 108); c.moveTo(36, 94); c.lineTo(16, 108); c.lineTo(36, 122); c.moveTo(92, 94); c.lineTo(112, 108); c.lineTo(92, 122); c.stroke(); }
});
const matSprite = (clave, fn, rea) => { const t = TEX_PATO[clave] || (TEX_PATO[clave] = fn()); const m = new THREE.SpriteMaterial({ color: rea ? 0xA9C4FF : 0xFFB3B3, map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }); m.userData.clave = clave; return m; };
const MATS_PATO = {};
const matPato = (id, g, rea) => { const k = id + (g || '') + (rea ? 'R' : 'P'), kt = id + (g || ''); return MATS_PATO[k] || (MATS_PATO[k] = id === 'movilidad' ? matSprite(kt, () => texMov(g), rea) : matSprite(kt, TEXFN[id], rea)); };

// tornillo de implante: cuello liso y cuerpo roscado que se afina hacia el ápice
function implanteGeo(i) {
  const r0 = Math.min(2.15, i.W * 0.24), Li = Math.min(i.L, 13) * 0.92, N = 9, pts = [new THREE.Vector2(0, 0.7), new THREE.Vector2(r0 * 0.92, 0.7), new THREE.Vector2(r0 * 1.05, 0.05)];
  for (let k = 0; k < N; k++) {
    const u0 = k / N, u1 = (k + 0.5) / N, y0 = -u0 * Li - 0.5, y1 = -u1 * Li - 0.5, tp = 1 - 0.32 * u1;
    pts.push(new THREE.Vector2(r0 * tp * 1.06, y0), new THREE.Vector2(r0 * tp * 0.74, y1));
  }
  pts.push(new THREE.Vector2(r0 * 0.5, -Li - 0.5), new THREE.Vector2(0, -Li - 0.9));
  return new THREE.LatheGeometry(pts, 28);
}
// conducto radicular (obturación de endodoncia): tubo que sigue la raíz, incluida su curvatura
function conductoGeo(r0, L, bend, H) {
  const pts = [];
  for (let k = 0; k <= 9; k++) { const d = k / 9; pts.push(new THREE.Vector3(bend * L * d * d, H * 0.32 - d * (L * 0.9 + H * 0.32), 0)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, Math.max(0.28, r0 * 0.15), 8, false);
}
// círculo tachado (ausente / extraído)
function tachado(R, rad, color) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, rad, 14, 56), matMarca(color)));
  const s = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.1, 2 * R - 2 * rad), 6, 14), matMarca(color));
  s.rotation.z = Math.PI / 4; g.add(s);
  return g;
}

function cruz(w, h, rad, color) {
  const g = new THREE.Group();
  const len = Math.hypot(w, h), ang = Math.atan2(h, w);
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len - 2 * rad, 6, 14), matMarca(color));
    m.rotation.z = s * (Math.PI / 2 - ang);
    g.add(m);
  }
  return g;
}

function anilloElipse(a, b, tubo, color) {
  const pts = [];
  for (let i = 0; i < 64; i++) { const t = i / 64 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * a, 0, Math.sin(t) * b)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, tubo, 10, true), matMarca(color));
}

function hash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function ruido(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const a = x - xi, b = y - yi, c = z - zi;
  const u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b), w = c * c * (3 - 2 * c);
  const l = (p, q, t) => p + (q - p) * t, h = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v), l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

// Corona + colores base por diente (se calculan una sola vez; el gemelo y las reconstrucciones los reutilizan).
const CACHE = new Map();
function datosCorona(i) {
  let d = CACHE.get(i.fdi);
  if (d) return d;
  const cr = corona(i), n = cr.reg.length, T = i.nino ? TONO.nino : TONO.adulto, c = new THREE.Color();
  const pos = cr.geo.attributes.position, base = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const t = cr.tp[k], px = pos.getX(k), py = pos.getY(k), pz = pos.getZ(k);
    c.copy(T.cuello).lerp(T.medio, smooth(0.04, 0.5, t)).lerp(T.punta, 0.6 * smooth(0.55, 1, t));
    c.multiplyScalar(1 + (ruido(px * 0.5 + 3.1, py * 0.5, pz * 0.5) - 0.5) * 0.08);                  // veteado sutil
    if (i.ant) c.lerp(T.borde, 0.62 * smooth(0.8, 1, t) * (1 - 0.35 * smooth(0.97, 1, t)));            // borde incisal translúcido
    else c.lerp(T.borde, 0.1 * smooth(0.86, 1, t));
    c.lerp(T.sombra, 0.22 * (1 - smooth(0, 0.16, t)));                                                  // línea cervical
    if (cr.ao[k] > 0.01) c.lerp(T.sombra, Math.min(0.85, cr.ao[k]));
    if (cr.surco[k] > 0.01) c.lerp(T.surco, Math.min(0.85, cr.surco[k] * 0.95));
    const cv = cr.cav[k];
    if (cv > 0) c.lerp(T.surco, Math.min(0.5, cv * 1.1) * smooth(0.12, 0.5, t));
    else c.lerp(T.punta, Math.min(0.28, -cv * 0.7) * smooth(0.3, 0.7, t));
    base[k * 3] = c.r; base[k * 3 + 1] = c.g; base[k * 3 + 2] = c.b;
  }
  d = { cr, base }; CACHE.set(i.fdi, d);
  return d;
}

// ---------- un diente ----------
class Diente {
  constructor(fdi) {
    this.i = info(fdi);
    const { W, D, H, L, nino, ant } = this.i;
    this.g = new THREE.Group();
    this.g.userData.fdi = fdi;
    const { cr, base } = datosCorona(this.i);
    this.reg = cr.reg; this.tp = cr.tp; this.surco = cr.surco;
    this.base = base;
    const geo = new THREE.BufferGeometry();       // comparte posición/normal/uv/índice con el gemelo; el color es propio
    geo.setIndex(cr.geo.index);
    for (const nm of ['position', 'normal', 'uv']) geo.setAttribute(nm, cr.geo.attributes[nm]);
    this.colores = new THREE.BufferAttribute(new Float32Array(base), 3);
    geo.setAttribute('color', this.colores);
    this.mE = matEsmalte(); this.mR = matRaiz(L); this.mG = matEncia();
    this.corona = new THREE.Mesh(geo, this.mE);
    this.corona.renderOrder = 1;
    this.g.add(this.corona);
    this.raices = [];
    for (const r of raices(this.i)) {
      const m = new THREE.Mesh(raiz(r.r, r.l, r.sz, r.bend, kindSurco(this.i)), this.mR);
      m.position.set(r.x, 0, r.z); m.rotation.set(r.rx, 0, r.rz); m.renderOrder = 2;
      this.g.add(m); this.raices.push(m);
    }
    this.encia = new THREE.Mesh(coronaCollar(this.i), this.mG);
    this.encia.renderOrder = 3;
    this.g.add(this.encia);
    for (const o of [this.corona, ...this.raices]) { o.castShadow = true; o.receiveShadow = true; }
    this.extFrente = cruz(W * 1.3, (H + L) * 0.95, nino ? 0.42 : 0.55, COL.ext);
    this.extFrente.position.set(0, (H - L) / 2, D / 2 + 1.6);
    this.extAtras = cruz(W * 1.3, (H + L) * 0.95, nino ? 0.42 : 0.55, COL.ext);
    this.extAtras.position.set(0, (H - L) / 2, -D / 2 - 1.6);
    this.extArriba = cruz(W * 1.25, D * 1.25, nino ? 0.38 : 0.5, COL.ext);
    this.extArriba.rotation.x = -Math.PI / 2;
    this.extArriba.position.set(0, H + 1.4, 0);
    this.perio = anilloElipse(W / 2 + 0.45, D / 2 + 0.6, nino ? 0.26 : 0.34, COL.per);
    this.perio.position.y = 0.25;
    // marcadores clínicos nuevos: casquete de oro, tornillo, conducto, banda, círculo tachado
    const yo = new THREE.Mesh(this.corona.geometry, matOro());
    yo.scale.set(1.05, 1.015, 1.05); yo.renderOrder = 2; this.oro = sinRayo(yo);
    this.imp = new THREE.Mesh(implanteGeo(this.i), matImplante()); this.imp.castShadow = true; this.imp.renderOrder = 2;
    this.canales = [];
    for (const [k, r] of raices(this.i).entries()) {
      const c = sinRayo(new THREE.Mesh(conductoGeo(r.r, r.l, r.bend, H), matConducto())); c.renderOrder = 6;
      this.raices[k].add(c); this.canales.push(c);
    }
    this.pulpa = sinRayo(new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, W * 0.1), 14, 10), matConducto()));
    this.pulpa.position.set(0, H * 0.42, 0); this.pulpa.renderOrder = 6;
    this.prot = sinRayo(anilloElipse(W / 2 * (ant ? 1.0 : 1.03) + 0.4, D / 2 * (ant ? 0.88 : 1.02) + 0.4, nino ? 0.4 : 0.52, 0xF26B1D));
    this.prot.position.y = H * 0.4;
    const Ra = W * 0.78 + 1.1, ra = nino ? 0.38 : 0.5;
    this.ausFrente = tachado(Ra, ra, 0x6B7280); this.ausFrente.position.set(0, (H - L) / 2, D / 2 + 1.6);
    this.ausAtras = tachado(Ra, ra, 0x6B7280); this.ausAtras.position.set(0, (H - L) / 2, -D / 2 - 1.6);
    this.ausArriba = tachado(Ra, ra, 0x6B7280); this.ausArriba.rotation.x = -Math.PI / 2; this.ausArriba.position.set(0, H + 1.4, 0);
    for (const o of [this.extFrente, this.extAtras, this.extArriba, this.perio, this.oro, this.imp, this.pulpa, this.prot, this.ausFrente, this.ausAtras, this.ausArriba]) { o.visible = false; this.g.add(o); }
    for (const c of this.canales) c.visible = false;
    // patología: periapical (ápice), fractura (corona), reabsorción y fístula (raíz), movilidad (sobre la corona)
    this.pato = {};
    for (const id of PATO) { const sp = sinRayo(new THREE.Sprite(matPato(id, id === 'movilidad' ? 1 : 0, false))); sp.renderOrder = 8; sp.visible = false; this.pato[id] = sp; this.g.add(sp); }
    const sz = Math.max(W * 1.05, 4.6);
    this.pato.periapical.scale.set(sz * 1.5, sz * 1.5, 1);
    this.pato.fractura.scale.set(Math.max(W * 1.05, 5), Math.max(W * 1.05, 5) * 0.5, 1);
    this.pato.reabsorcion.scale.set(sz * 0.95, sz * 0.95, 1);
    this.pato.fistula.scale.set(sz * 0.8, sz * 0.8, 1);
    this.pato.movilidad.scale.set(sz * 1.3, sz * 1.3, 1);
    this.posPato(1);
    this.lesiones = []; this.mk = []; this.rea = []; this.cache = {}; this.hover = -1; this.ext = false; this.kRaiz = 1;
  }
  // fracción visible de la raíz (1 = completa; en la vista completa se acorta y se desvanece para agrandar las coronas)
  setRaiz(k) {
    this.kRaiz = k;
    const { H, L } = this.i, fade = Math.min(1, Math.max(0, (1 - k) / (1 - KR)));
    for (const r of this.raices) r.scale.y = k;
    this.mR.userData.uFade.value = fade;
    this.mR.transparent = this.ext || fade > 0.001;
    this.encia.scale.y = 1 - 0.3 * fade;
    const f = (H + k * L) / (H + L), cy = (H - k * L) / 2;
    for (const o of [this.extFrente, this.extAtras]) { o.scale.y = f; o.position.y = cy; }
    for (const o of [this.ausFrente, this.ausAtras]) o.position.y = cy;
    this.imp.scale.y = k;
    this.posPato(k);
  }
  posPato(k) {
    const { W, H, L } = this.i, p = this.pato;
    p.periapical.position.set(0, -k * L - 0.3, 0);
    p.reabsorcion.position.set(0, -k * L * 0.62, 0);
    p.fistula.position.set(W * 0.36, -k * L * 0.4, 0);
    p.fractura.position.set(0, H * 0.62, 0);
    p.movilidad.position.set(0, H + 0.8 + p.movilidad.scale.y / 2, 0);
  }
  // centro de un grupo de vértices de la corona (en coordenadas del diente)
  media(fn) {
    const pos = this.corona.geometry.attributes.position, m = new THREE.Vector3(), k2 = this.i.ms / (this.i.W / 2);
    let c = 0;
    for (let k = 0; k < this.reg.length; k++) {
      if (!fn(this.reg[k], this.tp[k], pos.getX(k) * k2)) continue;
      m.x += pos.getX(k); m.y += pos.getY(k); m.z += pos.getZ(k); c++;
    }
    return c ? m.divideScalar(c) : null;
  }
  // zona que pinta cada clase de Black
  zona(cl, cara) {
    const key = cl + cara;
    if (key in this.cache) return this.cache[key];
    const { W, H, D, ant } = this.i, rc = CARA[cara];
    let z = null;
    if (cl === 'I' && rc === 0) z = { c: this.media(r => r === 0), allow: [0], tmin: 0, tmax: 9, rx: .3 * W, ry: .5 * H, rz: .3 * D, surcos: true };
    else if (cl === 'I') z = { c: this.media((r, t, u) => r === rc && t > (ant ? .3 : .55) && t < (ant ? .5 : .75) && Math.abs(u) < .3), allow: [rc], tmin: ant ? .2 : .45, tmax: ant ? .68 : .85, rx: .2 * W, ry: .16 * H, rz: .3 * D };
    else if (cl === 'II') z = { c: this.media((r, t) => r === rc && t > .55 && t < .85), allow: [rc, 0], tmin: .3, tmax: 9, rx: .3 * W, ry: .42 * H, rz: .36 * D };
    else if (cl === 'III') z = { c: this.media((r, t) => r === rc && t > .38 && t < .6), allow: [rc], tmin: .2, tmax: .74, rx: .25 * W, ry: .22 * H, rz: .45 * D };
    else if (cl === 'IV') z = { c: this.media((r, t) => r === rc && t > .82), allow: [rc, 0, 3, 4], tmin: .45, tmax: 9, rx: .34 * W, ry: .3 * H, rz: .7 * D };
    else if (cl === 'V') z = { c: this.media((r, t) => r === rc && t > .1 && t < .3), allow: [rc], tmin: .02, tmax: .42, rx: .42 * W, ry: .17 * H, rz: .4 * D };
    if (z && !z.c) z = null;
    if (z) z.seed = (this.i.fdi * 7.31 + rc * 13.7) % 61;
    return (this.cache[key] = z);
  }
  pintar() {
    const a = this.colores.array, pos = this.corona.geometry.attributes.position;
    a.set(this.base);
    const zs = [], zr = [];
    for (const l of this.lesiones) { const z = this.zona(l.cl, l.cara); if (z) { zs.push(z); zr.push(this.rea.includes('car:' + l.cara)); } }
    const prot = this.mk.includes('protesis'), sella = this.mk.includes('sellante');
    const cPro = C_PROT.clone().lerp(this.rea.includes('protesis') ? C_REST : C_PEND, 0.45), cSel = C_SELLA.clone().lerp(this.rea.includes('sellante') ? C_REST : C_PEND, 0.45);
    for (let k = 0; k < this.reg.length; k++) {
      let w = 0, wr = false;
      if (zs.length) {
        const px = pos.getX(k), py = pos.getY(k), pz = pos.getZ(k), rg = this.reg[k], t = this.tp[k];
        for (let zi = 0; zi < zs.length; zi++) {
          const z = zs[zi];
          if (!z.allow.includes(rg) || t < z.tmin || t > z.tmax) continue;
          const ex = (px - z.c.x) / z.rx, ey = (py - z.c.y) / z.ry, ez = (pz - z.c.z) / z.rz;
          const d = Math.sqrt(ex * ex + ey * ey + ez * ez) + (ruido(px * 1.15 + z.seed, py * 1.15, pz * 1.15) - 0.5) * 0.5;
          let p = 1 - smooth(0.62, 1.0, d);
          if (z.surcos) p = Math.max(p, Math.min(1, this.surco[k] * 1.7) * (1 - smooth(1.0, 1.7, d)));
          if (p > w) { w = p; wr = zr[zi]; }
        }
      }
      const j = k * 3;
      if (prot) { const f = 0.3; a[j] += (cPro.r - a[j]) * f; a[j + 1] += (cPro.g - a[j + 1]) * f; a[j + 2] += (cPro.b - a[j + 2]) * f; }
      if (sella) {
        const rg = this.reg[k], t = this.tp[k], ant = this.i.ant;
        const sw = ant ? (rg === 4 ? smooth(0.28, 0.4, t) * (1 - smooth(0.62, 0.74, t)) * 0.8 : 0) : (rg === 0 ? 0.5 + 0.4 * Math.min(1, this.surco[k] * 1.7) : 0);
        if (sw > 0) { a[j] += (cSel.r - a[j]) * sw; a[j + 1] += (cSel.g - a[j + 1]) * sw; a[j + 2] += (cSel.b - a[j + 2]) * sw; }
      }
      if (w > 0) { const f = w * 0.97, cc = wr ? C_REST : C_PEND; a[j] += (cc.r - a[j]) * f; a[j + 1] += (cc.g - a[j + 1]) * f; a[j + 2] += (cc.b - a[j + 2]) * f; }
      if (this.hover >= 0 && this.reg[k] === this.hover) { a[j] += (C_HOVER.r - a[j]) * 0.32; a[j + 1] += (C_HOVER.g - a[j + 1]) * 0.32; a[j + 2] += (C_HOVER.b - a[j + 2]) * 0.32; }
    }
    this.colores.needsUpdate = true; sucio = true;
  }
  // cara tocada (a partir del punto de impacto del rayo)
  caraEn(hit) {
    const p = this.corona.worldToLocal(hit.point.clone()), pos = this.corona.geometry.attributes.position;
    let best = hit.face.a, bd = Infinity;
    for (const k of [hit.face.a, hit.face.b, hit.face.c]) {
      const d = (pos.getX(k) - p.x) ** 2 + (pos.getY(k) - p.y) ** 2 + (pos.getZ(k) - p.z) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return { reg: this.reg[best], t: this.tp[best], u: p.x * this.i.ms / (this.i.W / 2), w: p.z };
  }
  aplicar(m, vista) {
    this.lesiones = m.car; this.mk = m.mk; this.rea = m.rea || [];
    this.pintar();
    const has = id => m.mk.includes(id), aus = has('ausente');
    this.oro.visible = has('corona') && !aus;
    this.imp.visible = has('implante');
    for (const r of this.raices) r.visible = !has('implante');
    for (const c of this.canales) c.visible = has('endodoncia') && !has('implante');
    this.pulpa.visible = has('endodoncia');
    this.prot.visible = has('protesis');
    this.ausFrente.visible = aus && (vista === 'vest' || vista === 'completo');
    this.ausAtras.visible = aus && vista === 'ling';
    this.ausArriba.visible = aus && vista === 'arcada';
    this.perio.visible = m.per;
    const rv = !aus && vista !== 'arcada';   // en la vista oclusal la raíz queda oculta bajo la corona: no se dibujan sus señales
    this.pato.periapical.visible = has('periapical') && rv;
    this.pato.reabsorcion.visible = has('reabsorcion') && rv;
    this.pato.fistula.visible = has('fistula') && rv;
    this.pato.fractura.visible = has('fractura') && !aus;
    this.pato.movilidad.visible = has('movilidad') && !aus;
    for (const id of PATO) if (has(id)) this.pato[id].material = matPato(id, id === 'movilidad' ? m.mov : 0, m.rea.includes(id));
    // estado de tratamiento: rojo = por realizar, azul = realizado (se mezcla con el color propio de cada marcador)
    const ec = id => m.rea.includes(id) ? C_REST : C_PEND;
    const mezcla = (mat, base, id, k = 0.5) => { mat.color.set(base).lerp(ec(id), k); };
    mezcla(this.oro.material, 0xE2AE1C, 'corona'); mezcla(this.imp.material, 0x14B3A3, 'implante');
    for (const c of [...this.canales, this.pulpa]) mezcla(c.material, 0xA45CFF, 'endodoncia', 0.45);
    for (const o of [this.prot]) o.material.color.set(0xF26B1D).lerp(ec('protesis'), 0.5), o.material.emissive.set(o.material.color);
    for (const o of [this.extFrente, this.extAtras, this.extArriba]) o.traverse(x => { if (x.material) { x.material.color.copy(ec('ext')); x.material.emissive.copy(ec('ext')); } });
    this.perio.material.color.copy(ec('per')); this.perio.material.emissive.copy(ec('per'));
    this.extFrente.visible = m.ext && (vista === 'vest' || vista === 'completo');
    this.extAtras.visible = m.ext && vista === 'ling';
    this.extArriba.visible = m.ext && vista === 'arcada';
    const fant = m.ext || aus, op = aus ? 0.13 : m.ext ? 0.38 : 1;
    this.ext = fant;
    for (const mt of [this.mE, this.mR]) { mt.transparent = fant; mt.opacity = op; mt.depthWrite = !fant; mt.needsUpdate = true; }
    this.mR.transparent = fant || this.mR.userData.uFade.value > 0.001;
    const perRea = m.rea.includes('per');
    this.mG.color.set(m.per ? (perRea ? 0x6EA0FF : 0xFF5E6E) : 0xFFFFFF);
    this.mG.emissive.set(m.per ? (perRea ? 0x0C2A6A : 0x6A0C18) : 0x000000);
    this.mG.opacity = aus ? 0.12 : m.ext ? 0.35 : 1;
  }
  resaltar(on, cara = -1) {
    sucio = true;
    this.mE.emissive.set(on && cara < 0 ? 0x2E9BEC : 0x000000);
    this.mE.emissiveIntensity = on && cara < 0 ? 0.2 : 0;
    if (this.hover !== cara) { this.hover = cara; this.pintar(); }
  }
}
const kindSurco = i => i.kind === 'mol' ? 0 : i.kind === 'pre' && i.sup && i.p === 4 ? 0.04 : 0.07;
const COLLARES = new Map();
const coronaCollar = i => { let g = COLLARES.get(i.fdi); if (!g) { g = collar(i); COLLARES.set(i.fdi, g); } return g; };

// ---------- escena ----------
const cont = document.getElementById('escena');
const MOVIL = Math.min(innerWidth, innerHeight) < 700;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio * (MOVIL ? 1.15 : 1.5), MOVIL ? 2.6 : 3));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;      // sombras suaves; se actualizan solo cuando algo se mueve
renderer.shadowMap.autoUpdate = false;
const sombras = () => { renderer.shadowMap.needsUpdate = true; sucio = true; };
cont.prepend(renderer.domElement);
const rot = new CSS2DRenderer({ element: document.getElementById('rotulos') });

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
// Estudio dental: cajas de luz suaves (arriba, laterales cálido/frío, relleno, contraluz) sobre una sala azul oscura.
function entornoEstudio() {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), new THREE.MeshBasicMaterial({ color: 0x0b1326, side: THREE.BackSide })));
  const panel = (w, h, col, k, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(50, 16, 0xffffff, 6, 0, 46, 24);
  panel(14, 48, 0xfff0dc, 4.5, -48, 4, 20);
  panel(14, 48, 0xcfe0ff, 4, 48, 4, 20);
  panel(52, 12, 0xdce8ff, 2.6, 0, -42, 28);
  panel(40, 24, 0xffffff, 2.2, 0, 10, -50);
  panel(26, 26, 0xffffff, 2.2, 0, 4, 56);
  return s;
}
scene.environment = pmrem.fromScene(entornoEstudio(), 0.03).texture;
const camera = new THREE.PerspectiveCamera(28, 1, 1, 2000);
scene.environmentIntensity = 0.85;
// Todas las luces cuelgan de un soporte que se gira al mirar por detrás (vista palatina/lingual).
const rig = new THREE.Group(); scene.add(rig);
const luz = new THREE.SpotLight(0xfff2e2, 2.1, 0, 0.62, 1, 0);
luz.position.set(-55, 85, 195); luz.target.position.set(0, 0, -10); rig.add(luz, luz.target);
luz.castShadow = true; luz.shadow.mapSize.set(MOVIL ? 1024 : 2048, MOVIL ? 1024 : 2048);
luz.shadow.radius = 6; luz.shadow.blurSamples = 14; luz.shadow.bias = -0.0004; luz.shadow.normalBias = 0.2;
luz.shadow.camera.near = 80; luz.shadow.camera.far = 460;
const luz2 = new THREE.DirectionalLight(0xcfe0ff, 0.55); luz2.position.set(70, -25, 90); rig.add(luz2);
const luz3 = new THREE.DirectionalLight(0xffffff, 1.0); luz3.position.set(30, 70, -90); rig.add(luz3);
rig.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2f2a, 0.22));
// Fondo: solo recibe la sombra de los dientes (transparente); sobre el degradado oscuro da profundidad 3D.
const fondo = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1100), new THREE.ShadowMaterial({ color: 0x01040c, opacity: 0.7, side: THREE.DoubleSide }));
fondo.receiveShadow = true; fondo.renderOrder = -1; scene.add(fondo);
function ajustarEscena(v) {
  const por = v === 'ling';
  rig.rotation.y = por ? Math.PI : 0;
  scene.environmentRotation.y = por ? Math.PI : 0;
  const z = v === 'arcada' ? 40 : v === 'completo' ? 17 : 20;
  fondo.position.z = por ? z : -z;
  sombras();
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minPolarAngle = Math.PI * 0.1; controls.maxPolarAngle = Math.PI * 0.9;
controls.zoomSpeed = 0.8; controls.panSpeed = 0.8; controls.rotateSpeed = 0.7;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

const raiz3d = new THREE.Group(); scene.add(raiz3d);
const ray = new THREE.Raycaster();

// ---------- estado y pacientes (localStorage) ----------
// store = { actual, pacientes: [{ id, nombre, ci, nac, estado:{adulto,nino}, hist:{adulto:{fdi:[entradas]},nino:{}}, consultas:[{ id, fecha, motivo, estado, hist }] }] }
const CLAVE = 'odonto3d-sonrisa-v3', CLAVE_V2 = 'odonto3d-sonrisa-v2';
const normBase = x => ({ car: Array.isArray(x && x.car) ? x.car.slice() : [], ext: !!(x && x.ext), per: !!(x && x.per), mk: Array.isArray(x && x.mk) ? x.mk.filter(k => MKS.includes(k)) : [] });
const normM = x => { const m = normBase(x); m.rea = (Array.isArray(x && x.rea) ? x.rea : []).filter((k, j, a) => a.indexOf(k) === j && (k === 'ext' ? m.ext : k === 'per' ? m.per : typeof k === 'string' && k.startsWith('car:') ? m.car.some(l => 'car:' + l.cara === k) : conEstado(k) && m.mk.includes(k))); m.mov = m.mk.includes('movilidad') ? Math.min(3, Math.max(1, parseInt(x && x.mov, 10) || 1)) : 0; return m; };
const norm = normM;
const clon = x => JSON.parse(JSON.stringify(x));
const uid = () => Math.random().toString(36).slice(2, 9);
const car = (cl, cara) => ({ cl, cara });
const EJEMPLO = {
  adulto: { 16: { car: [car('I', 'O')] }, 25: { car: [car('II', 'D')] }, 36: { car: [car('I', 'O'), car('V', 'V')], mk: ['fistula'], rea: ['car:V'] }, 11: { car: [car('III', 'M')], mk: ['fractura'] }, 22: { car: [car('IV', 'D')] }, 28: { ext: true }, 48: { ext: true }, 31: { per: true, mk: ['movilidad'], mov: 2 }, 41: { per: true, mk: ['movilidad'], mov: 1 }, 42: { per: true },
    14: { mk: ['corona'], rea: ['corona'] }, 46: { mk: ['endodoncia', 'corona', 'periapical'], rea: ['endodoncia', 'corona'] }, 21: { mk: ['implante'], rea: ['implante'] }, 37: { mk: ['ausente'] }, 35: { mk: ['protesis'] }, 17: { mk: ['sellante'], rea: ['sellante'] }, 26: { mk: ['sellante'] } },
  nino: { 55: { car: [car('I', 'O')] }, 64: { car: [car('II', 'M')] }, 74: { car: [car('I', 'O')] }, 61: { car: [car('V', 'V')] }, 52: { ext: true }, 81: { per: true }, 82: { per: true },
    54: { mk: ['corona'], rea: ['corona'] }, 84: { mk: ['endodoncia', 'fistula'] }, 71: { mk: ['ausente'] }, 65: { mk: ['sellante'] }, 75: { mk: ['sellante'] } },
};
const EJEMPLO_ANTES = {   // la "primera consulta" de la maqueta: menos hallazgos
  adulto: { 16: { car: [car('I', 'O')] }, 25: { car: [car('II', 'D')] }, 36: { car: [car('I', 'O')] }, 28: { ext: true }, 31: { per: true }, 46: { car: [car('I', 'O')] }, 21: { ext: true }, 37: { car: [car('II', 'M')] } },
  nino: { 55: { car: [car('I', 'O')] }, 64: { car: [car('II', 'M')] }, 52: { ext: true }, 84: { car: [car('I', 'O')] } },
};
const e1 = (fecha, dx, tx, nota) => ({ id: uid(), fecha, dx, tx, nota });
const HIST_EJEMPLO = () => ({
  adulto: {
    16: [e1('2026-08-20', 'Caries oclusal (clase I)', 'Restauración con resina compuesta', 'Refiere sensibilidad al frío.')],
    46: [e1('2026-08-20', 'Caries oclusal profunda', 'Control y radiografía periapical', ''), e1('2026-09-03', 'Pulpitis irreversible', 'Endodoncia (conductometría y obturación)', 'Quedó pendiente la corona.'), e1('2026-10-15', 'Endodoncia concluida', 'Corona metal-cerámica cementada', 'Control a los 6 meses.')],
    21: [e1('2026-06-10', 'Ausencia por traumatismo', 'Implante de titanio 4,0 × 11 mm', 'Oseointegración esperada a los 4 meses.'), e1('2026-10-28', 'Implante integrado', 'Corona sobre implante', '')],
    28: [e1('2026-08-20', 'Tercer molar con pericoronaritis', 'Extracción indicada', 'Derivar a cirugía.')],
    31: [e1('2026-08-20', 'Gingivitis localizada', 'Profilaxis y control de placa', '')],
  },
  nino: {
    55: [e1('2026-08-20', 'Caries oclusal temporal', 'Restauración con ionómero de vidrio', '')],
    84: [e1('2026-09-12', 'Pulpitis en molar temporal', 'Pulpectomía y corona de acero', 'Niño colaborador.')],
  },
});
function semilla(prev) {
  const base = prev || clon(EJEMPLO);
  const antes = { estado: clon(EJEMPLO_ANTES), hist: { adulto: { 16: HIST_EJEMPLO().adulto[16] }, nino: {} } };
  const id = uid();
  return { actual: id, pacientes: [{ id, nombre: 'Laura Benítez (ejemplo)', ci: '4.567.890', nac: '1990-05-12', estado: base, hist: HIST_EJEMPLO(),
    consultas: [{ id: uid(), fecha: '2026-08-20T10:30', motivo: 'Primera consulta (diagnóstico)', estado: antes.estado, hist: antes.hist }] }] };
}
function cargarStore() {
  try { const s = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (s && Array.isArray(s.pacientes) && s.pacientes.length) return s; } catch (e) { /* sin almacenamiento */ }
  let prev = null;
  try { const s = JSON.parse(localStorage.getItem(CLAVE_V2) || 'null'); if (s && s.adulto && s.nino && (Object.keys(s.adulto).length || Object.keys(s.nino).length)) prev = s; } catch (e) { /* sin almacenamiento */ }
  return semilla(prev);
}
let store = cargarStore();
for (const p of store.pacientes) { p.hist = p.hist || { adulto: {}, nino: {} }; p.hist.adulto = p.hist.adulto || {}; p.hist.nino = p.hist.nino || {}; p.consultas = p.consultas || []; }
const pac = () => store.pacientes.find(p => p.id === store.actual) || store.pacientes[0];
let estado = pac().estado, hist = pac().hist;
const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(store)); } catch (e) { /* sin almacenamiento */ } };
guardar();

let dent = 'adulto', selFdi = null, fichaFdi = null;
let vista = (innerWidth < innerHeight) ? 'arcada' : 'completo';
let herramienta = 'car', clase = 'auto';
let estadoNuevo = false;   // estado con el que nacen las marcas nuevas: false = por realizar, true = realizado
let dientes = new Map();
let rotulos = [];          // {obj, f, pos: {filas, arcada}}
let anim = null;

function orden(nino) {
  const P = nino ? [5, 4, 3, 2, 1] : [8, 7, 6, 5, 4, 3, 2, 1];
  const [a, b, c, d] = nino ? [5, 6, 8, 7] : [1, 2, 4, 3];
  return { sup: [...P.map(p => a * 10 + p), ...[...P].reverse().map(p => b * 10 + p)],
           inf: [...P.map(p => c * 10 + p), ...[...P].reverse().map(p => d * 10 + p)] };
}

// posiciones: odontograma en filas (de frente, coronas inclinadas para ver también la cara oclusal) y arcada abierta (oclusal)
const INCL = 0.38;
function disposiciones(nino) {
  const o = orden(nino), G = nino ? 0.8 : 0.9, MED = 1.6, HUECO = 1.3, ESP = nino ? 1.72 : 1.4, PIL = matchMedia('(max-width: 760px)').matches ? 15 : 7.8;   // ESP: separación horizontal en la vista completa
  const out = { filas: new Map(), ling: new Map(), completo: new Map(), completoG: new Map(), arcadaV: new Map(), arcadaH: new Map(), lados: { filas: {}, ling: {}, completo: {}, arcadaV: {}, arcadaH: {} }, caja: { filas: null, ling: null, completo: null, arcadaV: null, arcadaH: null } };
  const RY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const qSupL = new THREE.Quaternion().setFromAxisAngle(EJE_X, INCL).multiply(new THREE.Quaternion().setFromAxisAngle(EJE_Z, Math.PI));
  const qInfL = new THREE.Quaternion().setFromAxisAngle(EJE_X, -INCL);
  const qSup = new THREE.Quaternion().setFromAxisAngle(EJE_X, -INCL).multiply(new THREE.Quaternion().setFromAxisAngle(EJE_Z, Math.PI));
  const qInf = new THREE.Quaternion().setFromAxisAngle(EJE_X, INCL);
  const cI = Math.cos(INCL), sI = Math.sin(INCL);
  let ancho = 0;
  for (const fila of ['sup', 'inf']) {
    const lista = o[fila], ts = lista.map(info);
    const total = ts.reduce((s, t) => s + t.W, 0) + G * (ts.length - 1) + MED;
    ancho = Math.max(ancho, total);
    const maxR = Math.max(...ts.map(t => t.H + t.L));
    const maxRc = Math.max(...ts.map(t => t.H + KR * t.L)), cT = Math.cos(TILT);
    let x = -total / 2;
    ts.forEach((t, i) => {
      if (i === ts.length / 2) x += MED;
      const cx = x + t.W / 2; x += t.W + G;
      const s = fila === 'sup' ? 1 : -1;
      out.filas.set(t.fdi, { pos: new THREE.Vector3(cx, s * (HUECO + t.H * cI), -t.H * sI), q: fila === 'sup' ? qSup : qInf, rot: new THREE.Vector3(cx, s * (HUECO + maxR * cI + 3.2), 0) });
      { const cx2 = cx * ESP, HC = HUECO + 2.3, R = maxRc * cT + 3.6, yA = s * (HC + t.H * cT + R), yB = s * (HC + t.H * cT);
        const q0 = fila === 'sup' ? new THREE.Quaternion().setFromAxisAngle(EJE_Z, Math.PI) : new THREE.Quaternion();
        const qt = new THREE.Quaternion().setFromAxisAngle(EJE_X, -s * TILT);      // la corona se inclina hacia la cámara: se ve la cara oclusal
        out.completo.set(t.fdi, { pos: new THREE.Vector3(cx2, yA, 0), q: qt.clone().multiply(q0), rot: new THREE.Vector3(cx2, s * (HC + R + maxRc * cT + 3), 0) });
        out.completoG.set(t.fdi, { pos: new THREE.Vector3(cx2, yB, 0), q: qt.clone().multiply(RY).multiply(q0) });
        out.lados.completo[fila] = new THREE.Vector3(0, s * (HC + R + maxRc * cT + PIL), 0); }
      out.ling.set(t.fdi, { pos: new THREE.Vector3(cx, s * (HUECO + t.H * cI), t.H * sI), q: fila === 'sup' ? qSupL : qInfL, rot: new THREE.Vector3(cx, s * (HUECO + maxR * cI + 3.2), 0) });
    });
    out.lados.filas[fila] = new THREE.Vector3(0, (fila === 'sup' ? 1 : -1) * (HUECO + maxR * cI + 13.5), 0);
    out.lados.ling[fila] = out.lados.filas[fila];
  }
  out.lados.filas.der = new THREE.Vector3(-ancho / 2 - 7, 0, 0);
  out.lados.filas.izq = new THREE.Vector3(ancho / 2 + 7, 0, 0);
  out.lados.ling.der = out.lados.filas.der; out.lados.ling.izq = out.lados.filas.izq;
  out.lados.completo.der = new THREE.Vector3(-ancho * ESP / 2 - 5, 0, 0); out.lados.completo.izq = new THREE.Vector3(ancho * ESP / 2 + 5, 0, 0);
  // arcada: cuarto de elipse + tramo recto, colocando cada diente por su ancho
  const a = nino ? 15 : 22, b = nino ? 13 : 19, inc = nino ? 0.18 : 0.13;
  const poli = [];
  for (let i = 0; i <= 90; i++) { const f = i / 90 * Math.PI / 2; poli.push(new THREE.Vector2(a * Math.sin(f), b * Math.cos(f) - b)); }
  const dirR = new THREE.Vector2(inc, -1).normalize();
  for (let i = 1; i <= 80; i++) poli.push(new THREE.Vector2(a + dirR.x * i, -b + dirR.y * i));
  const acum = [0];
  for (let i = 1; i < poli.length; i++) acum.push(acum[i - 1] + poli[i].distanceTo(poli[i - 1]));
  const en = s => {
    let i = acum.findIndex(v => v >= s); if (i <= 0) i = 1;
    const u = (s - acum[i - 1]) / (acum[i] - acum[i - 1]);
    const p = poli[i - 1].clone().lerp(poli[i], u);
    const tg = poli[i].clone().sub(poli[i - 1]).normalize();
    return { p, n: new THREE.Vector2(-tg.y, tg.x) };      // normal hacia afuera
  };
  let maxX = 0, minY = 0;
  const mitad = {};
  for (const fila of ['sup', 'inf']) {
    const lista = o[fila], n2 = lista.length / 2;
    for (const lado of [-1, 1]) {
      const seq = lado < 0 ? lista.slice(0, n2).reverse() : lista.slice(n2);
      let s = MED / 2;
      for (const f of seq) {
        const t = info(f);
        const c = en(s + t.W / 2); s += t.W + G;
        mitad[f] = { p: new THREE.Vector2(c.p.x * lado, c.p.y), n: new THREE.Vector2(c.n.x * lado, c.n.y), t };
        maxX = Math.max(maxX, Math.abs(c.p.x) + t.D / 2); minY = Math.min(minY, c.p.y - t.D / 2);
      }
    }
  }
  const Y0 = -minY + (nino ? 3 : 4);
  for (const [f, m] of Object.entries(mitad)) {
    const s = m.t.sup ? 1 : -1;
    const p = new THREE.Vector3(m.p.x, s * (Y0 + m.p.y), -m.t.H);
    const nz = new THREE.Vector3(m.n.x, s * m.n.y, 0).normalize();
    const Y = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3().crossVectors(Y, nz);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, nz));
    const r = new THREE.Vector3(p.x, p.y, 0).addScaledVector(nz, m.t.D / 2 + (nino ? 3 : 3.6));
    out.arcadaV.set(+f, { pos: p, q, rot: r });
  }
  out.lados.arcadaV.sup = new THREE.Vector3(0, Y0 + 14 + (nino ? 0 : 1), 0);
  out.lados.arcadaV.inf = new THREE.Vector3(0, -Y0 - 14 - (nino ? 0 : 1), 0);
  out.lados.arcadaV.der = new THREE.Vector3(-maxX - 10, 0, 0);
  out.lados.arcadaV.izq = new THREE.Vector3(maxX + 10, 0, 0);
  // arcada en pantalla ancha: las dos arcadas lado a lado (la superior a la izquierda), cada una centrada en vertical; llena mejor el escritorio
  {
    const X0 = maxX + 7, ext = { sup: [1e9, -1e9], inf: [1e9, -1e9] };
    for (const [f, d] of out.arcadaV) { const e = ext[info(f).sup ? 'sup' : 'inf']; e[0] = Math.min(e[0], d.pos.y); e[1] = Math.max(e[1], d.pos.y); }
    for (const [f, d] of out.arcadaV) {
      const sup = info(f).sup, e = ext[sup ? 'sup' : 'inf'], cy = (e[0] + e[1]) / 2, dx = sup ? -X0 : X0;
      out.arcadaH.set(f, { pos: new THREE.Vector3(d.pos.x + dx, d.pos.y - cy, d.pos.z), q: d.q, rot: new THREE.Vector3(d.rot.x + dx, d.rot.y - cy, 0) });
    }
    const hy = Math.max(ext.sup[1] - ext.sup[0], ext.inf[1] - ext.inf[0]) / 2 + (nino ? 9 : 10);
    out.lados.arcadaH.sup = new THREE.Vector3(-X0, hy, 0); out.lados.arcadaH.inf = new THREE.Vector3(X0, hy, 0);
    out.lados.arcadaH.der = new THREE.Vector3(-X0 - maxX - 10, 0, 0); out.lados.arcadaH.izq = new THREE.Vector3(X0 + maxX + 10, 0, 0);
  }
  for (const v of ['filas', 'ling', 'completo', 'arcadaV', 'arcadaH']) {
    const caja = new THREE.Box3();
    for (const [, d] of out[v]) caja.expandByPoint(d.rot);
    for (const k of ['sup', 'inf', 'der', 'izq']) caja.expandByPoint(out.lados[v][k]);
    out.caja[v] = caja;
  }
  return out;
}

let DISP = null;
// En pantalla ancha (escritorio) la vista oclusal pone las dos arcadas lado a lado y queda bastante más grande.
let arcH = false;
const arcadaAncha = () => cont.clientWidth / Math.max(1, cont.clientHeight) > 1.25;
function usarArcada(h) {
  arcH = h;
  DISP.arcada = h ? DISP.arcadaH : DISP.arcadaV; DISP.lados.arcada = h ? DISP.lados.arcadaH : DISP.lados.arcadaV; DISP.caja.arcada = h ? DISP.caja.arcadaH : DISP.caja.arcadaV;
  for (const r of rotulos) r.pos.arcada = r.f ? DISP.arcada.get(r.f).rot : DISP.lados.arcada[r.k];
}
// coloca todo de golpe en la disposición de una vista (sin animar)
function colocar(v) {
  const comp = v === 'completo';
  for (const [f, d] of dientes) {
    const L = DISP[v].get(f), G = comp ? DISP.completoG.get(f) : L;
    d.g.position.copy(L.pos); d.g.quaternion.copy(L.q);
    d.gem.g.position.copy(G.pos); d.gem.g.quaternion.copy(G.q);
    d.gem.g.visible = comp; d.setRaiz(comp ? KR : 1); d.gem.setRaiz(comp ? KR : 1);
  }
  for (const r of rotulos) r.obj.position.copy(r.pos[v]);
  sombras();
}

function rotulo(txt, clase) {
  const el = document.createElement('div');
  el.className = clase; el.textContent = txt;
  return new CSS2DObject(el);
}

function construir() {
  for (const [, d] of dientes) { raiz3d.remove(d.g); raiz3d.remove(d.gem.g); }
  for (const r of rotulos) { r.obj.removeFromParent(); r.obj.element.remove(); }
  dientes = new Map(); rotulos = []; sobre = null;
  const nino = dent === 'nino';
  DISP = disposiciones(nino);
  DISP.vest = DISP.filas; DISP.lados.vest = DISP.lados.filas; DISP.caja.vest = DISP.caja.filas;
  usarArcada(arcadaAncha());
  const o = orden(nino);
  for (const f of [...o.sup, ...o.inf]) {
    const d = new Diente(f);
    const L = DISP[vista].get(f);
    d.g.position.copy(L.pos); d.g.quaternion.copy(L.q);
    raiz3d.add(d.g);
    d.gem = new Diente(f); d.gem.g.visible = vista === 'completo';
    d.setRaiz(vista === 'completo' ? KR : 1); d.gem.setRaiz(vista === 'completo' ? KR : 1);
    { const G = vista === 'completo' ? DISP.completoG.get(f) : L; d.gem.g.position.copy(G.pos); d.gem.g.quaternion.copy(G.q); }
    raiz3d.add(d.gem.g);
    dientes.set(f, d);
    const r = rotulo(String(f), 'num');
    r.position.copy(L.rot); scene.add(r);
    rotulos.push({ obj: r, f, pos: { vest: DISP.filas.get(f).rot, ling: DISP.ling.get(f).rot, completo: DISP.completo.get(f).rot, arcada: DISP.arcada.get(f).rot } });
  }
  const txt = { sup: '▲ SUPERIOR', inf: '▼ INFERIOR', der: 'DERECHA', izq: 'IZQUIERDA' };
  for (const k of ['sup', 'inf', 'der', 'izq']) {
    const r = rotulo(txt[k], 'lado');
    r.position.copy(DISP.lados[vista][k]); scene.add(r);
    rotulos.push({ obj: r, k, pos: { vest: DISP.lados.filas[k], ling: DISP.lados.ling[k], completo: DISP.lados.completo[k], arcada: DISP.lados.arcada[k] } });
  }
  refrescarMarcas();
  textosLados();
  encuadrar(false);
  ajustarEscena(vista);
  document.getElementById('subt').textContent = nino ? '· Pediátrico, 51 al 85' : '· Adulto, 11 al 48';
}

const TXT_LADO = {
  vest: { sup: '▲ SUPERIOR · VESTIBULAR', inf: '▼ INFERIOR · VESTIBULAR' },
  ling: { sup: '▲ SUPERIOR · PALATINA', inf: '▼ INFERIOR · LINGUAL' },
  completo: { sup: '▲ SUPERIOR · vestibular arriba, palatina abajo', inf: '▼ INFERIOR · lingual arriba, vestibular abajo' },
  arcada: { sup: '▲ SUPERIOR', inf: '▼ INFERIOR' } };
function modoControles() {
  const pan = vista === 'completo';
  controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = pan ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.screenSpacePanning = true;
}
function textosLados() {
  modoControles();
  document.body.classList.toggle('v-completo', vista === 'completo');
  for (const r of rotulos) if (r.k === 'sup' || r.k === 'inf') r.obj.element.textContent = vista === 'arcada' && arcH ? { sup: 'SUPERIOR', inf: 'INFERIOR' }[r.k] : TXT_LADO[vista][r.k];
}
// aplica un estado (de una dentición) a los dientes 3D y a sus rótulos; no toca el resumen ni el almacenamiento
function aplicarEstado(e) {
  for (const [f, d] of dientes) {
    const m = norm(e[f]), aus = m.mk.includes('ausente');
    d.aplicar(m, vista); d.gem.aplicar(m, vista === 'completo' ? 'ling' : vista);
    const r = rotulos.find(x => x.f === f);
    if (r) {
      const el = r.obj.element, c = el.classList;
      c.toggle('car', m.car.length > 0 && !m.ext); c.toggle('ext', m.ext); c.toggle('per', m.per && !m.ext && !m.car.length);
      c.toggle('aus', aus); c.toggle('sel', f === selFdi);
      el.querySelector('.pts')?.remove();
      if (m.mk.length) { const p = document.createElement('span'); p.className = 'pts'; for (const id of m.mk) { const i = document.createElement('i'); i.style.background = MARC[id].c; if (conEstado(id)) i.style.boxShadow = `0 0 0 1.6px ${m.rea.includes(id) ? AZUL : ROJO}`; p.append(i); } el.append(p); }
    }
    for (const x of [d, d.gem]) for (const o of [x.corona, ...x.raices]) o.castShadow = !(m.ext || aus);
  }
  sombras();
}
function refrescarMarcas() {
  aplicarEstado(estado[dent]);
  resumen();
}

function resumen() {
  const e = estado[dent], lc = [], le = [], lp = [], lm = {};
  for (const f of Object.keys(e).map(Number).sort((a, b) => a - b)) {
    const m = norm(e[f]), i = info(f);
    for (const id of m.mk) (lm[id] = lm[id] || []).push({ t: id === 'movilidad' ? `${f} (gr. ${ROM[m.mov]})` : String(f), ok: m.rea.includes(id) });
    for (const x of m.car) lc.push({ t: `${f} ${x.cl} ${nombreCara(i, CARA[x.cara])}`, ok: m.rea.includes('car:' + x.cara) });
    if (m.ext) le.push({ t: String(f), ok: m.rea.includes('ext') });
    if (m.per) lp.push({ t: String(f), ok: m.rea.includes('per') });
  }
  const res = document.getElementById('res');
  res.replaceChildren();
  const item = (color, nombre, lista) => {
    const s = document.createElement('span'), dot = document.createElement('span'), b = document.createElement('b');
    dot.className = 'dot'; dot.style.background = color;
    if (!lista.length) b.textContent = '—';
    lista.forEach((x, j) => { const e = document.createElement('span'); e.textContent = x.t + (x.ok ? ' ✓' : ''); e.style.color = x.ok ? AZUL : ROJO; b.append(e); if (j < lista.length - 1) b.append(' · '); });
    s.append(dot, `${nombre}: `, b);
    res.append(s);
  };
  item('#16161A', 'Caries (clase y cara)', lc);
  item('#1A5FB4', 'Extracción', le);
  item('#D7262B', 'Periodontal', lp);
  for (const id of MKS) if (lm[id]) item(MARC[id].c, MARC[id].n, lm[id]);
  const cnt = { r: 0, p: 0 }; for (const l of [lc, le, lp, ...Object.values(lm)]) for (const x of l) cnt[x.ok ? 'r' : 'p']++;
  const est = document.createElement('span'); est.className = 'est-res';
  est.innerHTML = '';
  { const a = document.createElement('b'), z = document.createElement('b'); a.style.color = ROJO; z.style.color = AZUL; a.textContent = `${cnt.p} por realizar`; z.textContent = `${cnt.r} realizado${cnt.r === 1 ? '' : 's'}`; est.append('Estado: ', a, ' · ', z); }
  res.append(est);
  const btn = document.createElement('button');
  btn.className = 'mini'; btn.textContent = 'Limpiar todo';
  btn.onclick = () => { estado[dent] = {}; guardar(); refrescarMarcas(); avisar('Odontograma sin marcas'); };
  const ej = document.createElement('button');
  ej.className = 'mini'; ej.textContent = 'Ver ejemplo';
  ej.onclick = () => { estado[dent] = JSON.parse(JSON.stringify(EJEMPLO[dent])); guardar(); refrescarMarcas(); avisar('Paciente de ejemplo'); };
  const nota = document.createElement('span');
  nota.className = 'nota'; nota.textContent = 'Maqueta de concepto · paciente de ejemplo.';
  const desd = (sup) => {
    const b = document.createElement('button'); b.className = 'mini';
    b.textContent = sup ? 'Desdentado superior' : 'Desdentado inferior';
    b.onclick = () => {
      const qs = dent === 'adulto' ? (sup ? [1, 2] : [3, 4]) : (sup ? [5, 6] : [7, 8]);
      const n = dent === 'adulto' ? 8 : 5, e = estado[dent], fs = [];
      for (const q of qs) for (let i = 1; i <= n; i++) fs.push(q * 10 + i);
      const todos = fs.every(f => e[f] && norm(e[f]).mk.includes('ausente'));
      for (const f of fs) {
        const m = norm(e[f]); const k = m.mk.indexOf('ausente');
        if (todos) { if (k >= 0) m.mk.splice(k, 1); }
        else if (k < 0) { m.mk.push('ausente'); m.car = []; m.ext = false; m.per = false; }
        if (!m.car.length && !m.ext && !m.per && !m.mk.length) delete e[f]; else e[f] = m;
      }
      guardar(); refrescarMarcas();
      avisar(`Arcada ${sup ? 'superior' : 'inferior'} ${todos ? 'restaurada' : 'desdentada'}`);
    };
    return b;
  };
  res.append(btn, desd(true), desd(false), ej, nota);
}

// ---------- cámara ----------
function encuadre(v, asp = camera.aspect) {
  const caja = DISP.caja[v], c = caja.getCenter(new THREE.Vector3()), t = caja.getSize(new THREE.Vector3());
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = v === 'completo' ? Math.max((t.y / 2 + 3.9) / tan, Math.min((t.x / 2) / (tan * asp) * 1.02 + 4, (t.y / 2) / tan * 1.9)) : Math.max((t.y / 2) / tan, (t.x / 2) / (tan * asp)) * 1.07 + 8;
  return { pos: new THREE.Vector3(c.x, c.y, v === 'ling' ? -d : d), target: c };
}
function encuadrar(animado) {
  sucio = true;
  const e = encuadre(vista);
  const dz = Math.abs(e.pos.z); controls.maxDistance = dz * 1.8; controls.minDistance = dz * 0.18;
  if (!animado) { camera.position.copy(e.pos); controls.target.copy(e.target); controls.update(); return null; }
  return { camDe: camera.position.clone(), camA: e.pos, tgDe: controls.target.clone(), tgA: e.target };
}

function iniciarAnim(a, dur, cam) {
  anim = { t0: performance.now(), dur, a, cam };
  for (const [, d] of dientes) { d.ini = { p: d.g.position.clone(), q: d.g.quaternion.clone() }; d.gem.ini = { p: d.gem.g.position.clone(), q: d.gem.g.quaternion.clone() }; d.k0 = d.kRaiz; if (a === 'completo') d.gem.g.visible = true; }
  for (const r of rotulos) r.ini = r.obj.position.clone();
}

function cambiarVista(v) {
  if (v === vista && !anim) return;
  zoom = null; camAnim = null; mostrarVolver(false);
  vista = v;
  ajustarEscena(v);
  iniciarAnim(v, 1300, encuadrar(true));
  refrescarMarcas();
  textosLados();
  document.querySelectorAll('#segVista button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

function paso(now) {
  if (!anim) return;
  const u = Math.min(1, (now - anim.t0) / anim.dur), k = ease(u);
  for (const [f, d] of dientes) {
    const L = DISP[anim.a].get(f);
    d.g.position.lerpVectors(d.ini.p, L.pos, k);
    d.g.quaternion.slerpQuaternions(d.ini.q, L.q, k);
    const G = anim.a === 'completo' ? DISP.completoG.get(f) : L;
    d.gem.g.position.lerpVectors(d.gem.ini.p, G.pos, k);
    d.gem.g.quaternion.slerpQuaternions(d.gem.ini.q, G.q, k);
    if (u >= 1) d.gem.g.visible = anim.a === 'completo';
    const kk = d.k0 + ((anim.a === 'completo' ? KR : 1) - d.k0) * k; d.setRaiz(kk); d.gem.setRaiz(kk);
  }
  sombras();
  for (const r of rotulos) r.obj.position.lerpVectors(r.ini, r.pos[anim.a], k);
  if (anim.cam) {
    const C = anim.cam;
    if (!C.s0) { C.s0 = new THREE.Spherical().setFromVector3(C.camDe.clone().sub(C.tgDe)); C.s1 = new THREE.Spherical().setFromVector3(C.camA.clone().sub(C.tgA));
      let dt = C.s1.theta - C.s0.theta; if (dt > Math.PI) dt -= 2 * Math.PI; if (dt < -Math.PI) dt += 2 * Math.PI; if (Math.abs(Math.abs(dt) - Math.PI) < 0.05) dt = Math.PI; C.dt = dt; }
    controls.target.lerpVectors(C.tgDe, C.tgA, k);
    const sp = new THREE.Spherical(C.s0.radius + (C.s1.radius - C.s0.radius) * k, C.s0.phi + (C.s1.phi - C.s0.phi) * k, C.s0.theta + C.dt * k);
    camera.position.setFromSpherical(sp).add(controls.target);
  }
  if (u >= 1) anim = null;
}

// ---------- caries por clase de Black ----------
const EXP = {
  auto: 'Toque la cara del diente: la clase de Black sale sola.',
  I: 'Clase I: fosas y fisuras (oclusal) · cara palatina de anteriores.',
  II: 'Clase II: caras proximales de premolares y molares.',
  III: 'Clase III: proximales de anteriores, sin el ángulo incisal.',
  IV: 'Clase IV: proximales de anteriores, con el ángulo incisal.',
  V: 'Clase V: tercio cervical, vestibular o lingual.',
};
function elegirClase(i, c) {
  const lado = c.u >= 0 ? 'M' : 'D';
  const prox = c.reg === 1 || c.reg === 2 ? LETRAS[c.reg] : null;
  const vl = c.reg === 3 || c.reg === 4 ? LETRAS[c.reg] : (c.w >= 0 ? 'V' : 'L');
  if (clase === 'auto') {
    if (!i.ant) {
      if (c.reg === 0) return { cl: 'I', cara: 'O' };
      if (prox) return { cl: 'II', cara: prox };
      if (i.kind === 'mol' && c.t >= 0.55) return { cl: 'I', cara: vl };
      return { cl: 'V', cara: vl };
    }
    if (c.reg === 0) return { cl: 'IV', cara: lado };
    if (prox) return { cl: c.t > 0.74 ? 'IV' : 'III', cara: prox };
    if (c.reg === 4 && c.t >= 0.3) return { cl: 'I', cara: 'L' };
    return { cl: 'V', cara: vl };
  }
  if (clase === 'I') return i.ant ? { cl: 'I', cara: 'L' } : (i.kind === 'mol' && (c.reg === 3 || c.reg === 4) && c.t >= .55 ? { cl: 'I', cara: vl } : { cl: 'I', cara: 'O' });
  if (clase === 'II') return i.ant ? { error: 'La clase II es para premolares y molares' } : { cl: 'II', cara: prox || lado };
  if (clase === 'III' || clase === 'IV') return i.ant ? { cl: clase, cara: prox || lado } : { error: `La clase ${clase} es para incisivos y caninos` };
  return { cl: 'V', cara: vl };
}

// ---------- interacción ----------
const ptr = new THREE.Vector2();
let abajo = null, sobre = null;
const tip = document.getElementById('tip');
function golpe(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const objs = []; for (const [, d] of dientes) for (const x of [d, d.gem]) if (x.g.visible) x.g.traverseVisible(o => { if (o.isMesh && o !== x.encia) objs.push(o); });
  const h = ray.intersectObjects(objs, false)[0];
  if (!h) return null;
  let o = h.object; while (o && o.userData.fdi === undefined) o = o.parent;
  if (!o) return null;
  const d0 = dientes.get(o.userData.fdi), dd = d0.gem.g === o ? d0.gem : d0;
  return { d: dd, base: d0, hit: h };
}
// toque normal = marcar · pulsación larga = ficha del diente · doble toque / doble clic = zoom al diente
let largo = null, largoHecho = false, ultimo = null;
const cancelarLargo = () => { clearTimeout(largo); largo = null; };
renderer.domElement.addEventListener('contextmenu', ev => ev.preventDefault());
renderer.domElement.addEventListener('pointerdown', ev => {
  if (!ev.isPrimary) { cancelarLargo(); abajo = null; return; }
  abajo = { x: ev.clientX, y: ev.clientY }; largoHecho = false; cancelarLargo();
  const cx = ev.clientX, cy = ev.clientY;
  largo = setTimeout(() => {
    largo = null;
    if (!abajo || anim) return;
    const g = golpe({ clientX: cx, clientY: cy });
    if (!g) return;
    largoHecho = true; ultimo = null;
    navigator.vibrate && navigator.vibrate(18);
    abrirFicha(g.d.i.fdi);
  }, 560);
});
renderer.domElement.addEventListener('pointerup', ev => {
  cancelarLargo();
  if (!abajo) return;
  const mov = Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y);
  abajo = null;
  if (largoHecho) { largoHecho = false; return; }
  if (mov > 7 || anim) return;
  const g = golpe(ev);
  if (!g) return;
  const f = g.d.i.fdi, ahora = performance.now();
  if (ultimo && ahora - ultimo.t < 340 && ultimo.f === f && Math.hypot(ev.clientX - ultimo.x, ev.clientY - ultimo.y) < 30) {
    // segundo toque del doble toque: se deshace lo que hizo el primero y se hace zoom
    if (ultimo.antes === null) delete estado[dent][f]; else estado[dent][f] = JSON.parse(ultimo.antes);
    ultimo = null; guardar(); refrescarMarcas(); if (fichaFdi) renderFicha();
    enfocar(g.d);
    return;
  }
  ultimo = { t: ahora, f, x: ev.clientX, y: ev.clientY, antes: estado[dent][f] === undefined ? null : JSON.stringify(estado[dent][f]) };
  seleccionar(f);
  if (herramienta === 'ficha') abrirFicha(f);
  else marcar(g.d, g.hit, g.base);
});
renderer.domElement.addEventListener('pointercancel', () => { cancelarLargo(); abajo = null; });
renderer.domElement.addEventListener('pointermove', ev => {
  if (abajo && Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y) > 7) cancelarLargo();
  if (ev.pointerType !== 'mouse') return;
  const g = abajo ? null : golpe(ev);
  const d = g ? g.d : null;
  const cara = g && herramienta === 'car' && g.hit.object === d.corona ? d.caraEn(g.hit).reg : -1;
  if (d !== sobre) { if (sobre) sobre.resaltar(false); sobre = d; }
  if (d) d.resaltar(true, cara);
  renderer.domElement.style.cursor = d ? 'pointer' : 'grab';
  if (d) {
    tip.style.display = 'block'; tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
    tip.textContent = `${d.i.fdi} · ${d.i.nombre}` + (cara >= 0 ? ` · cara ${nombreCara(d.i, cara)}` : '');
  } else tip.style.display = 'none';
});
renderer.domElement.addEventListener('pointerleave', () => { tip.style.display = 'none'; if (sobre) { sobre.resaltar(false); sobre = null; } });

// alterna ext / per / un marcador clínico de un diente; devuelve el mensaje
function alternarMarca(f, id) {
  const e = estado[dent], m = norm(e[f]);
  let msg;
  if (id === 'ext' || id === 'per') {
    m[id] = !m[id];
    if (m[id] && estadoNuevo && !m.rea.includes(id)) m.rea.push(id);
    if (id === 'ext' && m.ext) m.car = [];
    msg = id === 'ext' ? (m.ext ? 'extracción marcada' : 'extracción quitada') : (m.per ? 'problema periodontal marcado' : 'problema periodontal quitado');
  } else {
    const k = m.mk.indexOf(id);
    if (id === 'movilidad') {   // cada toque sube el grado I → II → III; el cuarto lo quita
      if (k < 0) { m.mk.push(id); m.mov = 1; if (estadoNuevo) m.rea.push(id); } else if (m.mov < 3) m.mov++; else { m.mk.splice(k, 1); m.mov = 0; }
      msg = m.mov ? `movilidad grado ${ROM[m.mov]}` : 'movilidad quitada';
    } else {
      if (k >= 0) m.mk.splice(k, 1); else { m.mk.push(id); if (estadoNuevo && conEstado(id)) m.rea.push(id); if (id === 'ausente') { m.car = []; m.ext = false; m.per = false; } }
      msg = `${MARC[id].n.toLowerCase()} ${k >= 0 ? 'quitado' : 'marcado'}`;
    }
  }
  if (!m.car.length && !m.ext && !m.per && !m.mk.length) delete e[f]; else e[f] = m;
  return msg;
}

function marcar(d, hit, base) {
  const e = estado[dent], f = d.i.fdi, m = norm(e[f]);
  const aus = m.mk.includes('ausente');
  let msg;
  if (herramienta === 'sano') { delete e[f]; msg = 'sin marcas'; }
  else if (herramienta === 'car') {
    if (m.ext) { avisar(`${f}: está marcado para extracción`); return; }
    if (aus) { avisar(`${f}: diente ausente`); return; }
    if (hit.object !== d.corona) { avisar('Toque la corona del diente para marcar la caries'); return; }
    const c = d.caraEn(hit), r = elegirClase(d.i, c);
    if (r.error) { avisar(r.error); return; }
    const k = m.car.findIndex(x => x.cara === r.cara);
    const nom = nombreCara(d.i, CARA[r.cara]);
    if (k >= 0 && m.car[k].cl === r.cl) { m.car.splice(k, 1); msg = `caries clase ${r.cl} ${nom} quitada`; }
    else { if (k >= 0) m.car.splice(k, 1); m.car.push(r); m.rea = m.rea.filter(x => x !== 'car:' + r.cara); if (estadoNuevo) m.rea.push('car:' + r.cara); msg = `caries clase ${r.cl}, cara ${nom}` + (estadoNuevo ? ' (realizado)' : ''); }
    if (!sobre) { d.hover = CARA[r.cara]; setTimeout(() => { if (sobre !== d) { d.hover = -1; d.pintar(); } }, 650); }
    if (!m.car.length && !m.ext && !m.per && !m.mk.length) delete e[f]; else e[f] = m;
  } else {
    if (aus && (herramienta === 'ext' || herramienta === 'per')) { avisar(`${f}: diente ausente`); return; }
    msg = alternarMarca(f, herramienta);
  }
  guardar(); refrescarMarcas();
  if (fichaFdi) renderFicha();
  avisar(`${f} · ${msg}`);
  ocultarAyuda();
}

let tt;
function avisar(t) {
  const el = document.getElementById('toast');
  el.textContent = t; el.classList.add('ver');
  clearTimeout(tt); tt = setTimeout(() => el.classList.remove('ver'), 2400);
}
let ayudaFuera = false;
function ocultarAyuda() { if (ayudaFuera) return; ayudaFuera = true; document.getElementById('ayuda').style.opacity = 0; }
controls.addEventListener('start', ocultarAyuda);

// ================= v3: ficha, marcadores, pacientes/consultas, comparar, imprimir, zoom =================
const h = (tag, a, ...kids) => {
  const el = document.createElement(tag); let val;
  for (const [k, v] of Object.entries(a || {})) {
    if (k === 'class') el.className = v; else if (k === 'value') val = v;
    else if (k.startsWith('on')) el[k] = v;
    else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  if (val !== undefined) el.value = val;
  return el;
};
const $ = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const ahoraISO = () => { const d = new Date(); return `${hoyISO()}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtF = iso => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtFH = iso => fmtF(iso) + (iso && iso.length > 10 ? ' ' + iso.slice(11, 16) : '');
const edadDe = nac => { if (!nac) return ''; const n = new Date(nac), t = new Date(); let a = t.getFullYear() - n.getFullYear(); if (t.getMonth() < n.getMonth() || (t.getMonth() === n.getMonth() && t.getDate() < n.getDate())) a--; return a >= 0 ? ` (${a} años)` : ''; };
const espera = ms => new Promise(r => setTimeout(r, ms));
function icono(id, tam = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', tam); s.setAttribute('height', tam); s.setAttribute('viewBox', '-10 -10 20 20'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = MARC[id].ic;   // constantes del propio código, no texto del usuario
  return s;
}
const punto = c => h('span', { class: 'dot', style: `background:${c}` });
const cuadranteTxt = i => `${i.sup ? 'superior' : 'inferior'} ${i.der ? 'derecho' : 'izquierdo'}`;

// ----- barra de marcadores: se agregan a la paleta existente (caries, extracción y periodontal siguen igual) -----
{
  const herr = $('herr'), sano = herr.querySelector('[data-t=sano]');
  const btn = id => h('button', { class: 'tool', 'data-t': id, title: MARC[id].d }, icono(id), MARC[id].n.split(' /')[0]);
  for (const id of MKS.filter(k => !PATO.includes(k))) herr.insertBefore(btn(id), sano);
  // grupo «Patología»: segunda fila plegable bajo la barra principal
  const fila = h('div', { class: 'herr pat', id: 'herrPat', hidden: true }, h('span', { class: 't' }, 'PATOLOGÍA'), PATO.map(btn));
  const tg = h('button', { type: 'button', class: 'tool-g', id: 'patTg', 'aria-expanded': 'false', 'aria-controls': 'herrPat', title: 'Patología oral: lesión periapical, fractura, reabsorción, movilidad, fístula' }, 'Patología ', h('span', { class: 'fl' }, '▾'));
  tg.onclick = () => { const a = fila.hidden; fila.hidden = !a; tg.setAttribute('aria-expanded', a ? 'true' : 'false'); tg.classList.toggle('abierto', a); };
  herr.insertBefore(tg, sano);
  const be = h('button', { type: 'button', class: 'tool-g est-btn', id: 'bEstado', 'aria-pressed': 'false', title: 'Estado con el que se marcan los hallazgos nuevos' }, 'Estado: ', h('span', { class: 'dot', style: `background:${ROJO}` }), h('b', {}, 'Por realizar'));
  be.onclick = () => { estadoNuevo = !estadoNuevo; be.setAttribute('aria-pressed', estadoNuevo ? 'true' : 'false'); be.classList.toggle('rea', estadoNuevo); be.querySelector('.dot').style.background = estadoNuevo ? AZUL : ROJO; be.querySelector('b').textContent = estadoNuevo ? 'Realizado' : 'Por realizar'; };
  herr.insertBefore(be, herr.querySelector('.tool'));
  herr.after(fila);
}

// ----- selección del diente y botón ⓘ -----
function seleccionar(f) {
  selFdi = f;
  for (const r of rotulos) if (r.f) r.obj.element.classList.toggle('sel', r.f === f);
  actualizarAcc();
}
function actualizarAcc() {
  const b = $('bFicha');
  b.hidden = selFdi == null || fichaFdi != null;
  if (selFdi != null) $('bFichaN').textContent = `Ficha ${selFdi}`;
}
$('bFicha').onclick = () => { if (selFdi != null) abrirFicha(selFdi); };

// ----- zoom de cámara a un diente -----
let zoom = null, camAnim = null;
const mostrarVolver = v => { $('volver').hidden = !v; };
function pasoCam(now) {
  if (!camAnim) return;
  const u = Math.min(1, (now - camAnim.t0) / camAnim.dur), k = ease(u);
  controls.target.lerpVectors(camAnim.de.tg, camAnim.a.tg, k);
  camera.position.lerpVectors(camAnim.de.pos, camAnim.a.pos, k);
  sucio = true;
  if (u >= 1) { const fin = camAnim.fin; camAnim = null; if (fin) fin(); }
}
function enfocar(d) {
  if (anim) return;
  raiz3d.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const o of [d.corona, ...d.raices]) if (o.visible) box.expandByObject(o);
  const c = box.getCenter(new THREE.Vector3()), r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const dist = r * 1.1 / Math.sin(Math.min(vf, hf) / 2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (!zoom) zoom = { prev: { pos: camera.position.clone(), tg: controls.target.clone() } };
  zoom.fdi = d.i.fdi;
  controls.minDistance = 4;
  camAnim = { t0: performance.now(), dur: 650, de: { pos: camera.position.clone(), tg: controls.target.clone() }, a: { pos: c.clone().addScaledVector(dir, dist), tg: c } };
  mostrarVolver(true); seleccionar(d.i.fdi);
  avisar(`Zoom al diente ${d.i.fdi} · Esc para volver`);
}
function volverZoom() {
  if (!zoom) return;
  const p = zoom.prev; zoom = null; mostrarVolver(false);
  camAnim = { t0: performance.now(), dur: 600, de: { pos: camera.position.clone(), tg: controls.target.clone() }, a: p,
    fin: () => { const dz = Math.abs(encuadre(vista).pos.z); controls.minDistance = dz * 0.18; } };
}
$('volver').onclick = volverZoom;

// ----- ventanas (modal) -----
function abrirModal(titulo, cuerpo, ancho) {
  $('mtit').textContent = titulo;
  $('mcuerpo').replaceChildren(...[].concat(cuerpo));
  $('modal').dataset.ancho = ancho || '';
  $('modal').hidden = false;
}
function cerrarModal() { $('modal').hidden = true; $('mcuerpo').replaceChildren(); }
$('mcerrar').onclick = cerrarModal;
$('mfondo').onclick = cerrarModal;
const fila = (...x) => h('div', { class: 'm-fila' }, ...x);
const campo = (etq, input) => h('label', { class: 'm-campo' }, h('span', {}, etq), input);

// ----- leyenda -----
function legendaItems(compacto) {
  return ['car', 'ext', 'per', ...MKS].map(id => h('div', { class: 'ley-item' },
    h('span', { class: 'ley-ic' }, icono(id, 24)), h('div', {}, h('b', {}, MARC[id].n), compacto ? null : h('div', { class: 'ley-d' }, MARC[id].d))))
    .concat([[ROJO, 'Por realizar', 'Hallazgo pendiente de tratamiento: se dibuja en rojo (o con un tinte y borde rojos).'], [AZUL, 'Realizado', 'Tratamiento ya hecho: se dibuja en azul (la caries pasa a obturación azul).']].map(([c, n, d]) => h('div', { class: 'ley-item' },
      h('span', { class: 'ley-ic' }, h('span', { class: 'dot est-p', style: `background:${c};width:18px;height:18px` })), h('div', {}, h('b', {}, `Estado · ${n}`), compacto ? null : h('div', { class: 'ley-d' }, d)))));
}
$('bLeyenda').onclick = () => abrirModal('Leyenda de marcadores', [h('div', { class: 'ley' }, legendaItems(false)),
  h('p', { class: 'nota' }, 'La caries se marca tocando la cara del diente; los demás marcadores se eligen en la barra inferior y se tocan sobre el diente. Un segundo toque lo quita (la movilidad sube de grado I a III con cada toque y después se quita).')]);

// ----- ficha del diente -----
const DX = ['Caries', 'Caries oclusal (clase I)', 'Caries proximal (clase II)', 'Pulpitis reversible', 'Pulpitis irreversible', 'Necrosis pulpar', 'Gingivitis', 'Periodontitis', 'Fractura coronaria', 'Movilidad', 'Ausencia', 'Sano / control'];
const TX = ['Restauración con resina', 'Ionómero de vidrio', 'Sellante de fosas y fisuras', 'Endodoncia', 'Corona', 'Implante', 'Extracción', 'Profilaxis y raspaje', 'Prótesis', 'Control'];
// hallazgos de un diente con su estado de tratamiento: { k (clave de estado), t (texto), rea (true = realizado), est (texto o null) }
function itemsDe(m, i) {
  const it = (k, t, st) => ({ k, t, st, rea: st && m.rea.includes(k), est: st ? (m.rea.includes(k) ? 'Realizado' : 'Por realizar') : null });
  const r = m.car.map(x => it('car:' + x.cara, `Caries clase ${x.cl}, ${nombreCara(i, CARA[x.cara])}`, true));
  if (m.ext) r.push(it('ext', MARC.ext.n, true));
  if (m.per) r.push(it('per', MARC.per.n, true));
  for (const id of m.mk) r.push(it(id, id === 'movilidad' ? `Movilidad grado ${ROM[m.mov]}` : MARC[id].n, conEstado(id)));
  return r;
}
function marcasTexto(m, i) { return itemsDe(m, i).map(x => x.est ? `${x.t} (${x.est.toLowerCase()})` : x.t); }
function alternarEstado(f, k) {
  const m = norm(estado[dent][f]), j = m.rea.indexOf(k);
  if (j >= 0) m.rea.splice(j, 1); else m.rea.push(k);
  estado[dent][f] = m; guardar(); refrescarMarcas(); renderFicha();
  avisar(`${f} · ${j >= 0 ? 'vuelve a pendiente' : 'marcado como realizado'}`);
}
function abrirFicha(f) {
  fichaFdi = f; selFdi = f; seleccionar(f);
  $('panel').hidden = false;
  renderFicha();
  actualizarAcc();
}
function cerrarFicha() {
  fichaFdi = null; $('panel').hidden = true; $('panel').replaceChildren(); actualizarAcc();
}
function renderFicha() {
  const f = fichaFdi;
  if (f == null) return;
  const i = info(f), m = norm(estado[dent][f]);
  const lista = (hist[dent][f] || []).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
  const marcas = marcasTexto(m, i);
  const chips = ['ext', 'per', ...MKS].map(id => {
    const on = id === 'ext' ? m.ext : id === 'per' ? m.per : m.mk.includes(id);
    return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
      onclick: () => {
        const mm = norm(estado[dent][f]);
        if (mm.mk.includes('ausente') && (id === 'ext' || id === 'per')) { avisar(`${f}: diente ausente`); return; }
        const msg = alternarMarca(f, id); guardar(); refrescarMarcas(); renderFicha(); avisar(`${f} · ${msg}`);
      } }, punto(MARC[id].c), id === 'ext' ? 'Extracción' : id === 'movilidad' && on ? `Movilidad ${ROM[m.mov]}` : MARC[id].n.split(' /')[0]);
  });
  const dx = h('input', { type: 'text', id: 'fhDx', list: 'dlDx', maxlength: 120, autocomplete: 'off', placeholder: 'Ej.: caries oclusal profunda' });
  const tx = h('input', { type: 'text', id: 'fhTx', list: 'dlTx', maxlength: 120, autocomplete: 'off', placeholder: 'Ej.: restauración con resina' });
  const fe = h('input', { type: 'date', id: 'fhF', value: hoyISO(), required: true });
  const nota = h('textarea', { id: 'fhNota', rows: 3, maxlength: 500, placeholder: 'Observaciones' });
  const err = h('div', { class: 'p-err', role: 'alert' });
  const form = h('form', { class: 'p-form', onsubmit: ev => {
    ev.preventDefault();
    if (!dx.value.trim() && !tx.value.trim() && !nota.value.trim()) { err.textContent = 'Escriba al menos el diagnóstico, el tratamiento o una nota.'; return; }
    const lst = hist[dent][f] = hist[dent][f] || [];
    lst.push({ id: uid(), fecha: fe.value || hoyISO(), dx: dx.value.trim(), tx: tx.value.trim(), nota: nota.value.trim() });
    guardar(); renderFicha(); avisar(`${f} · entrada agregada al historial`);
  } },
    h('h3', {}, 'Agregar al historial'),
    campo('Fecha', fe), campo('Diagnóstico', dx), campo('Tratamiento', tx), campo('Notas', nota), err,
    h('button', { type: 'submit', class: 'btnp' }, 'Agregar entrada'));
  $('panel').replaceChildren(
    h('div', { class: 'p-cab' },
      h('div', { class: 'p-num' }, String(f)),
      h('div', { class: 'p-tit' }, h('b', {}, i.nombre.replace(/ (superior|inferior) (derecho|izquierdo)$/, '')), h('span', {}, `${cuadranteTxt(i)} · ${i.nino ? 'dentición temporal' : 'dentición permanente'}`)),
      h('button', { type: 'button', class: 'p-x', 'aria-label': 'Cerrar ficha', onclick: cerrarFicha }, '×')),
    h('div', { class: 'p-cuerpo' },
      h('section', {}, h('h3', {}, 'Estado actual'),
        marcas.length ? h('ul', { class: 'p-marcas' }, itemsDe(m, i).map(x => h('li', { class: 'p-m' }, h('span', { class: 'p-mt' }, x.t), x.est ? h('span', { class: 'est ' + (x.rea ? 'rea' : 'pend') }, x.est) : null, x.est ? h('button', { type: 'button', class: 'mini p-est', onclick: () => alternarEstado(f, x.k) }, x.rea ? 'Volver a pendiente' : 'Marcar realizado') : null))) : h('p', { class: 'nota' }, 'Sano, sin marcas.'),
        h('div', { class: 'chips' }, chips)),
      h('section', {}, h('h3', {}, `Historial (${lista.length})`),
        lista.length ? h('ol', { class: 'hist' }, lista.map(e => h('li', {},
          h('div', { class: 'hf' }, h('b', {}, fmtF(e.fecha)), h('button', { type: 'button', class: 'mini', 'aria-label': 'Quitar entrada', onclick: () => { hist[dent][f] = hist[dent][f].filter(x => x.id !== e.id); if (!hist[dent][f].length) delete hist[dent][f]; guardar(); renderFicha(); } }, 'Quitar')),
          e.dx ? h('div', {}, h('span', { class: 'et' }, 'Diagnóstico'), e.dx) : null,
          e.tx ? h('div', {}, h('span', { class: 'et' }, 'Tratamiento'), e.tx) : null,
          e.nota ? h('div', { class: 'hn' }, h('span', { class: 'et' }, 'Notas'), e.nota) : null))) : h('p', { class: 'nota' }, 'Todavía no hay entradas para este diente.')),
      form,
      h('datalist', { id: 'dlDx' }, DX.map(x => h('option', { value: x }))),
      h('datalist', { id: 'dlTx' }, TX.map(x => h('option', { value: x })))));
}

// ----- pacientes -----
function llenarBarra() {
  const sel = $('selPac');
  sel.replaceChildren(...store.pacientes.map(p => h('option', { value: p.id }, p.nombre)));
  sel.value = pac().id;
  $('nCons').textContent = String(pac().consultas.length);
  document.querySelector('.kicker').textContent = `Sonrisa Para Todos Conecta · ${pac().nombre}`;
}
function cambiarPaciente(id) {
  store.actual = id; estado = pac().estado; hist = pac().hist;
  selFdi = null; zoom = null; camAnim = null; mostrarVolver(false); cerrarFicha();
  guardar(); refrescarMarcas(); llenarBarra();
}
$('selPac').onchange = ev => cambiarPaciente(ev.target.value);
function formPaciente(p) {
  const nom = h('input', { type: 'text', id: 'fpNom', value: p ? p.nombre : '', maxlength: 80, autocomplete: 'off', placeholder: 'Nombre y apellido', required: true });
  const ci = h('input', { type: 'text', id: 'fpCi', value: p ? p.ci : '', maxlength: 20, inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ej.: 4.567.890' });
  const nac = h('input', { type: 'date', id: 'fpNac', value: p ? p.nac : '', max: hoyISO() });
  const err = h('div', { class: 'p-err', role: 'alert' });
  abrirModal(p ? 'Editar paciente' : 'Nuevo paciente', h('form', { class: 'm-form', onsubmit: ev => {
    ev.preventDefault();
    const n = nom.value.trim();
    if (!n) { err.textContent = 'El nombre es obligatorio.'; nom.focus(); return; }
    if (p) { p.nombre = n; p.ci = ci.value.trim(); p.nac = nac.value; guardar(); llenarBarra(); cerrarModal(); avisar('Datos del paciente actualizados'); }
    else {
      const np = { id: uid(), nombre: n, ci: ci.value.trim(), nac: nac.value, estado: { adulto: {}, nino: {} }, hist: { adulto: {}, nino: {} }, consultas: [] };
      store.pacientes.push(np); cerrarModal(); cambiarPaciente(np.id); avisar(`Paciente «${n}» creado`);
    }
  } }, campo('Nombre completo', nom), campo('Documento de identidad (C.I.)', ci), campo('Fecha de nacimiento', nac), err,
  fila(h('button', { type: 'button', class: 'btnc', onclick: cerrarModal }, 'Cancelar'), h('button', { type: 'submit', class: 'btnp' }, p ? 'Guardar cambios' : 'Crear paciente'))));
  setTimeout(() => nom.focus(), 30);
}
$('bNuevo').onclick = () => formPaciente(null);
$('bEditar').onclick = () => formPaciente(pac());
$('bBorrar').onclick = () => {
  const p = pac();
  if (store.pacientes.length < 2) { avisar('Debe quedar al menos un paciente'); return; }
  abrirModal('Eliminar paciente', [
    h('p', {}, `¿Eliminar a «${p.nombre}»? Se borran su odontograma, sus historiales y ${p.consultas.length} consulta${p.consultas.length === 1 ? '' : 's'} guardada${p.consultas.length === 1 ? '' : 's'}. No se puede deshacer.`),
    fila(h('button', { type: 'button', class: 'btnc', onclick: cerrarModal }, 'Cancelar'),
      h('button', { type: 'button', class: 'btnp peligro', id: 'confBorrar', onclick: () => {
        store.pacientes = store.pacientes.filter(x => x.id !== p.id); cerrarModal(); cambiarPaciente(store.pacientes[0].id); avisar('Paciente eliminado');
      } }, 'Eliminar'))]);
};

// ----- consultas (instantáneas fechadas) -----
const instantanea = () => ({ estado: clon(estado), hist: clon(hist) });
const porFecha = (a, b) => a.fecha.localeCompare(b.fecha);
$('bGuardarCons').onclick = () => {
  const fe = h('input', { type: 'datetime-local', id: 'fcF', value: ahoraISO(), required: true });
  const mo = h('input', { type: 'text', id: 'fcMotivo', maxlength: 100, autocomplete: 'off', placeholder: 'Ej.: control, urgencia, tratamiento…' });
  abrirModal('Guardar consulta', h('form', { class: 'm-form', onsubmit: ev => {
    ev.preventDefault();
    const p = pac(), c = { id: uid(), fecha: fe.value || ahoraISO(), motivo: mo.value.trim(), ...instantanea() };
    p.consultas.push(c); p.consultas.sort(porFecha); guardar(); llenarBarra(); cerrarModal();
    avisar(`Consulta guardada · ${fmtFH(c.fecha)}`);
  } }, h('p', { class: 'nota' }, `Se guarda una copia de todo el odontograma (adulto y pediátrico) y de los historiales de «${pac().nombre}».`),
  campo('Fecha y hora', fe), campo('Motivo (opcional)', mo),
  fila(h('button', { type: 'button', class: 'btnc', onclick: cerrarModal }, 'Cancelar'), h('button', { type: 'submit', class: 'btnp' }, 'Guardar consulta'))));
};
function resumenConsulta(c) {
  let n = 0, hn = 0;
  for (const dn of ['adulto', 'nino']) { n += Object.keys(c.estado[dn] || {}).length; for (const k of Object.keys((c.hist && c.hist[dn]) || {})) hn += c.hist[dn][k].length; }
  return `${n} diente${n === 1 ? '' : 's'} con marcas · ${hn} entrada${hn === 1 ? '' : 's'} de historial`;
}
$('bCons').onclick = abrirConsultas;
function abrirConsultas() {
  const p = pac();
  const cuerpo = p.consultas.length ? h('ul', { class: 'cons' }, p.consultas.slice().sort(porFecha).reverse().map(c => h('li', {},
    h('div', {}, h('b', {}, fmtFH(c.fecha)), c.motivo ? h('span', { class: 'mot' }, ` · ${c.motivo}`) : null, h('div', { class: 'nota' }, resumenConsulta(c))),
    h('div', { class: 'cons-b' },
      h('button', { type: 'button', class: 'btnc', onclick: () => confirmarCargar(c) }, 'Cargar'),
      h('button', { type: 'button', class: 'btnc', onclick: () => abrirComparar(c.id) }, 'Comparar'),
      h('button', { type: 'button', class: 'btnc', 'aria-label': 'Eliminar consulta', onclick: () => { p.consultas = p.consultas.filter(x => x.id !== c.id); guardar(); llenarBarra(); abrirConsultas(); avisar('Consulta eliminada'); } }, 'Eliminar'))))) :
    h('p', {}, 'Este paciente todavía no tiene consultas guardadas. Use «Guardar consulta» para registrar el estado de hoy.');
  abrirModal(`Consultas de ${p.nombre}`, cuerpo);
}
function confirmarCargar(c) {
  abrirModal('Cargar consulta', [h('p', {}, `Se reemplaza el odontograma actual por el de la consulta del ${fmtFH(c.fecha)}. Lo que no haya guardado como consulta se pierde.`),
    fila(h('button', { type: 'button', class: 'btnc', onclick: abrirConsultas }, 'Cancelar'),
      h('button', { type: 'button', class: 'btnp', id: 'confCargar', onclick: () => {
        const p = pac(); p.estado = clon(c.estado); p.hist = clon(c.hist);
        estado = p.estado; hist = p.hist; guardar(); cerrarModal(); cerrarFicha(); refrescarMarcas(); avisar(`Consulta del ${fmtFH(c.fecha)} cargada`);
      } }, 'Cargar'))]);
}

// ----- capturas 2D del odontograma (se renderiza a pedido, sin tocar la vista en pantalla) -----
function capturar({ v, w, h: alto, est, cambios }) {
  const vOld = vista;
  if (sobre) sobre.resaltar(false);
  anim = null; camAnim = null;
  if (v === 'arcada') usarArcada(true);
  vista = v; colocar(v); ajustarEscena(v); textosLados(); aplicarEstado(est[dent] || {});
  raiz3d.updateMatrixWorld(true);
  const e = encuadre(v, w / alto), cam = new THREE.PerspectiveCamera(camera.fov, w / alto, 1, 2000);
  cam.position.copy(e.pos); cam.lookAt(e.target); cam.updateMatrixWorld(true);
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(1); renderer.setSize(w, alto, false);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, cam);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = alto;
  const cx = cv.getContext('2d'), u = w / 1100;
  const gr = cx.createRadialGradient(w / 2, alto / 2, 0, w / 2, alto / 2, Math.hypot(w, alto) / 1.7);
  gr.addColorStop(0, '#2A3B5C'); gr.addColorStop(0.55, '#162038'); gr.addColorStop(1, '#0B1222');
  cx.fillStyle = gr; cx.fillRect(0, 0, w, alto);
  cx.drawImage(renderer.domElement, 0, 0, w, alto);
  const px = p => { const q = p.clone().project(cam); return [(q.x + 1) / 2 * w, (1 - q.y) / 2 * alto]; };
  const fuente = (peso, tam) => `${peso} ${tam}px Hanken, system-ui, sans-serif`;
  // dientes que cambiaron: recuadro ámbar alrededor del diente
  if (cambios && cambios.size) {
    for (const f of cambios) {
      const d = dientes.get(f); if (!d) continue;
      for (const x of [d, d.gem]) {
        if (!x.g.visible) continue;
        const bx = new THREE.Box3();
        for (const o of [x.corona, ...x.raices]) if (o.visible) bx.expandByObject(o);
        const xs = [], ys = [];
        for (const a of [bx.min.x, bx.max.x]) for (const b of [bx.min.y, bx.max.y]) for (const c of [bx.min.z, bx.max.z]) { const [X, Y] = px(new THREE.Vector3(a, b, c)); xs.push(X); ys.push(Y); }
        const x0 = Math.min(...xs) - 6 * u, x1 = Math.max(...xs) + 6 * u, y0 = Math.min(...ys) - 6 * u, y1 = Math.max(...ys) + 6 * u;
        cx.beginPath(); cx.roundRect(x0, y0, x1 - x0, y1 - y0, 10 * u);
        cx.fillStyle = 'rgba(255,176,32,.16)'; cx.fill(); cx.lineWidth = 3 * u; cx.strokeStyle = '#FFB020'; cx.stroke();
      }
    }
  }
  // rótulos: números FDI y lados
  for (const r of rotulos) {
    const [X, Y] = px(r.obj.position);
    if (r.k) {
      const t = r.obj.element.textContent; cx.font = fuente(800, 10.5 * u);
      const tw = cx.measureText(t).width + 18 * u, th = 20 * u;
      cx.beginPath(); cx.roundRect(X - tw / 2, Y - th / 2, tw, th, th / 2); cx.fillStyle = 'rgba(255,255,255,.88)'; cx.fill();
      cx.lineWidth = 1.5 * u; cx.strokeStyle = '#D9D3E6'; cx.stroke();
      cx.fillStyle = '#4A4666'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(t, X, Y + 0.5 * u);
      continue;
    }
    const m = norm((est[dent] || {})[r.f]), rad = 11.5 * u;
    const col = m.car.length && !m.ext ? '#16161A' : m.ext ? '#1A5FB4' : m.per ? '#D7262B' : m.mk.length ? MARC[m.mk[0]].c : '#D9D3E6';
    cx.beginPath(); cx.arc(X, Y, rad, 0, Math.PI * 2); cx.fillStyle = '#fff'; cx.fill();
    cx.lineWidth = 2 * u; cx.strokeStyle = col; cx.stroke();
    cx.fillStyle = m.ext ? '#1A5FB4' : '#232036'; cx.font = fuente(700, 10.5 * u); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(String(r.f), X, Y + 0.5 * u);
    m.mk.forEach((id, k) => { cx.beginPath(); cx.arc(X + (k - (m.mk.length - 1) / 2) * 7 * u, Y + rad + 3 * u, 3 * u, 0, Math.PI * 2); cx.fillStyle = MARC[id].c; cx.fill(); cx.lineWidth = (conEstado(id) ? 1.8 : 1) * u; cx.strokeStyle = !conEstado(id) ? '#fff' : m.rea.includes(id) ? AZUL : ROJO; cx.stroke(); });
  }
  // restaurar la vista en pantalla
  renderer.setPixelRatio(pr); tam();
  vista = vOld; usarArcada(arcadaAncha()); colocar(vOld); ajustarEscena(vOld); textosLados(); aplicarEstado(estado[dent]);
  return cv.toDataURL('image/jpeg', 0.92);
}

// ----- comparar dos consultas -----
const canon = m => JSON.stringify({ car: m.car.map(x => `${x.cara}${x.cl}`).sort(), ext: m.ext, per: m.per, mk: m.mk.slice().sort(), mov: m.mov, rea: m.rea.slice().sort() });
function textoDiente(m, i) { const t = marcasTexto(m, i); return t.length ? t.join(' · ') : 'sano / sin marcas'; }
function diferencias(A, B) {
  const out = [];
  for (const dn of ['adulto', 'nino']) {
    const ea = A.estado[dn] || {}, eb = B.estado[dn] || {}, ha = (A.hist && A.hist[dn]) || {}, hb = (B.hist && B.hist[dn]) || {};
    const fs = [...new Set([...Object.keys(ea), ...Object.keys(eb), ...Object.keys(ha), ...Object.keys(hb)].map(Number))].sort((x, y) => x - y);
    for (const f of fs) {
      const ma = norm(ea[f]), mb = norm(eb[f]), i = info(f);
      const marcas = canon(ma) !== canon(mb), nh = (hb[f] || []).length - (ha[f] || []).length, hc = JSON.stringify(ha[f] || []) !== JSON.stringify(hb[f] || []);
      if (marcas || hc) out.push({ dn, f, nombre: i.nombre, antes: textoDiente(ma, i), despues: textoDiente(mb, i), marcas, nh });
    }
  }
  return out;
}
function abrirComparar(prefA) {
  const p = pac(), cs = p.consultas.slice().sort(porFecha);
  const snap = id => id === 'actual' ? { estado, hist, fecha: null, t: 'Estado actual (sin guardar)' } : (c => ({ ...c, t: fmtFH(c.fecha) + (c.motivo ? ` · ${c.motivo}` : '') }))(cs.find(x => x.id === id));
  const ops = [...cs.map(c => ({ v: c.id, t: fmtFH(c.fecha) + (c.motivo ? ` · ${c.motivo}` : '') })), { v: 'actual', t: 'Estado actual (sin guardar)' }];
  let ida = prefA || (cs.length >= 2 ? cs[cs.length - 2].id : cs.length ? cs[0].id : 'actual'), idb = prefA ? 'actual' : (cs.length >= 2 ? cs[cs.length - 1].id : 'actual');
  let vc = 'completo', modo = 'lado', ver = 'a';
  const selA = h('select', { id: 'cmpA', 'aria-label': 'Consulta A' }, ops.map(o => h('option', { value: o.v }, o.t))), selB = h('select', { id: 'cmpB', 'aria-label': 'Consulta B' }, ops.map(o => h('option', { value: o.v }, o.t)));
  selA.value = ida; selB.value = idb;
  const imgA = h('img', { alt: 'Odontograma A' }), imgB = h('img', { alt: 'Odontograma B' });
  const capA = h('figcaption', {}), capB = h('figcaption', {});
  const figA = h('figure', { class: 'cmp-f a' }, capA, imgA), figB = h('figure', { class: 'cmp-f b' }, capB, imgB);
  const figs = h('div', { class: 'cmp-figs lado' }, figA, figB);
  const lista = h('div', { class: 'cmp-lista' });
  const estadoTxt = h('div', { class: 'nota', id: 'cmpEstado' });
  const seg = (items, get, set) => { const el = h('div', { class: 'seg mini-seg' }); items.forEach(([k, t]) => el.append(h('button', { type: 'button', class: get() === k ? 'on' : '', 'data-k': k, onclick: () => { set(k); [...el.children].forEach(b => b.classList.toggle('on', b.dataset.k === k)); } }, t))); return el; };
  const alt = h('button', { type: 'button', class: 'btnc', id: 'cmpAlt', onclick: () => { ver = ver === 'a' ? 'b' : 'a'; pintarModo(); } }, 'Alternar A / B');
  function pintarModo() {
    figs.className = `cmp-figs ${modo}` + (modo === 'alt' ? ` ver-${ver}` : '');
    alt.hidden = modo !== 'alt';
    alt.textContent = ver === 'a' ? 'Mostrar B' : 'Mostrar A';
  }
  let gen = 0;
  async function pintar() {
    const mi = ++gen;
    estadoTxt.textContent = 'Generando imágenes…';
    await espera(30);
    if (mi !== gen) return;
    const A = snap(selA.value), B = snap(selB.value);
    const dif = diferencias(A, B), cambios = new Set(dif.filter(d => d.dn === dent).map(d => d.f));
    const w = vc === 'completo' ? 1400 : 1200, al = vc === 'completo' ? 620 : 660;
    imgA.src = capturar({ v: vc, w, h: al, est: A.estado, cambios });
    imgB.src = capturar({ v: vc, w, h: al, est: B.estado, cambios });
    capA.textContent = `A · ${A.t}`; capB.textContent = `B · ${B.t}`;
    estadoTxt.textContent = '';
    const dentTxt = dent === 'nino' ? 'pediátrica' : 'adulta';
    lista.replaceChildren(
      h('h3', {}, dif.length ? `Dientes con cambios (${dif.length})` : 'Sin cambios entre A y B'),
      dif.length ? h('p', { class: 'nota' }, `En la imagen se destacan en ámbar los de la dentición ${dentTxt}.`) : null,
      dif.length ? h('ul', { class: 'cmp-ul' }, dif.map(d => h('li', {},
        h('b', {}, `${d.f}`), h('span', { class: 'nota' }, ` ${d.dn === 'nino' ? 'pediátrico' : 'adulto'} · ${d.nombre}`),
        d.marcas ? h('div', {}, h('span', { class: 'ant' }, d.antes), ' → ', h('span', { class: 'des' }, d.despues)) : null,
        d.nh ? h('div', { class: 'nota' }, `Historial: ${d.nh > 0 ? '+' : ''}${d.nh} entrada${Math.abs(d.nh) === 1 ? '' : 's'}`) : (!d.marcas ? h('div', { class: 'nota' }, 'Historial modificado') : null)))) : null);
  }
  selA.onchange = selB.onchange = pintar;
  pintarModo();
  abrirModal('Comparar consultas', [
    h('div', { class: 'cmp-ctrl' }, campo('A (antes)', selA), campo('B (después)', selB),
      h('div', { class: 'm-campo' }, h('span', {}, 'Vista'), seg([['completo', 'Completo'], ['arcada', 'Oclusal']], () => vc, k => { vc = k; pintar(); })),
      h('div', { class: 'm-campo' }, h('span', {}, 'Modo'), seg([['lado', 'Lado a lado'], ['alt', 'Alternar']], () => modo, k => { modo = k; pintarModo(); })), alt),
    estadoTxt, figs, lista], 'ancho');
  pintar();
}
$('bComparar').onclick = () => abrirComparar();

// ----- imprimir / PDF -----
async function abrirPrevia() {
  avisar('Preparando la hoja…');
  await espera(40);
  const p = pac(), nino = dent === 'nino';
  const imgA = capturar({ v: 'completo', w: 1800, h: 800, est: estado, cambios: null });
  const imgB = capturar({ v: 'arcada', w: 1300, h: 760, est: estado, cambios: null });
  const ult = p.consultas.length ? fmtFH(p.consultas.slice().sort(porFecha).pop().fecha) : 'sin consultas guardadas';
  const dato = (e, v) => h('div', { class: 'h-d' }, h('span', {}, e), h('b', {}, v));
  const fs = [...new Set([...Object.keys(estado[dent]), ...Object.keys(hist[dent])].map(Number))].sort((a, b) => a - b)
    .filter(f => marcasTexto(norm(estado[dent][f]), info(f)).length || (hist[dent][f] || []).length);
  const filas = fs.map(f => {
    const i = info(f), m = norm(estado[dent][f]), mt = marcasTexto(m, i), hs = (hist[dent][f] || []).slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    return h('tr', {},
      h('td', { class: 't-f' }, h('b', {}, String(f)), h('div', {}, i.nombre.replace(/ (superior|inferior) (derecho|izquierdo)$/, ''))),
      h('td', {}, mt.length ? itemsDe(m, i).map(x => h('div', {}, x.t)) : h('span', { class: 'gris' }, 'Sin marcas')),
      h('td', { class: 't-e' }, mt.length ? itemsDe(m, i).map(x => x.est ? h('div', { class: 'est ' + (x.rea ? 'rea' : 'pend') }, x.est) : h('div', { class: 'gris' }, '—')) : h('span', { class: 'gris' }, '—')),
      h('td', {}, hs.length ? hs.map(e => h('div', { class: 't-h' }, h('b', {}, fmtF(e.fecha)), ' · ', [e.dx, e.tx].filter(Boolean).join(' → '), e.nota ? h('i', {}, ` (${e.nota})`) : null)) : h('span', { class: 'gris' }, '—')));
  });
  $('hoja').replaceChildren(
    h('header', { class: 'h-cab' }, h('div', {}, h('div', { class: 'h-marca' }, 'Sonrisa Para Todos'), h('div', { class: 'h-sub' }, 'Odontograma · registro clínico')), h('div', { class: 'h-fecha' }, `Emitido el ${fmtF(hoyISO())}`)),
    h('section', { class: 'h-pac' }, dato('Paciente', p.nombre), dato('C.I. N°', p.ci || '—'), dato('Fecha de nacimiento', p.nac ? fmtF(p.nac) + edadDe(p.nac) : '—'),
      dato('Dentición', nino ? 'Temporal (pediátrica), 51 al 85' : 'Permanente (adulta), 11 al 48'), dato('Última consulta guardada', ult)),
    h('h2', {}, 'Odontograma'),
    h('figure', { class: 'h-fig' }, h('img', { src: imgA, alt: 'Odontograma, vista completa' }), h('figcaption', {}, 'Vista completa: vestibular y palatina/lingual de cada arcada.')),
    h('div', { class: 'h-dos' },
      h('figure', { class: 'h-fig' }, h('img', { src: imgB, alt: 'Odontograma, vista oclusal' }), h('figcaption', {}, 'Vista oclusal.')),
      h('div', {}, h('h2', {}, 'Leyenda'), h('div', { class: 'ley compacta' }, legendaItems(false)))),
    h('h2', {}, 'Hallazgos por diente'),
    fs.length ? h('table', { class: 'h-tab' }, h('thead', {}, h('tr', {}, h('th', {}, 'Diente'), h('th', {}, 'Hallazgos'), h('th', {}, 'Estado'), h('th', {}, 'Historial'))), h('tbody', {}, filas)) : h('p', {}, 'No hay hallazgos registrados en esta dentición.'),
    h('footer', { class: 'h-pie' }, 'Sonrisa Para Todos · Maqueta de concepto, sin valor de historia clínica oficial.'));
  $('previa').hidden = false;
  $('previa').scrollTop = 0;
  document.body.classList.add('con-previa');
}
function cerrarPrevia() { $('previa').hidden = true; document.body.classList.remove('con-previa'); }
$('bImprimir').onclick = abrirPrevia;
$('pvCerrar').onclick = cerrarPrevia;
$('pvImp').onclick = () => window.print();

// ----- teclado -----
addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (!$('previa').hidden) cerrarPrevia();
  else if (!$('modal').hidden) cerrarModal();
  else if (zoom) volverZoom();
  else if (fichaFdi != null) cerrarFicha();
});
llenarBarra();

document.querySelectorAll('.tool').forEach(b => b.onclick = () => {
  herramienta = b.dataset.t;
  document.querySelectorAll('.tool').forEach(x => x.classList.toggle('on', x === b));
  document.getElementById('clases').classList.toggle('oculto', herramienta !== 'car');
});
document.querySelectorAll('#clases button').forEach(b => b.onclick = () => {
  clase = b.dataset.c;
  document.querySelectorAll('#clases button').forEach(x => x.classList.toggle('on', x === b));
  document.getElementById('exp').textContent = EXP[clase];
});
document.querySelectorAll('#segDent button').forEach(b => b.onclick = () => {
  if (b.dataset.d === dent) return;
  dent = b.dataset.d;
  document.querySelectorAll('#segDent button').forEach(x => x.classList.toggle('on', x === b));
  zoom = null; camAnim = null; mostrarVolver(false); cerrarFicha(); selFdi = null;
  construir();
});
document.querySelectorAll('#segVista button').forEach(b => b.onclick = () => cambiarVista(b.dataset.v));
document.getElementById('reset').onclick = () => { zoom = null; camAnim = null; mostrarVolver(false); iniciarAnim(vista, 700, encuadrar(true)); };

function tam() {
  const w = cont.clientWidth, h = cont.clientHeight;
  renderer.setSize(w, h); rot.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix(); sucio = true;
}
function ajustarAncho() {
  const w = arcadaAncha();
  if (w === arcH || !DISP) return;
  usarArcada(w); textosLados();
  if (vista === 'arcada' && !anim) colocar('arcada');
}
new ResizeObserver(() => { tam(); ajustarAncho(); if (!anim && !zoom) encuadrar(false); }).observe(cont);
document.querySelectorAll('#segVista button').forEach(b => b.classList.toggle('on', b.dataset.v === vista));

tam();
construir();
const reencuadre = () => { tam(); ajustarAncho(); if (!anim && !zoom) encuadrar(false); };
document.fonts && document.fonts.ready.then(reencuadre); setTimeout(reencuadre, 900); setTimeout(reencuadre, 2500);
// render bajo demanda: se repinta al volver a la pestaña o si el navegador restaura el contexto GL (móviles)
document.addEventListener('visibilitychange', () => { if (!document.hidden) sombras(); });
renderer.domElement.addEventListener('webglcontextrestored', sombras);
renderer.setAnimationLoop(now => {
  const activa = !!anim || !!camAnim;
  paso(now);
  pasoCam(now);
  const mueve = controls.update();
  if (!activa && !mueve && !sucio) return;
  sucio = false;
  renderer.render(scene, camera);
  rot.render(scene, camera);
});
window.__odonto = { dientes: () => dientes, vista: () => vista, estado: () => estado, store: () => store, camara: camera, controles: controls, cambiarVista, abrirFicha, enfocar, capturar, abrirPrevia, zoom: () => zoom,
  pantalla: (f, gem = false) => { const d = dientes.get(f), x = gem ? d.gem : d; raiz3d.updateMatrixWorld(true); const c = new THREE.Box3().expandByObject(x.corona).getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect(); return [r.left + (c.x + 1) / 2 * r.width, r.top + (1 - c.y) / 2 * r.height]; } };
