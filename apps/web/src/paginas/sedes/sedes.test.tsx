import type { Sede } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  renderApp,
  sedeDe,
  sesionDe,
  uuid,
} from '../../test/fabricas.js';
import { validarTramos, type Tramo } from './EditorHorarios.js';
import { COLORES_SEDE, infoEstadoSede } from './estadoSede.js';

function tramo(p: Partial<Tramo>): Tramo {
  return {
    clave: p.clave ?? 'a',
    diaSemana: 1,
    horaInicio: '08:00',
    horaFin: '12:00',
    intervaloMin: 30,
    ...p,
  };
}

describe('validación de horarios', () => {
  it('el cierre tiene que ser posterior a la apertura', () => {
    const r = validarTramos([tramo({ horaInicio: '18:00', horaFin: '08:00' })]);
    expect(r).toEqual({
      ok: false,
      errores: { a: 'La hora de cierre tiene que ser posterior a la de apertura.' },
    });
  });

  it('acepta varios tramos por día y rechaza los superpuestos', () => {
    const ok = validarTramos([
      tramo({ clave: 'a' }),
      tramo({ clave: 'b', horaInicio: '14:00', horaFin: '18:00' }),
      tramo({ clave: 'c', diaSemana: 6, horaInicio: '08:00', horaFin: '12:00' }),
    ]);
    expect(ok.ok).toBe(true);
    const mal = validarTramos([
      tramo({ clave: 'a' }),
      tramo({ clave: 'b', horaInicio: '11:00', horaFin: '13:00' }),
    ]);
    expect(mal).toEqual({
      ok: false,
      errores: { b: 'Se superpone con el tramo de 8:00 a 12:00.' },
    });
  });

  it('pide completar las horas vacías', () => {
    const r = validarTramos([tramo({ horaFin: '' })]);
    expect(r.ok).toBe(false);
  });
});

