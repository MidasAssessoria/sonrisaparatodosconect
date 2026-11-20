import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { URL_SALUD } from './api.js';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('muestra «Conecta» y el estado de la API', async () => {
    const fetchFalso = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchFalso);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Conecta' })).toBeInTheDocument();
    expect(await screen.findByText('API en línea')).toBeInTheDocument();
    expect(fetchFalso).toHaveBeenCalledWith(URL_SALUD);
  });
});
