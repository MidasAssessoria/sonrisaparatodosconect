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
 *     guardan relativos al ancho: al rotar la tablet se redibujan a la escala nueva sin perderse.
 *   - No mueve la página: `touch-action: none` en el lienzo y, por las dudas (Safari viejo),
 *     `preventDefault` en los toques que empiezan adentro.
 *   - El PNG se arma aparte, a `anchoSalida` px de ancho y con fondo transparente: no depende de la
 *     pantalla del dispositivo y queda chico (si pasa `maxCaracteres`, se achica).
 *   - Accesible: grupo con rótulo, estado escrito («Todavía no hay firma» / «Firma lista») con
 *     ícono, error asociado y, como alternativa sin dibujar, «Firmar con el teclado»: el nombre
 *     escrito se dibuja en el lienzo y sale como la misma imagen. Cada pantalla decide si la ofrece.
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
  sinLienzo:
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
  /** Ofrece «Firmar con el teclado». */
  permitirTeclado?: boolean | undefined;
  /** Nombre con el que se completa «Firmar con el teclado». */
  nombreSugerido?: string | undefined;
  textos?: Partial<TextosFirma> | undefined;
  id?: string | undefined;
  className?: string | undefined;
}

/** Punto relativo al ancho del lienzo (x, y y grosor van en «anchos»). */
interface Punto {
  x: number;
  y: number;
  g: number;
}

const GROSOR_BASE = 2.6;
const TINTA_RESPALDO = '#232036';

function dibujarTrazo(ctx: CanvasRenderingContext2D, puntos: Punto[], escala: number): void {
  const primero = puntos[0];
  if (!primero) return;
  if (puntos.length === 1) {
    ctx.beginPath();
    ctx.arc(primero.x * escala, primero.y * escala, (primero.g * escala) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < puntos.length; i++)
    dibujarTramo(ctx, puntos, i, escala, i === puntos.length - 1);
}

/**
 * Tramo que termina en el punto `i`: curva desde el punto medio anterior hasta el medio actual con
 * control en el punto `i - 1` (suaviza el trazo sin retrasarlo). El último llega hasta el punto.
 */
function dibujarTramo(
  ctx: CanvasRenderingContext2D,
  puntos: Punto[],
  i: number,
  escala: number,
  ultimo: boolean,
): void {
  const a = puntos[i - 2];
  const b = puntos[i - 1];
  const c = puntos[i];
  if (!b || !c) return;
  const desde = a ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : b;
  const hasta = ultimo ? c : { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  ctx.lineWidth = ((b.g + c.g) / 2) * escala;
  ctx.beginPath();
  ctx.moveTo(desde.x * escala, desde.y * escala);
  ctx.quadraticCurveTo(b.x * escala, b.y * escala, hasta.x * escala, hasta.y * escala);
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
  permitirTeclado = true,
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

  /** Dibuja todo (trazos, nombre escrito, imagen de fondo) a `escala` px por ancho. */
  const pintar = useCallback(
    (ctx: CanvasRenderingContext2D, escala: number, altoPx: number) => {
      const fondo = imagenFondo.current;
      if (fondo && fondo.naturalWidth > 0) {
        ctx.drawImage(fondo, 0, 0, escala, (fondo.naturalHeight / fondo.naturalWidth) * escala);
      }
      prepararTinta(ctx, color());
      const texto = textoFirma.current;
      if (texto) {
        const tamano = Math.min(altoPx * 0.38, (escala * 1.6) / Math.max(texto.length, 8));
        ctx.font = `italic 600 ${tamano}px "Hanken Grotesk", system-ui, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(texto, escala * 0.05, altoPx * 0.68, escala * 0.9);
      }
      for (const trazo of trazos.current) dibujarTrazo(ctx, trazo, escala);
    },
    [color],
  );

  /** Ajusta el lienzo al ancho del contenedor y a la densidad de la pantalla, y redibuja. */
  const ajustar = useCallback(() => {
    const lienzo = refLienzo.current;
    if (!lienzo) return;
    const medido = refCaja.current?.getBoundingClientRect().width ?? 0;
    const w = medido > 0 ? medido : 320;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
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
    pintar(ctx, w, alto);
  }, [alto, pintar]);

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

  /** PNG a `anchoSalida`, achicándolo si el data URL se pasa de `maxCaracteres`. */
  const exportar = useCallback((): string | null => {
    const w = ancho.current || 320;
    let salida = anchoSalida;
    for (let intento = 0; intento < 4; intento++) {
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(salida);
      lienzo.height = Math.round((salida * alto) / w);
      const ctx = contexto2d(lienzo);
      if (!ctx) return null;
      pintar(ctx, lienzo.width, lienzo.height);
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
  }, [alto, anchoSalida, maxCaracteres, pintar]);

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
    setHayFirma(false);
    ajustar();
  }, [ajustar]);

  // `valor` desde afuera: null borra; un PNG con el lienzo vacío se dibuja de fondo.
  useEffect(() => {
    if (valor === undefined) return;
    const vacio = !trazos.current.length && !textoFirma.current && !imagenFondo.current;
    if (valor === null) {
      if (!vacio || hayFirma) limpiar();
      return;
    }
    if (!vacio || typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => {
      imagenFondo.current = img;
      setHayFirma(true);
      ajustar();
    };
    img.src = valor;
  }, [valor, hayFirma, limpiar, ajustar]);

  function punto(e: { clientX: number; clientY: number; pressure: number; pointerType: string }) {
    const lienzo = refLienzo.current;
    const r = lienzo?.getBoundingClientRect();
    const w = ancho.current || r?.width || 320;
    const x = e.clientX - (r?.left ?? 0);
    const y = e.clientY - (r?.top ?? 0);
    const presion = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    const g = (GROSOR_BASE * (0.55 + presion * 0.9)) / w;
    return { x: x / w, y: y / w, g };
  }

  const contexto = () => (refLienzo.current ? contexto2d(refLienzo.current) : null);

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
    const p = punto(e);
    actual.current = { puntero: e.pointerId, puntos: [p] };
    const ctx = contexto();
    if (ctx) {
      prepararTinta(ctx, color());
      dibujarTrazo(ctx, [p], ancho.current || 320);
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
    const ctx = contexto();
    if (ctx) prepararTinta(ctx, color());
    for (const p of nuevos) {
      trazo.puntos.push(p);
      if (ctx)
        dibujarTramo(ctx, trazo.puntos, trazo.puntos.length - 1, ancho.current || 320, false);
    }
  }

  function alSoltar(e: EventoPuntero<HTMLCanvasElement>) {
    const trazo = actual.current;
    if (!trazo || trazo.puntero !== e.pointerId) return;
    actual.current = null;
    trazos.current = [...trazos.current, trazo.puntos];
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
          {t.sinLienzo}
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
