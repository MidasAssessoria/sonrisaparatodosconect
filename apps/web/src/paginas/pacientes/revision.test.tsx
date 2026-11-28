import {
  crearPacienteSchema,
  editarPacienteSchema,
  pacienteSchema,
  type AlertaManual,
  type Paciente,
  type PacienteResumen,
  type Relacion,
} from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diferida,
  IDS_PACIENTES,
  LUCIA,
  MATEO,
  montar,
  pacienteDe,
  PERMISOS_ODONTOLOGO,
  PERMISOS_RECEPCION,
  resumenDe,
  ROL_ODONTOLOGO,
  ROL_RECEPCION,
  uuid,
  type PedidoRegistrado,
  type RespuestaFalsa,
} from '../../test/fabricas.js';
import { diaEnZona } from '../../utilidades/fechas.js';

/*
 * Defectos de las revisiones del Sprint 3. Cada prueba falla con el código anterior.
 * Los simuladores responden con la forma real de la API: el 409 de CI duplicada con `detalles`, y
 * los `PATCH` con la ficha validada por el contrato (no el cuerpo mandado).
 */

const RECEPCION = { permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION };
const ODONTOLOGO = { permisos: PERMISOS_ODONTOLOGO, rol: ROL_ODONTOLOGO };
const RUTA_ANA = `/pacientes/${IDS_PACIENTES.ana}`;
const RUTA_MATEO = `/pacientes/${IDS_PACIENTES.mateo}`;
const ROSA_ID = uuid(705);

const de = (pedidos: PedidoRegistrado[], metodo: string, ruta: string) =>
  pedidos.filter((p) => p.metodo === metodo && p.url.pathname === `/api/v1${ruta}`);
const listaVacia: RespuestaFalsa = { cuerpo: { items: [], siguienteCursor: null } };

/** 409 de CI duplicada como lo manda la API (con `existente` solo para quien tiene pacientes:ver). */
function ciDuplicada(existente: PacienteResumen | null): RespuestaFalsa {
  return {
    estado: 409,
    cuerpo: {
      codigo: 'conflicto',
      mensaje: 'Esa cédula ya está cargada en otro paciente.',
      detalles: [{ campo: 'ci', mensaje: 'Esa cédula ya la tiene otro paciente.' }],
      ...(existente ? { existente } : {}),
    },
  };
}

/** Lo que haría la API con un `PATCH /pacientes/:id` válido: responde la ficha completa. */
function editadoPorLaApi(p: Paciente, cuerpo: unknown, extra: Partial<Paciente> = {}): Paciente {
  const datos = editarPacienteSchema.parse(cuerpo);
  const limpio = Object.fromEntries(
    Object.entries(datos).filter(([k, v]) => v !== undefined && k !== 'confirmarCiDuplicada'),
  );
  return pacienteSchema.parse({ ...p, ...limpio, ...extra });
}

/** Lo que haría la API con un `POST /pacientes` válido. */
function creadoPorLaApi(cuerpo: unknown): Paciente {
  const c = crearPacienteSchema.parse(cuerpo);
  return pacienteDe({
    id: ROSA_ID,
    nombres: c.nombres,
    apellidos: c.apellidos ?? null,
    ci: c.ci ?? null,
    telefono: c.telefono ?? null,
    fechaNac: null,
    edad: null,
    email: null,
    ciudad: null,
    aceptaWhatsapp: c.aceptaWhatsapp ?? false,
  });
}

const escribir = (
  hoja: { getByLabelText: (etiqueta: RegExp) => HTMLElement },
  etiqueta: RegExp,
  valor: string,
) => {
  const campo = hoja.getByLabelText(etiqueta);
  fireEvent.change(campo, { target: { value: valor } });
  fireEvent.blur(campo);
};

