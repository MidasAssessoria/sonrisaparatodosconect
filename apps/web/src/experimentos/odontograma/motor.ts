/**
 * Motor 3D del odontograma: escena, cámara, controles, rótulos, toques y animaciones de vista.
 *
 * Adaptado de la parte «escena», «cámara» e «interacción» de `referencia/maqueta/codigo/app.js`
 * (`renderer`, `entornoEstudio`, luces, `ajustarEscena`, `controls`, `construir`, `colocar`,
 * `aplicarEstado`, `encuadrar`, `iniciarAnim`, `cambiarVista`, `paso`, `golpe`, manejadores de
 * puntero, `modoControles`, `textosLados`, `tam`, `ajustarAncho`, bucle de dibujo bajo demanda).
 *
 * Lo que cambia respecto de la maqueta:
 * - Todo vive en una instancia: nada de variables globales del módulo, nada de ids del HTML. El
 *   motor recibe un contenedor y crea adentro el lienzo, la capa de rótulos y el globo de ayuda.
 * - No guarda el estado clínico: lo recibe con `setEstado` y cada toque sale por `alTocar`. Quien
 *   decide qué cambia (y lo guarda) es el componente React con las reglas de `reglas.ts`.
 * - Solo vuelve a pintar los dientes cuyo estado cambió (la maqueta repintaba los 64 por toque).
 * - `dispose()` deja todo limpio: corta el bucle de dibujo, desconecta el `ResizeObserver`, quita
 *   los manejadores, libera geometrías, materiales, texturas y mapas de sombra, y suelta el
 *   contexto WebGL (`forceContextLoss`), que el navegador limita a unos 16 por página.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Diente } from './diente.js';
import {
  disposiciones,
  encuadre,
  type ClaveVista,
  type Disposicion,
  type Lado,
} from './disposicion.js';
import { KR, ease } from './geometria.js';
import { Recursos } from './materiales.js';
import {
  CATALOGO,
  CARA,
  TIPO_DE_MARCADOR,
  canon,
  conEstado,
  nombreCara,
  normM,
  orden,
  type Cara,
  type Denticion,
  type EstadoOdontograma,
  type Herramienta,
} from './modelo.js';
import type { Toque } from './reglas.js';

export type Vista = 'completo' | 'vestibular' | 'lingual' | 'oclusal';
const INTERNA: Record<Vista, ClaveVista> = {
  completo: 'completo',
  vestibular: 'vest',
  lingual: 'ling',
  oclusal: 'arcada',
};

export interface OpcionesMotor {
  denticion: Denticion;
  vista: Vista;
  estado: EstadoOdontograma;
  herramienta: Herramienta;
  soloLectura: boolean;
  /** Rótulos SUPERIOR / INFERIOR / DERECHA / IZQUIERDA dentro de la escena (siguen a la cámara). */
  rotulosLado: boolean;
  /** Toque corto sobre un diente (modo edición). */
  alTocar: (t: Toque) => void;
  /** Pulsación larga, o toque en modo solo lectura. */
  alElegir: (fdi: number) => void;
  /** Primer cuadro dibujado: milisegundos desde que se creó el motor. */
  alPrimerCuadro?: (ms: number) => void;
}

export interface Metricas {
  /** Cuadros dibujados desde que se creó el motor. */
  cuadros: number;
  geometrias: number;
  texturas: number;
  programas: number;
  llamadas: number;
  triangulos: number;
  /** Milisegundos que tardó en armar los dientes la última vez. */
  msConstruccion: number;
}

export interface MedicionGiro {
  fps: number;
  cuadros: number;
  /** Cuadro más lento (ms entre dos cuadros dibujados). */
  msPeor: number;
  msMedio: number;
}

interface Rotulo {
  obj: CSS2DObject;
  f?: number;
  k?: Lado;
}

const TXT_LADO: Record<ClaveVista, Record<'sup' | 'inf', string>> = {
  vest: { sup: '▲ SUPERIOR · VESTIBULAR', inf: '▼ INFERIOR · VESTIBULAR' },
  ling: { sup: '▲ SUPERIOR · PALATINA', inf: '▼ INFERIOR · LINGUAL' },
  completo: {
    sup: '▲ SUPERIOR · vestibular arriba, palatina abajo',
    inf: '▼ INFERIOR · lingual arriba, vestibular abajo',
  },
  arcada: { sup: '▲ SUPERIOR', inf: '▼ INFERIOR' },
};
const TXT_LADO_FIJO: Record<'der' | 'izq', string> = { der: 'DERECHA', izq: 'IZQUIERDA' };

