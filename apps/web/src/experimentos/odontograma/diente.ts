/**
 * Un diente 3D: corona, raíces, encía y marcadores clínicos.
 *
 * Copia de la clase `Diente` de `referencia/maqueta/codigo/app.js` (`constructor`, `setRaiz`,
 * `posPato`, `media`, `zona`, `pintar`, `caraEn`, `aplicar`, `resaltar`). Cambios:
 * - recibe los recursos del motor y avisa «hay que redibujar» por callback (en la maqueta eran
 *   variables globales: `texBump`, `MATS_PATO`, `sucio`);
 * - `dispose()` libera geometrías y materiales propios (la maqueta nunca liberaba nada);
 * - colores clínicos fijos del design system: la caries por realizar se pinta negra
 *   (`clinico-caries`), la cruz de extracción siempre azul y el anillo periodontal siempre rojo.
 *   En la maqueta las tres marcas tomaban el color del estado (rojo / azul). El estado de esas tres
 *   se ve en el rótulo del número y en el resumen. La caries realizada se pinta azul (obturación).
 */
import * as THREE from 'three';
import {
  CARA,
  PATO,
  info,
  type Cara,
  type ClaseBlack,
  type InfoDiente,
  type Lesion,
  type MarcaDiente,
  type Marcador,
} from './modelo.js';
import type { PuntoCara } from './reglas.js';
import {
  KR,
  anilloElipse,
  conductoGeo,
  cruz,
  datosCorona,
  geometriaCollar,
  geometriaCorona,
  implanteGeo,
  kindSurco,
  raices,
  raiz,
  ruido,
  smooth,
  tachado,
} from './geometria.js';
import { matConducto, matImplante, matOro, type IdPato, type Recursos } from './materiales.js';

export const COLOR_CARIES = 0x16161a; // --clinico-caries
export const COLOR_EXTRACCION = 0x1a5fb4; // --clinico-extraccion
export const COLOR_PERIODONTAL = 0xd7262b; // --clinico-periodontal

const C_SELLA = new THREE.Color(0x2fb344),
  C_PROT = new THREE.Color(0xf26b1d);
const C_PEND = new THREE.Color(0xd7262b),
  C_REST = new THREE.Color(0x1a5fb4); // estado de tratamiento: rojo = por realizar, azul = realizado
const C_CARIES = new THREE.Color(COLOR_CARIES),
  C_HOVER = new THREE.Color(0x2e9bec);

export type VistaInterna = 'vest' | 'ling' | 'completo' | 'arcada';

interface Zona {
  c: THREE.Vector3;
  allow: number[];
  tmin: number;
  tmax: number;
  rx: number;
  ry: number;
  rz: number;
  surcos?: boolean;
  seed: number;
}

const sinRayo = <T extends THREE.Object3D>(o: T): T => {
  o.raycast = () => {};
  return o;
};

export class Diente {
  readonly i: InfoDiente;
  readonly g = new THREE.Group();
  readonly corona: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly raices: THREE.Mesh[] = [];
  readonly encia: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  /** El gemelo de la vista «completo» (cara palatina/lingual). Solo lo tiene el diente principal. */
  gem: Diente | null = null;
  kRaiz = 1;
  hover = -1;
  ext = false;
  /** Posición y giro al empezar una animación de vista. */
  ini: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  k0 = 1;

  private readonly reg: Uint8Array;
  private readonly tp: Float32Array;
  private readonly surco: Float32Array;
  private readonly base: Float32Array;
  private readonly colores: THREE.BufferAttribute;
  private readonly mE: THREE.MeshPhysicalMaterial;
  private readonly mR: THREE.MeshStandardMaterial;
  private readonly mG: THREE.MeshPhysicalMaterial;
  private readonly extFrente: THREE.Group;
  private readonly extAtras: THREE.Group;
  private readonly extArriba: THREE.Group;
  private readonly perio: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
  private readonly oro: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly imp: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly canales: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly pulpa: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly prot: THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>;
  private readonly ausFrente: THREE.Group;
  private readonly ausAtras: THREE.Group;
  private readonly ausArriba: THREE.Group;
  private readonly pato: Record<IdPato, THREE.Sprite>;
  private lesiones: Lesion[] = [];
  private mk: Marcador[] = [];
  private rea: string[] = [];
  private readonly cache = new Map<string, Zona | null>();

