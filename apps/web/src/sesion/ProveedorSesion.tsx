import type { Accion, Modulo, Sesion } from '@conecta/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { crearClienteApi, type ClienteApi } from '../api/cliente.js';
import { ErrorConecta, reaccionPorCodigo } from '../api/errores.js';
import type { ServicioAuth, SesionAuth } from '../auth/servicioAuth.js';
import { useTextos } from '../i18n/idioma.js';
import type { Textos } from '../i18n/es.js';
import {
  claves,
  escribir,
  escribirEnSesion,
  leer,
  leerActividad,
  leerDeSesion,
  marcarActividad,
  olvidarDeSesion,
  TODAS,
} from './preferencias.js';

/** Ruta a la que vuelve el enlace del correo de recuperación. */
export const RUTA_NUEVA_CLAVE = '/acceso/nueva-clave';

/** Cuánto se espera el aviso de cierre a la API antes de salir igual. */
const ESPERA_AVISO_CIERRE_MS = 3000;

export type MotivoCierre =
  { tipo: 'inactividad'; minutos: number } | { tipo: 'vencida' } | { tipo: 'sin_membresia' } | null;

export type Fase =
  | { fase: 'iniciando' }
  | { fase: 'sin_sesion'; motivo: MotivoCierre }
  | { fase: 'recuperacion' }
  /** aal1 con un TOTP verificado: hay que escribir el código. */
  | { fase: 'segundo_factor'; factorId: string }
  /** El rol (o la cuenta) exige doble factor y no hay ninguno verificado: hay que activarlo. */
  | { fase: 'activar_segundo_factor' }
  | { fase: 'cargando_sesion' }
  | { fase: 'elegir_clinica'; clinicas: { id: string; nombre: string }[]; actualId: string | null }
  | { fase: 'error'; mensaje: string }
  | { fase: 'lista'; sesion: Sesion };

/**
 * Sede con la que se trabaja. «Todas» y «ninguna» son cosas distintas: `todas` es la vista de
 * todas las sedes (solo con `puedeVerTodasLasSedes`); `ninguna` es que el usuario no ve ninguna sede.
 */
export type SedeActiva = { tipo: 'sede'; id: string } | { tipo: 'todas' } | { tipo: 'ninguna' };

export interface PreferenciasSede {
  /** Elegida a mano en esta sesión (sessionStorage). */
  elegidaEnSesion: string | null;
  /** Última usada (localStorage), de sesiones anteriores. */
  recordada: string | null;
}