export class MotorOdontograma {
  readonly lienzo: HTMLCanvasElement;
  private readonly cont: HTMLElement;
  private readonly capaRotulos: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly rot: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 1, 2000);
  private readonly controls: OrbitControls;
  private readonly rig = new THREE.Group();
  private readonly fondo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly luz: THREE.SpotLight;
  private readonly raiz3d = new THREE.Group();
  private readonly ray = new THREE.Raycaster();
  private readonly recursos = new Recursos();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly entorno: THREE.Texture;
  private readonly observador: ResizeObserver | null;
  private readonly t0 = performance.now();

  private op: OpcionesMotor;
  private vista: ClaveVista;
  private dientes = new Map<number, Diente>();
  private rotulos: Rotulo[] = [];
  private disp: Disposicion | null = null;
  /** Lo último aplicado a cada diente (para no repintar lo que no cambió). */
  private aplicado = new Map<number, string>();
  private selFdi: number | null = null;
  private sucio = true;
  private anim: { t0: number; dur: number; a: ClaveVista; cam: AnimCam | null } | null = null;
  private abajo: { x: number; y: number } | null = null;
  private sobre: Diente | null = null;
  private largo: ReturnType<typeof setTimeout> | null = null;
  private largoHecho = false;
  private destellos = new Set<ReturnType<typeof setTimeout>>();
  private cuadros = 0;
  private primerCuadro = false;
  private msConstruccion = 0;
  private destruido = false;
  private pendiente: { estado?: boolean; construir?: boolean } = {};
  private medicion: number[] | null = null;
  private readonly quitarManejadores: (() => void)[] = [];

  constructor(contenedor: HTMLElement, op: OpcionesMotor) {
    this.cont = contenedor;
    this.op = op;
    this.vista = INTERNA[op.vista];
    const movil = Math.min(window.innerWidth, window.innerHeight) < 700;

    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio * (movil ? 1.15 : 1.5), movil ? 2.6 : 3));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.VSMShadowMap; // sombras suaves; se actualizan solo cuando algo se mueve
    r.shadowMap.autoUpdate = false;
    this.renderer = r;
    this.lienzo = r.domElement;
    this.lienzo.classList.add('od3d__lienzo');
    contenedor.prepend(this.lienzo);

    this.capaRotulos = document.createElement('div');
    this.capaRotulos.className = 'od3d__rotulos';
    contenedor.append(this.capaRotulos);
    this.rot = new CSS2DRenderer({ element: this.capaRotulos });
    this.tip = document.createElement('div');
    this.tip.className = 'od3d__tip';
    this.tip.hidden = true;
    contenedor.append(this.tip);

    // Estudio dental: cajas de luz suaves sobre una sala azul oscura (mapa de entorno por código).
    this.pmrem = new THREE.PMREMGenerator(r);
    const est = entornoEstudio();
    this.entorno = this.pmrem.fromScene(est, 0.03).texture;
    liberar(est);
    this.scene.environment = this.entorno;
    this.scene.environmentIntensity = 0.85;
    // Todas las luces cuelgan de un soporte que se gira al mirar por detrás (vista palatina/lingual).
    this.scene.add(this.rig);
    const luz = new THREE.SpotLight(0xfff2e2, 2.1, 0, 0.62, 1, 0);
    luz.position.set(-55, 85, 195);
    luz.target.position.set(0, 0, -10);
    this.rig.add(luz, luz.target);
    luz.castShadow = true;
    luz.shadow.mapSize.set(movil ? 1024 : 2048, movil ? 1024 : 2048);
    luz.shadow.radius = 6;
    luz.shadow.blurSamples = 14;
    luz.shadow.bias = -0.0004;
    luz.shadow.normalBias = 0.2;
    luz.shadow.camera.near = 80;
    luz.shadow.camera.far = 460;
    this.luz = luz;
    const luz2 = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    luz2.position.set(70, -25, 90);
    const luz3 = new THREE.DirectionalLight(0xffffff, 1.0);
    luz3.position.set(30, 70, -90);
    this.rig.add(luz2, luz3, new THREE.HemisphereLight(0xdfe8ff, 0x3a2f2a, 0.22));
    // Fondo: solo recibe la sombra de los dientes (transparente).
    this.fondo = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1100),
      new THREE.ShadowMaterial({ color: 0x01040c, opacity: 0.7, side: THREE.DoubleSide }),
    );
    this.fondo.receiveShadow = true;
    this.fondo.renderOrder = -1;
    this.scene.add(this.fondo);
    this.scene.add(this.raiz3d);

    const c = new OrbitControls(this.camera, this.lienzo);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minPolarAngle = Math.PI * 0.1;
    c.maxPolarAngle = Math.PI * 0.9;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.8;
    c.rotateSpeed = 0.7;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls = c;

    this.escuchar(this.lienzo, 'contextmenu', (ev) => ev.preventDefault());
    this.escuchar(this.lienzo, 'pointerdown', (ev) => this.alBajar(ev as PointerEvent));
    this.escuchar(this.lienzo, 'pointerup', (ev) => this.alSubir(ev as PointerEvent));
    this.escuchar(this.lienzo, 'pointercancel', () => {
      this.cancelarLargo();
      this.abajo = null;
    });
    this.escuchar(this.lienzo, 'pointermove', (ev) => this.alMover(ev as PointerEvent));
    this.escuchar(this.lienzo, 'pointerleave', () => {
      this.tip.hidden = true;
      if (this.sobre) {
        this.sobre.resaltar(false);
        this.sobre = null;
      }
    });
    this.escuchar(this.lienzo, 'webglcontextrestored', () => this.sombras());

    this.observador =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            this.tam();
            this.ajustarAncho();
            if (!this.anim) this.encuadrar();
          });
    this.observador?.observe(contenedor);

    this.tam();
    this.construir();
    // primer cuadro enseguida, sin esperar al próximo requestAnimationFrame
    this.cuadro(performance.now());
    r.setAnimationLoop((now) => this.cuadro(now));
  }

  /* ---------- API ---------- */

  /** El estado se aplica en el próximo cuadro (varios cambios seguidos se pintan una sola vez). */
  setEstado(e: EstadoOdontograma): void {
    if (this.destruido || e === this.op.estado) return;
    this.op = { ...this.op, estado: e };
    this.pendiente.estado = true;
  }

  /** La dentición se reconstruye en el próximo cuadro, ya con el estado más reciente. */
  setDenticion(d: Denticion): void {
    if (this.destruido || d === this.op.denticion) return;
    this.op = { ...this.op, denticion: d };
    this.selFdi = null;
    this.pendiente.construir = true;
  }

  /** Aplica ya lo pendiente (lo usa el bucle de dibujo; también sirve en pruebas). */
  procesarPendiente(): void {
    if (this.pendiente.construir) this.construir();
    else if (this.pendiente.estado) this.aplicarEstado(false);
    this.pendiente = {};
  }

  setVista(v: Vista): void {
    if (this.destruido) return;
    this.op = { ...this.op, vista: v };
    const iv = INTERNA[v];
    if (iv === this.vista && !this.anim) return;
    this.vista = iv;
    this.ajustarEscena();
    this.iniciarAnim(iv, 1300, this.encuadrar(true));
    this.aplicarEstado(true);
    this.textosLados();
  }

  setHerramienta(h: Herramienta): void {
    this.op = { ...this.op, herramienta: h };
  }

  setSoloLectura(s: boolean): void {
    this.op = { ...this.op, soloLectura: s };
  }

  setCallbacks(c: Pick<OpcionesMotor, 'alTocar' | 'alElegir'>): void {
    this.op = { ...this.op, ...c };
  }

  /** Vuelve a encuadrar la vista actual (botón «Centrar»). */
  centrar(): void {
    if (this.destruido) return;
    this.iniciarAnim(this.vista, 700, this.encuadrar(true));
  }

  /** Resalta un instante la cara marcada (en el táctil no hay «hover» que la muestre). */
  destellar(fdi: number, cara: Cara): void {
    const d = this.dientes.get(fdi);
    if (!d || this.sobre === d) return;
    for (const x of [d, d.gem]) if (x) x.resaltar(false, CARA[cara]);
    const t = setTimeout(() => {
      this.destellos.delete(t);
      if (this.destruido || this.sobre === d) return;
      for (const x of [d, d.gem]) if (x) x.resaltar(false, -1);
    }, 650);
    this.destellos.add(t);
  }

  /**
   * Medición: gira la cámara sola durante `ms` (como si el usuario arrastrara sin parar) y cuenta
   * los cuadros dibujados. Devuelve cuadros por segundo y el cuadro más lento.
   */
  medirGiro(ms = 4000): Promise<MedicionGiro> {
    return new Promise((res) => {
      if (this.destruido) {
        res({ fps: 0, cuadros: 0, msPeor: 0, msMedio: 0 });
        return;
      }
      const tiempos: number[] = [];
      this.medicion = tiempos;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 12; // una vuelta cada ~5 s
      const t0 = performance.now();
      const t = setTimeout(() => {
        this.destellos.delete(t);
        this.controls.autoRotate = false;
        this.medicion = null;
        const dur = performance.now() - t0;
        const deltas = tiempos.slice(1).map((x, i) => x - (tiempos[i] as number));
        res({
          fps: Math.round((tiempos.length / dur) * 1000 * 10) / 10,
          cuadros: tiempos.length,
          msPeor: Math.round(Math.max(0, ...deltas) * 10) / 10,
          msMedio: deltas.length
            ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10
            : 0,
        });
      }, ms);
      this.destellos.add(t);
    });
  }

  /**
   * Medición independiente del ritmo de `requestAnimationFrame` (que el navegador frena en ventanas
   * tapadas o en segundo plano): gira la cámara `n` pasos y dibuja cada uno de forma sincrónica,
   * esperando a la GPU con una lectura de 1 píxel. Devuelve milisegundos por cuadro.
   */
  medirCosto(n = 30): { msPorCuadro: number; fpsPosible: number } {
    if (this.destruido) return { msPorCuadro: 0, fpsPosible: 0 };
    const gl = this.renderer.getContext(),
      px = new Uint8Array(4);
    const esperarGpu = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t = this.controls.target,
      v = this.camera.position.clone().sub(t);
    this.renderer.render(this.scene, this.camera);
    esperarGpu();
    const t0 = performance.now();
    for (let k = 0; k < n; k++) {
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.02);
      this.camera.position.copy(t).add(v);
      this.camera.lookAt(t);
      this.renderer.render(this.scene, this.camera);
      this.rot.render(this.scene, this.camera);
      esperarGpu();
    }
    const ms = (performance.now() - t0) / n;
    this.sucio = true;
    return { msPorCuadro: Math.round(ms * 10) / 10, fpsPosible: Math.round(1000 / ms) };
  }

  /**
   * Punto de la pantalla (coordenadas de cliente) donde se ve el centro de la corona de un diente.
   * Para pruebas de punta a punta (la maqueta tenía `window.__odonto.pantalla`).
   */
  puntoEnPantalla(fdi: number, gemelo = false): { x: number; y: number } | null {
    const d0 = this.dientes.get(fdi),
      d = gemelo ? d0?.gem : d0;
    if (!d) return null;
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const c = new THREE.Box3()
      .expandByObject(d.corona)
      .getCenter(new THREE.Vector3())
      .project(this.camera);
    const r = this.lienzo.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }

  metricas(): Metricas {
    const inf = this.renderer.info;
    return {
      cuadros: this.cuadros,
      geometrias: inf.memory.geometries,
      texturas: inf.memory.textures,
      programas: inf.programs?.length ?? 0,
      llamadas: inf.render.calls,
      triangulos: inf.render.triangles,
      msConstruccion: this.msConstruccion,
    };
  }

  dispose(): void {
    if (this.destruido) return;
    this.destruido = true;
    this.renderer.setAnimationLoop(null);
    this.cancelarLargo();
    for (const t of this.destellos) clearTimeout(t);
    this.destellos.clear();
    this.observador?.disconnect();
    for (const q of this.quitarManejadores.splice(0)) q();
    this.controls.dispose();
    this.vaciarDientes();
    this.recursos.dispose();
    this.fondo.geometry.dispose();
    this.fondo.material.dispose();
    this.luz.dispose();
    this.entorno.dispose();
    this.pmrem.dispose();
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.lienzo.remove();
    this.capaRotulos.remove();
    this.tip.remove();
  }

  /* ---------- construcción ---------- */

  private escuchar(el: EventTarget, tipo: string, fn: (ev: Event) => void): void {
    el.addEventListener(tipo, fn);
    this.quitarManejadores.push(() => el.removeEventListener(tipo, fn));
  }

  private vaciarDientes(): void {
    for (const [, d] of this.dientes) {
      d.gem?.dispose();
      d.dispose();
    }
    for (const r of this.rotulos) {
      r.obj.removeFromParent();
      r.obj.element.remove();
    }
    this.dientes = new Map();
    this.rotulos = [];
    this.aplicado.clear();
    this.sobre = null;
  }

  private nuevaDisposicion(): Disposicion {
    const w = this.cont.clientWidth,
      h = this.cont.clientHeight;
    return disposiciones(
      this.op.denticion === 'pediatrico',
      w > 0 && w <= 760,
      w / Math.max(1, h) > 1.25,
    );
  }

  private construir(): void {
    const t = performance.now();
    this.vaciarDientes();
    const nino = this.op.denticion === 'pediatrico';
    const D = (this.disp = this.nuevaDisposicion());
    const v = this.vista,
      comp = v === 'completo';
    const marcar = () => this.marcarSucio();
    const o = orden(nino);
    for (const f of [...o.sup, ...o.inf]) {
      const L = D.vistas[v].get(f);
      if (!L) continue;
      const d = new Diente(f, this.recursos, marcar);
      d.g.position.copy(L.pos);
      d.g.quaternion.copy(L.q);
      this.raiz3d.add(d.g);
      const gem = new Diente(f, this.recursos, marcar);
      gem.g.visible = comp;
      d.setRaiz(comp ? KR : 1);
      gem.setRaiz(comp ? KR : 1);
      const G = comp ? (D.completoG.get(f) ?? L) : L;
      gem.g.position.copy(G.pos);
      gem.g.quaternion.copy(G.q);
      this.raiz3d.add(gem.g);
      d.gem = gem;
      this.dientes.set(f, d);
      const r = rotulo(String(f), 'od3d-num');
      r.position.copy(L.rot);
      this.scene.add(r);
      this.rotulos.push({ obj: r, f });
    }
    if (this.op.rotulosLado)
      for (const k of ['sup', 'inf', 'der', 'izq'] as const) {
        const r = rotulo(
          k === 'der' || k === 'izq' ? TXT_LADO_FIJO[k] : TXT_LADO[v][k],
          'od3d-lado',
        );
        r.position.copy(D.lados[v][k]);
        this.scene.add(r);
        this.rotulos.push({ obj: r, k });
      }
    this.aplicarEstado(true);
    this.textosLados();
    this.encuadrar();
    this.ajustarEscena();
    this.msConstruccion = performance.now() - t;
  }

  private colocar(v: ClaveVista): void {
    const D = this.disp;
    if (!D) return;
    const comp = v === 'completo';
    for (const [f, d] of this.dientes) {
      const L = D.vistas[v].get(f);
      if (!L) continue;
      const G = comp ? (D.completoG.get(f) ?? L) : L;
      d.g.position.copy(L.pos);
      d.g.quaternion.copy(L.q);
      if (d.gem) {
        d.gem.g.position.copy(G.pos);
        d.gem.g.quaternion.copy(G.q);
        d.gem.g.visible = comp;
        d.gem.setRaiz(comp ? KR : 1);
      }
      d.setRaiz(comp ? KR : 1);
    }
    for (const r of this.rotulos) r.obj.position.copy(this.posRotulo(r, v));
    this.sombras();
  }

  private posRotulo(r: Rotulo, v: ClaveVista): THREE.Vector3 {
    const D = this.disp as Disposicion;
    if (r.f !== undefined) return (D.vistas[v].get(r.f) as { rot: THREE.Vector3 }).rot;
    return D.lados[v][r.k as Lado];
  }

  private ajustarAncho(): void {
    if (!this.disp) return;
    const n = this.nuevaDisposicion();
    if (n.arcadaAncha === this.disp.arcadaAncha) return;
    this.disp = n;
    this.textosLados();
    if (!this.anim) this.colocar(this.vista);
  }

  private ajustarEscena(): void {
    const v = this.vista,
      por = v === 'ling';
    this.rig.rotation.y = por ? Math.PI : 0;
    this.scene.environmentRotation.y = por ? Math.PI : 0;
    const z = v === 'arcada' ? 40 : v === 'completo' ? 17 : 20;
    this.fondo.position.z = por ? z : -z;
    this.sombras();
  }

  private textosLados(): void {
    const pan = this.vista === 'completo';
    this.controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = pan ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    this.controls.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    this.controls.screenSpacePanning = true;
    this.cont.classList.toggle('od3d--completo', pan);
    const arcH = !!this.disp?.arcadaAncha;
    for (const r of this.rotulos)
      if (r.k === 'sup' || r.k === 'inf')
        r.obj.element.textContent =
          this.vista === 'arcada' && arcH
            ? { sup: 'SUPERIOR', inf: 'INFERIOR' }[r.k]
            : TXT_LADO[this.vista][r.k];
  }

  /** Aplica el estado a los dientes 3D y a sus rótulos. Con `todo` repinta aunque no haya cambios. */
  private aplicarEstado(todo: boolean): void {
    const e = this.op.estado,
      v = this.vista;
    for (const [f, d] of this.dientes) {
      const m = normM(e[String(f)]);
      const clave = canon(m) + '|' + v;
      const r = this.rotulos.find((x) => x.f === f);
      if (r) r.obj.element.classList.toggle('is-sel', f === this.selFdi);
      if (!todo && this.aplicado.get(f) === clave) continue;
      this.aplicado.set(f, clave);
      const aus = m.mk.includes('ausente');
      d.aplicar(m, v);
      d.gem?.aplicar(m, v === 'completo' ? 'ling' : v);
      if (r) {
        const el = r.obj.element,
          c = el.classList;
        c.toggle('is-car', m.car.length > 0 && !m.ext);
        c.toggle('is-ext', m.ext);
        c.toggle('is-per', m.per && !m.ext && !m.car.length);
        c.toggle('is-aus', aus);
        el.querySelector('.od3d-pts')?.remove();
        // puntos bajo el número: un punto por hallazgo, con borde rojo (por realizar) o azul (realizado)
        const pts: [string, string | null][] = [];
        if (m.car.length)
          pts.push([
            CATALOGO.caries.color,
            m.car.every((l) => m.rea.includes('car:' + l.cara)) ? 'rea' : 'pend',
          ]);
        if (m.ext)
          pts.push([CATALOGO.extraccion_indicada.color, m.rea.includes('ext') ? 'rea' : 'pend']);
        if (m.per) pts.push([CATALOGO.periodontal.color, m.rea.includes('per') ? 'rea' : 'pend']);
        for (const id of m.mk)
          pts.push([
            CATALOGO[TIPO_DE_MARCADOR[id]].color,
            conEstado(id) ? (m.rea.includes(id) ? 'rea' : 'pend') : null,
          ]);
        if (pts.length) {
          const p = document.createElement('span');
          p.className = 'od3d-pts';
          for (const [color, est] of pts) {
            const i = document.createElement('i');
            i.style.background = color;
            if (est) i.className = 'is-' + est;
            p.append(i);
          }
          el.append(p);
        }
      }
      for (const x of [d, d.gem])
        if (x) for (const o of [x.corona, ...x.raices]) o.castShadow = !(m.ext || aus);
    }
    this.sombras();
  }

  /* ---------- cámara y animación ---------- */

  private encuadrar(animado: true): AnimCam;
  private encuadrar(animado?: false): null;
  private encuadrar(animado = false): AnimCam | null {
    if (!this.disp) return null;
    this.sucio = true;
    const e = encuadre(this.disp, this.vista, this.camera.fov, this.camera.aspect);
    const dz = Math.abs(e.pos.z);
    this.controls.maxDistance = dz * 1.8;
    this.controls.minDistance = dz * 0.18;
    if (!animado) {
      this.camera.position.copy(e.pos);
      this.controls.target.copy(e.target);
      this.controls.update();
      return null;
    }
    return {
      camDe: this.camera.position.clone(),
      camA: e.pos,
      tgDe: this.controls.target.clone(),
      tgA: e.target,
    };
  }

  private iniciarAnim(a: ClaveVista, dur: number, cam: AnimCam | null): void {
    this.anim = { t0: performance.now(), dur, a, cam };
    for (const [, d] of this.dientes) {
      d.ini = { p: d.g.position.clone(), q: d.g.quaternion.clone() };
      if (d.gem) {
        d.gem.ini = { p: d.gem.g.position.clone(), q: d.gem.g.quaternion.clone() };
        if (a === 'completo') d.gem.g.visible = true;
      }
      d.k0 = d.kRaiz;
    }
    for (const r of this.rotulos) r.obj.userData.ini = r.obj.position.clone();
  }

  private paso(now: number): void {
    const A = this.anim,
      D = this.disp;
    if (!A || !D) return;
    const u = Math.min(1, (now - A.t0) / A.dur),
      k = ease(u);
    for (const [f, d] of this.dientes) {
      const L = D.vistas[A.a].get(f);
      if (!L || !d.ini) continue;
      d.g.position.lerpVectors(d.ini.p, L.pos, k);
      d.g.quaternion.slerpQuaternions(d.ini.q, L.q, k);
      const G = A.a === 'completo' ? (D.completoG.get(f) ?? L) : L;
      const kk = d.k0 + ((A.a === 'completo' ? KR : 1) - d.k0) * k;
      if (d.gem?.ini) {
        d.gem.g.position.lerpVectors(d.gem.ini.p, G.pos, k);
        d.gem.g.quaternion.slerpQuaternions(d.gem.ini.q, G.q, k);
        if (u >= 1) d.gem.g.visible = A.a === 'completo';
        d.gem.setRaiz(kk);
      }
      d.setRaiz(kk);
    }
    this.sombras();
    for (const r of this.rotulos)
      r.obj.position.lerpVectors(r.obj.userData.ini as THREE.Vector3, this.posRotulo(r, A.a), k);
    if (A.cam) {
      const C = A.cam;
      if (!C.s0) {
        C.s0 = new THREE.Spherical().setFromVector3(C.camDe.clone().sub(C.tgDe));
        C.s1 = new THREE.Spherical().setFromVector3(C.camA.clone().sub(C.tgA));
        let dt = C.s1.theta - C.s0.theta;
        if (dt > Math.PI) dt -= 2 * Math.PI;
        if (dt < -Math.PI) dt += 2 * Math.PI;
        if (Math.abs(Math.abs(dt) - Math.PI) < 0.05) dt = Math.PI;
        C.dt = dt;
      }
      const s0 = C.s0,
        s1 = C.s1 as THREE.Spherical;
      this.controls.target.lerpVectors(C.tgDe, C.tgA, k);
      const sp = new THREE.Spherical(
        s0.radius + (s1.radius - s0.radius) * k,
        s0.phi + (s1.phi - s0.phi) * k,
        s0.theta + (C.dt ?? 0) * k,
      );
      this.camera.position.setFromSpherical(sp).add(this.controls.target);
    }
    if (u >= 1) this.anim = null;
  }

  private cuadro(now: number): void {
    this.procesarPendiente();
    const activa = !!this.anim;
    this.paso(now);
    const mueve = this.controls.update();
    if (!activa && !mueve && !this.sucio) return;
    this.sucio = false;
    this.renderer.render(this.scene, this.camera);
    this.rot.render(this.scene, this.camera);
    this.cuadros++;
    this.medicion?.push(now);
    if (!this.primerCuadro) {
      this.primerCuadro = true;
      // para medir el primer cuadro de verdad se espera a que la GPU termine (una sola vez)
      const gl = typeof this.renderer.getContext === 'function' ? this.renderer.getContext() : null;
      gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      this.op.alPrimerCuadro?.(performance.now() - this.t0);
    }
  }

  private marcarSucio(): void {
    this.sucio = true;
  }

  private sombras(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.sucio = true;
  }

  private tam(): void {
    const w = this.cont.clientWidth,
      h = this.cont.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.rot.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.sucio = true;
  }

  /* ---------- interacción: toque = marcar · pulsación larga = elegir diente ---------- */

  private golpe(ev: {
    clientX: number;
    clientY: number;
  }): { d: Diente; hit: THREE.Intersection } | null {
    const r = this.lienzo.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ptr = new THREE.Vector2(
      ((ev.clientX - r.left) / r.width) * 2 - 1,
      -((ev.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(ptr, this.camera);
    const objs: THREE.Object3D[] = [];
    for (const [, d] of this.dientes)
      for (const x of [d, d.gem])
        if (x?.g.visible)
          x.g.traverseVisible((o) => {
            if ((o as THREE.Mesh).isMesh && o !== x.encia) objs.push(o);
          });
    const h = this.ray.intersectObjects(objs, false)[0];
    if (!h) return null;
    let o: THREE.Object3D | null = h.object;
    while (o && o.userData.fdi === undefined) o = o.parent;
    if (!o) return null;
    const d0 = this.dientes.get(o.userData.fdi as number);
    if (!d0) return null;
    const dd = d0.gem && d0.gem.g === o ? d0.gem : d0;
    return { d: dd, hit: h };
  }

  private cancelarLargo(): void {
    if (this.largo) clearTimeout(this.largo);
    this.largo = null;
  }

  private alBajar(ev: PointerEvent): void {
    if (!ev.isPrimary) {
      this.cancelarLargo();
      this.abajo = null;
      return;
    }
    this.abajo = { x: ev.clientX, y: ev.clientY };
    this.largoHecho = false;
    this.cancelarLargo();
    const cx = ev.clientX,
      cy = ev.clientY;
    this.largo = setTimeout(() => {
      this.largo = null;
      if (!this.abajo || this.anim || this.destruido) return;
      const g = this.golpe({ clientX: cx, clientY: cy });
      if (!g) return;
      this.largoHecho = true;
      if (typeof navigator.vibrate === 'function') navigator.vibrate(18);
      this.seleccionar(g.d.i.fdi);
      this.op.alElegir(g.d.i.fdi);
    }, 560);
  }

  private alSubir(ev: PointerEvent): void {
    this.cancelarLargo();
    if (!this.abajo) return;
    const mov = Math.hypot(ev.clientX - this.abajo.x, ev.clientY - this.abajo.y);
    this.abajo = null;
    if (this.largoHecho) {
      this.largoHecho = false;
      return;
    }
    if (mov > 7 || this.anim) return;
    const g = this.golpe(ev);
    if (!g) return;
    const f = g.d.i.fdi;
    this.seleccionar(f);
    if (this.op.soloLectura) {
      this.op.alElegir(f);
      return;
    }
    this.op.alTocar({ fdi: f, cara: g.hit.object === g.d.corona ? g.d.caraEn(g.hit) : null });
  }

  private alMover(ev: PointerEvent): void {
    if (this.abajo && Math.hypot(ev.clientX - this.abajo.x, ev.clientY - this.abajo.y) > 7)
      this.cancelarLargo();
    if (ev.pointerType !== 'mouse') return;
    const g = this.abajo ? null : this.golpe(ev);
    const d = g ? g.d : null;
    const cara =
      g &&
      d &&
      !this.op.soloLectura &&
      this.op.herramienta === 'caries' &&
      g.hit.object === d.corona
        ? d.caraEn(g.hit).reg
        : -1;
    if (d !== this.sobre) {
      if (this.sobre) this.sobre.resaltar(false);
      this.sobre = d;
    }
    if (d) d.resaltar(true, cara);
    this.lienzo.style.cursor = d ? 'pointer' : 'grab';
    if (d) {
      const r = this.cont.getBoundingClientRect();
      this.tip.hidden = false;
      this.tip.style.left = ev.clientX - r.left + 14 + 'px';
      this.tip.style.top = ev.clientY - r.top + 14 + 'px';
      this.tip.textContent =
        `${d.i.fdi} · ${d.i.nombre}` + (cara >= 0 ? ` · cara ${nombreCara(d.i, cara)}` : '');
    } else this.tip.hidden = true;
  }

  private seleccionar(f: number): void {
    this.selFdi = f;
    for (const r of this.rotulos)
      if (r.f !== undefined) r.obj.element.classList.toggle('is-sel', r.f === f);
  }
}

interface AnimCam {
  camDe: THREE.Vector3;
  camA: THREE.Vector3;
  tgDe: THREE.Vector3;
  tgA: THREE.Vector3;
  s0?: THREE.Spherical;
  s1?: THREE.Spherical;
  dt?: number;
}

function rotulo(txt: string, clase: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = clase;
  el.textContent = txt;
  return new CSS2DObject(el);
}

function entornoEstudio(): THREE.Scene {
  const s = new THREE.Scene();
  s.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(60, 48, 24),
      new THREE.MeshBasicMaterial({ color: 0x0b1326, side: THREE.BackSide }),
    ),
  );
  const panel = (w: number, h: number, col: number, k: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(col).multiplyScalar(k),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(50, 16, 0xffffff, 6, 0, 46, 24);
  panel(14, 48, 0xfff0dc, 4.5, -48, 4, 20);
  panel(14, 48, 0xcfe0ff, 4, 48, 4, 20);
  panel(52, 12, 0xdce8ff, 2.6, 0, -42, 28);
  panel(40, 24, 0xffffff, 2.2, 0, 10, -50);
  panel(26, 26, 0xffffff, 2.2, 0, 4, 56);
  return s;
}

function liberar(s: THREE.Object3D): void {
  s.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const m = o as THREE.Mesh;
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
}