  constructor(
    fdi: number,
    private readonly rec: Recursos,
    private readonly sucio: () => void,
  ) {
    this.i = info(fdi);
    const { W, D, H, L, nino, ant } = this.i;
    this.g.userData.fdi = fdi;
    const dc = datosCorona(this.i);
    this.reg = dc.reg;
    this.tp = dc.tp;
    this.surco = dc.surco;
    this.base = dc.base;
    const geo = geometriaCorona(dc); // comparte posición/normal/uv/índice; el color es propio
    this.colores = new THREE.BufferAttribute(new Float32Array(dc.base), 3);
    geo.setAttribute('color', this.colores);
    this.mE = rec.esmalte();
    this.mR = rec.raiz(L);
    this.mG = rec.encia();
    this.corona = new THREE.Mesh(geo, this.mE);
    this.corona.renderOrder = 1;
    this.g.add(this.corona);
    const rs = raices(this.i);
    for (const r of rs) {
      const m = new THREE.Mesh(raiz(r.r, r.l, r.sz, r.bend, kindSurco(this.i)), this.mR);
      m.position.set(r.x, 0, r.z);
      m.rotation.set(r.rx, 0, r.rz);
      m.renderOrder = 2;
      this.g.add(m);
      this.raices.push(m);
    }
    this.encia = new THREE.Mesh(geometriaCollar(this.i), this.mG);
    this.encia.renderOrder = 3;
    this.g.add(this.encia);
    for (const o of [this.corona, ...this.raices]) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    this.extFrente = cruz(W * 1.3, (H + L) * 0.95, nino ? 0.42 : 0.55, COLOR_EXTRACCION);
    this.extFrente.position.set(0, (H - L) / 2, D / 2 + 1.6);
    this.extAtras = cruz(W * 1.3, (H + L) * 0.95, nino ? 0.42 : 0.55, COLOR_EXTRACCION);
    this.extAtras.position.set(0, (H - L) / 2, -D / 2 - 1.6);
    this.extArriba = cruz(W * 1.25, D * 1.25, nino ? 0.38 : 0.5, COLOR_EXTRACCION);
    this.extArriba.rotation.x = -Math.PI / 2;
    this.extArriba.position.set(0, H + 1.4, 0);
    this.perio = anilloElipse(W / 2 + 0.45, D / 2 + 0.6, nino ? 0.26 : 0.34, COLOR_PERIODONTAL);
    this.perio.position.y = 0.25;
    // marcadores clínicos: casquete de oro, tornillo, conducto, banda, círculo tachado
    const yo = new THREE.Mesh(this.corona.geometry, matOro());
    yo.scale.set(1.05, 1.015, 1.05);
    yo.renderOrder = 2;
    this.oro = sinRayo(yo);
    this.imp = new THREE.Mesh(implanteGeo(this.i), matImplante());
    this.imp.castShadow = true;
    this.imp.renderOrder = 2;
    for (const [k, r] of rs.entries()) {
      const c = sinRayo(new THREE.Mesh(conductoGeo(r.r, r.l, r.bend, H), matConducto()));
      c.renderOrder = 6;
      this.raices[k]?.add(c);
      this.canales.push(c);
    }
    this.pulpa = sinRayo(
      new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, W * 0.1), 14, 10), matConducto()),
    );
    this.pulpa.position.set(0, H * 0.42, 0);
    this.pulpa.renderOrder = 6;
    this.prot = sinRayo(
      anilloElipse(
        (W / 2) * (ant ? 1.0 : 1.03) + 0.4,
        (D / 2) * (ant ? 0.88 : 1.02) + 0.4,
        nino ? 0.4 : 0.52,
        0xf26b1d,
      ),
    );
    this.prot.position.y = H * 0.4;
    const Ra = W * 0.78 + 1.1,
      ra = nino ? 0.38 : 0.5;
    this.ausFrente = tachado(Ra, ra, 0x6b7280);
    this.ausFrente.position.set(0, (H - L) / 2, D / 2 + 1.6);
    this.ausAtras = tachado(Ra, ra, 0x6b7280);
    this.ausAtras.position.set(0, (H - L) / 2, -D / 2 - 1.6);
    this.ausArriba = tachado(Ra, ra, 0x6b7280);
    this.ausArriba.rotation.x = -Math.PI / 2;
    this.ausArriba.position.set(0, H + 1.4, 0);
    for (const o of [
      this.extFrente,
      this.extAtras,
      this.extArriba,
      this.perio,
      this.oro,
      this.imp,
      this.pulpa,
      this.prot,
      this.ausFrente,
      this.ausAtras,
      this.ausArriba,
    ]) {
      o.visible = false;
      this.g.add(o);
    }
    for (const c of this.canales) c.visible = false;
    // patología: periapical (ápice), fractura (corona), reabsorción y fístula (raíz), movilidad (sobre la corona)
    const sp = (id: IdPato) => {
      const s = sinRayo(new THREE.Sprite(rec.pato(id, id === 'movilidad' ? 1 : 0, false)));
      s.renderOrder = 8;
      s.visible = false;
      this.g.add(s);
      return s;
    };
    this.pato = {
      periapical: sp('periapical'),
      fractura: sp('fractura'),
      reabsorcion: sp('reabsorcion'),
      movilidad: sp('movilidad'),
      fistula: sp('fistula'),
    };
    const sz = Math.max(W * 1.05, 4.6);
    this.pato.periapical.scale.set(sz * 1.5, sz * 1.5, 1);
    this.pato.fractura.scale.set(Math.max(W * 1.05, 5), Math.max(W * 1.05, 5) * 0.5, 1);
    this.pato.reabsorcion.scale.set(sz * 0.95, sz * 0.95, 1);
    this.pato.fistula.scale.set(sz * 0.8, sz * 0.8, 1);
    this.pato.movilidad.scale.set(sz * 1.3, sz * 1.3, 1);
    this.posPato(1);
  }

  /** Fracción visible de la raíz (1 = completa; en la vista completa se acorta y se desvanece). */
  setRaiz(k: number): void {
    this.kRaiz = k;
    const { H, L } = this.i,
      fade = Math.min(1, Math.max(0, (1 - k) / (1 - KR)));
    for (const r of this.raices) r.scale.y = k;
    (this.mR.userData.uFade as { value: number }).value = fade;
    this.mR.transparent = this.ext || fade > 0.001;
    this.encia.scale.y = 1 - 0.3 * fade;
    const f = (H + k * L) / (H + L),
      cy = (H - k * L) / 2;
    for (const o of [this.extFrente, this.extAtras]) {
      o.scale.y = f;
      o.position.y = cy;
    }
    for (const o of [this.ausFrente, this.ausAtras]) o.position.y = cy;
    this.imp.scale.y = k;
    this.posPato(k);
  }

  private posPato(k: number): void {
    const { W, H, L } = this.i,
      p = this.pato;
    p.periapical.position.set(0, -k * L - 0.3, 0);
    p.reabsorcion.position.set(0, -k * L * 0.62, 0);
    p.fistula.position.set(W * 0.36, -k * L * 0.4, 0);
    p.fractura.position.set(0, H * 0.62, 0);
    p.movilidad.position.set(0, H + 0.8 + p.movilidad.scale.y / 2, 0);
  }

  /** Centro de un grupo de vértices de la corona (en coordenadas del diente). */
  private media(fn: (reg: number, t: number, u: number) => boolean): THREE.Vector3 | null {
    const pos = this.corona.geometry.attributes.position as THREE.BufferAttribute,
      m = new THREE.Vector3(),
      k2 = this.i.ms / (this.i.W / 2);
    let c = 0;
    for (let k = 0; k < this.reg.length; k++) {
      if (!fn(this.reg[k] as number, this.tp[k] as number, pos.getX(k) * k2)) continue;
      m.x += pos.getX(k);
      m.y += pos.getY(k);
      m.z += pos.getZ(k);
      c++;
    }
    return c ? m.divideScalar(c) : null;
  }

  /** Zona que pinta cada clase de Black. */
  private zona(cl: ClaseBlack, cara: Cara): Zona | null {
    const key = cl + cara;
    const previa = this.cache.get(key);
    if (previa !== undefined) return previa;
    const { W, H, D, ant } = this.i,
      rc = CARA[cara];
    let z: Omit<Zona, 'c' | 'seed'> & { c: THREE.Vector3 | null };
    if (cl === 'I' && rc === 0)
      z = {
        c: this.media((r) => r === 0),
        allow: [0],
        tmin: 0,
        tmax: 9,
        rx: 0.3 * W,
        ry: 0.5 * H,
        rz: 0.3 * D,
        surcos: true,
      };
    else if (cl === 'I')
      z = {
        c: this.media(
          (r, t, u) =>
            r === rc && t > (ant ? 0.3 : 0.55) && t < (ant ? 0.5 : 0.75) && Math.abs(u) < 0.3,
        ),
        allow: [rc],
        tmin: ant ? 0.2 : 0.45,
        tmax: ant ? 0.68 : 0.85,
        rx: 0.2 * W,
        ry: 0.16 * H,
        rz: 0.3 * D,
      };
    else if (cl === 'II')
      z = {
        c: this.media((r, t) => r === rc && t > 0.55 && t < 0.85),
        allow: [rc, 0],
        tmin: 0.3,
        tmax: 9,
        rx: 0.3 * W,
        ry: 0.42 * H,
        rz: 0.36 * D,
      };
    else if (cl === 'III')
      z = {
        c: this.media((r, t) => r === rc && t > 0.38 && t < 0.6),
        allow: [rc],
        tmin: 0.2,
        tmax: 0.74,
        rx: 0.25 * W,
        ry: 0.22 * H,
        rz: 0.45 * D,
      };
    else if (cl === 'IV')
      z = {
        c: this.media((r, t) => r === rc && t > 0.82),
        allow: [rc, 0, 3, 4],
        tmin: 0.45,
        tmax: 9,
        rx: 0.34 * W,
        ry: 0.3 * H,
        rz: 0.7 * D,
      };
    else
      z = {
        c: this.media((r, t) => r === rc && t > 0.1 && t < 0.3),
        allow: [rc],
        tmin: 0.02,
        tmax: 0.42,
        rx: 0.42 * W,
        ry: 0.17 * H,
        rz: 0.4 * D,
      };
    const out: Zona | null = z.c
      ? { ...z, c: z.c, seed: (this.i.fdi * 7.31 + rc * 13.7) % 61 }
      : null;
    this.cache.set(key, out);
    return out;
  }

  pintar(): void {
    const a = this.colores.array as Float32Array,
      pos = this.corona.geometry.attributes.position as THREE.BufferAttribute;
    a.set(this.base);
    const zs: Zona[] = [],
      zr: boolean[] = [];
    for (const l of this.lesiones) {
      const z = this.zona(l.cl, l.cara);
      if (z) {
        zs.push(z);
        zr.push(this.rea.includes('car:' + l.cara));
      }
    }
    const prot = this.mk.includes('protesis'),
      sella = this.mk.includes('sellante');
    const cPro = C_PROT.clone().lerp(this.rea.includes('protesis') ? C_REST : C_PEND, 0.45),
      cSel = C_SELLA.clone().lerp(this.rea.includes('sellante') ? C_REST : C_PEND, 0.45);
    for (let k = 0; k < this.reg.length; k++) {
      let w = 0,
        wr = false;
      if (zs.length) {
        const px = pos.getX(k),
          py = pos.getY(k),
          pz = pos.getZ(k),
          rg = this.reg[k] as number,
          t = this.tp[k] as number;
        for (let zi = 0; zi < zs.length; zi++) {
          const z = zs[zi] as Zona;
          if (!z.allow.includes(rg) || t < z.tmin || t > z.tmax) continue;
          const ex = (px - z.c.x) / z.rx,
            ey = (py - z.c.y) / z.ry,
            ez = (pz - z.c.z) / z.rz;
          const d =
            Math.sqrt(ex * ex + ey * ey + ez * ez) +
            (ruido(px * 1.15 + z.seed, py * 1.15, pz * 1.15) - 0.5) * 0.5;
          let p = 1 - smooth(0.62, 1.0, d);
          if (z.surcos)
            p = Math.max(
              p,
              Math.min(1, (this.surco[k] as number) * 1.7) * (1 - smooth(1.0, 1.7, d)),
            );
          if (p > w) {
            w = p;
            wr = zr[zi] as boolean;
          }
        }
      }
      const j = k * 3;
      if (prot) {
        const f = 0.3;
        a[j] = (a[j] as number) + (cPro.r - (a[j] as number)) * f;
        a[j + 1] = (a[j + 1] as number) + (cPro.g - (a[j + 1] as number)) * f;
        a[j + 2] = (a[j + 2] as number) + (cPro.b - (a[j + 2] as number)) * f;
      }
      if (sella) {
        const rg = this.reg[k] as number,
          t = this.tp[k] as number,
          ant = this.i.ant;
        const sw = ant
          ? rg === 4
            ? smooth(0.28, 0.4, t) * (1 - smooth(0.62, 0.74, t)) * 0.8
            : 0
          : rg === 0
            ? 0.5 + 0.4 * Math.min(1, (this.surco[k] as number) * 1.7)
            : 0;
        if (sw > 0) {
          a[j] = (a[j] as number) + (cSel.r - (a[j] as number)) * sw;
          a[j + 1] = (a[j + 1] as number) + (cSel.g - (a[j + 1] as number)) * sw;
          a[j + 2] = (a[j + 2] as number) + (cSel.b - (a[j + 2] as number)) * sw;
        }
      }
      if (w > 0) {
        // caries: negra por realizar (color clínico fijo); azul si está realizada (obturación)
        const f = w * 0.97,
          cc = wr ? C_REST : C_CARIES;
        a[j] = (a[j] as number) + (cc.r - (a[j] as number)) * f;
        a[j + 1] = (a[j + 1] as number) + (cc.g - (a[j + 1] as number)) * f;
        a[j + 2] = (a[j + 2] as number) + (cc.b - (a[j + 2] as number)) * f;
      }
      if (this.hover >= 0 && this.reg[k] === this.hover) {
        a[j] = (a[j] as number) + (C_HOVER.r - (a[j] as number)) * 0.32;
        a[j + 1] = (a[j + 1] as number) + (C_HOVER.g - (a[j + 1] as number)) * 0.32;
        a[j + 2] = (a[j + 2] as number) + (C_HOVER.b - (a[j + 2] as number)) * 0.32;
      }
    }
    this.colores.needsUpdate = true;
    this.sucio();
  }

  /** Cara tocada, a partir del punto de impacto del rayo. */
  caraEn(hit: THREE.Intersection): PuntoCara {
    const p = this.corona.worldToLocal(hit.point.clone()),
      pos = this.corona.geometry.attributes.position as THREE.BufferAttribute;
    const f = hit.face as THREE.Face;
    let best = f.a,
      bd = Infinity;
    for (const k of [f.a, f.b, f.c]) {
      const d = (pos.getX(k) - p.x) ** 2 + (pos.getY(k) - p.y) ** 2 + (pos.getZ(k) - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return {
      reg: this.reg[best] as number,
      t: this.tp[best] as number,
      u: (p.x * this.i.ms) / (this.i.W / 2),
      w: p.z,
    };
  }

  aplicar(m: MarcaDiente, vista: VistaInterna): void {
    this.lesiones = m.car;
    this.mk = m.mk;
    this.rea = m.rea;
    this.pintar();
    const has = (id: Marcador) => m.mk.includes(id),
      aus = has('ausente');
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
    const rv = !aus && vista !== 'arcada'; // en la vista oclusal la raíz queda oculta bajo la corona
    this.pato.periapical.visible = has('periapical') && rv;
    this.pato.reabsorcion.visible = has('reabsorcion') && rv;
    this.pato.fistula.visible = has('fistula') && rv;
    this.pato.fractura.visible = has('fractura') && !aus;
    this.pato.movilidad.visible = has('movilidad') && !aus;
    for (const id of PATO)
      if (has(id))
        this.pato[id].material = this.rec.pato(
          id,
          id === 'movilidad' ? m.mov : 0,
          m.rea.includes(id),
        );
    // estado de tratamiento de los marcadores no clínicos: rojo = por realizar, azul = realizado
    const ec = (id: string) => (m.rea.includes(id) ? C_REST : C_PEND);
    const mezcla = (
      mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
      base: number,
      id: string,
      k = 0.5,
    ) => {
      mat.color.set(base).lerp(ec(id), k);
    };
    mezcla(this.oro.material, 0xe2ae1c, 'corona');
    mezcla(this.imp.material, 0x14b3a3, 'implante');
    for (const c of [...this.canales, this.pulpa]) mezcla(c.material, 0xa45cff, 'endodoncia', 0.45);
    this.prot.material.color.set(0xf26b1d).lerp(ec('protesis'), 0.5);
    this.prot.material.emissive.set(this.prot.material.color);
    this.extFrente.visible = m.ext && (vista === 'vest' || vista === 'completo');
    this.extAtras.visible = m.ext && vista === 'ling';
    this.extArriba.visible = m.ext && vista === 'arcada';
    const fant = m.ext || aus,
      op = aus ? 0.13 : m.ext ? 0.38 : 1;
    this.ext = fant;
    for (const mt of [this.mE, this.mR]) {
      mt.transparent = fant;
      mt.opacity = op;
      mt.depthWrite = !fant;
      mt.needsUpdate = true;
    }
    this.mR.transparent = fant || (this.mR.userData.uFade as { value: number }).value > 0.001;
    // encía enrojecida mientras el problema periodontal está por realizar
    const perPend = m.per && !m.rea.includes('per');
    this.mG.color.set(perPend ? 0xff5e6e : 0xffffff);
    this.mG.emissive.set(perPend ? 0x6a0c18 : 0x000000);
    this.mG.opacity = aus ? 0.12 : m.ext ? 0.35 : 1;
  }

  resaltar(on: boolean, cara = -1): void {
    this.sucio();
    this.mE.emissive.set(on && cara < 0 ? 0x2e9bec : 0x000000);
    this.mE.emissiveIntensity = on && cara < 0 ? 0.2 : 0;
    if (this.hover !== cara) {
      this.hover = cara;
      this.pintar();
    }
  }

  /** Libera geometrías y materiales propios. Las texturas compartidas las libera `Recursos`. */
  dispose(): void {
    this.g.traverse((o) => {
      // los sprites usan una geometría global de three y materiales de `Recursos`: no se tocan
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mats) x.dispose();
    });
    this.g.removeFromParent();
    this.cache.clear();
  }
}
