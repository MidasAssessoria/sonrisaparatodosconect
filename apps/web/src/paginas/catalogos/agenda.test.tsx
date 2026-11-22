import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  IDS,
  montar,
  PERMISOS_LECTURA_SEDES,
  ROL_LECTURA_SEDES,
  sedeDe,
} from '../../test/fabricas.js';
import { textoAnticipacion } from '../sedes/ReservaOnline.js';

/** Lo que devuelve la API si la sede todavía no tiene configuración. */
const POR_DEFECTO = {
  sedeId: IDS.sedeCentro,
  anticipacionMin: 120,
  diasAdelante: 14,
  reservaOnlineActiva: false,
};

describe('Reserva online de la sede', () => {
  it('muestra los valores por defecto, valida y guarda una sola vez', async () => {
    const f = montar(
      {
        'GET /sedes/:id': { cuerpo: sedeDe() },
        'GET /sedes/:id/agenda': { cuerpo: POR_DEFECTO },
        'PUT /sedes/:id/agenda': ({ cuerpo }) => ({
          cuerpo: { sedeId: IDS.sedeCentro, ...(cuerpo as object) },
        }),
      },
      `/sedes/${IDS.sedeCentro}`,
    );
    const form = within(await screen.findByRole('form', { name: 'Reserva online' }));
    const interruptor = form.getByRole('switch', { name: /Reserva online/ });
    expect(interruptor).toHaveAttribute('aria-checked', 'false');
    expect(interruptor).toHaveTextContent('Apagada');
    expect(form.getByLabelText('Horas')).toHaveValue('2');
    expect(form.getByLabelText('Minutos')).toHaveValue('0');
    expect(form.getByLabelText('Días hacia adelante')).toHaveValue(14);
    expect(form.getByText('No se reserva online para dentro de menos de 2 h.')).toBeInTheDocument();

    fireEvent.change(form.getByLabelText('Días hacia adelante'), { target: { value: '0' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar reserva online' }));
    expect(await form.findByText('Poné de 1 a 90 días.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'PUT')).toBe(false);

    fireEvent.change(form.getByLabelText('Horas'), { target: { value: '1' } });
    fireEvent.change(form.getByLabelText('Minutos'), { target: { value: '30' } });
    fireEvent.change(form.getByLabelText('Días hacia adelante'), { target: { value: '30' } });
    fireEvent.click(interruptor);
    expect(interruptor).toHaveAttribute('aria-checked', 'true');
    expect(form.getByText('1 h 30 min', { exact: false })).toBeInTheDocument();
    const guardar = form.getByRole('button', { name: 'Guardar reserva online' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    expect(await screen.findByText('Reserva online guardada')).toBeInTheDocument();
    const puts = f.pedidos.filter((p) => p.metodo === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url.pathname).toBe(`/api/v1/sedes/${IDS.sedeCentro}/agenda`);
    expect(puts[0]?.cuerpo).toEqual({
      anticipacionMin: 90,
      diasAdelante: 30,
      reservaOnlineActiva: true,
    });
  });

  it('sin `sedes:editar` se ve en solo lectura', async () => {
    const f = montar(
      {
        'GET /sedes/:id': { cuerpo: sedeDe() },
        'GET /sedes/:id/agenda': { cuerpo: POR_DEFECTO },
      },
      `/sedes/${IDS.sedeCentro}`,
      { rol: ROL_LECTURA_SEDES, permisos: PERMISOS_LECTURA_SEDES },
    );
    const seccion = within(
      (await screen.findByRole('heading', { name: 'Reserva online' })).closest('section')!,
    );
    expect(await seccion.findByText('2 h')).toBeInTheDocument();
    expect(seccion.getByText('14 días')).toBeInTheDocument();
    const chip = seccion.getByText('Apagada').closest('.cn-chip');
    expect(chip?.querySelector('svg')).not.toBeNull();
    expect(seccion.queryByRole('switch')).toBeNull();
    expect(seccion.queryByRole('button', { name: 'Guardar reserva online' })).toBeNull();
    expect(f.pedidos.some((p) => p.metodo === 'PUT')).toBe(false);
  });

  it('anticipación legible', () => {
    expect(textoAnticipacion(0)).toBe('Sin anticipación');
    expect(textoAnticipacion(45)).toBe('45 min');
    expect(textoAnticipacion(2880)).toBe('48 h');
  });
});
