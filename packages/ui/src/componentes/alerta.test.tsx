import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertaClinica } from '../index.js';

describe('AlertaClinica', () => {
  it('muestra el origen de una alerta derivada y acepta otro nombre de región', () => {
    render(
      <AlertaClinica
        etiqueta="Alertas de esta versión"
        alertas={[
          { tipo: 'alergia', texto: 'Alergia al látex' },
          { tipo: 'condicion', texto: 'Toma anticoagulantes', origen: 'De la anamnesis' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Alertas de esta versión' });
    const items = within(region).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Alergia al látex',
      'Toma anticoagulantes · De la anamnesis',
    ]);
    expect(items[0]).toHaveClass('cn-alerta--alergia');
    expect(items[1]).toHaveClass('cn-alerta--condicion');
    expect(within(region).getByText('Alertas de esta versión')).toBeInTheDocument();
  });
});
