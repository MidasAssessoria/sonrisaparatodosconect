import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as EventoPuntero,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx } from '../utilidades.js';
import { Boton } from './Boton.js';
import { Icono } from './Icono.js';

/*
 * Firma manuscrita: lienzo para firmar con el dedo, el lápiz o el mouse (anamnesis,
 * consentimientos, recetas). Sale un PNG en data URL («data:image/png;base64,…») cada vez que se
 * termina un trazo, o `null` al borrar.
 *
 *   - Eventos de puntero con captura: el trazo sigue aunque el dedo salga del recuadro. Usa los
 *     eventos «coalesced» (más puntos por cuadro en lápices rápidos) y dibuja curvas suaves entre
 *     los puntos medios; con lápiz, la presión cambia el grosor.
 *   - Alta densidad: el lienzo mide lo que ocupa en pantalla por `devicePixelRatio`. Los trazos se
 *     guardan en una caja de referencia: al rotar la tablet la caja entera se encaja centrada y sin
 *     deformar (nada se recorta), y el PNG sale siempre de la caja completa.
 *   - No mueve la página: `touch-action: none` en el lienzo y, por las dudas (Safari viejo),
 *     `preventDefault` en los toques que empiezan adentro.
 *   - El PNG se arma aparte, a `anchoSalida` px de ancho y con fondo transparente: no depende de la
 *     pantalla del dispositivo y queda chico (si pasa `maxCaracteres`, se achica).
 *   - Accesible: grupo con rótulo, estado escrito («Todavía no hay firma» / «Firma lista») con
 *     ícono y error asociado. «Firmar con el teclado» (el nombre escrito se dibuja y sale como la
 *     misma imagen) es opt-in con `permitirTeclado`: hasta que el cliente responda P5, las firmas
 *     de pacientes van siempre dibujadas.
 *   - Sin nada dibujado no sale PNG: «Borrar» y una firma vacía avisan `null`.
 */

export interface TextosFirma {
  instruccion: string;
  area: string;
  vacia: string;
  lista: string;
  borrar: string;
  teclado: string;
  tecladoEtiqueta: string;
  tecladoUsar: string;
  tecladoCancelar: string;
  tecladoFalta: string;
  sinLienzo: string;
  sinLienzoTeclado: string;
}

const TEXTOS: TextosFirma = {
  instruccion: 'Firmá con el dedo o con el lápiz dentro del recuadro.',
  area: 'Recuadro para firmar',
  vacia: 'Todavía no hay firma',
  lista: 'Firma lista',
  borrar: 'Borrar',
  teclado: 'Firmar con el teclado',
  tecladoEtiqueta: 'Escribí el nombre completo de quien firma',
  tecladoUsar: 'Usar como firma',
  tecladoCancelar: 'Cancelar',
  tecladoFalta: 'Escribí el nombre para usarlo como firma.',
  sinLienzo: 'Este dispositivo no permite dibujar la firma. Probá con otro dispositivo.',
  sinLienzoTeclado:
    'Este dispositivo no permite dibujar la firma. Usá «Firmar con el teclado» u otro dispositivo.',
};