export interface ValorSesion {
  estado: Fase;
  auth: ServicioAuth;
  api: ClienteApi;
  /** Sesión de la API (solo en la fase `lista`). */
  sesion: Sesion | null;
  puede: (modulo: Modulo, accion: Accion) => boolean;
  sedeActiva: SedeActiva;
  /** `null` = «Todas las sedes» (solo si `puedeVerTodasLasSedes`). */
  elegirSede: (id: string | null) => void;
  ingresar: (email: string, clave: string) => Promise<void>;
  verificarSegundoFactor: (codigo: string) => Promise<void>;
  /** Después de activar el doble factor obligatorio (la sesión ya es aal2): vuelve a pedir `/sesion`. */
  terminarActivacion: () => Promise<void>;
  elegirClinica: (id: string) => Promise<void>;
  irAElegirClinica: () => void;
  recargarSesion: () => Promise<void>;
  /**
   * Aviso silencioso de actividad a la API (renueva la sesión del servidor). No toca el estado:
   * solo reacciona si la API dice que la sesión venció (`no_autenticado`) o que ya no hay
   * membresía (`sin_membresia`). Red caída, 429 o 503 se ignoran.
   */
  mantenerSesion: () => Promise<void>;
  /** Reintento manual desde la pantalla de error (p. ej. 503 al arrancar). */
  reintentar: () => void;
  terminarRecuperacion: () => Promise<void>;
  cerrarSesion: (motivo?: MotivoCierre) => Promise<void>;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

/**
 * Sede inicial al entrar a una clínica. Regla:
 * 1. Si el usuario no ve ninguna sede: `ninguna`.
 * 2. La que eligió a mano en esta sesión (sobrevive a recargar la página y a cambiar de clínica).
 * 3. Su sede por defecto, si la puede ver.
 * 4. La última que usó en una sesión anterior (solo llega acá si no tiene sede por defecto válida).
 * 5. «Todas las sedes» si puede verlas; si no, la primera.
 */
export function sedeInicial(sesion: Sesion, pref: PreferenciasSede): SedeActiva {
  const ids = sesion.sedes.map((s) => s.id);
  const primera = ids[0];
  if (primera === undefined) return { tipo: 'ninguna' };
  const valida = (v: string | null): SedeActiva | null => {
    if (v === TODAS) return sesion.puedeVerTodasLasSedes ? { tipo: 'todas' } : null;
    return v && ids.includes(v) ? { tipo: 'sede', id: v } : null;
  };
  return (
    valida(pref.elegidaEnSesion) ??
    (sesion.sedeDefectoId && ids.includes(sesion.sedeDefectoId)
      ? { tipo: 'sede', id: sesion.sedeDefectoId }
      : null) ??
    valida(pref.recordada) ??
    (sesion.puedeVerTodasLasSedes ? { tipo: 'todas' } : { tipo: 'sede', id: primera })
  );
}

/** ¿La sede activa sigue valiendo con esta sesión? */
function sedeSigueValida(sede: SedeActiva, s: Sesion): boolean {
  if (sede.tipo === 'ninguna') return s.sedes.length === 0;
  if (sede.tipo === 'todas') return s.puedeVerTodasLasSedes && s.sedes.length > 0;
  return s.sedes.some((x) => x.id === sede.id);
}

function preferenciasSede(usuarioId: string, clinicaId: string): PreferenciasSede {
  return {
    elegidaEnSesion: leerDeSesion(claves.sedeElegida(usuarioId, clinicaId)),
    recordada: leer(claves.sede(usuarioId, clinicaId)),
  };
}

/** ¿La última actividad registrada ya pasó el límite? (Sin marca no se sabe: no vencida.) */
export function inactividadVencida(minutos: number, ahora: number = Date.now()): boolean {
  const ultima = leerActividad();
  return ultima !== null && ahora - ultima >= minutos * 60_000;
}

/** Puente entre el estado de React y el cliente de API (que vive fuera del render). */
class EnlaceApi {
  clinicaId: string | null = null;
  alError: (e: ErrorConecta) => void = () => undefined;
  fijarClinica(id: string | null) {
    this.clinicaId = id;
  }
  fijarAlError(fn: (e: ErrorConecta) => void) {
    this.alError = fn;
  }
}

interface PropsProveedor {
  auth: ServicioAuth;
  fetch?: typeof fetch | undefined;
  /** Base de la API (las pruebas la fijan); por defecto la de `VITE_API_URL`. */
  baseApi?: string | undefined;
  children: ReactNode;
}

/**
 * Estado de la sesión. Toda respuesta asíncrona se aplica solo si sigue vigente: cada cambio de
 * rumbo (cerrar sesión, cambiar de clínica, pasar al segundo factor, recuperar contraseña…)
 * abre una «generación» nueva, y lo que vuelve de una generación anterior se descarta. Así una
 * respuesta tardía no puede revivir la app después de salir ni mostrar una clínica distinta de
 * la que va en `X-Clinica-Id`.
 */
export function ProveedorSesion({ auth, fetch: fetchImpl, baseApi, children }: PropsProveedor) {
  const t = useTextos();
  const consultas = useQueryClient();
  const [estado, setEstado] = useState<Fase>({ fase: 'iniciando' });
  const [sedeActiva, setSedeActiva] = useState<SedeActiva>({ tipo: 'ninguna' });

  const refUsuario = useRef<SesionAuth | null>(null);
  const refEstado = useRef<Fase>(estado);
  const refGeneracion = useRef(0);
  const refRecarga = useRef(0);
  const refCerrando = useRef(false);
  const refTextos = useRef<Textos>(t);
  useEffect(() => {
    refTextos.current = t;
  }, [t]);
  /** Clínica activa y reacciones globales que lee el cliente de API en cada pedido. */
  const [enlace] = useState(() => new EnlaceApi());

  const api = useMemo(
    () =>
      crearClienteApi({
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        ...(baseApi !== undefined ? { base: baseApi } : {}),
        obtenerToken: () => auth.obtenerToken(),
        obtenerClinicaId: () => enlace.clinicaId,
        alError: (e) => enlace.alError(e),
      }),
    [auth, fetchImpl, baseApi, enlace],
  );

  const nuevaGeneracion = useCallback(() => ++refGeneracion.current, []);
  const vigente = useCallback((g: number) => g === refGeneracion.current, []);
  /** Cambia la fase y la deja leíble enseguida desde los callbacks (sin esperar al render). */
  const cambiarEstado = useCallback((f: Fase) => {
    refEstado.current = f;
    setEstado(f);
  }, []);

  const salirLocal = useCallback(
    (motivo: MotivoCierre) => {
      nuevaGeneracion();
      refUsuario.current = null;
      enlace.fijarClinica(null);
      olvidarDeSesion(claves.sedesElegidas);
      consultas.clear();
      setSedeActiva({ tipo: 'ninguna' });
      cambiarEstado({ fase: 'sin_sesion', motivo });
    },
    [nuevaGeneracion, enlace, consultas, cambiarEstado],
  );

  const cerrarSesion = useCallback(
    async (motivo: MotivoCierre = null) => {
      if (refCerrando.current) return;
      refCerrando.current = true;
      // Nada de lo que esté en vuelo se aplica después de esto.
      nuevaGeneracion();
      try {
        // Primero se le avisa a la API (todavía con el token), sin trabar la salida si falla o tarda.
        // Con la sesión ya vencida no tiene sentido.
        if (motivo?.tipo !== 'vencida') {
          let espera: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              api.sesion.cerrar(),
              new Promise<void>((r) => {
                espera = setTimeout(r, ESPERA_AVISO_CIERRE_MS);
              }),
            ]);
          } catch {
            // La API no respondió: igual se sale.
          } finally {
            clearTimeout(espera);
          }
        }
        try {
          await auth.cerrarSesion();
        } catch {
          // Aunque falle el aviso a Supabase, la app sale igual.
        }
        salirLocal(motivo);
      } finally {
        refCerrando.current = false;
      }
    },
    [api, auth, nuevaGeneracion, salirLocal],
  );

  /** Código si hay un factor verificado; si no, activación obligatoria. */
  const pasarASegundoFactor = useCallback(
    async (generacion?: number): Promise<void> => {
      const g = generacion ?? nuevaGeneracion();
      let factorId: string | null;
      try {
        factorId = (await auth.factoresTotp()).find((f) => f.verificado)?.id ?? null;
      } catch {
        if (vigente(g))
          cambiarEstado({ fase: 'error', mensaje: refTextos.current.comun.errorGenerico });
        return;
      }
      if (!vigente(g)) return;
      cambiarEstado(
        factorId ? { fase: 'segundo_factor', factorId } : { fase: 'activar_segundo_factor' },
      );
    },
    [auth, nuevaGeneracion, vigente, cambiarEstado],
  );

  const aplicarSesion = useCallback(
    (s: Sesion) => {
      const usuarioId = refUsuario.current?.usuarioId ?? s.usuario.id;
      // Clínica de la cabecera y clínica en pantalla cambian juntas.
      enlace.fijarClinica(s.clinica.id);
      escribir(claves.clinica(usuarioId), s.clinica.id);
      setSedeActiva(sedeInicial(s, preferenciasSede(usuarioId, s.clinica.id)));
      cambiarEstado({ fase: 'lista', sesion: s });
    },
    [enlace, cambiarEstado],
  );

  const cargarSesion = useCallback(
    async (opciones: { clinicaElegida?: string; restaurada?: boolean } = {}): Promise<void> => {
      const usuario = refUsuario.current;
      if (!usuario) return;
      const g = nuevaGeneracion();
      cambiarEstado({ fase: 'cargando_sesion' });
      const textos = refTextos.current;
      let recordada = opciones.clinicaElegida ?? leer(claves.clinica(usuario.usuarioId));
      let sesion: Sesion;
      try {
        try {
          sesion = await api.sesion.obtener(recordada);
        } catch (e) {
          if (!vigente(g)) return;
          // Solo estos dicen que la clínica recordada ya no sirve (membresía dada de baja, etc.).
          // Un 429, un 503 o un corte de red no: no se olvida nada por eso.
          const olvidable =
            e instanceof ErrorConecta &&
            ['sin_membresia', 'no_encontrado', 'datos_invalidos'].includes(e.codigo);
          if (!recordada || opciones.clinicaElegida || !olvidable) throw e;
          escribir(claves.clinica(usuario.usuarioId), null);
          recordada = null;
          sesion = await api.sesion.obtener(null);
        }
      } catch (e) {
        if (!vigente(g)) return;
        if (!(e instanceof ErrorConecta)) {
          cambiarEstado({ fase: 'error', mensaje: textos.comun.errorGenerico });
          return;
        }
        const r = reaccionPorCodigo(e.codigo);
        if (r.tipo === 'cerrar_sesion') return cerrarSesion({ tipo: 'vencida' });
        if (r.tipo === 'segundo_factor') return pasarASegundoFactor(g);
        if (r.tipo === 'sin_membresia') {
          cambiarEstado({ fase: 'error', mensaje: textos.clinica.sinMembresia });
          return;
        }
        if (r.tipo === 'elegir_clinica') {
          cambiarEstado({ fase: 'error', mensaje: textos.clinica.sinLista });
          return;
        }
        cambiarEstado({ fase: 'error', mensaje: e.message || textos.comun.errorGenerico });
        return;
      }
      if (!vigente(g)) return;
      // Sesión guardada de antes: si la última actividad ya pasó el límite, no se entra.
      if (opciones.restaurada && inactividadVencida(sesion.inactividadMin)) {
        return cerrarSesion({ tipo: 'inactividad', minutos: sesion.inactividadMin });
      }
      if (!recordada && sesion.clinicas.length > 1) {
        enlace.fijarClinica(null);
        cambiarEstado({ fase: 'elegir_clinica', clinicas: sesion.clinicas, actualId: null });
        return;
      }
      aplicarSesion(sesion);
    },
    [
      api,
      aplicarSesion,
      cerrarSesion,
      pasarASegundoFactor,
      nuevaGeneracion,
      vigente,
      cambiarEstado,
      enlace,
    ],
  );

  const continuarTrasAutenticar = useCallback(
    async (usuario: SesionAuth, opciones: { restaurada?: boolean } = {}) => {
      const g = nuevaGeneracion();
      refUsuario.current = usuario;
      const nivel = await auth.nivel();
      if (!vigente(g)) return;
      if (nivel.actual === 'aal1' && nivel.siguiente === 'aal2') {
        await pasarASegundoFactor(g);
        return;
      }
      await cargarSesion(opciones);
    },
    [auth, cargarSesion, pasarASegundoFactor, nuevaGeneracion, vigente],
  );

  /** Arranque: ¿hay sesión guardada por Supabase? */
  const arrancar = useCallback(async () => {
    const g = nuevaGeneracion();
    let usuario: SesionAuth | null;
    try {
      usuario = await auth.obtenerSesion();
    } catch {
      usuario = null;
    }
    if (!vigente(g)) return;
    if (!usuario) {
      cambiarEstado({ fase: 'sin_sesion', motivo: null });
      return;
    }
    // La pantalla de contraseña nueva NO se abre por la ruta: solo con el evento
    // PASSWORD_RECOVERY de Supabase (ver `alCambiar` más abajo).
    try {
      await continuarTrasAutenticar(usuario, { restaurada: true });
    } catch {
      if (vigente(refGeneracion.current) && refEstado.current.fase !== 'sin_sesion') {
        cambiarEstado({ fase: 'error', mensaje: refTextos.current.comun.errorGenerico });
      }
    }
  }, [auth, continuarTrasAutenticar, nuevaGeneracion, vigente, cambiarEstado]);

  useEffect(() => {
    // Se arranca en una microtarea: el efecto solo dispara el flujo asíncrono.
    queueMicrotask(() => void arrancar());
    return () => {
      // Desmontado: nada de lo pendiente se aplica.
      nuevaGeneracion();
    };
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  // Eventos de Supabase (también los que vienen de otras pestañas).
  useEffect(
    () =>
      auth.alCambiar((evento) => {
        if (evento === 'recuperacion') {
          const g = nuevaGeneracion();
          void auth.obtenerSesion().then((u) => {
            if (!vigente(g)) return;
            refUsuario.current = u;
            cambiarEstado(u ? { fase: 'recuperacion' } : { fase: 'sin_sesion', motivo: null });
          });
          return;
        }
        if (evento === 'salio' && refEstado.current.fase !== 'sin_sesion') {
          salirLocal(null);
        }
      }),
    [auth, nuevaGeneracion, vigente, cambiarEstado, salirLocal],
  );

  useEffect(() => {
    enlace.fijarAlError((e: ErrorConecta) => {
      const actual = refEstado.current;
      if (actual.fase !== 'lista') return;
      const r = reaccionPorCodigo(e.codigo);
      switch (r.tipo) {
        case 'cerrar_sesion':
          void cerrarSesion({ tipo: 'vencida' });
          return;
        case 'sin_membresia':
          // Usuario desactivado mientras trabajaba: se sale con el motivo, no es un error más.
          void cerrarSesion({ tipo: 'sin_membresia' });
          return;
        case 'segundo_factor':
          void pasarASegundoFactor();
          return;
        case 'elegir_clinica':
          nuevaGeneracion();
          cambiarEstado({
            fase: 'elegir_clinica',
            clinicas: actual.sesion.clinicas,
            actualId: actual.sesion.clinica.id,
          });
          return;
        default:
          return;
      }
    });
  }, [cerrarSesion, pasarASegundoFactor, nuevaGeneracion, cambiarEstado, enlace]);

  const recargarSesion = useCallback(async () => {
    const actual = refEstado.current;
    if (actual.fase !== 'lista') return;
    const g = refGeneracion.current;
    const n = ++refRecarga.current;
    let s: Sesion;
    try {
      s = await api.sesion.obtener(actual.sesion.clinica.id);
    } catch {
      // Los errores globales ya se atendieron en alError; el resto no bloquea.
      return;
    }
    // Vencida: hubo un cambio de rumbo, o llegó una recarga más nueva.
    if (!vigente(g) || n !== refRecarga.current) return;
    if (refEstado.current.fase !== 'lista' || enlace.clinicaId !== s.clinica.id) return;
    const usuarioId = refUsuario.current?.usuarioId ?? s.usuario.id;
    setSedeActiva((previa) =>
      sedeSigueValida(previa, s)
        ? previa
        : sedeInicial(s, preferenciasSede(usuarioId, s.clinica.id)),
    );
    cambiarEstado({ fase: 'lista', sesion: s });
  }, [api, vigente, enlace, cambiarEstado]);

  const mantenerSesion = useCallback(async () => {
    if (refEstado.current.fase !== 'lista') return;
    const g = refGeneracion.current;
    try {
      await api.sesion.mantener();
    } catch (e) {
      // Un cambio de rumbo mientras tanto (salir, cambiar de clínica): la respuesta ya no cuenta.
      if (!vigente(g) || refEstado.current.fase !== 'lista') return;
      if (!(e instanceof ErrorConecta)) return;
      const r = reaccionPorCodigo(e.codigo);
      if (r.tipo === 'cerrar_sesion') void cerrarSesion({ tipo: 'vencida' });
      else if (r.tipo === 'sin_membresia') void cerrarSesion({ tipo: 'sin_membresia' });
    }
  }, [api, vigente, cerrarSesion]);

  const sesion = estado.fase === 'lista' ? estado.sesion : null;

  const valor = useMemo<ValorSesion>(() => {
    const permisos = new Set((sesion?.permisos ?? []).map((p) => `${p.modulo}:${p.accion}`));
    return {
      estado,
      auth,
      api,
      sesion,
      puede: (modulo, accion) => permisos.has(`${modulo}:${accion}`),
      sedeActiva,
      elegirSede: (id) => {
        if (!sesion) return;
        if (id === null && !sesion.puedeVerTodasLasSedes) return;
        if (id !== null && !sesion.sedes.some((s) => s.id === id)) return;
        const valorGuardado = id ?? TODAS;
        escribir(claves.sede(sesion.usuario.id, sesion.clinica.id), valorGuardado);
        escribirEnSesion(claves.sedeElegida(sesion.usuario.id, sesion.clinica.id), valorGuardado);
        setSedeActiva(id === null ? { tipo: 'todas' } : { tipo: 'sede', id });
      },
      ingresar: async (email, clave) => {
        const usuario = await auth.iniciarSesion(email, clave);
        // Ingreso nuevo: actividad desde ahora y sin elecciones de sede de una sesión anterior.
        marcarActividad();
        olvidarDeSesion(claves.sedesElegidas);
        await continuarTrasAutenticar(usuario);
      },
      verificarSegundoFactor: async (codigo) => {
        if (estado.fase !== 'segundo_factor') return;
        await auth.verificarCodigo(estado.factorId, codigo);
        await cargarSesion();
      },
      terminarActivacion: async () => {
        if (estado.fase !== 'activar_segundo_factor') return;
        await cargarSesion();
      },
      elegirClinica: async (id) => {
        const usuario = refUsuario.current;
        if (usuario) escribir(claves.clinica(usuario.usuarioId), id);
        consultas.clear();
        await cargarSesion({ clinicaElegida: id });
      },
      irAElegirClinica: () => {
        if (!sesion) return;
        nuevaGeneracion();
        cambiarEstado({
          fase: 'elegir_clinica',
          clinicas: sesion.clinicas,
          actualId: sesion.clinica.id,
        });
      },
      recargarSesion,
      mantenerSesion,
      reintentar: () => {
        if (refUsuario.current) void cargarSesion();
        else void arrancar();
      },
      terminarRecuperacion: async () => {
        const usuario = refUsuario.current ?? (await auth.obtenerSesion());
        if (!usuario) {
          cambiarEstado({ fase: 'sin_sesion', motivo: null });
          return;
        }
        // Acaba de cambiar la contraseña: cuenta como actividad.
        marcarActividad();
        await continuarTrasAutenticar(usuario);
      },
      cerrarSesion,
    };
  }, [
    estado,
    auth,
    api,
    sesion,
    sedeActiva,
    continuarTrasAutenticar,
    cargarSesion,
    cerrarSesion,
    recargarSesion,
    mantenerSesion,
    arrancar,
    consultas,
    nuevaGeneracion,
    cambiarEstado,
  ]);

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): ValorSesion {
  const v = useContext(ContextoSesion);
  if (!v) throw new Error('useSesion necesita <ProveedorSesion>');
  return v;
}

/** Igual que `useSesion` pero garantiza que la sesión de la API ya está cargada. */
export function useSesionLista(): ValorSesion & { sesion: Sesion } {
  const v = useSesion();
  if (!v.sesion) throw new Error('useSesionLista solo dentro del armazón');
  return v as ValorSesion & { sesion: Sesion };
}