describe('Sedes', () => {
  it('lista vacía: EstadoVacio con acción; alta valida, crea y muestra el éxito', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    let sedes: Sede[] = [];
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': () => ({ cuerpo: sedes }),
      'POST /sedes': ({ cuerpo }) => {
        const nueva = sedeDe({ id: uuid(99), ...(cuerpo as Partial<Sede>) });
        sedes = [nueva];
        return { estado: 201, cuerpo: nueva };
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByText('Todavía no hay sedes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar la primera sede' }));

    const hoja = within(await screen.findByRole('dialog', { name: 'Nueva sede' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar sede' }));
    expect(await hoja.findByText('Poné el nombre de la sede.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(hoja.getByLabelText(/^Nombre/), { target: { value: 'San Lorenzo' } });
    fireEvent.change(hoja.getByLabelText('Teléfono'), { target: { value: '021 555 555' } });
    fireEvent.change(hoja.getByLabelText('Estado'), { target: { value: 'proxima' } });
    fireEvent.click(hoja.getByRole('radio', { name: 'Cielo' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar sede' }));

    expect(await screen.findByText('Sede «San Lorenzo» creada')).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toEqual({
      nombre: 'San Lorenzo',
      telefono: '021 555 555',
      estado: 'proxima',
      color: '#2e9bec',
    });
    expect((await screen.findAllByText('Próxima apertura')).length).toBeGreaterThan(0);
    // la sesión se recarga para el selector de sede
    expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion').length).toBeGreaterThan(1);
  });

  it('lista con tarjetas: estado con Chip y enlace al detalle', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': {
        cuerpo: [sedeDe(), sedeDe({ id: IDS.sedeNorte, nombre: 'Norte', estado: 'cerrada' })],
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect((await screen.findAllByRole('link', { name: 'Norte' }))[0]).toHaveAttribute(
      'href',
      `/sedes/${IDS.sedeNorte}`,
    );
    expect(screen.getAllByText('Cerrada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Abierta').length).toBeGreaterThan(0);
  });

  it('error al cargar: mensaje con reintento', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': {
        estado: 409,
        cuerpo: { codigo: 'conflicto', mensaje: 'Probá de nuevo en un rato.' },
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Probá de nuevo en un rato.');
    expect(screen.getByRole('button', { name: 'Probá de nuevo' })).toBeInTheDocument();
  });

  it('horarios: no deja guardar un cierre anterior a la apertura y guarda varios tramos', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes/:id': { cuerpo: sedeDe() },
      'PUT /sedes/:id/horarios': ({ cuerpo }) => ({
        cuerpo: sedeDe({ horarios: (cuerpo as { horarios: Sede['horarios'] }).horarios }),
      }),
    });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    await screen.findByRole('heading', { name: 'Centro', level: 1 });
    const lunes = within(screen.getByRole('group', { name: 'Lunes' }));
    fireEvent.click(lunes.getByRole('button', { name: 'Agregar horario' }));
    fireEvent.change(lunes.getByLabelText('Cierra (tramo 1)'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));
    expect(
      await lunes.findByText('La hora de cierre tiene que ser posterior a la de apertura.'),
    ).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'PUT')).toBe(false);

    fireEvent.change(lunes.getByLabelText('Cierra (tramo 1)'), { target: { value: '12:00' } });
    fireEvent.click(lunes.getByRole('button', { name: 'Agregar otro tramo' }));
    fireEvent.change(lunes.getByLabelText('Abre (tramo 2)'), { target: { value: '14:00' } });
    fireEvent.change(lunes.getByLabelText('Cierra (tramo 2)'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));
    expect(await screen.findByText('Horarios guardados')).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'PUT')?.cuerpo).toEqual({
      horarios: [
        { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 },
        { diaSemana: 1, horaInicio: '14:00', horaFin: '18:00', intervaloMin: 30 },
      ],
    });
  });

  it('sillones: agregar, renombrar y desactivar', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const sillon = { id: uuid(70), sedeId: IDS.sedeCentro, nombre: 'Sillón 1', activo: true };
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes/:id': { cuerpo: sedeDe({ sillones: [sillon] }) },
      'POST /sedes/:id/sillones': ({ cuerpo }) => ({
        estado: 201,
        cuerpo: { id: uuid(71), sedeId: IDS.sedeCentro, activo: true, ...(cuerpo as object) },
      }),
      'PATCH /sillones/:id': ({ cuerpo }) => ({ cuerpo: { ...sillon, ...(cuerpo as object) } }),
    });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    await screen.findByText('Sillón 1');

    fireEvent.click(screen.getByRole('button', { name: 'Agregar sillón' }));
    expect(await screen.findByText('Poné el nombre del sillón.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nombre del sillón nuevo'), {
      target: { value: 'Sillón 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar sillón' }));
    expect(await screen.findByText('Sillón «Sillón 2» agregado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Sillón 1' }));
    await waitFor(() =>
      expect(f.pedidos.find((p) => p.metodo === 'PATCH')?.cuerpo).toEqual({ activo: false }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Renombrar Sillón 1' }));
    fireEvent.change(screen.getByLabelText('Nombre nuevo de «Sillón 1»'), {
      target: { value: 'Box A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));
    await waitFor(() =>
      expect(f.pedidos.filter((p) => p.metodo === 'PATCH').at(-1)?.cuerpo).toEqual({
        nombre: 'Box A',
      }),
    );
  });

  it('editar: vaciar la dirección y elegir «Sin color» borran esos datos (color: null)', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const conColor = sedeDe({ color: COLORES_SEDE[1]!.valor });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes/:id': { cuerpo: conColor },
      // Respuesta fija (no un eco del pedido): la aserción mira lo que se mandó.
      'PATCH /sedes/:id': { cuerpo: sedeDe({ direccion: null, color: null }) },
    });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    expect(await screen.findByText('Cielo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos de la sede' }));
    expect(hoja.getByRole('radio', { name: 'Cielo' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(hoja.getByLabelText('Dirección'), { target: { value: '' } });
    fireEvent.click(hoja.getByRole('radio', { name: 'Sin color' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Datos de la sede guardados')).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'PATCH')?.cuerpo).toEqual({
      nombre: 'Centro',
      estado: 'abierta',
      telefono: '021 000 000',
      direccion: '',
      color: null,
    });
  });

  it('el nombre de cada color se ve escrito, sin depender del hover', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': { cuerpo: [] },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva sede' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Nueva sede' }));
    for (const c of COLORES_SEDE) {
      const opcion = hoja.getByRole('radio', { name: c.nombre });
      expect(opcion).toHaveTextContent(c.nombre);
      expect(opcion).not.toHaveAttribute('title');
    }
  });

  it('dos clics rápidos en «Guardar sede» mandan un solo POST', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': { cuerpo: [] },
      'POST /sedes': ({ cuerpo }) => ({
        estado: 201,
        cuerpo: sedeDe({ id: uuid(99), ...(cuerpo as Partial<Sede>) }),
      }),
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva sede' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Nueva sede' }));
    fireEvent.change(hoja.getByLabelText(/^Nombre/), { target: { value: 'San Lorenzo' } });
    const guardar = hoja.getByRole('button', { name: 'Guardar sede' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    expect(await screen.findByText('Sede «San Lorenzo» creada')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
  });

  it('dos clics rápidos en «Confirmar baja» y en «Agregar sillón» mandan un solo pedido', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': { cuerpo: [] },
      'GET /sedes/:id': { cuerpo: sedeDe() },
      'POST /sedes/:id/sillones': ({ cuerpo }) => ({
        estado: 201,
        cuerpo: { id: uuid(71), sedeId: IDS.sedeCentro, activo: true, ...(cuerpo as object) },
      }),
      'DELETE /sedes/:id': { estado: 204 },
    });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    fireEvent.change(await screen.findByLabelText('Nombre del sillón nuevo'), {
      target: { value: 'Sillón 1' },
    });
    const agregar = screen.getByRole('button', { name: 'Agregar sillón' });
    fireEvent.click(agregar);
    fireEvent.click(agregar);
    expect(await screen.findByText('Sillón «Sillón 1» agregado')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Dar de baja «Centro»' }));
    fireEvent.change(hoja.getByLabelText(/^Motivo de la baja/), {
      target: { value: 'Se mudó a otro local' },
    });
    const confirmar = hoja.getByRole('button', { name: 'Confirmar baja' });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(await screen.findByText('La sede quedó dada de baja.')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'DELETE')).toHaveLength(1);
  });

  it('estados con ícono: sillón Activo/Inactivo y sede Cerrada sin el candado', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes/:id': {
        cuerpo: sedeDe({
          estado: 'cerrada',
          sillones: [
            { id: uuid(70), sedeId: IDS.sedeCentro, nombre: 'Sillón 1', activo: true },
            { id: uuid(71), sedeId: IDS.sedeCentro, nombre: 'Sillón 2', activo: false },
          ],
        }),
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    await screen.findByText('Sillón 1');
    for (const texto of ['Activo', 'Inactivo', 'Cerrada']) {
      const chip = screen.getByText(texto).closest('.cn-chip');
      expect(chip?.querySelector('svg')).not.toBeNull();
    }
    expect(infoEstadoSede('cerrada').icono).not.toBe('candado');
  });

  it('dar de baja pide motivo, confirma y vuelve a la lista con el aviso', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    let dadaDeBaja = false;
    let pedidaTrasLaBaja = false;
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': { cuerpo: [] },
      'GET /sedes/:id': () => {
        if (!dadaDeBaja) return { cuerpo: sedeDe() };
        pedidaTrasLaBaja = true;
        return {
          estado: 404,
          cuerpo: { codigo: 'no_encontrado', mensaje: 'No encontramos esa sede.' },
        };
      },
      'DELETE /sedes/:id': () => {
        dadaDeBaja = true;
        return { estado: 204 };
      },
    });
    // Si en algún momento aparece el error, queda registrado (aunque sea por un instante).
    let vioNoEncontrada = false;
    const observador = new MutationObserver(() => {
      if (document.body.textContent?.includes('No encontramos esa sede')) vioNoEncontrada = true;
    });
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Dar de baja «Centro»' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Confirmar baja' }));
    expect(await hoja.findByText('Contanos el motivo de la baja.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);

    fireEvent.change(hoja.getByLabelText(/^Motivo de la baja/), {
      target: { value: 'Se mudó a otro local' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Confirmar baja' }));
    expect(await screen.findByText('La sede quedó dada de baja.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sedes' })).toBeInTheDocument();
    const baja = f.pedidos.find((p) => p.metodo === 'DELETE');
    expect(baja?.url.pathname).toBe(`/api/v1/sedes/${IDS.sedeCentro}`);
    expect(baja?.cuerpo).toEqual({ motivo: 'Se mudó a otro local' });
    // Esperar a que termine de recargar la sesión y el caché.
    await waitFor(() =>
      expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion').length).toBe(2),
    );
    observador.disconnect();
    expect(pedidaTrasLaBaja).toBe(false);
    expect(vioNoEncontrada).toBe(false);
  });
});
