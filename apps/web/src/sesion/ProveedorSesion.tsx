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
import { claves, escribir, leer, TODAS } from './preferencias.js';

/** Ruta a la que vuelve el enlace del correo de recuperación. */
export const RUTA_NUEVA_CLAVE = '/acceso/nueva-clave';

export type MotivoCierre = { tipo: 'inactividad'; minutos: number } | { tipo: 'vencida' } | null;

export type Fase =
  | { fase: 'iniciando' }
  | { fase: 'sin_sesion'; motivo: MotivoCierre }
  | { fase: 'recuperacion' }
  | { fase: 'segundo_factor'; factorId: string }
  | { fase: 'cargando_sesion' }
  | { fase: 'elegir_clinica'; clinicas: { id: string; nombre: string }[]; actualId: string | null }
  | { fase: 'error'; mensaje: string }
  | { fase: 'lista'; sesion: Sesion };

export interface ValorSesion {
  estado: Fase;
  auth: ServicioAuth;
  api: ClienteApi;
  /** Sesión de la API (solo en la fase `lista`). */
  sesion: Sesion | null;
  puede: (modulo: Modulo, accion: Accion) => boolean;
  /** `null` = todas las sedes (solo si `puedeVerTodasLasSedes`). */
  sedeActivaId: string | null;
  elegirSede: (id: string | null) => void;
  ingresar: (email: string, clave: string) => Promise<void>;
  verificarSegundoFactor: (codigo: string) => Promise<void>;
  elegirClinica: (id: string) => Promise<void>;
  irAElegirClinica: () => void;
  recargarSesion: () => Promise<void>;
  terminarRecuperacion: () => Promise<void>;
  cerrarSesion: (motivo?: MotivoCierre) => Promise<void>;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

/** Sede inicial: la recordada si sigue siendo válida; si no, la por defecto. */
export function sedeInicial(sesion: Sesion, guardada: string | null): string | null {
  const ids = sesion.sedes.map((s) => s.id);
  if (guardada === TODAS && sesion.puedeVerTodasLasSedes) return null;
  if (guardada && ids.includes(guardada)) return guardada;
  if (sesion.sedeDefectoId && ids.includes(sesion.sedeDefectoId)) return sesion.sedeDefectoId;
  if (sesion.puedeVerTodasLasSedes) return null;
  return ids[0] ?? null;
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
  children: ReactNode;
}

export function ProveedorSesion({ auth, fetch: fetchImpl, children }: PropsProveedor) {
  const t = useTextos();
  const consultas = useQueryClient();
  const [estado, setEstado] = useState<Fase>({ fase: 'iniciando' });
  const [sedeActivaId, setSedeActivaId] = useState<string | null>(null);

  const refUsuario = useRef<SesionAuth | null>(null);
  const refEstado = useRef<Fase>(estado);
  useEffect(() => {
    refEstado.current = estado;
  }, [estado]);
  /** Clínica activa y reacciones globales que lee el cliente de API en cada pedido. */
  const [enlace] = useState(() => new EnlaceApi());

  const api = useMemo(
    () =>
      crearClienteApi({
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        obtenerToken: () => auth.obtenerToken(),
        obtenerClinicaId: () => enlace.clinicaId,
        alError: (e) => enlace.alError(e),
      }),
    [auth, fetchImpl, enlace],
  );

  const cerrarSesion = useCallback(
    async (motivo: MotivoCierre = null) => {
      try {
        await auth.cerrarSesion();
      } catch {
        // Aunque falle el aviso a Supabase, la app sale igual.
      }
      refUsuario.current = null;
      enlace.fijarClinica(null);
      consultas.clear();
      setEstado({ fase: 'sin_sesion', motivo });
    },
    [auth, consultas, enlace],
  );

  const pasarASegundoFactor = useCallback(async (): Promise<boolean> => {
    const factores = await auth.factoresTotp();
    const factor = factores.find((f) => f.verificado);
    if (!factor) return false;
    setEstado({ fase: 'segundo_factor', factorId: factor.id });
    return true;
  }, [auth]);

  const aplicarSesion = useCallback(
    (s: Sesion) => {
      const usuarioId = refUsuario.current?.usuarioId ?? s.usuario.id;
      enlace.fijarClinica(s.clinica.id);
      escribir(claves.clinica(usuarioId), s.clinica.id);
      setSedeActivaId(sedeInicial(s, leer(claves.sede(usuarioId, s.clinica.id))));
      setEstado({ fase: 'lista', sesion: s });
    },
    [enlace],
  );

  const cargarSesion = useCallback(
    async (clinicaElegida?: string): Promise<void> => {
      const usuario = refUsuario.current;
      if (!usuario) return;
      setEstado({ fase: 'cargando_sesion' });
      let recordada = clinicaElegida ?? leer(claves.clinica(usuario.usuarioId));
      let sesion: Sesion | undefined;
      try {
        try {
          sesion = await api.sesion.obtener(recordada);
        } catch (e) {
          const olvidable =
            e instanceof ErrorConecta &&
            !['no_autenticado', 'mfa_requerido', 'sin_conexion'].includes(e.codigo);
          if (!recordada || clinicaElegida || !olvidable) throw e;
          // La clínica recordada ya no sirve (membresía dada de baja, etc.): se olvida y se reintenta.
          escribir(claves.clinica(usuario.usuarioId), null);
          recordada = null;
          sesion = await api.sesion.obtener(null);
        }
      } catch (e) {
        if (!(e instanceof ErrorConecta)) {
          setEstado({ fase: 'error', mensaje: t.comun.errorGenerico });
          return;
        }
        const r = reaccionPorCodigo(e.codigo);
        if (r.tipo === 'cerrar_sesion') return cerrarSesion({ tipo: 'vencida' });
        if (r.tipo === 'segundo_factor' && (await pasarASegundoFactor())) return;
        if (e.codigo === 'sin_membresia') {
          setEstado({ fase: 'error', mensaje: t.clinica.sinMembresia });
          return;
        }
        if (r.tipo === 'elegir_clinica') {
          setEstado({ fase: 'error', mensaje: t.clinica.sinLista });
          return;
        }
        setEstado({ fase: 'error', mensaje: e.message || t.comun.errorGenerico });
        return;
      }
      if (!sesion) return;
      if (!recordada && sesion.clinicas.length > 1) {
        enlace.fijarClinica(null);
        setEstado({
          fase: 'elegir_clinica',
          clinicas: sesion.clinicas,
          actualId: null,
        });
        return;
      }
      aplicarSesion(sesion);
    },
    [api, aplicarSesion, cerrarSesion, pasarASegundoFactor, t, enlace],
  );

  const continuarTrasAutenticar = useCallback(
    async (usuario: SesionAuth) => {
      refUsuario.current = usuario;
      const nivel = await auth.nivel();
      if (nivel.actual === 'aal1' && nivel.siguiente === 'aal2' && (await pasarASegundoFactor())) {
        return;
      }
      await cargarSesion();
    },
    [auth, cargarSesion, pasarASegundoFactor],
  );

  // Arranque: ¿hay sesión guardada por Supabase?
  useEffect(() => {
    let vigente = true;
    void (async () => {
      let usuario: SesionAuth | null;
      try {
        usuario = await auth.obtenerSesion();
      } catch {
        usuario = null;
      }
      if (!vigente) return;
      if (!usuario) {
        setEstado({ fase: 'sin_sesion', motivo: null });
        return;
      }
      refUsuario.current = usuario;
      if (window.location.pathname === RUTA_NUEVA_CLAVE) {
        setEstado({ fase: 'recuperacion' });
        return;
      }
      try {
        await continuarTrasAutenticar(usuario);
      } catch {
        if (vigente) setEstado({ fase: 'error', mensaje: t.comun.errorGenerico });
      }
    })();
    return () => {
      vigente = false;
    };
    // Solo al montar: las funciones de flujo cambian de identidad con el idioma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  // Eventos de Supabase (también los que vienen de otras pestañas).
  useEffect(
    () =>
      auth.alCambiar((evento) => {
        if (evento === 'recuperacion') {
          void auth.obtenerSesion().then((u) => {
            refUsuario.current = u;
            setEstado({ fase: 'recuperacion' });
          });
          return;
        }
        if (evento === 'salio' && refEstado.current.fase !== 'sin_sesion') {
          refUsuario.current = null;
          enlace.fijarClinica(null);
          consultas.clear();
          setEstado((previo) =>
            previo.fase === 'sin_sesion' ? previo : { fase: 'sin_sesion', motivo: null },
          );
        }
      }),
    [auth, consultas, enlace],
  );

  useEffect(() => {
    enlace.fijarAlError((e: ErrorConecta) => {
      if (refEstado.current.fase !== 'lista') return;
      const r = reaccionPorCodigo(e.codigo);
      if (r.tipo === 'cerrar_sesion') void cerrarSesion({ tipo: 'vencida' });
      if (r.tipo === 'segundo_factor') void pasarASegundoFactor();
      if (r.tipo === 'elegir_clinica') {
        const actual = refEstado.current;
        if (actual.fase === 'lista') {
          setEstado({
            fase: 'elegir_clinica',
            clinicas: actual.sesion.clinicas,
            actualId: actual.sesion.clinica.id,
          });
        }
      }
    });
  }, [cerrarSesion, pasarASegundoFactor, enlace]);

  const sesion = estado.fase === 'lista' ? estado.sesion : null;

  const valor = useMemo<ValorSesion>(() => {
    const permisos = new Set((sesion?.permisos ?? []).map((p) => `${p.modulo}:${p.accion}`));
    return {
      estado,
      auth,
      api,
      sesion,
      puede: (modulo, accion) => permisos.has(`${modulo}:${accion}`),
      sedeActivaId,
      elegirSede: (id) => {
        if (!sesion) return;
        if (id === null && !sesion.puedeVerTodasLasSedes) return;
        if (id !== null && !sesion.sedes.some((s) => s.id === id)) return;
        escribir(claves.sede(sesion.usuario.id, sesion.clinica.id), id ?? TODAS);
        setSedeActivaId(id);
      },
      ingresar: async (email, clave) => {
        const usuario = await auth.iniciarSesion(email, clave);
        await continuarTrasAutenticar(usuario);
      },
      verificarSegundoFactor: async (codigo) => {
        if (estado.fase !== 'segundo_factor') return;
        await auth.verificarCodigo(estado.factorId, codigo);
        await cargarSesion();
      },
      elegirClinica: async (id) => {
        const usuario = refUsuario.current;
        if (usuario) escribir(claves.clinica(usuario.usuarioId), id);
        consultas.clear();
        await cargarSesion(id);
      },
      irAElegirClinica: () => {
        if (!sesion) return;
        setEstado({
          fase: 'elegir_clinica',
          clinicas: sesion.clinicas,
          actualId: sesion.clinica.id,
        });
      },
      recargarSesion: async () => {
        if (!sesion) return;
        try {
          aplicarSesionSinCambiarSede(await api.sesion.obtener(sesion.clinica.id));
        } catch {
          // Los errores globales ya se atendieron en alError; el resto no bloquea.
        }
      },
      terminarRecuperacion: async () => {
        const usuario = refUsuario.current ?? (await auth.obtenerSesion());
        if (!usuario) {
          setEstado({ fase: 'sin_sesion', motivo: null });
          return;
        }
        window.history.replaceState(null, '', '/');
        await continuarTrasAutenticar(usuario);
      },
      cerrarSesion,
    };

    function aplicarSesionSinCambiarSede(s: Sesion) {
      setSedeActivaId((previa) => {
        if (previa === null && s.puedeVerTodasLasSedes) return null;
        if (previa && s.sedes.some((x) => x.id === previa)) return previa;
        return sedeInicial(s, null);
      });
      setEstado({ fase: 'lista', sesion: s });
    }
  }, [
    estado,
    auth,
    api,
    sesion,
    sedeActivaId,
    continuarTrasAutenticar,
    cargarSesion,
    cerrarSesion,
    consultas,
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
