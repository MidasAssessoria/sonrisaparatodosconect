import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  LUCIA,
  montar,
  pacienteDe,
  PERMISOS_LECTURA_SEDES,
  PERMISOS_RECEPCION,
  resumenDe,
  ROL_LECTURA_SEDES,
  ROL_RECEPCION,
  type PedidoRegistrado,
} from '../test/fabricas.js';

const RECEPCION = { permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION };
const busquedas = (pedidos: PedidoRegistrado[]) =>
  pedidos.filter((p) => p.url.pathname === '/api/v1/buscar');
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buscador() {
  return screen.getByRole('combobox', { name: 'Buscar paciente' });
}

describe('buscador global de la barra superior', () => {
  it('con pacientes:ver busca desde 2 caracteres, con espera, y elegir abre la ficha', async () => {
    const f = montar(
      {
        'GET /buscar': { cuerpo: { pacientes: [resumenDe(), LUCIA] } },
        'GET /pacientes/:id': { cuerpo: pacienteDe() },
      },
      '/',
      RECEPCION,
    );
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });

    fireEvent.change(buscador(), { target: { value: 'a' } });
    await espera(500);
    expect(busquedas(f.pedidos)).toHaveLength(0);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(buscador(), { target: { value: 'an' } });
    fireEvent.change(buscador(), { target: { value: 'ana' } });
    expect(busquedas(f.pedidos)).toHaveLength(0);
    const opcion = await screen.findByRole('option', { name: /Ana Giménez/ });
    expect(busquedas(f.pedidos)).toHaveLength(1);
    expect(busquedas(f.pedidos)[0]?.url.searchParams.get('q')).toBe('ana');
    expect(opcion).toHaveTextContent('CI 4.123.456 · 0981 123 456');
    // Lucía tiene una alerta: chip de atención con texto.
    expect(screen.getByRole('option', { name: /Lucía Benítez/ })).toHaveTextContent('Con alerta');

    fireEvent.click(opcion);
    expect(
      await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 }),
    ).toBeInTheDocument();
    expect(buscador()).toHaveValue('');
  });

  it('con menos de 2 caracteres (o solo espacios) no pide nada', async () => {
    const f = montar({}, '/', RECEPCION);
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    fireEvent.change(buscador(), { target: { value: ' m ' } });
    fireEvent.change(buscador(), { target: { value: '   ' } });
    await espera(500);
    await waitFor(() => expect(busquedas(f.pedidos)).toHaveLength(0));
  });

  it('sin pacientes:ver no aparece', async () => {
    montar({}, '/', { permisos: PERMISOS_LECTURA_SEDES, rol: ROL_LECTURA_SEDES });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    expect(screen.queryByRole('combobox', { name: 'Buscar paciente' })).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();
  });
});
