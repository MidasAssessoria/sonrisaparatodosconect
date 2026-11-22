/**
 * Odontograma 3D como componente controlado: el estado entra por props y cada toque sale como
 * evento. El componente no guarda nada: si el padre no actualiza `estado`, el diente no cambia.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { MotorOdontograma, type MedicionGiro, type Metricas, type Vista } from './motor.js';
import {
  info,
  type ClaseElegida,
  type Denticion,
  type EstadoHallazgo,
  type EstadoOdontograma,
  type Herramienta,
} from './modelo.js';
import { resolverToque, type CambioOdontograma, type Toque } from './reglas.js';
import { hayWebGL } from './soporte.js';
import './odontograma3d.css';

export interface PropsOdontograma3D {
  denticion: Denticion;
  /** fdi → marcas (modelo de la maqueta; se normaliza con `normM` al leerlo). */
  estado: EstadoOdontograma;
  herramienta: Herramienta;
  /** Estado con que nacen los hallazgos nuevos. */
  estadoNuevo: EstadoHallazgo;
  /** Clase de Black: «auto» la deduce de la cara tocada; una clase fija se valida contra el diente. */
  claseCaries?: ClaseElegida | undefined;
  vista?: Vista | undefined;
  soloLectura?: boolean | undefined;
  /** Rótulos de lado dentro de la escena (siguen la vista; útil en la vista palatina/lingual). */
  rotulosLado?: boolean | undefined;
  /** Un evento por toque que cambia algo. */
  onCambio?: ((evento: CambioOdontograma) => void) | undefined;
  /** Toque que no cambia nada, con el motivo («La clase II es para premolares y molares»). */
  onRechazo?: ((mensaje: string, fdi: string) => void) | undefined;
  /** Pulsación larga en edición; toque simple en solo lectura. */
  onElegirDiente?: ((fdi: string) => void) | undefined;
  /** Milisegundos hasta el primer cuadro (medición). */
  onPrimerCuadro?: ((ms: number) => void) | undefined;
  /** Control del motor mientras está montado (centrar, mediciones); `null` al desmontar. */
  onControl?: ((control: ControlOdontograma | null) => void) | undefined;
  etiqueta?: string | undefined;
  className?: string | undefined;
}

/** Lo que el padre puede pedirle al visor sin pasar por el estado. */
export interface ControlOdontograma {
  centrar(): void;
  metricas(): Metricas;
  medirGiro(ms?: number): Promise<MedicionGiro>;
  /** Costo por cuadro dibujando de forma sincrónica (no depende del ritmo de requestAnimationFrame). */
  medirCosto(n?: number): { msPorCuadro: number; fpsPosible: number };
  /** Dónde se ve un diente en pantalla (para pruebas de punta a punta). */
  puntoEnPantalla(fdi: number, gemelo?: boolean): { x: number; y: number } | null;
}

export function Odontograma3D(props: PropsOdontograma3D): ReactElement {
  const {
    denticion,
    estado,
    herramienta,
    vista = 'completo',
    soloLectura = false,
    className,
    etiqueta,
  } = props;
  const contRef = useRef<HTMLDivElement>(null);
  const motorRef = useRef<MotorOdontograma | null>(null);
  const ultimas = useRef(props);
  const [webgl] = useState(hayWebGL);

  useLayoutEffect(() => {
    ultimas.current = props;
  });

  // Un motor por montaje. Las props iniciales se leen de `ultimas`; los cambios llegan por los efectos de abajo.
  useEffect(() => {
    const cont = contRef.current;
    if (!cont || !webgl) return;
    const p = ultimas.current;
    const alTocar = (t: Toque) => {
      const q = ultimas.current;
      const r = resolverToque(q.estado[String(t.fdi)], info(t.fdi), t, {
        herramienta: q.herramienta,
        estadoNuevo: q.estadoNuevo,
        clase: q.claseCaries ?? 'auto',
      });
      if (r.tipo === 'rechazo') {
        q.onRechazo?.(r.mensaje, r.fdi);
        return;
      }
      if (r.evento.tipo === 'caries' && r.evento.accion === 'agregar' && r.evento.cara)
        motor.destellar(t.fdi, r.evento.cara);
      q.onCambio?.(r.evento);
    };
    const motor = new MotorOdontograma(cont, {
      denticion: p.denticion,
      vista: p.vista ?? 'completo',
      estado: p.estado,
      herramienta: p.herramienta,
      soloLectura: !!p.soloLectura,
      rotulosLado: !!p.rotulosLado,
      alTocar,
      alElegir: (fdi) => ultimas.current.onElegirDiente?.(String(fdi)),
      alPrimerCuadro: (ms) => ultimas.current.onPrimerCuadro?.(ms),
    });
    motorRef.current = motor;
    p.onControl?.({
      centrar: () => motor.centrar(),
      metricas: () => motor.metricas(),
      medirGiro: (ms) => motor.medirGiro(ms),
      medirCosto: (n) => motor.medirCosto(n),
      puntoEnPantalla: (fdi, gemelo) => motor.puntoEnPantalla(fdi, gemelo),
    });
    return () => {
      ultimas.current.onControl?.(null);
      motor.dispose();
      motorRef.current = null;
    };
  }, [webgl]);

  useEffect(() => motorRef.current?.setEstado(estado), [estado]);
  useEffect(() => motorRef.current?.setDenticion(denticion), [denticion]);
  useEffect(() => motorRef.current?.setVista(vista), [vista]);
  useEffect(() => motorRef.current?.setHerramienta(herramienta), [herramienta]);
  useEffect(() => motorRef.current?.setSoloLectura(soloLectura), [soloLectura]);

  const texto =
    etiqueta ??
    `Odontograma 3D, dentición ${denticion === 'adulto' ? 'permanente 11 a 48' : 'temporal 51 a 85'}`;
  if (!webgl)
    return (
      <div className={['od3d', 'od3d--sin-webgl', className].filter(Boolean).join(' ')} role="note">
        <p>Este equipo no puede mostrar el odontograma 3D. Usá la vista 2D de la ficha.</p>
      </div>
    );
  return (
    <div
      ref={contRef}
      className={['od3d', soloLectura && 'od3d--lectura', className].filter(Boolean).join(' ')}
      role="application"
      aria-label={texto}
      aria-roledescription="odontograma 3D"
    />
  );
}

export type { CambioOdontograma, MedicionGiro, Metricas, Vista };
