import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearAuthFalso, crearFetchFalso, renderApp, sesionDe } from '../test/fabricas.js';
import { useInactividad } from './useInactividad.js';

const MIN = 60_000;

describe('useInactividad', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('avisa un minuto antes, «Seguir conectado» reinicia y al final cierra', () => {
    const alCerrar = vi.fn();
    const { result } = renderHook(() => useInactividad({ minutos: 5, activo: true, alCerrar }));
    act(() => {
      vi.advanceTimersByTime(4 * MIN - 1000);
    });
    expect(result.current.aviso).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.aviso).toBe(true);

    act(() => result.current.seguir());
    expect(result.current.aviso).toBe(false);
    act(() => {
      vi.advanceTimersByTime(4 * MIN + 1000);
    });
    expect(result.current.aviso).toBe(true);
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(alCerrar).toHaveBeenCalledOnce();
  });

  it('la actividad reinicia la cuenta, pero no mientras se ve el aviso', () => {
    const alCerrar = vi.fn();
    const { result } = renderHook(() => useInactividad({ minutos: 2, activo: true, alCerrar }));
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
    });
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(result.current.aviso).toBe(false);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current.aviso).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
    });
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(alCerrar).toHaveBeenCalledOnce();
  });

  it('se sincroniza con la actividad de otra pestaña', () => {
    const alCerrar = vi.fn();
    const { result } = renderHook(() => useInactividad({ minutos: 2, activo: true, alCerrar }));
    act(() => {
      vi.advanceTimersByTime(70_000);
    });
    expect(result.current.aviso).toBe(true);
    // Otra pestaña registra actividad.
    act(() => {
      const ahora = String(Date.now());
      window.localStorage.setItem('conecta.actividad', ahora);
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'conecta.actividad', newValue: ahora }),
      );
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.aviso).toBe(false);
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(alCerrar).not.toHaveBeenCalled();
  });

  it('al montar no pisa la marca guardada: parte de la última actividad registrada', () => {
    // Última actividad hace 2 minutos (p. ej. antes de recargar la página).
    window.localStorage.setItem('conecta.actividad', String(Date.now() - 2 * MIN));
    const alCerrar = vi.fn();
    const { result } = renderHook(() => useInactividad({ minutos: 3, activo: true, alCerrar }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Faltaba un minuto: el aviso aparece enseguida, no a los 2 minutos de montar.
    expect(result.current.aviso).toBe(true);
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(alCerrar).toHaveBeenCalledOnce();
  });

  it('inactivo no hace nada', () => {
    const alCerrar = vi.fn();
    renderHook(() => useInactividad({ minutos: 1, activo: false, alCerrar }));
    act(() => {
      vi.advanceTimersByTime(10 * MIN);
    });
    expect(alCerrar).not.toHaveBeenCalled();
  });
});

describe('cierre por inactividad en la app', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('muestra el aviso, «Seguir conectado» lo cierra y al vencer vuelve a Acceso con el motivo', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ inactividadMin: 3 }) } });
    renderApp({ auth, fetch: f.fetch });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    // El efecto que registra el intervalo corre después del render: sin esto, bajo carga, el
    // reloj falso avanzaba antes de que existiera el temporizador y la prueba fallaba a veces.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    expect(window.localStorage.getItem('conecta.actividad')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2 * MIN + 1000);
    });
    expect(screen.getByRole('dialog', { name: 'Tu sesión está por cerrarse' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir conectado' }));
    expect(screen.queryByRole('dialog', { name: 'Tu sesión está por cerrarse' })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3 * MIN + 1000);
    });
    expect(
      await screen.findByText(
        'Cerramos tu sesión porque pasaron 3 minutos sin actividad. Ingresá de nuevo para seguir.',
      ),
    ).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });
});

