import { useCallback, useEffect, useRef, useState } from 'react';
import { claveCompleta, claves, leerActividad, marcarActividad } from './preferencias.js';

const EVENTOS_ACTIVIDAD = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/** Cada cuánto se revisa el tiempo sin actividad. */
const TICK_MS = 1000;
/** Para no escribir en localStorage con cada tecla. */
const ESCRITURA_MIN_MS = 5000;

interface Opciones {
  minutos: number;
  activo: boolean;
  alCerrar: () => void;
}

/**
 * Cierre por inactividad sincronizado entre pestañas: la última actividad de cualquier pestaña
 * se comparte en `localStorage` (`conecta.actividad`, solo un número de milisegundos).
 * Un minuto antes del cierre se muestra el aviso; mientras está visible, la actividad pasiva
 * no cuenta: hay que tocar «Seguir conectado».
 *
 * Al montar NO pisa la marca guardada: parte de la última actividad registrada (de esta u otra
 * pestaña). Así recargar la página o reabrir el navegador no reinicia la cuenta. El ingreso con
 * contraseña es el que marca «ahora» (`ProveedorSesion.ingresar`).
 */
export function useInactividad({ minutos, activo, alCerrar }: Opciones) {
  const [aviso, setAviso] = useState(false);
  const refUltima = useRef(0);
  const refEscrita = useRef(0);
  const refAviso = useRef(false);
  const refCerrar = useRef(alCerrar);
  useEffect(() => {
    refCerrar.current = alCerrar;
  }, [alCerrar]);

  const registrar = useCallback((forzar: boolean) => {
    const ahora = Date.now();
    refUltima.current = ahora;
    if (forzar || ahora - refEscrita.current >= ESCRITURA_MIN_MS) {
      refEscrita.current = ahora;
      marcarActividad(ahora);
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    const guardada = leerActividad();
    if (guardada !== null && guardada <= Date.now()) refUltima.current = guardada;
    else registrar(true);
    refAviso.current = false;
    let cerrada = false;
    const limite = minutos * 60_000;
    const umbralAviso = Math.max(0, minutos - 1) * 60_000;

    const alActuar = () => {
      if (!refAviso.current) registrar(false);
    };
    const alAlmacenar = (e: StorageEvent) => {
      if (e.key !== claveCompleta(claves.actividad) || !e.newValue) return;
      const v = Number(e.newValue);
      if (Number.isFinite(v) && v > refUltima.current) refUltima.current = v;
    };
    const revisar = () => {
      if (cerrada) return;
      const compartida = leerActividad();
      if (compartida !== null && compartida > refUltima.current) refUltima.current = compartida;
      const transcurrido = Date.now() - refUltima.current;
      if (transcurrido >= limite) {
        cerrada = true;
        refAviso.current = false;
        setAviso(false);
        refCerrar.current();
        return;
      }
      const mostrar = transcurrido >= umbralAviso;
      if (mostrar !== refAviso.current) {
        refAviso.current = mostrar;
        setAviso(mostrar);
      }
    };

    for (const ev of EVENTOS_ACTIVIDAD) {
      window.addEventListener(ev, alActuar, { capture: true, passive: true });
    }
    window.addEventListener('storage', alAlmacenar);
    const intervalo = window.setInterval(revisar, TICK_MS);
    return () => {
      for (const ev of EVENTOS_ACTIVIDAD) {
        window.removeEventListener(ev, alActuar, { capture: true });
      }
      window.removeEventListener('storage', alAlmacenar);
      window.clearInterval(intervalo);
    };
  }, [activo, minutos, registrar]);

  const seguir = useCallback(() => {
    registrar(true);
    refAviso.current = false;
    setAviso(false);
  }, [registrar]);

  return { aviso, seguir };
}
