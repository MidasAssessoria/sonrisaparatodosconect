/**
 * Prueba de humo del componente: WebGL no existe en jsdom, así que el renderer y el generador de
 * entorno de three se reemplazan por falsos. Todo lo demás es real: geometría, materiales,
 * OrbitControls, CSS2DRenderer, raycasting y reglas.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CambioOdontograma, ControlOdontograma } from './Odontograma3D.js';

interface RendererFalso {
  domElement: HTMLCanvasElement;
  bucle: ((t: number) => void) | null;
  liberado: boolean;
  contextoPerdido: boolean;
  dibujos: number;
}
const renderers: RendererFalso[] = [];

vi.mock('three', async (original) => {
  const real = await original<typeof import('three')>();
  class WebGLRenderer implements RendererFalso {
    domElement = document.createElement('canvas');
    bucle: ((t: number) => void) | null = null;
    liberado = false;
    contextoPerdido = false;
    dibujos = 0;
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = '';
    shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    renderLists = { dispose: () => {} };
    info = {
      memory: { geometries: 0, textures: 0 },
      render: { calls: 0, triangles: 0 },
      programs: [],
    };
    constructor() {
      renderers.push(this);
    }
    setPixelRatio() {}
    getPixelRatio() {
      return 1;
    }
    setSize() {}
    setAnimationLoop(fn: ((t: number) => void) | null) {
      this.bucle = fn;
    }
    render(scene: import('three').Scene, camera: import('three').Camera) {
      // como el real: actualiza matrices antes de dibujar
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      this.dibujos++;
    }
    dispose() {
      this.liberado = true;
    }
    forceContextLoss() {
      this.contextoPerdido = true;
    }
  }
  class PMREMGenerator {
    fromScene() {
      return { texture: new real.Texture() };
    }
    dispose() {}
  }
  return { ...real, WebGLRenderer, PMREMGenerator };
});
vi.mock('./soporte.js', () => ({ hayWebGL: () => true }));

const { Odontograma3D } = await import('./Odontograma3D.js');
const { EJEMPLO_ADULTO } = await import('../datosEjemplo.js');

/* ---------- registro de manejadores en window, document y lienzos ---------- */
type Registro = { objetivo: EventTarget; tipo: string; fn: unknown };
const vivos: Registro[] = [];
const proto = EventTarget.prototype;
const addOriginal = Object.getOwnPropertyDescriptor(proto, 'addEventListener')
  ?.value as EventTarget['addEventListener'];
const removeOriginal = Object.getOwnPropertyDescriptor(proto, 'removeEventListener')
  ?.value as EventTarget['removeEventListener'];
const vigilado = (t: EventTarget) =>
  t === window || t === document || t instanceof HTMLCanvasElement;

class ResizeObserverFalso {
  static vivos = 0;
  activo = false;
  observe() {
    if (!this.activo) ResizeObserverFalso.vivos++;
    this.activo = true;
  }
  unobserve() {}
  disconnect() {
    if (this.activo) ResizeObserverFalso.vivos--;
    this.activo = false;
  }
}

beforeAll(() => {
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    tipo: string,
    fn: EventListenerOrEventListenerObject | null,
    op?: boolean | AddEventListenerOptions,
  ) {
    if (vigilado(this)) vivos.push({ objetivo: this, tipo, fn });
    addOriginal.call(this, tipo, fn, op);
  };
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    tipo: string,
    fn: EventListenerOrEventListenerObject | null,
    op?: boolean | EventListenerOptions,
  ) {
    const k = vivos.findIndex((r) => r.objetivo === this && r.tipo === tipo && r.fn === fn);
    if (k >= 0) vivos.splice(k, 1);
    removeOriginal.call(this, tipo, fn, op);
  };
  vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
  // sin contexto 2D en jsdom: las texturas de patología quedan vacías (y jsdom no avisa en cada lienzo)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  HTMLCanvasElement.prototype.setPointerCapture = () => {};
  HTMLCanvasElement.prototype.releasePointerCapture = () => {};
  HTMLCanvasElement.prototype.hasPointerCapture = () => false;
});
afterAll(() => {
  EventTarget.prototype.addEventListener = addOriginal;
  EventTarget.prototype.removeEventListener = removeOriginal;
  vi.unstubAllGlobals();
});
beforeEach(() => {
  renderers.length = 0;
});
afterEach(() => cleanup());

const props = {
  denticion: 'adulto' as const,
  estado: EJEMPLO_ADULTO,
  herramienta: 'caries' as const,
  estadoNuevo: 'por_realizar' as const,
};