async function abrirAlta() {
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo paciente' }));
  return within(await screen.findByRole('dialog', { name: 'Nuevo paciente' }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CI duplicada: «Guardar igual» manda el formulario actual (defecto 1)', () => {
  it('alta: cambiar algo después del 409 oculta el aviso, y «Guardar igual» va con la corrección', async () => {
    const f = montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': ({ cuerpo }) =>
          (cuerpo as { confirmarCiDuplicada?: boolean }).confirmarCiDuplicada
            ? { estado: 201, cuerpo: creadoPorLaApi(cuerpo) }
            : ciDuplicada(resumenDe()),
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    escribir(hoja, /^Nombre/, 'Rosa');
    escribir(hoja, /^Apellido/, 'Duart');
    escribir(hoja, /^Cédula/, '4123456');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    expect(await hoja.findByText('La cédula 4.123.456 ya está cargada')).toBeInTheDocument();

    // Corrige el apellido: el aviso del pedido anterior ya no vale.
    escribir(hoja, /^Apellido/, 'Duarte');
    await waitFor(() => expect(hoja.queryByText('La cédula 4.123.456 ya está cargada')).toBeNull());
    expect(hoja.queryByRole('button', { name: 'Guardar igual' })).toBeNull();

    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    fireEvent.click(await hoja.findByRole('button', { name: 'Guardar igual' }));
    await screen.findByRole('heading', { name: 'Rosa Duarte', level: 1 });
    const altas = de(f.pedidos, 'POST', '/pacientes').map((p) => p.cuerpo);
    expect(altas).toHaveLength(3);
    expect(altas[2]).toEqual({
      nombres: 'Rosa',
      apellidos: 'Duarte',
      ci: '4123456',
      idioma: 'es',
      aceptaWhatsapp: false,
      confirmarCiDuplicada: true,
    });
  });

  it('edición: cambiar la CI después del 409 oculta el aviso; «Guardar igual» manda la CI nueva', async () => {
    let paciente = pacienteDe();
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'PATCH /pacientes/:id': ({ cuerpo }) => {
          if (!(cuerpo as { confirmarCiDuplicada?: boolean }).confirmarCiDuplicada) {
            return ciDuplicada(resumenDe({ id: IDS_PACIENTES.rosa, nombres: 'Rosa', ci: null }));
          }
          paciente = editadoPorLaApi(paciente, cuerpo);
          return { cuerpo: paciente };
        },
      },
      RUTA_ANA,
      RECEPCION,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos del paciente' }));
    fireEvent.change(hoja.getByLabelText(/^Cédula/), { target: { value: '3.333.333' } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await hoja.findByRole('button', { name: 'Guardar igual' })).toBeInTheDocument();

    fireEvent.change(hoja.getByLabelText(/^Cédula/), { target: { value: '3.333.334' } });
    await waitFor(() => expect(hoja.queryByRole('button', { name: 'Guardar igual' })).toBeNull());
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    fireEvent.click(await hoja.findByRole('button', { name: 'Guardar igual' }));
    expect(await screen.findByText('Guardamos los cambios.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA).map((p) => p.cuerpo)).toEqual([
      { ci: '3333333' },
      { ci: '3333334' },
      { ci: '3333334', confirmarCiDuplicada: true },
    ]);
    expect(screen.getByText('34 años · CI 3.333.334 · 0981 123 456')).toBeInTheDocument();
  });
});

describe('409 sin `existente` (defecto 10)', () => {
  it('quien no puede ver pacientes recibe solo el mensaje y puede guardar igual', async () => {
    const f = montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': ({ cuerpo }) =>
          (cuerpo as { confirmarCiDuplicada?: boolean }).confirmarCiDuplicada
            ? { estado: 201, cuerpo: creadoPorLaApi(cuerpo) }
            : ciDuplicada(null),
        'GET /pacientes/:id': { cuerpo: pacienteDe({ id: ROSA_ID, nombres: 'Rosa' }) },
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    escribir(hoja, /^Nombre/, 'Rosa');
    escribir(hoja, /^Cédula/, '4123456');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    expect(
      await hoja.findByText('Esa cédula ya está cargada en otro paciente.'),
    ).toBeInTheDocument();
    expect(hoja.queryByRole('button', { name: 'Abrir su ficha' })).toBeNull();
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar igual' }));
    await screen.findByRole('heading', { name: 'Rosa', level: 1 });
    expect(de(f.pedidos, 'POST', '/pacientes')[1]?.cuerpo).toMatchObject({
      ci: '4123456',
      confirmarCiDuplicada: true,
    });
  });
});

describe('fecha de nacimiento máxima en la zona de la clínica (defecto 4)', () => {
  it('a las 22:30 de Asunción, hoy sigue siendo hoy (en UTC ya es mañana)', () => {
    const noche = new Date('2026-11-24T01:30:00Z');
    expect(noche.toISOString().slice(0, 10)).toBe('2026-11-24');
    expect(diaEnZona('America/Asuncion', noche)).toBe('2026-11-23');
    expect(diaEnZona('America/Asuncion', new Date('2026-11-24T03:00:00Z'))).toBe('2026-11-24');
  });

  it('el formulario no deja elegir mañana entre las 21:00 y las 24:00', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T01:30:00Z'));
    montar({ 'GET /pacientes': listaVacia }, '/pacientes', RECEPCION);
    const hoja = await abrirAlta();
    expect(hoja.getByLabelText(/^Fecha de nacimiento/)).toHaveAttribute('max', '2026-11-23');
  });
});

