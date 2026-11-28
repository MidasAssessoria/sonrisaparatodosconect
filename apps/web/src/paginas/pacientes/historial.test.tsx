import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  anamnesisDe,
  CATALOGO_PRUEBA,
  IDS_PACIENTES,
  montar,
  pacienteDe,
  PERMISOS_ODONTOLOGO,
  PERMISOS_RECEPCION,
  resumenAnamnesisDe,
  ROL_ODONTOLOGO,
  ROL_RECEPCION,
  type PedidoRegistrado,
} from '../../test/fabricas.js';

const RECEPCION = { permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION };
const ODONTOLOGO = { permisos: PERMISOS_ODONTOLOGO, rol: ROL_ODONTOLOGO };
const RUTA_ANA = `/pacientes/${IDS_PACIENTES.ana}`;

// Frases como las arma la base (migraciones/0030_alerta_derivada_historial.sql).
const PAGINA_1 = {
  eventos: [
    {
      tipo: 'anamnesis',
      fecha: '2026-11-20T13:15:00Z',
      descripcion: 'Se registró la anamnesis (versión 2). Firmó Ana Giménez. Deja 1 alerta médica.',
      autor: 'Lorena Fretes',
      referencia: '2',
    },
    {
      tipo: 'vinculo_agregado',
      fecha: '2026-11-12T15:00:00Z',
      descripcion: 'Se agregó a Mateo Giménez al grupo familiar (hijo).',
      autor: 'Lorena Fretes',
      referencia: IDS_PACIENTES.mateo,
    },
    {
      tipo: 'alerta_creada',
      fecha: '2026-11-10T12:30:00Z',
      descripcion: 'Se cargó la alerta «Alergia al látex».',
      autor: 'Dra. Marta Acosta',
      referencia: IDS_PACIENTES.alerta,
    },
  ],
  siguienteCursor: 'cursor-1',
};
const PAGINA_2 = {
  eventos: [
    {
      tipo: 'alta',
      fecha: '2026-11-02T13:00:00Z',
      descripcion: 'Alta del paciente.',
      autor: null,
      referencia: null,
    },
  ],
  siguienteCursor: null,
};

function rutasHistorial() {
  return {
    'GET /pacientes/:id': { cuerpo: pacienteDe() },
    'GET /pacientes/:id/historial': ({ url }: { url: URL }) => ({
      cuerpo: url.searchParams.get('cursor') === 'cursor-1' ? PAGINA_2 : PAGINA_1,
    }),
  };
}

const de = (pedidos: PedidoRegistrado[], ruta: string) =>
  pedidos.filter((p) => p.metodo === 'GET' && p.url.pathname === `/api/v1${ruta}`);

describe('Historial del paciente', () => {
  it('línea de tiempo en el orden de la API, con «Cargar más» al final', async () => {
    const f = montar(rutasHistorial(), `${RUTA_ANA}/historial`, ODONTOLOGO);
    const lista = await screen.findByRole('list', { name: 'Historial del paciente' });
    const textos = () =>
      within(lista)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.w-historial__texto')?.textContent);
    expect(textos()).toEqual([
      'Se registró la anamnesis (versión 2). Firmó Ana Giménez. Deja 1 alerta médica.',
      'Se agregó a Mateo Giménez al grupo familiar (hijo).',
      'Se cargó la alerta «Alergia al látex».',
    ]);
    // Tipo con ícono y texto; fecha en la zona de la clínica; autor.
    const primero = within(lista).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(primero).getByText('Anamnesis')).toBeInTheDocument();
    expect(within(primero).getByText('Por Lorena Fretes')).toBeInTheDocument();
    expect(primero.querySelector('time')).toHaveAttribute('datetime', '2026-11-20T13:15:00Z');
    expect(primero.querySelector('time')?.textContent).toMatch(/20 de nov · 10:15$/);

    const [pedido] = de(f.pedidos, `${RUTA_ANA}/historial`);
    expect(pedido?.url.searchParams.get('limite')).toBe('30');
    expect(pedido?.url.searchParams.has('cursor')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    await waitFor(() => expect(textos()).toHaveLength(4));
    expect(textos()[3]).toBe('Alta del paciente.');
    expect(de(f.pedidos, `${RUTA_ANA}/historial`)[1]?.url.searchParams.get('cursor')).toBe(
      'cursor-1',
    );
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
    expect(screen.getByText('No hay más eventos.')).toBeInTheDocument();
  });

  it('enlaza a la versión de anamnesis, al familiar y a las alertas', async () => {
    montar(rutasHistorial(), `${RUTA_ANA}/historial`, ODONTOLOGO);
    expect(
      await screen.findByRole('link', { name: 'Ver la versión 2 de la anamnesis' }),
    ).toHaveAttribute('href', `${RUTA_ANA}/anamnesis?version=2`);
    expect(screen.getByRole('link', { name: 'Ver la ficha del familiar' })).toHaveAttribute(
      'href',
      `/pacientes/${IDS_PACIENTES.mateo}`,
    );
    expect(screen.getByRole('link', { name: 'Ver las alertas' })).toHaveAttribute('href', RUTA_ANA);
  });

  it('el enlace de la anamnesis abre esa versión en su pestaña', async () => {
    const v1 = anamnesisDe({ version: 1, esVigente: false });
    const v2 = anamnesisDe();
    montar(
      {
        ...rutasHistorial(),
        'GET /pacientes/:id/anamnesis': {
          cuerpo: { versiones: [v2, v1].map(resumenAnamnesisDe), requiereTutor: false },
        },
        'GET /pacientes/:id/anamnesis/:version': ({ url }: { url: URL }) => ({
          cuerpo: url.pathname.endsWith('/1') ? v1 : v2,
        }),
        'GET /anamnesis/preguntas': {
          cuerpo: { preguntas: CATALOGO_PRUEBA, huella: 'huella-catalogo-1' },
        },
      },
      `${RUTA_ANA}/historial`,
      ODONTOLOGO,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Ver la versión 2 de la anamnesis' }));
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 2', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anamnesis' })).toHaveAttribute('aria-current', 'page');
  });

  it('recepción ve la pestaña Historial, sin enlace a la anamnesis', async () => {
    montar(rutasHistorial(), `${RUTA_ANA}/historial`, RECEPCION);
    expect(await screen.findByRole('link', { name: 'Historial' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await screen.findByRole('list', { name: 'Historial del paciente' });
    // Si la API mandara un evento clínico, recepción no tiene a dónde ir.
    expect(screen.queryByRole('link', { name: /Ver la versión/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver la ficha del familiar' })).toBeInTheDocument();
  });

  it('sin eventos: estado vacío', async () => {
    montar(
      {
        'GET /pacientes/:id': { cuerpo: pacienteDe() },
        'GET /pacientes/:id/historial': { cuerpo: { eventos: [], siguienteCursor: null } },
      },
      `${RUTA_ANA}/historial`,
      ODONTOLOGO,
    );
    expect(await screen.findByText('Todavía no hay eventos en el historial.')).toBeInTheDocument();
  });
});
