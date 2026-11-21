import type { Permiso, Tratamiento } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERMISOS_ADMINISTRACION } from '../../test/fabricas.js';
import { IDS_CATALOGO, montar, tratamientoDe } from './ayudasPrueba.js';
import { conMiles, montoDesdeTexto, soloDigitos, textoMinutos } from './formato.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CATALOGO: Tratamiento[] = [
  tratamientoDe(),
  tratamientoDe({
    id: IDS_CATALOGO.extraccion,
    nombre: 'Extracción simple',
    categoria: 'Cirugía',
    precio: 250_000,
    iva: 0,
    duracionMin: 60,
  }),
  tratamientoDe({
    id: IDS_CATALOGO.blanqueamiento,
    nombre: 'Blanqueamiento',
    categoria: 'Estética',
    precio: 1_200_000,
    iva: 5,
    duracionMin: 90,
    activo: false,
  }),
];

/** La tabla de escritorio (la lista de tarjetas repite lo mismo para el celular). */
async function tabla() {
  return within((await screen.findAllByRole('table'))[0]!);
}

describe('formato de montos y duraciones', () => {
  it('separador de miles mientras se tipea y entero al mandar', () => {
    expect(conMiles(soloDigitos('1500000'))).toBe('1.500.000');
    expect(conMiles(soloDigitos('Gs. 1.500.000,50'))).toBe('150.000.050');
    expect(conMiles(soloDigitos('0012'))).toBe('12');
    expect(soloDigitos('12345678901')).toBe('123456789');
    expect(montoDesdeTexto('1.500.000')).toBe(1_500_000);
    expect(montoDesdeTexto('')).toBeNull();
    expect(textoMinutos(90)).toBe('1 h 30 min');
    expect(textoMinutos(60)).toBe('1 h');
  });
});

