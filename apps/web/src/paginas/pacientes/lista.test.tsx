import type { PacienteResumen } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CARLOS,
  LUCIA,
  MATEO,
  montar,
  PERMISOS_RECEPCION,
  resumenDe,
  ROL_RECEPCION,
  type PedidoRegistrado,
} from '../../test/fabricas.js';

const ANA = resumenDe();

function pagina(items: PacienteResumen[], siguienteCursor: string | null = null) {
  return { cuerpo: { items, siguienteCursor } };
}

const listas = (pedidos: PedidoRegistrado[]) =>
  pedidos.filter((p) => p.metodo === 'GET' && p.url.pathname === '/api/v1/pacientes');

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function campoBusqueda() {
  return screen.getByRole('combobox', { name: 'Buscar en la lista de pacientes' });
}

describe('Pacientes: lista', () => {
  it('aparece en la navegación y muestra nombre, edad, CI con puntos, teléfono y chips', async () => {
    montar({ 'GET /pacientes': pagina([ANA, MATEO, LUCIA, CARLOS]) }, '/pacientes', {
      permisos: PERMISOS_RECEPCION,
      rol: ROL_RECEPCION,
    });
    const enlaces = await screen.findAllByRole('link', { name: 'Ana Giménez' });
    const nav = within(screen.getByRole('navigation', { name: 'Módulos' }));
    expect(nav.getByRole('link', { name: 'Pacientes' })).toHaveAttribute('href', '/pacientes');

    expect(enlaces[0]).toHaveAttribute('href', `/pacientes/${ANA.id}`);
    expect(screen.getAllByText('CI 4.123.456').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0981 123 456').length).toBeGreaterThan(0);
    // Tarjeta del celular: edad · CI · teléfono.
    expect(screen.getByText('34 años · CI 4.123.456 · 0981 123 456')).toBeInTheDocument();
    expect(screen.getAllByText('7 años').length).toBeGreaterThan(0);

    for (const texto of ['Pediátrico', 'Con alerta', 'Inactivo']) {
      const chip = screen.getAllByText(texto, { selector: '.cn-chip span' })[0];
      expect(chip?.closest('.cn-chip')?.querySelector('svg')).not.toBeNull();
    }
    expect(
      screen.getAllByText('Pediátrico', { selector: '.cn-chip span' })[0]?.closest('.cn-chip'),
    ).toHaveClass('cn-chip--familia');
    expect(
      screen.getAllByText('Con alerta', { selector: '.cn-chip span' })[0]?.closest('.cn-chip'),
    ).toHaveClass('cn-chip--atencion');
    // Recepción puede dar de alta.
    expect(screen.getByRole('button', { name: 'Nuevo paciente' })).toBeInTheDocument();
  });

  it('busca con espera corta y manda el texto como se escribió (normaliza la API)', async () => {
    const f = montar(
      {
        'GET /pacientes': ({ url }) =>
          pagina(url.searchParams.get('q') ? [ANA] : [ANA, MATEO, LUCIA]),
      },
      '/pacientes',
    );
    await screen.findAllByRole('link', { name: 'Lucía Benítez' });
    expect(listas(f.pedidos)).toHaveLength(1);

    for (const parcial of ['G', 'Go', 'Gon', 'Gonz', 'González']) {
      fireEvent.change(campoBusqueda(), { target: { value: parcial } });
    }
    // Mientras se escribe no sale nada.
    expect(listas(f.pedidos)).toHaveLength(1);
    await waitFor(() => expect(listas(f.pedidos)).toHaveLength(2));
    expect(listas(f.pedidos)[1]?.url.searchParams.get('q')).toBe('González');
    await waitFor(() =>
      expect(screen.queryAllByRole('link', { name: 'Lucía Benítez' })).toHaveLength(0),
    );

    fireEvent.change(campoBusqueda(), { target: { value: '4.123.456' } });
    await waitFor(() => expect(listas(f.pedidos)).toHaveLength(3));
    expect(listas(f.pedidos)[2]?.url.searchParams.get('q')).toBe('4.123.456');

    fireEvent.change(campoBusqueda(), { target: { value: '  0981 123 456 ' } });
    await waitFor(() => expect(listas(f.pedidos)).toHaveLength(4));
    expect(listas(f.pedidos)[3]?.url.searchParams.get('q')).toBe('0981 123 456');
    await espera(400);
    expect(listas(f.pedidos)).toHaveLength(4);
  });

  it('sin resultados lo dice y orienta', async () => {
    montar(
      {
        'GET /pacientes': ({ url }) => pagina(url.searchParams.get('q') ? [] : [ANA]),
      },
      '/pacientes',
    );
    await screen.findAllByRole('link', { name: 'Ana Giménez' });
    fireEvent.change(campoBusqueda(), { target: { value: 'Villalba' } });
    expect(
      await screen.findByText('No encontramos pacientes para «Villalba».'),
    ).toBeInTheDocument();
  });

  it('filtra Todos / Pediátricos / Con alerta / Inactivos', async () => {
    const f = montar(
      {
        'GET /pacientes': ({ url }) => {
          const filtro = url.searchParams.get('filtro');
          if (filtro === 'pediatricos') return pagina([MATEO]);
          if (filtro === 'con_alerta') return pagina([LUCIA]);
          if (filtro === 'inactivos') return pagina([]);
          return pagina([ANA, MATEO, LUCIA]);
        },
      },
      '/pacientes',
    );
    await screen.findAllByRole('link', { name: 'Ana Giménez' });
    expect(listas(f.pedidos)[0]?.url.searchParams.has('filtro')).toBe(false);
    const filtros = within(screen.getByRole('group', { name: 'Mostrar' }));
    expect(filtros.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Todos',
      'Pediátricos',
      'Con alerta',
      'Inactivos',
    ]);

    fireEvent.click(filtros.getByRole('button', { name: 'Pediátricos' }));
    await waitFor(() =>
      expect(screen.queryAllByRole('link', { name: 'Ana Giménez' })).toHaveLength(0),
    );
    expect(screen.getAllByRole('link', { name: 'Mateo Giménez' }).length).toBeGreaterThan(0);
    expect(listas(f.pedidos).at(-1)?.url.searchParams.get('filtro')).toBe('pediatricos');
    expect(filtros.getByRole('button', { name: 'Pediátricos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(filtros.getByRole('button', { name: 'Con alerta' }));
    await screen.findAllByRole('link', { name: 'Lucía Benítez' });
    expect(listas(f.pedidos).at(-1)?.url.searchParams.get('filtro')).toBe('con_alerta');

    fireEvent.click(filtros.getByRole('button', { name: 'Inactivos' }));
    expect(await screen.findByText('No hay pacientes en este filtro.')).toBeInTheDocument();
    expect(listas(f.pedidos).at(-1)?.url.searchParams.get('filtro')).toBe('inactivos');
  });

  it('«Cargar más» pide la página siguiente con el cursor', async () => {
    const f = montar(
      {
        'GET /pacientes': ({ url }) =>
          url.searchParams.get('cursor') === 'pagina-2'
            ? pagina([LUCIA])
            : pagina([ANA, MATEO], 'pagina-2'),
      },
      '/pacientes',
    );
    await screen.findAllByRole('link', { name: 'Ana Giménez' });
    expect(screen.queryAllByRole('link', { name: 'Lucía Benítez' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    await screen.findAllByRole('link', { name: 'Lucía Benítez' });
    expect(listas(f.pedidos)[1]?.url.searchParams.get('cursor')).toBe('pagina-2');
    // Lo ya cargado sigue ahí.
    expect(screen.getAllByRole('link', { name: 'Ana Giménez' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
    expect(screen.getByText('No hay más pacientes para mostrar.')).toBeInTheDocument();
  });

  it('vacía: invita a agregar el primero', async () => {
    montar({ 'GET /pacientes': pagina([]) }, '/pacientes');
    expect(
      await screen.findByText('Todavía no hay pacientes. Agregá el primero.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Nuevo paciente' })).toHaveLength(2);
  });

  it('sin pacientes:ver no está en la navegación y la ruta muestra el candado', async () => {
    const f = montar({}, '/pacientes', {
      permisos: PERMISOS_RECEPCION.filter((p) => p.modulo !== 'pacientes'),
      rol: ROL_RECEPCION,
    });
    expect(
      await screen.findByRole('heading', { name: 'Tu rol no tiene acceso a esto' }),
    ).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Módulos' }));
    expect(nav.queryByRole('link', { name: 'Pacientes' })).toBeNull();
    expect(listas(f.pedidos)).toHaveLength(0);
  });
});
