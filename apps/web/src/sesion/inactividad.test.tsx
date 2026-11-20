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
