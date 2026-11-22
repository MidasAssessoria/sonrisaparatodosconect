/**
 * Posición de cada diente en cada vista y encuadre de cámara.
 *
 * Copia de `disposiciones`, `usarArcada` y `encuadre` de `referencia/maqueta/codigo/app.js`, con los
 * mismos números. Cambio: la maqueta leía `matchMedia('(max-width: 760px)')` de la ventana; acá el
 * motor pasa si su propio contenedor es angosto (un visor chico dentro de una página ancha).
 */
import * as THREE from 'three';
import { info, orden } from './modelo.js';
import { KR, TILT } from './geometria.js';

export type ClaveVista = 'vest' | 'ling' | 'completo' | 'arcada';
type VistaBase = 'filas' | 'ling' | 'completo' | 'arcadaV' | 'arcadaH';
export type Lado = 'sup' | 'inf' | 'der' | 'izq';

export interface Lugar {
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  /** Dónde va el rótulo con el número. */
  rot: THREE.Vector3;
}

export interface Disposicion {
  vistas: Record<ClaveVista, Map<number, Lugar>>;
  /** Gemelos de la vista completa (cara palatina/lingual, debajo de cada fila). */
  completoG: Map<number, Omit<Lugar, 'rot'>>;
  lados: Record<ClaveVista, Record<Lado, THREE.Vector3>>;
  caja: Record<ClaveVista, THREE.Box3>;
  /** Arcadas lado a lado (pantalla ancha) o una sobre otra. */
  arcadaAncha: boolean;
}

const INCL = 0.38;
const EJE_X = new THREE.Vector3(1, 0, 0),
  EJE_Z = new THREE.Vector3(0, 0, 1);

/**
 * @param nino dentición temporal
 * @param angosto contenedor de 760 px o menos (separa más los rótulos de lado)
 * @param ancha relación de aspecto mayor a 1,25 (la vista oclusal pone las arcadas lado a lado)
 */