describe('Odontograma3D (render simulado)', () => {
  it('montar y desmontar 20 veces no deja bucles de dibujo, contextos, manejadores ni observadores vivos', () => {
    // React registra una vez por documento sus propios manejadores (p. ej. selectionchange): se toma la base después
    render(<Odontograma3D {...props} />).unmount();
    renderers.length = 0;
    const base = vivos.length;
    for (let i = 0; i < 20; i++) {
      const v = render(<Odontograma3D {...props} denticion={i % 2 ? 'pediatrico' : 'adulto'} />);
      expect(v.container.querySelector('canvas')).not.toBeNull();
      // los rótulos entran al DOM con el primer cuadro (CSS2DRenderer)
      act(() => renderers[i]?.bucle?.(performance.now()));
      expect(v.container.querySelectorAll('.od3d-num').length).toBe(i % 2 ? 20 : 32);
      v.unmount();
    }
    expect(renderers).toHaveLength(20);
    for (const r of renderers) {
      expect(r.bucle).toBeNull();
      expect(r.liberado).toBe(true);
      expect(r.contextoPerdido).toBe(true);
      expect(r.domElement.isConnected).toBe(false);
    }
    expect(vivos.slice(base).map((r) => r.tipo)).toEqual([]);
    expect(ResizeObserverFalso.vivos).toBe(0);
  }, 120_000);

  it('dos instancias en la misma página no se pisan', () => {
    const a = render(<Odontograma3D {...props} />);
    const b = render(<Odontograma3D {...props} denticion="pediatrico" soloLectura />);
    expect(renderers).toHaveLength(2);
    const [ra, rb] = renderers as [RendererFalso, RendererFalso];
    act(() => {
      ra.bucle?.(performance.now());
      rb.bucle?.(performance.now());
    });
    expect(a.container.querySelectorAll('.od3d-num')).toHaveLength(32);
    expect(b.container.querySelectorAll('.od3d-num')).toHaveLength(20);
    a.unmount();
    expect(ra.bucle).toBeNull();
    expect(rb.bucle).not.toBeNull();
    // la otra sigue viva: recibe un estado nuevo y lo dibuja
    rb.dibujos = 0;
    b.rerender(
      <Odontograma3D
        {...props}
        denticion="pediatrico"
        soloLectura
        estado={{ 55: { car: [], ext: true, per: false, mk: [], rea: [], mov: 0 } }}
      />,
    );
    act(() => rb.bucle?.(performance.now()));
    expect(rb.dibujos).toBe(1);
    expect([...b.container.querySelectorAll('.od3d-num.is-ext')].map((e) => e.textContent)).toEqual(
      ['55'],
    );
    b.unmount();
  }, 60_000);

  it('el estado entra por props: los rótulos muestran las marcas', () => {
    const v = render(<Odontograma3D {...props} />);
    act(() => renderers[0]?.bucle?.(performance.now()));
    const num = (f: string) =>
      [...v.container.querySelectorAll('.od3d-num')].find((e) =>
        e.textContent?.startsWith(f),
      ) as HTMLElement;
    expect(num('28').classList.contains('is-ext')).toBe(true);
    expect(num('37').classList.contains('is-aus')).toBe(true);
    expect(num('16').classList.contains('is-car')).toBe(true);
    expect(num('15').className).toBe('od3d-num');
    v.rerender(
      <Odontograma3D
        {...props}
        estado={{
          ...props.estado,
          15: { car: [], ext: false, per: true, mk: [], rea: [], mov: 0 },
        }}
      />,
    );
    act(() => renderers[0]?.bucle?.(performance.now()));
    expect(num('15').classList.contains('is-per')).toBe(true);
  }, 60_000);

  it('un toque sobre un diente emite un evento y el componente no guarda nada por su cuenta', () => {
    let control: ControlOdontograma | null = null;
    const eventos: CambioOdontograma[] = [];
    const v = render(
      <Odontograma3D
        {...props}
        estado={{}}
        onCambio={(e) => eventos.push(e)}
        onControl={(c) => {
          control = c;
        }}
      />,
    );
    const lienzo = v.container.querySelector('canvas') as HTMLCanvasElement;
    lienzo.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
      right: 1000,
      bottom: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => renderers[0]?.bucle?.(performance.now()));
    const p = (control as ControlOdontograma | null)?.puntoEnPantalla(36);
    expect(p).not.toBeNull();
    const tocar = () => {
      const op = {
        clientX: p?.x ?? 0,
        clientY: p?.y ?? 0,
        isPrimary: true,
        pointerType: 'touch',
        pointerId: 1,
        bubbles: true,
      };
      lienzo.dispatchEvent(new PointerEvent('pointerdown', op));
      lienzo.dispatchEvent(new PointerEvent('pointerup', op));
    };
    tocar();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      fdi: '36',
      tipo: 'caries',
      accion: 'agregar',
      estado: 'por_realizar',
    });
    expect(['I', 'II', 'V']).toContain(eventos[0]?.clase);
    // el padre no actualizó `estado`: el segundo toque vuelve a «agregar», no quita
    tocar();
    expect(eventos[1]).toMatchObject({ fdi: '36', accion: 'agregar' });
    v.unmount();
  }, 60_000);
});
