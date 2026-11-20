import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { crearServicioAuthSupabase } from './supabase.js';

type Oyente = (evento: string) => void;

function clienteFalso() {
  let oyente: Oyente | null = null;
  const auth = {
    onAuthStateChange: vi.fn((cb: Oyente) => {
      oyente = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  return {
    cliente: { auth } as unknown as Pick<SupabaseClient, 'auth'>,
    emitir: (e: string) => oyente?.(e),
  };
}

const esperar = () => new Promise((r) => setTimeout(r, 5));

describe('servicio de Supabase', () => {
  it('PASSWORD_RECOVERY que llega antes de que la app se suscriba se entrega igual, una vez', async () => {
    const { cliente, emitir } = clienteFalso();
    const servicio = crearServicioAuthSupabase(cliente);
    emitir('PASSWORD_RECOVERY');
    await esperar();
    const cb = vi.fn();
    servicio.alCambiar(cb);
    await esperar();
    expect(cb).toHaveBeenCalledWith('recuperacion');
    const otro = vi.fn();
    servicio.alCambiar(otro);
    await esperar();
    expect(otro).not.toHaveBeenCalled();
  });

  it('SIGNED_OUT llega a los suscriptos y desuscribirse corta los avisos', async () => {
    const { cliente, emitir } = clienteFalso();
    const servicio = crearServicioAuthSupabase(cliente);
    const cb = vi.fn();
    const salir = servicio.alCambiar(cb);
    emitir('SIGNED_OUT');
    await esperar();
    expect(cb).toHaveBeenCalledWith('salio');
    salir();
    emitir('SIGNED_OUT');
    await esperar();
    expect(cb).toHaveBeenCalledOnce();
  });
});