export function disposiciones(nino: boolean, angosto: boolean, ancha: boolean): Disposicion {
  const o = orden(nino),
    G = nino ? 0.8 : 0.9,
    MED = 1.6,
    HUECO = 1.3,
    ESP = nino ? 1.72 : 1.4,
    PIL = angosto ? 15 : 7.8;
  const base: Record<VistaBase, Map<number, Lugar>> = {
    filas: new Map(),
    ling: new Map(),
    completo: new Map(),
    arcadaV: new Map(),
    arcadaH: new Map(),
  };
  const completoG = new Map<number, Omit<Lugar, 'rot'>>();
  const v0 = () => new THREE.Vector3();
  const lados: Record<VistaBase, Record<Lado, THREE.Vector3>> = {
    filas: { sup: v0(), inf: v0(), der: v0(), izq: v0() },
    ling: { sup: v0(), inf: v0(), der: v0(), izq: v0() },
    completo: { sup: v0(), inf: v0(), der: v0(), izq: v0() },
    arcadaV: { sup: v0(), inf: v0(), der: v0(), izq: v0() },
    arcadaH: { sup: v0(), inf: v0(), der: v0(), izq: v0() },
  };
  const RY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const qSupL = new THREE.Quaternion()
    .setFromAxisAngle(EJE_X, INCL)
    .multiply(new THREE.Quaternion().setFromAxisAngle(EJE_Z, Math.PI));
  const qInfL = new THREE.Quaternion().setFromAxisAngle(EJE_X, -INCL);
  const qSup = new THREE.Quaternion()
    .setFromAxisAngle(EJE_X, -INCL)
    .multiply(new THREE.Quaternion().setFromAxisAngle(EJE_Z, Math.PI));
  const qInf = new THREE.Quaternion().setFromAxisAngle(EJE_X, INCL);
  const cI = Math.cos(INCL),
    sI = Math.sin(INCL);
  let ancho = 0;
  for (const fila of ['sup', 'inf'] as const) {
    const lista = o[fila],
      ts = lista.map(info);
    const total = ts.reduce((s, t) => s + t.W, 0) + G * (ts.length - 1) + MED;
    ancho = Math.max(ancho, total);
    const maxR = Math.max(...ts.map((t) => t.H + t.L));
    const maxRc = Math.max(...ts.map((t) => t.H + KR * t.L)),
      cT = Math.cos(TILT);
    let x = -total / 2;
    const s = fila === 'sup' ? 1 : -1;
    ts.forEach((t, i) => {
      if (i === ts.length / 2) x += MED;
      const cx = x + t.W / 2;
      x += t.W + G;
      base.filas.set(t.fdi, {
        pos: new THREE.Vector3(cx, s * (HUECO + t.H * cI), -t.H * sI),
        q: fila === 'sup' ? qSup : qInf,
        rot: new THREE.Vector3(cx, s * (HUECO + maxR * cI + 3.2), 0),
      });
      {
        const cx2 = cx * ESP,
          HC = HUECO + 2.3,
          R = maxRc * cT + 3.6,
          yA = s * (HC + t.H * cT + R),
          yB = s * (HC + t.H * cT);
        const q0 =
          fila === 'sup'
            ? new THREE.Quaternion().setFromAxisAngle(EJE_Z, Math.PI)
            : new THREE.Quaternion();
        const qt = new THREE.Quaternion().setFromAxisAngle(EJE_X, -s * TILT); // la corona se inclina hacia la cámara
        base.completo.set(t.fdi, {
          pos: new THREE.Vector3(cx2, yA, 0),
          q: qt.clone().multiply(q0),
          rot: new THREE.Vector3(cx2, s * (HC + R + maxRc * cT + 3), 0),
        });
        completoG.set(t.fdi, {
          pos: new THREE.Vector3(cx2, yB, 0),
          q: qt.clone().multiply(RY).multiply(q0),
        });
        lados.completo[fila] = new THREE.Vector3(0, s * (HC + R + maxRc * cT + PIL), 0);
      }
      base.ling.set(t.fdi, {
        pos: new THREE.Vector3(cx, s * (HUECO + t.H * cI), t.H * sI),
        q: fila === 'sup' ? qSupL : qInfL,
        rot: new THREE.Vector3(cx, s * (HUECO + maxR * cI + 3.2), 0),
      });
    });
    lados.filas[fila] = new THREE.Vector3(0, s * (HUECO + maxR * cI + 13.5), 0);
    lados.ling[fila] = lados.filas[fila];
  }
  lados.filas.der = new THREE.Vector3(-ancho / 2 - 7, 0, 0);
  lados.filas.izq = new THREE.Vector3(ancho / 2 + 7, 0, 0);
  lados.ling.der = lados.filas.der;
  lados.ling.izq = lados.filas.izq;
  lados.completo.der = new THREE.Vector3((-ancho * ESP) / 2 - 5, 0, 0);
  lados.completo.izq = new THREE.Vector3((ancho * ESP) / 2 + 5, 0, 0);
  // arcada: cuarto de elipse + tramo recto, colocando cada diente por su ancho
  const a = nino ? 15 : 22,
    b = nino ? 13 : 19,
    inc = nino ? 0.18 : 0.13;
  const poli: THREE.Vector2[] = [];
  for (let i = 0; i <= 90; i++) {
    const f = ((i / 90) * Math.PI) / 2;
    poli.push(new THREE.Vector2(a * Math.sin(f), b * Math.cos(f) - b));
  }
  const dirR = new THREE.Vector2(inc, -1).normalize();
  for (let i = 1; i <= 80; i++) poli.push(new THREE.Vector2(a + dirR.x * i, -b + dirR.y * i));
  const acum = [0];
  for (let i = 1; i < poli.length; i++)
    acum.push(
      (acum[i - 1] as number) + (poli[i] as THREE.Vector2).distanceTo(poli[i - 1] as THREE.Vector2),
    );
  const en = (s: number) => {
    let i = acum.findIndex((v) => v >= s);
    if (i <= 0) i = 1;
    const p0 = poli[i - 1] as THREE.Vector2,
      p1 = poli[i] as THREE.Vector2;
    const u = (s - (acum[i - 1] as number)) / ((acum[i] as number) - (acum[i - 1] as number));
    const p = p0.clone().lerp(p1, u);
    const tg = p1.clone().sub(p0).normalize();
    return { p, n: new THREE.Vector2(-tg.y, tg.x) }; // normal hacia afuera
  };
  let maxX = 0,
    minY = 0;
  const mitad = new Map<
    number,
    { p: THREE.Vector2; n: THREE.Vector2; t: ReturnType<typeof info> }
  >();
  for (const fila of ['sup', 'inf'] as const) {
    const lista = o[fila],
      n2 = lista.length / 2;
    for (const lado of [-1, 1]) {
      const seq = lado < 0 ? lista.slice(0, n2).reverse() : lista.slice(n2);
      let s = MED / 2;
      for (const f of seq) {
        const t = info(f);
        const c = en(s + t.W / 2);
        s += t.W + G;
        mitad.set(f, {
          p: new THREE.Vector2(c.p.x * lado, c.p.y),
          n: new THREE.Vector2(c.n.x * lado, c.n.y),
          t,
        });
        maxX = Math.max(maxX, Math.abs(c.p.x) + t.D / 2);
        minY = Math.min(minY, c.p.y - t.D / 2);
      }
    }
  }
  const Y0 = -minY + (nino ? 3 : 4);
  for (const [f, m] of mitad) {
    const s = m.t.sup ? 1 : -1;
    const p = new THREE.Vector3(m.p.x, s * (Y0 + m.p.y), -m.t.H);
    const nz = new THREE.Vector3(m.n.x, s * m.n.y, 0).normalize();
    const Y = new THREE.Vector3(0, 0, 1),
      X = new THREE.Vector3().crossVectors(Y, nz);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, nz));
    const r = new THREE.Vector3(p.x, p.y, 0).addScaledVector(nz, m.t.D / 2 + (nino ? 3 : 3.6));
    base.arcadaV.set(f, { pos: p, q, rot: r });
  }
  lados.arcadaV.sup = new THREE.Vector3(0, Y0 + 14 + (nino ? 0 : 1), 0);
  lados.arcadaV.inf = new THREE.Vector3(0, -Y0 - 14 - (nino ? 0 : 1), 0);
  lados.arcadaV.der = new THREE.Vector3(-maxX - 10, 0, 0);
  lados.arcadaV.izq = new THREE.Vector3(maxX + 10, 0, 0);
  // arcada en pantalla ancha: las dos arcadas lado a lado (la superior a la izquierda)
  {
    const X0 = maxX + 7,
      ext = { sup: [1e9, -1e9], inf: [1e9, -1e9] };
    for (const [f, d] of base.arcadaV) {
      const e = ext[info(f).sup ? 'sup' : 'inf'];
      e[0] = Math.min(e[0] as number, d.pos.y);
      e[1] = Math.max(e[1] as number, d.pos.y);
    }
    for (const [f, d] of base.arcadaV) {
      const sup = info(f).sup,
        e = ext[sup ? 'sup' : 'inf'],
        cy = ((e[0] as number) + (e[1] as number)) / 2,
        dx = sup ? -X0 : X0;
      base.arcadaH.set(f, {
        pos: new THREE.Vector3(d.pos.x + dx, d.pos.y - cy, d.pos.z),
        q: d.q,
        rot: new THREE.Vector3(d.rot.x + dx, d.rot.y - cy, 0),
      });
    }
    const hy =
      Math.max(
        (ext.sup[1] as number) - (ext.sup[0] as number),
        (ext.inf[1] as number) - (ext.inf[0] as number),
      ) /
        2 +
      (nino ? 9 : 10);
    lados.arcadaH.sup = new THREE.Vector3(-X0, hy, 0);
    lados.arcadaH.inf = new THREE.Vector3(X0, hy, 0);
    lados.arcadaH.der = new THREE.Vector3(-X0 - maxX - 10, 0, 0);
    lados.arcadaH.izq = new THREE.Vector3(X0 + maxX + 10, 0, 0);
  }
  const cajas = {} as Record<VistaBase, THREE.Box3>;
  for (const v of ['filas', 'ling', 'completo', 'arcadaV', 'arcadaH'] as const) {
    const caja = new THREE.Box3();
    for (const [, d] of base[v]) caja.expandByPoint(d.rot);
    for (const k of ['sup', 'inf', 'der', 'izq'] as const) caja.expandByPoint(lados[v][k]);
    cajas[v] = caja;
  }
  const arc: VistaBase = ancha ? 'arcadaH' : 'arcadaV';
  return {
    vistas: { vest: base.filas, ling: base.ling, completo: base.completo, arcada: base[arc] },
    completoG,
    lados: { vest: lados.filas, ling: lados.ling, completo: lados.completo, arcada: lados[arc] },
    caja: { vest: cajas.filas, ling: cajas.ling, completo: cajas.completo, arcada: cajas[arc] },
    arcadaAncha: ancha,
  };
}

/** Posición de cámara y punto de mira para ver toda una vista. */
export function encuadre(
  d: Disposicion,
  v: ClaveVista,
  fov: number,
  asp: number,
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const caja = d.caja[v],
    c = caja.getCenter(new THREE.Vector3()),
    t = caja.getSize(new THREE.Vector3());
  const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const dist =
    v === 'completo'
      ? Math.max(
          (t.y / 2 + 3.9) / tan,
          Math.min((t.x / 2 / (tan * asp)) * 1.02 + 4, (t.y / 2 / tan) * 1.9),
        )
      : Math.max(t.y / 2 / tan, t.x / 2 / (tan * asp)) * 1.07 + 8;
  return { pos: new THREE.Vector3(c.x, c.y, v === 'ling' ? -dist : dist), target: c };
}