describe('Tratamientos', () => {
  it('alta: el precio se ve con separadores y se manda entero; un solo POST con doble clic', async () => {
    let lista: Tratamiento[] = [];
    const f = montar(
      {
        'GET /tratamientos': () => ({ cuerpo: lista }),
        'POST /tratamientos': ({ cuerpo }) => {
          const nuevo = tratamientoDe({
            id: IDS_CATALOGO.blanqueamiento,
            categoria: null,
            ...(cuerpo as Partial<Tratamiento>),
          });
          lista = [nuevo];
          return { estado: 201, cuerpo: nuevo };
        },
      },
      '/tratamientos',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar el primer tratamiento' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Nuevo tratamiento' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar tratamiento' }));
    expect(await hoja.findByText('Poné el nombre del tratamiento.')).toBeInTheDocument();
    expect(hoja.getByText('Poné el precio en guaraníes (puede ser 0).')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(hoja.getByLabelText(/^Nombre/), { target: { value: 'Blanqueamiento' } });
    const precio = hoja.getByLabelText(/^Precio en guaraníes/);
    fireEvent.change(precio, { target: { value: '1500000' } });
    expect(precio).toHaveValue('1.500.000');
    fireEvent.change(hoja.getByLabelText('IVA'), { target: { value: '5' } });
    fireEvent.change(hoja.getByLabelText('Duración'), { target: { value: '60' } });
    const guardar = hoja.getByRole('button', { name: 'Guardar tratamiento' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);

    expect(await screen.findByText('Tratamiento «Blanqueamiento» agregado')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    expect(f.pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toEqual({
      nombre: 'Blanqueamiento',
      precio: 1_500_000,
      iva: 5,
      duracionMin: 60,
    });
    const t = await tabla();
    expect(t.getByText('Gs. 1.500.000')).toBeInTheDocument();
    expect(t.getByText('5 %')).toBeInTheDocument();
    expect(t.getByText('1 h')).toBeInTheDocument();
  });

  it('nombre duplicado: muestra el mensaje de la API y deja la hoja abierta', async () => {
    const mensaje =
      'Ya hay un tratamiento activo con ese nombre (sin contar mayúsculas, tildes ni espacios). Elegí otro nombre o desactivá el otro primero.';
    montar(
      {
        'GET /tratamientos': { cuerpo: [tratamientoDe()] },
        'POST /tratamientos': { estado: 409, cuerpo: { codigo: 'conflicto', mensaje } },
      },
      '/tratamientos',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo tratamiento' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Nuevo tratamiento' }));
    fireEvent.change(hoja.getByLabelText(/^Nombre/), { target: { value: 'limpieza dental' } });
    fireEvent.change(hoja.getByLabelText(/^Precio en guaraníes/), { target: { value: '150000' } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar tratamiento' }));
    expect(await hoja.findByRole('alert')).toHaveTextContent(mensaje);
    expect(screen.getByRole('dialog', { name: 'Nuevo tratamiento' })).toBeInTheDocument();
  });

  it('filtra por categoría y por activos', async () => {
    montar({ 'GET /tratamientos': { cuerpo: CATALOGO } }, '/tratamientos');
    let t = await tabla();
    expect(t.getByText('Limpieza dental')).toBeInTheDocument();
    expect(t.getByText('Extracción simple')).toBeInTheDocument();
    expect(t.getByText('Gs. 250.000')).toBeInTheDocument();
    expect(t.getByText('Exento')).toBeInTheDocument();
    // Por defecto, solo activos.
    expect(t.queryByText('Blanqueamiento')).toBeNull();

    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'Cirugía' } });
    t = await tabla();
    expect(t.queryByText('Limpieza dental')).toBeNull();
    expect(t.getByText('Extracción simple')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Mostrar'), { target: { value: 'inactivos' } });
    t = await tabla();
    expect(t.getByText('Blanqueamiento')).toBeInTheDocument();
    expect(t.queryByText('Limpieza dental')).toBeNull();

    fireEvent.change(screen.getByLabelText('Mostrar'), { target: { value: 'todos' } });
    t = await tabla();
    expect(t.getAllByRole('row')).toHaveLength(1 + CATALOGO.length);

    fireEvent.change(screen.getByLabelText('Mostrar'), { target: { value: 'activos' } });
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'Estética' } });
    expect(
      await screen.findByText('Ningún tratamiento coincide con el filtro.'),
    ).toBeInTheDocument();
  });

  it('desactivar manda `activo: false` una sola vez; editar manda el precio entero', async () => {
    let lista = [...CATALOGO];
    const f = montar(
      {
        'GET /tratamientos': () => ({ cuerpo: lista }),
        'PATCH /tratamientos/:id': ({ url, cuerpo }) => {
          const id = url.pathname.split('/').pop();
          const previo = lista.find((x) => x.id === id)!;
          const nuevo = { ...previo, ...(cuerpo as Partial<Tratamiento>) };
          lista = lista.map((x) => (x.id === id ? nuevo : x));
          return { cuerpo: nuevo };
        },
      },
      '/tratamientos',
    );
    const desactivar = (await tabla()).getByRole('button', { name: 'Desactivar Limpieza dental' });
    fireEvent.click(desactivar);
    fireEvent.click(desactivar);
    expect(await screen.findByText('«Limpieza dental» quedó inactivo')).toBeInTheDocument();
    const patches = f.pedidos.filter((p) => p.metodo === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url.pathname).toBe(`/api/v1/tratamientos/${IDS_CATALOGO.limpieza}`);
    expect(patches[0]?.cuerpo).toEqual({ activo: false });
    await waitFor(async () => expect((await tabla()).queryByText('Limpieza dental')).toBeNull());

    fireEvent.click((await tabla()).getByRole('button', { name: 'Editar Extracción simple' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar «Extracción simple»' }));
    const precio = hoja.getByLabelText(/^Precio en guaraníes/);
    expect(precio).toHaveValue('250.000');
    fireEvent.change(precio, { target: { value: '275.0000' } });
    expect(precio).toHaveValue('2.750.000');
    fireEvent.change(hoja.getByLabelText('Categoría'), { target: { value: '' } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar tratamiento' }));
    expect(await screen.findByText('«Extracción simple» guardado')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'PATCH').at(-1)?.cuerpo).toEqual({
      nombre: 'Extracción simple',
      categoria: null,
      precio: 2_750_000,
      iva: 0,
      duracionMin: 60,
    });
  });

  it('permisos: sin `crear` no hay alta; sin `editar` no hay acciones por fila', async () => {
    montar({ 'GET /tratamientos': { cuerpo: CATALOGO } }, '/tratamientos', {
      permisos: PERMISOS_ADMINISTRACION,
    });
    const t = await tabla();
    expect(t.getByRole('button', { name: 'Editar Limpieza dental' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo tratamiento' })).toBeNull();
  });

  it('permisos: con solo `configuracion:ver` es de solo lectura', async () => {
    const permisos: Permiso[] = [
      { modulo: 'inicio', accion: 'ver' },
      { modulo: 'configuracion', accion: 'ver' },
    ];
    montar({ 'GET /tratamientos': { cuerpo: CATALOGO } }, '/tratamientos', { permisos });
    const t = await tabla();
    expect(t.getByText('Limpieza dental')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo tratamiento' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Desactivar/ })).toBeNull();
    expect(t.queryByRole('columnheader', { name: 'Acciones' })).toBeNull();
  });
});
