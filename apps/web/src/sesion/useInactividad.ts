import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claveCompleta,
  claves,
  leerActividad,
  leerAvisoApi,
  marcarActividad,
  marcarAvisoApi,
} from './preferencias.js';

const EVENTOS_ACTIVIDAD = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
/** Cada cuánto se revisa el tiempo sin actividad. */
const TICK_MS = 1000;
/** Para no escribir en localStorage con cada tecla. */
const ESCRITURA_MIN_MS = 5000;
/** Como mucho un aviso de actividad a la API por minuto, entre todas las pestañas. */
export const AVISO_API_MIN_MS = 60_000;

interface Opciones {
  minutos: number;
  activo: boolean;
  alCerrar: () => void;
  /**
   * Avisa a la API que hay actividad (renueva la sesión del lado del servidor). Se llama solo
   * por actividad real del usuario, como mucho una vez por minuto entre todas las pestañas, y
   * enseguida con «Seguir conectado». Sin actividad no se llama: así la sesión puede vencer.
   */
  alAvisarApi?: () => void;
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
 *
 * La API mide la inactividad por pedidos recibidos: con actividad en la interfaz pero sin
 * pedidos (p. ej. llenando un formulario largo) cerraría la sesión. Por eso la actividad también
 * dispara `alAvisarApi`, coordinado entre pestañas con `conecta.aviso-api`.
 */
export function useInactividad({ minutos, activo, alCerrar, alAvisarApi }: Opciones) {
  const [aviso, setAviso] = useState(false);
  const refUltima = useRef(0);
  const refEscrita = useRef(0);
  const refAviso = useRef(false);
  const refCerrar = useRef(alCerrar);
  const refAvisarApi = useRef(alAvisarApi);
  /** Último aviso a la API conocido por esta pestaña (por si no hay almacenamiento). */
  const refAvisoApi = useRef(0);
  useEffect(() => {
    refCerrar.current = alCerrar;
    refAvisarApi.current = alAvisarApi;
  }, [alCerrar, alAvisarApi]);

  const avisarApi = useCallback((forzar: boolean) => {
    const avisar = refAvisarApi.current;
    if (!avisar) return;
    const ahora = Date.now();
    const ultimo = Math.max(refAvisoApi.current, leerAvisoApi() ?? 0);
    // Una marca «en el futuro» (reloj cambiado) no frena el aviso.
    if (!forzar && ultimo <= ahora && ahora - ultimo < AVISO_API_MIN_MS) return;
    refAvisoApi.current = ahora;
    marcarAvisoApi(ahora);
    avisar();
  }, []);

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
      if (refAviso.current) return;
      registrar(false);
      avisarApi(false);
    };
    const alAlmacenar = (e: StorageEvent) => {
      if (!e.newValue) return;
      const v = Number(e.newValue);
      if (e.key === claveCompleta(claves.avisoApi)) {
        if (Number.isFinite(v) && v > refAvisoApi.current) refAvisoApi.current = v;
        return;
      }
      if (e.key !== claveCompleta(claves.actividad)) return;
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
  }, [activo, minutos, registrar, avisarApi]);

  const seguir = useCallback(() => {
    registrar(true);
    avisarApi(true);
    refAviso.current = false;
    setAviso(false);
  }, [registrar, avisarApi]);

  return { aviso, seguir };
}