export interface FirmaManuscritaProps {
  /** Rótulo visible, p. ej. «Firma del paciente». */
  etiqueta: ReactNode;
  /** Se llama al terminar cada trazo con el PNG completo, y con `null` al borrar. */
  onCambio: (png: string | null) => void;
  /**
   * `null` desde afuera borra el lienzo (sin volver a llamar a `onCambio`). Un PNG se dibuja de
   * fondo si el lienzo está vacío (p. ej. al volver a montar un formulario). Sin valor: libre.
   */
  valor?: string | null | undefined;
  ayuda?: ReactNode;
  error?: ReactNode;
  /** Alto del recuadro en px de pantalla (el ancho es el del contenedor). */
  alto?: number | undefined;
  /** Ancho del PNG que sale, en px. */
  anchoSalida?: number | undefined;
  /** Largo máximo del data URL; si se pasa, el PNG se rehace más chico. */
  maxCaracteres?: number | undefined;
  deshabilitado?: boolean | undefined;
  /** Ofrece «Firmar con el teclado» (por defecto no: ver P5 en docs/plan.md). */
  permitirTeclado?: boolean | undefined;
  /** Nombre con el que se completa «Firmar con el teclado». */
  nombreSugerido?: string | undefined;
  textos?: Partial<TextosFirma> | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

/** Punto en coordenadas de la caja de referencia (x, y y grosor en px de esa caja). */
interface Punto {
  x: number;
  y: number;
  g: number;
}

const GROSOR_BASE = 2.6;
const TINTA_RESPALDO = '#232036';

/**
 * Caja de referencia de la firma, en px de pantalla del momento en que se trazó. Los puntos se
 * guardan en estas coordenadas; para dibujar se encaja la caja entera, centrada y sin deformar, en
 * el lienzo de ahora (al rotar la tablet nada se recorta ni se estira).
 */
interface Caja {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Escala y desplazamiento que encajan `caja` (entera y centrada) en un lienzo de `w × h`. */
function encaje(caja: Caja, w: number, h: number): { s: number; dx: number; dy: number } {
  const s = Math.min(w / caja.w, h / caja.h);
  return {
    s,
    dx: (w - caja.w * s) / 2 - caja.x0 * s,
    dy: (h - caja.h * s) / 2 - caja.y0 * s,
  };
}

/** Lo que se ve ahora del lienzo, en coordenadas de la caja (siempre contiene a la caja). */
function visible(caja: Caja, w: number, h: number): Caja {
  const { s, dx, dy } = encaje(caja, w, h);
  return { x0: -dx / s, y0: -dy / s, w: w / s, h: h / s };
}

function dibujarTrazo(ctx: CanvasRenderingContext2D, puntos: Punto[]): void {
  const primero = puntos[0];
  if (!primero) return;
  if (puntos.length === 1) {
    ctx.beginPath();
    ctx.arc(primero.x, primero.y, primero.g / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < puntos.length; i++) dibujarTramo(ctx, puntos, i, i === puntos.length - 1);
}

/**
 * Tramo que termina en el punto `i`: curva desde el punto medio anterior hasta el medio actual con
 * control en el punto `i - 1` (suaviza el trazo sin retrasarlo). El último llega hasta el punto.
 */
function dibujarTramo(
  ctx: CanvasRenderingContext2D,
  puntos: Punto[],
  i: number,
  ultimo: boolean,
): void {
  const a = puntos[i - 2];
  const b = puntos[i - 1];
  const c = puntos[i];
  if (!b || !c) return;
  const desde = a ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : b;
  const hasta = ultimo ? c : { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  ctx.lineWidth = (b.g + c.g) / 2;
  ctx.beginPath();
  ctx.moveTo(desde.x, desde.y);
  ctx.quadraticCurveTo(b.x, b.y, hasta.x, hasta.y);
  ctx.stroke();
}

/** Contexto 2D, o `null` si el navegador no lo da (o lo niega, p. ej. por privacidad). */
function contexto2d(lienzo: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return lienzo.getContext('2d');
  } catch {
    return null;
  }
}

function prepararTinta(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

const densidad = () =>
  typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;

export function FirmaManuscrita({
  etiqueta,
  onCambio,
  valor,
  ayuda,
  error,
  alto = 200,
  anchoSalida = 900,
  maxCaracteres = 400_000,
  deshabilitado,
  // Opt-in: una firma escrita con el teclado no es una firma dibujada. Hasta que el cliente
  // responda P5 (docs/plan.md §7), las firmas de pacientes (anamnesis, consentimientos) van
  // siempre dibujadas y la API rechaza un PNG sin trazo.
  permitirTeclado = false,
  nombreSugerido,
  textos,
  id,
  className,
}: FirmaManuscritaProps): ReactElement {
  const t = { ...TEXTOS, ...textos };
  const idAuto = useId();
  const base = id ?? idAuto;
  const idEtiqueta = `${base}-etiqueta`;
  const idAyuda = `${base}-ayuda`;
  const idEstado = `${base}-estado`;
  const idError = `${base}-error`;
  const idTeclado = `${base}-teclado`;

  const refLienzo = useRef<HTMLCanvasElement>(null);
  const refCaja = useRef<HTMLDivElement>(null);
  const trazos = useRef<Punto[][]>([]);
  const actual = useRef<{ puntero: number; puntos: Punto[] } | null>(null);
  const textoFirma = useRef<string | null>(null);
  const imagenFondo = useRef<HTMLImageElement | null>(null);
  /** Caja de referencia (`null` = todavía no se dibujó nada). */
  const referencia = useRef<Caja | null>(null);
  /** Ancho en px de pantalla con el que se dibuja ahora. */
  const ancho = useRef(0);
  const refCambio = useRef(onCambio);
  useEffect(() => {
    refCambio.current = onCambio;
  });

  const [hayFirma, setHayFirma] = useState(false);
  const [sinLienzo, setSinLienzo] = useState(false);
  const [tecleando, setTecleando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [faltaNombre, setFaltaNombre] = useState(false);
  const refNombre = useRef<HTMLInputElement>(null);
  // Al abrir «Firmar con el teclado», el foco va al nombre.
  useEffect(() => {
    if (tecleando) refNombre.current?.focus();
  }, [tecleando]);

  const color = useCallback((): string => {
    const lienzo = refLienzo.current;
    if (!lienzo || typeof getComputedStyle !== 'function') return TINTA_RESPALDO;
    return getComputedStyle(lienzo).color || TINTA_RESPALDO;
  }, []);

  const vacia = () => !trazos.current.length && !textoFirma.current && !imagenFondo.current;

  /** La caja de referencia; si no hay, la de la pantalla de ahora. */
  const cajaActual = useCallback(
    (): Caja => referencia.current ?? { x0: 0, y0: 0, w: ancho.current || 320, h: alto },
    [alto],
  );

  /** Dibuja todo (imagen de fondo, nombre escrito, trazos) en coordenadas de la caja. */
  const pintar = useCallback(
    (ctx: CanvasRenderingContext2D, caja: Caja) => {
      const fondo = imagenFondo.current;
      if (fondo && fondo.naturalWidth > 0) {
        ctx.drawImage(
          fondo,
          caja.x0,
          caja.y0,
          caja.w,
          (fondo.naturalHeight / fondo.naturalWidth) * caja.w,
        );
      }
      prepararTinta(ctx, color());
      const texto = textoFirma.current;
      if (texto) {
        const tamano = Math.min(caja.h * 0.38, (caja.w * 1.6) / Math.max(texto.length, 8));
        ctx.font = `italic 600 ${tamano}px "Hanken Grotesk", system-ui, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(texto, caja.x0 + caja.w * 0.05, caja.y0 + caja.h * 0.68, caja.w * 0.9);
      }
      for (const trazo of trazos.current) dibujarTrazo(ctx, trazo);
    },
    [color],
  );

  /** Contexto del lienzo en pantalla con la transformación de la caja a la pantalla de ahora. */
  const contextoEnPantalla = useCallback((): CanvasRenderingContext2D | null => {
    const lienzo = refLienzo.current;
    const ctx = lienzo ? contexto2d(lienzo) : null;
    if (!ctx) return null;
    const dpr = densidad();
    const { s, dx, dy } = encaje(cajaActual(), ancho.current || 320, alto);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * dx, dpr * dy);
    return ctx;
  }, [alto, cajaActual]);

  /** Ajusta el lienzo al ancho del contenedor y a la densidad de la pantalla, y redibuja todo. */
  const ajustar = useCallback(() => {
    const lienzo = refLienzo.current;
    if (!lienzo) return;
    const medido = refCaja.current?.getBoundingClientRect().width ?? 0;
    const w = medido > 0 ? medido : 320;
    const dpr = densidad();
    ancho.current = w;
    lienzo.width = Math.round(w * dpr);
    lienzo.height = Math.round(alto * dpr);
    const ctx = contexto2d(lienzo);
    if (!ctx) {
      setSinLienzo(true);
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, alto);
    if (vacia()) return;
    const caja = cajaActual();
    const { s, dx, dy } = encaje(caja, w, alto);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * dx, dpr * dy);
    pintar(ctx, caja);
  }, [alto, pintar, cajaActual]);

  useLayoutEffect(() => {
    ajustar();
    const caja = refCaja.current;
    if (typeof ResizeObserver !== 'undefined' && caja) {
      let previo = caja.getBoundingClientRect().width;
      const observador = new ResizeObserver(() => {
        const w = caja.getBoundingClientRect().width;
        if (Math.abs(w - previo) >= 1) {
          previo = w;
          ajustar();
        }
      });
      observador.observe(caja);
      return () => observador.disconnect();
    }
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, [ajustar]);

  // Safari viejo no respeta `touch-action`: el toque que empieza en el lienzo no mueve la página.
  useEffect(() => {
    const lienzo = refLienzo.current;
    if (!lienzo) return;
    const frenar = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    lienzo.addEventListener('touchstart', frenar, { passive: false });
    lienzo.addEventListener('touchmove', frenar, { passive: false });
    return () => {
      lienzo.removeEventListener('touchstart', frenar);
      lienzo.removeEventListener('touchmove', frenar);
    };
  }, []);

  /**
   * PNG de la caja entera a `anchoSalida` px de ancho, achicándolo si el data URL se pasa de
   * `maxCaracteres`. Sin nada dibujado no hay PNG (una firma vacía no es una firma).
   */
  const exportar = useCallback((): string | null => {
    if (vacia()) return null;
    const caja = cajaActual();
    let salida = anchoSalida;
    for (let intento = 0; intento < 4; intento++) {
      const lienzo = document.createElement('canvas');
      const escala = salida / caja.w;
      lienzo.width = Math.round(salida);
      lienzo.height = Math.round(caja.h * escala);
      const ctx = contexto2d(lienzo);
      if (!ctx) return null;
      ctx.setTransform(escala, 0, 0, escala, -caja.x0 * escala, -caja.y0 * escala);
      pintar(ctx, caja);
      let png: string;
      try {
        png = lienzo.toDataURL('image/png');
      } catch {
        return null;
      }
      if (png.length <= maxCaracteres) return png;
      salida *= 0.7;
    }
    return null;
  }, [anchoSalida, maxCaracteres, pintar, cajaActual]);

  const avisar = useCallback(() => {
    const png = exportar();
    setHayFirma(png !== null);
    refCambio.current(png);
  }, [exportar]);

  const limpiar = useCallback(() => {
    trazos.current = [];
    actual.current = null;
    textoFirma.current = null;
    imagenFondo.current = null;
    referencia.current = null;
    setHayFirma(false);
    ajustar();
  }, [ajustar]);

  // `valor` null desde afuera: el estado cambia en el render (sin efecto) y el lienzo se vacía en
  // el efecto de abajo, sin volver a avisar.
  const [valorPrevio, setValorPrevio] = useState(valor);
  if (valor !== valorPrevio) {
    setValorPrevio(valor);
    if (valor === null && hayFirma) setHayFirma(false);
  }

  // Un PNG con el lienzo vacío se dibuja de fondo.
  useEffect(() => {
    if (valor === undefined) return;
    if (valor === null) {
      if (!vacia()) {
        trazos.current = [];
        actual.current = null;
        textoFirma.current = null;
        imagenFondo.current = null;
        referencia.current = null;
        ajustar();
      }
      return;
    }
    if (!vacia() || typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => {
      referencia.current ??= cajaActual();
      imagenFondo.current = img;
      setHayFirma(true);
      ajustar();
    };
    img.src = valor;
  }, [valor, ajustar, cajaActual]);

  /** Punto de un evento, en coordenadas de la caja. */
  function punto(e: { clientX: number; clientY: number; pressure: number; pointerType: string }) {
    const r = refLienzo.current?.getBoundingClientRect();
    const { s, dx, dy } = encaje(cajaActual(), ancho.current || 320, alto);
    const x = e.clientX - (r?.left ?? 0);
    const y = e.clientY - (r?.top ?? 0);
    const presion = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return { x: (x - dx) / s, y: (y - dy) / s, g: (GROSOR_BASE * (0.55 + presion * 0.9)) / s };
  }

  function alBajar(e: EventoPuntero<HTMLCanvasElement>) {
    if (deshabilitado || sinLienzo) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (actual.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // sin captura: igual dibuja mientras el puntero esté adentro
    }
    // La caja crece hasta lo que se ve ahora (tras rotar, el lienzo puede mostrar más): así el
    // trazo nuevo nunca queda afuera del PNG. Lo ya dibujado no se mueve en pantalla.
    referencia.current = visible(cajaActual(), ancho.current || 320, alto);
    const p = punto(e);
    actual.current = { puntero: e.pointerId, puntos: [p] };
    const ctx = contextoEnPantalla();
    if (ctx) {
      prepararTinta(ctx, color());
      dibujarTrazo(ctx, [p]);
    }
  }

  function alMover(e: EventoPuntero<HTMLCanvasElement>) {
    const trazo = actual.current;
    if (!trazo || trazo.puntero !== e.pointerId) return;
    e.preventDefault();
    const nativo = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const eventos = nativo.getCoalescedEvents?.() ?? [];
    const nuevos = (eventos.length ? eventos : [nativo]).map((ev) =>
      punto({
        clientX: ev.clientX,
        clientY: ev.clientY,
        pressure: ev.pressure,
        pointerType: ev.pointerType || e.pointerType,
      }),
    );
    const ctx = contextoEnPantalla();
    if (ctx) prepararTinta(ctx, color());
    for (const p of nuevos) {
      trazo.puntos.push(p);
      if (ctx) dibujarTramo(ctx, trazo.puntos, trazo.puntos.length - 1, false);
    }
  }

  function alSoltar(e: EventoPuntero<HTMLCanvasElement>) {
    const trazo = actual.current;
    if (!trazo || trazo.puntero !== e.pointerId) return;
    actual.current = null;
    if (trazo.puntos.length) trazos.current = [...trazos.current, trazo.puntos];
    // Redibuja todo: el último tramo llega hasta el punto final.
    ajustar();
    avisar();
  }

  function usarNombre() {
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    if (limpio.length < 2) {
      setFaltaNombre(true);
      return;
    }
    trazos.current = [];
    imagenFondo.current = null;
    referencia.current = { x0: 0, y0: 0, w: ancho.current || 320, h: alto };
    textoFirma.current = limpio;
    setTecleando(false);
    setFaltaNombre(false);
    ajustar();
    avisar();
  }

  const hayError = error != null && error !== false && error !== '';
  const describe = [idAyuda, idEstado, hayError ? idError : null].filter(Boolean).join(' ');

  return (
    <div
      className={cx(
        'cn-firma',
        hayError && 'is-error',
        deshabilitado && 'is-deshabilitada',
        className,
      )}
      role="group"
      aria-labelledby={idEtiqueta}
      aria-describedby={describe}
    >
      <span id={idEtiqueta} className="cn-firma__etiqueta">
        {etiqueta}
      </span>
      <p id={idAyuda} className="cn-firma__ayuda">
        {ayuda ?? t.instruccion}
      </p>
      <div ref={refCaja} className="cn-firma__caja" style={{ height: alto }}>
        <canvas
          ref={refLienzo}
          className="cn-firma__lienzo"
          role="img"
          aria-label={`${t.area}: ${hayFirma ? t.lista : t.vacia}`}
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          onContextMenu={(e) => e.preventDefault()}
        />
        <span className="cn-firma__linea" aria-hidden={true} />
      </div>
      <div className="cn-firma__pie">
        <p
          id={idEstado}
          className={cx('cn-firma__estado', hayFirma && 'cn-firma__estado--lista')}
          role="status"
        >
          <Icono nombre={hayFirma ? 'check' : 'info'} tamano={18} />
          <span>{hayFirma ? t.lista : t.vacia}</span>
        </p>
        <div className="cn-firma__acciones">
          {permitirTeclado && !tecleando ? (
            <Boton
              variante="fantasma"
              disabled={deshabilitado}
              onClick={() => {
                setNombre((n) => n || nombreSugerido || '');
                setFaltaNombre(false);
                setTecleando(true);
              }}
            >
              {t.teclado}
            </Boton>
          ) : null}
          <Boton
            variante="secundario"
            icono="cerrar"
            disabled={deshabilitado || !hayFirma}
            onClick={() => {
              limpiar();
              refCambio.current(null);
            }}
          >
            {t.borrar}
          </Boton>
        </div>
      </div>
      {sinLienzo ? (
        <p className="cn-firma__ayuda" role="note">
          {permitirTeclado ? t.sinLienzoTeclado : t.sinLienzo}
        </p>
      ) : null}
      {permitirTeclado && tecleando ? (
        <div id={idTeclado} className="cn-firma__teclado">
          <label htmlFor={`${idTeclado}-nombre`} className="cn-firma__etiqueta">
            {t.tecladoEtiqueta}
          </label>
          <input
            ref={refNombre}
            id={`${idTeclado}-nombre`}
            className="cn-campo__control"
            value={nombre}
            maxLength={120}
            autoComplete="off"
            aria-invalid={faltaNombre || undefined}
            aria-describedby={faltaNombre ? `${idTeclado}-falta` : undefined}
            onChange={(e) => {
              setNombre(e.target.value);
              setFaltaNombre(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                usarNombre();
              }
            }}
          />
          {faltaNombre ? (
            <p id={`${idTeclado}-falta`} className="cn-firma__error">
              <Icono nombre="alerta" tamano={18} />
              <span>{t.tecladoFalta}</span>
            </p>
          ) : null}
          <div className="cn-firma__acciones">
            <Boton variante="secundario" onClick={() => setTecleando(false)}>
              {t.tecladoCancelar}
            </Boton>
            <Boton variante="secundario" icono="check" onClick={usarNombre}>
              {t.tecladoUsar}
            </Boton>
          </div>
        </div>
      ) : null}
      {hayError ? (
        <p id={idError} className="cn-firma__error">
          <Icono nombre="alerta" tamano={18} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