describe('ficha ya cargada con una recarga que falla (defecto 5)', () => {
  it('sigue mostrando la ficha, con un aviso y «Probá de nuevo»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T15:00:00Z'));
    let fallar = false;
    const relacionAna: Relacion = {
      id: IDS_PACIENTES.relacion,
      familiar: { id: MATEO.id, nombre: 'Mateo Giménez', edad: 7 },
      tipo: 'hijo',
      esTutorLegal: true,
      esResponsablePago: false,
      familiarEsTutorLegal: false,
      familiarEsResponsablePago: false,
    };
    const mateo = pacienteDe({
      ...MATEO,
      relaciones: [
        {
          ...relacionAna,
          id: uuid(722),
          familiar: { id: IDS_PACIENTES.ana, nombre: 'Ana Giménez', edad: 34 },
          tipo: 'madre',
        },
      ],
    });
    montar(
      {
        'GET /pacientes/:id': ({ url }) => {
          if (url.pathname.endsWith(MATEO.id)) return { cuerpo: mateo };
          if (fallar) {
            return {
              estado: 503,
              cuerpo: { codigo: 'servicio_no_disponible', mensaje: 'Sin servicio.' },
            };
          }
          return { cuerpo: pacienteDe({ relaciones: [relacionAna] }) };
        },
      },
      RUTA_ANA,
      RECEPCION,
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    fireEvent.click(screen.getByRole('link', { name: 'Mateo Giménez' }));
    await screen.findByRole('heading', { name: 'Mateo Giménez', level: 1 });

    // Pasó el tiempo: al volver, la ficha de Ana está vieja y se recarga; la recarga falla.
    fallar = true;
    vi.setSystemTime(new Date('2026-11-23T15:05:00Z'));
    fireEvent.click(screen.getByRole('link', { name: 'Ana Giménez' }));
    expect(
      await screen.findByText(
        'No pudimos actualizar la ficha: lo que ves puede estar desactualizado.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ana Giménez', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Datos personales' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Probá de nuevo' })).toBeInTheDocument();

    fallar = false;
    fireEvent.click(screen.getByRole('button', { name: 'Probá de nuevo' }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          'No pudimos actualizar la ficha: lo que ves puede estar desactualizado.',
        ),
      ).toBeNull(),
    );
  });
});