describe('aviso de actividad a la API', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tecla = () => window.dispatchEvent(new KeyboardEvent('keydown'));

  it('con actividad continua avisa como mucho una vez por minuto', () => {
    const alAvisarApi = vi.fn();
    renderHook(() => useInactividad({ minutos: 15, activo: true, alCerrar: vi.fn(), alAvisarApi }));
    // Cinco minutos tecleando cada 10 segundos.
    for (let i = 0; i < 30; i++) {
      act(() => {
        tecla();
        vi.advanceTimersByTime(10_000);
      });
    }
    expect(alAvisarApi.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(alAvisarApi.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('sin actividad no avisa', () => {
    const alAvisarApi = vi.fn();
    renderHook(() => useInactividad({ minutos: 15, activo: true, alCerrar: vi.fn(), alAvisarApi }));
    act(() => {
      vi.advanceTimersByTime(10 * MIN);
    });
    expect(alAvisarApi).not.toHaveBeenCalled();
  });

  it('«Seguir conectado» avisa enseguida, aunque haga menos de un minuto del anterior', () => {
    const alAvisarApi = vi.fn();
    const { result } = renderHook(() =>
      useInactividad({ minutos: 15, activo: true, alCerrar: vi.fn(), alAvisarApi }),
    );
    act(() => {
      tecla();
    });
    expect(alAvisarApi).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => result.current.seguir());
    expect(alAvisarApi).toHaveBeenCalledTimes(2);
  });

  it('con otra pestaña que ya avisó, esta no duplica el aviso', () => {
    const alAvisarApi = vi.fn();
    renderHook(() => useInactividad({ minutos: 15, activo: true, alCerrar: vi.fn(), alAvisarApi }));
    // La otra pestaña avisa a la API y lo anota.
    act(() => {
      const ahora = String(Date.now());
      window.localStorage.setItem('conecta.aviso-api', ahora);
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'conecta.aviso-api', newValue: ahora }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
      tecla();
    });
    expect(alAvisarApi).not.toHaveBeenCalled();
    // Pasado el minuto desde el aviso de la otra pestaña, esta sí avisa (y lo anota para la otra).
    act(() => {
      vi.advanceTimersByTime(31_000);
      tecla();
    });
    expect(alAvisarApi).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem('conecta.aviso-api')).toBe(String(Date.now()));
  });

  it('dos pestañas con actividad a la vez avisan una sola vez por minuto entre las dos', () => {
    const avisoA = vi.fn();
    const avisoB = vi.fn();
    // Las dos comparten el mismo localStorage (como dos pestañas del mismo origen).
    renderHook(() =>
      useInactividad({ minutos: 15, activo: true, alCerrar: vi.fn(), alAvisarApi: avisoA }),
    );
    renderHook(() =>
      useInactividad({ minutos: 15, activo: true, alCerrar: vi.fn(), alAvisarApi: avisoB }),
    );
    for (let i = 0; i < 30; i++) {
      act(() => {
        tecla();
        vi.advanceTimersByTime(10_000);
      });
    }
    const total = avisoA.mock.calls.length + avisoB.mock.calls.length;
    expect(total).toBeGreaterThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(5);
  });
});

describe('aviso de actividad a la API en la app', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** `GET /sesion`: el primero carga la sesión; los siguientes son avisos y responden `aviso`. */
  async function montar(aviso: () => { estado: number; cuerpo?: unknown } | Promise<never>) {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const auth = crearAuthFalso({ conSesion: true });
    let pedidosSesion = 0;
    const f = crearFetchFalso({
      'GET /sesion': () => {
        pedidosSesion++;
        if (pedidosSesion === 1) return { cuerpo: sesionDe({ inactividadMin: 15 }) };
        return aviso();
      },
    });
    renderApp({ auth, fetch: f.fetch });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    const avisos = () =>
      f.pedidos.filter((p) => p.metodo === 'GET' && p.url.pathname.endsWith('/sesion')).length - 1;
    return { auth, f, avisos };
  }

  it('la actividad en pantalla manda `GET /sesion`, como mucho uno por minuto', async () => {
    const { avisos } = await montar(() => ({ estado: 200, cuerpo: sesionDe() }));
    expect(avisos()).toBe(0);
    for (let i = 0; i < 30; i++) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown'));
        vi.advanceTimersByTime(10_000);
      });
    }
    await vi.waitFor(() => expect(avisos()).toBeGreaterThanOrEqual(4));
    expect(avisos()).toBeLessThanOrEqual(5);
  });

  it('«Seguir conectado» manda el aviso enseguida', async () => {
    const { avisos } = await montar(() => ({ estado: 200, cuerpo: sesionDe() }));
    act(() => {
      vi.advanceTimersByTime(14 * MIN + 1000);
    });
    expect(avisos()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Seguir conectado' }));
    await vi.waitFor(() => expect(avisos()).toBe(1));
  });

  it.each([
    ['la red falla', () => Promise.reject<never>(new TypeError('Failed to fetch'))],
    [
      'responde 503',
      () => ({
        estado: 503,
        cuerpo: { codigo: 'servicio_no_disponible', mensaje: 'El servicio no responde.' },
      }),
    ],
    [
      'responde 429',
      () => ({
        estado: 429,
        cuerpo: { codigo: 'demasiados_pedidos', mensaje: 'Hay muchos pedidos seguidos.' },
      }),
    ],
  ])('si %s no muestra nada ni cierra la sesión', async (_caso, aviso) => {
    const { auth, avisos } = await montar(aviso);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
    });
    await vi.waitFor(() => expect(avisos()).toBe(1));
    // Dejar que la respuesta (fallida) se procese (setTimeout no está simulado).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(auth.cerrarSesion).not.toHaveBeenCalled();
  });

  it('si responde `no_autenticado` cierra la sesión con su mensaje', async () => {
    const { auth, avisos } = await montar(() => ({
      estado: 401,
      cuerpo: { codigo: 'no_autenticado', mensaje: 'Tu sesión venció. Ingresá de nuevo.' },
    }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
    });
    await vi.waitFor(() => expect(avisos()).toBe(1));
    expect(
      await screen.findByText('Tu sesión venció. Ingresá de nuevo para seguir.'),
    ).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });

  it('si responde `sin_membresia` cierra la sesión', async () => {
    const { auth, avisos } = await montar(() => ({
      estado: 403,
      cuerpo: { codigo: 'sin_membresia', mensaje: 'Sin membresía.' },
    }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown'));
    });
    await vi.waitFor(() => expect(avisos()).toBe(1));
    await vi.waitFor(() => expect(auth.cerrarSesion).toHaveBeenCalled());
  });
});