describe('caché después de cambiar una ficha (defecto 6)', () => {
  it('agregar una alerta vuelve a pedir el buscador global (chip «Con alerta»)', async () => {
    let paciente = pacienteDe();
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'GET /buscar': () => ({
          cuerpo: { pacientes: [resumenDe({ conAlerta: paciente.conAlerta })] },
        }),
        'POST /pacientes/:id/alertas': ({ cuerpo }) => {
          const alerta: AlertaManual = {
            id: uuid(713),
            ...(cuerpo as Pick<AlertaManual, 'tipo' | 'texto'>),
            activa: true,
            creadaEn: '2026-11-20T15:00:00Z',
            creadaPor: 'Dr. Esteban Rojas',
          };
          paciente = { ...paciente, conAlerta: true, alertas: [alerta] };
          return { estado: 201, cuerpo: alerta };
        },
      },
      RUTA_ANA,
      ODONTOLOGO,
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    const buscador = () => screen.getByRole('combobox', { name: 'Buscar paciente' });
    fireEvent.change(buscador(), { target: { value: 'Ana' } });
    expect(await screen.findByRole('option', { name: /Ana Giménez/ })).not.toHaveTextContent(
      'Con alerta',
    );
    fireEvent.change(buscador(), { target: { value: '' } });

    const alertas = within(screen.getByRole('region', { name: 'Alertas' }));
    fireEvent.click(alertas.getByRole('button', { name: 'Alergia' }));
    fireEvent.change(alertas.getByLabelText(/Nueva alerta/), { target: { value: 'Látex' } });
    fireEvent.click(alertas.getByRole('button', { name: 'Agregar alerta' }));
    expect(await screen.findByText('Agregamos la alerta.')).toBeInTheDocument();

    fireEvent.change(buscador(), { target: { value: 'Ana' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Ana Giménez/ })).toHaveTextContent('Con alerta'),
    );
    expect(de(f.pedidos, 'GET', '/buscar')).toHaveLength(2);
  });

  it('renombrar a un paciente vuelve a pedir las fichas de sus familiares', async () => {
    let ana = pacienteDe({
      relaciones: [
        {
          id: IDS_PACIENTES.relacion,
          familiar: { id: MATEO.id, nombre: 'Mateo Giménez', edad: 7 },
          tipo: 'hijo',
          esTutorLegal: true,
          esResponsablePago: false,
          familiarEsTutorLegal: false,
          familiarEsResponsablePago: false,
        },
      ],
    });
    const mateo = () =>
      pacienteDe({
        ...MATEO,
        relaciones: [
          {
            id: uuid(722),
            familiar: {
              id: ana.id,
              nombre: `${ana.nombres} ${ana.apellidos ?? ''}`.trim(),
              edad: 34,
            },
            tipo: 'madre',
            esTutorLegal: false,
            esResponsablePago: false,
            familiarEsTutorLegal: true,
            familiarEsResponsablePago: false,
          },
        ],
      });
    const f = montar(
      {
        'GET /pacientes/:id': ({ url }) => ({
          cuerpo: url.pathname.endsWith(MATEO.id) ? mateo() : ana,
        }),
        'PATCH /pacientes/:id': ({ cuerpo }) => {
          ana = editadoPorLaApi(ana, cuerpo);
          return { cuerpo: ana };
        },
      },
      RUTA_ANA,
      RECEPCION,
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    fireEvent.click(screen.getByRole('link', { name: 'Mateo Giménez' }));
    await screen.findByRole('heading', { name: 'Mateo Giménez', level: 1 });
    fireEvent.click(screen.getByRole('link', { name: 'Ana Giménez' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos del paciente' }));
    fireEvent.change(hoja.getByLabelText(/^Nombre/), { target: { value: 'Ana María' } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Guardamos los cambios.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Mateo Giménez' }));
    expect(await screen.findByRole('link', { name: 'Ana María Giménez' })).toBeInTheDocument();
    expect(de(f.pedidos, 'GET', RUTA_MATEO)).toHaveLength(2);
  });
});

describe('alertas: un candado por fila (defecto 7)', () => {
  it('tocar otra alerta mientras la primera se guarda también se manda', async () => {
    const a1: AlertaManual = {
      id: IDS_PACIENTES.alerta,
      tipo: 'alergia',
      texto: 'Penicilina',
      activa: true,
      creadaEn: '2026-11-10T12:30:00Z',
      creadaPor: null,
    };
    const a2: AlertaManual = {
      ...a1,
      id: IDS_PACIENTES.alertaVieja,
      tipo: 'condicion',
      texto: 'Embarazo',
    };
    const primera = diferida<RespuestaFalsa>();
    const f = montar(
      {
        'GET /pacientes/:id': { cuerpo: pacienteDe({ conAlerta: true, alertas: [a1, a2] }) },
        'PATCH /alertas/:id': ({ url }) =>
          url.pathname.endsWith(a1.id) ? primera.promesa : { cuerpo: { ...a2, activa: false } },
      },
      RUTA_ANA,
      ODONTOLOGO,
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    const alertas = within(screen.getByRole('region', { name: 'Alertas' }));
    fireEvent.click(alertas.getByRole('button', { name: 'Desactivar la alerta «Penicilina»' }));
    fireEvent.click(alertas.getByRole('button', { name: 'Desactivar la alerta «Embarazo»' }));
    await waitFor(() => expect(de(f.pedidos, 'PATCH', `/alertas/${a2.id}`)).toHaveLength(1));
    expect(de(f.pedidos, 'PATCH', `/alertas/${a1.id}`)).toHaveLength(1);
    expect(
      await alertas.findByRole('button', { name: 'Activar la alerta «Embarazo»' }),
    ).toBeInTheDocument();
    primera.resolver({ cuerpo: { ...a1, activa: false } });
    expect(
      await alertas.findByRole('button', { name: 'Activar la alerta «Penicilina»' }),
    ).toBeInTheDocument();
  });
});

describe('selector de familiar con GET /pacientes (defecto 8)', () => {
  it('si la primera página son la propia ficha y ya vinculados, ofrece «Cargar más»', async () => {
    const paciente = pacienteDe({
      relaciones: [
        {
          id: IDS_PACIENTES.relacion,
          familiar: { id: LUCIA.id, nombre: 'Lucía Benítez', edad: 38 },
          tipo: 'hermano',
          esTutorLegal: false,
          esResponsablePago: false,
          familiarEsTutorLegal: false,
          familiarEsResponsablePago: false,
        },
      ],
    });
    const f = montar(
      {
        'GET /pacientes/:id': { cuerpo: paciente },
        'GET /pacientes': ({ url }) => ({
          cuerpo: url.searchParams.get('cursor')
            ? { items: [MATEO], siguienteCursor: null }
            : { items: [resumenDe(), LUCIA], siguienteCursor: 'pagina-2' },
        }),
      },
      RUTA_ANA,
      RECEPCION,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar familiar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Agregar familiar' }));
    fireEvent.change(hoja.getByLabelText(/^Buscá al familiar/), { target: { value: 'Giménez' } });
    expect(
      await hoja.findByText(
        'Los pacientes que encontramos hasta ahora ya están en el grupo familiar.',
      ),
    ).toBeInTheDocument();
    expect(hoja.queryByText(/No encontramos pacientes/)).toBeNull();
    fireEvent.click(hoja.getByRole('button', { name: 'Cargar más' }));
    fireEvent.click(await hoja.findByRole('button', { name: 'Elegir a Mateo Giménez' }));
    expect(hoja.getByText('Mateo Giménez')).toBeInTheDocument();

    const pedidos = de(f.pedidos, 'GET', '/pacientes').map((p) => p.url.searchParams);
    expect(pedidos.map((p) => [p.get('q'), p.get('limite'), p.get('cursor')])).toEqual([
      ['Giménez', '20', null],
      ['Giménez', '20', 'pagina-2'],
    ]);
    expect(de(f.pedidos, 'GET', '/buscar')).toHaveLength(0);
  });

  it('dice «Sin resultados» solo cuando no hay más páginas', async () => {
    montar(
      {
        'GET /pacientes/:id': { cuerpo: pacienteDe() },
        'GET /pacientes': { cuerpo: { items: [resumenDe()], siguienteCursor: null } },
      },
      RUTA_ANA,
      RECEPCION,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar familiar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Agregar familiar' }));
    fireEvent.change(hoja.getByLabelText(/^Buscá al familiar/), { target: { value: 'Giménez' } });
    expect(await hoja.findByText(/No encontramos pacientes para «Giménez»/)).toBeInTheDocument();
    expect(hoja.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });
});

describe('teléfonos fijos (defecto 9)', () => {
  const FIJO = '+59521123456';

  it('la lista los muestra como se escriben acá', async () => {
    montar(
      {
        'GET /pacientes': {
          cuerpo: { items: [resumenDe({ telefono: FIJO })], siguienteCursor: null },
        },
      },
      '/pacientes',
      RECEPCION,
    );
    expect((await screen.findAllByText('021 123 456')).length).toBeGreaterThan(0);
    expect(screen.queryByText(FIJO)).toBeNull();
  });

  it('la ficha y el formulario también', async () => {
    montar(
      { 'GET /pacientes/:id': { cuerpo: pacienteDe({ telefono: '+595521123456' }) } },
      RUTA_ANA,
      RECEPCION,
    );
    expect(await screen.findByText('34 años · CI 4.123.456 · 0521 123 456')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos del paciente' }));
    expect(hoja.getByLabelText(/^Teléfono/)).toHaveValue('0521 123 456');
  });
});

describe('la pantalla muestra lo que devuelve la API (defecto 11)', () => {
  it('después de editar se ve la ficha respondida, no el cuerpo mandado', async () => {
    let paciente = pacienteDe();
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        // La API guarda la ciudad con su nombre de catálogo.
        'PATCH /pacientes/:id': ({ cuerpo }) => {
          paciente = editadoPorLaApi(paciente, cuerpo, { ciudad: 'San Lorenzo' });
          return { cuerpo: paciente };
        },
      },
      RUTA_ANA,
      RECEPCION,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos del paciente' }));
    fireEvent.change(hoja.getByLabelText(/^Ciudad/), { target: { value: 'san lorenzo' } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Guardamos los cambios.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA)[0]?.cuerpo).toEqual({ ciudad: 'san lorenzo' });
    const datos = within(screen.getByRole('region', { name: 'Datos personales' }));
    expect(datos.getByText('San Lorenzo')).toBeInTheDocument();
    expect(datos.queryByText('san lorenzo')).toBeNull();
  });

  it('activar o desactivar una alerta muestra la alerta que respondió la API', async () => {
    const alerta: AlertaManual = {
      id: IDS_PACIENTES.alerta,
      tipo: 'alergia',
      texto: 'Penicilina',
      activa: true,
      creadaEn: '2026-11-10T12:30:00Z',
      creadaPor: null,
    };
    montar(
      {
        'GET /pacientes/:id': { cuerpo: pacienteDe({ conAlerta: true, alertas: [alerta] }) },
        // La API la deja inactiva y con el texto como quedó guardado.
        'PATCH /alertas/:id': {
          cuerpo: { ...alerta, activa: false, texto: 'Penicilina (amoxicilina)' },
        },
      },
      RUTA_ANA,
      ODONTOLOGO,
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    const alertas = within(screen.getByRole('region', { name: 'Alertas' }));
    fireEvent.click(alertas.getByRole('button', { name: 'Desactivar la alerta «Penicilina»' }));
    expect(await alertas.findByText('Penicilina (amoxicilina)')).toBeInTheDocument();
    expect(alertas.getByText('Inactiva')).toBeInTheDocument();
  });
});
