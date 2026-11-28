import {
  crearRelacionSchema,
  editarPacienteSchema,
  pacienteSchema,
  type Paciente,
} from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  diferida,
  IDS_PACIENTES,
  matriz,
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
import { PESTANAS_FICHA, pestanasVisibles } from './pestanas.js';

const RECEPCION = { permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION };
const ODONTOLOGO = { permisos: PERMISOS_ODONTOLOGO, rol: ROL_ODONTOLOGO };
const RUTA_ANA = `/pacientes/${IDS_PACIENTES.ana}`;

const ALERTA_ACTIVA = {
  id: IDS_PACIENTES.alerta,
  tipo: 'alergia' as const,
  texto: 'Alergia a la penicilina',
  activa: true,
  creadaEn: '2026-11-10T12:30:00Z',
  creadaPor: 'Dra. Marta Acosta',
};
const ALERTA_INACTIVA = {
  id: IDS_PACIENTES.alertaVieja,
  tipo: 'condicion' as const,
  texto: 'Embarazo',
  activa: false,
  creadaEn: '2025-03-01T12:30:00Z',
  creadaPor: 'Dra. Marta Acosta',
};

/** Ana con alertas: lo que ve quien tiene ficha clínica (con nota) o recepción (sin nota). */
function ana(parcial: Partial<Paciente> = {}): Paciente {
  return pacienteDe({ conAlerta: true, alertas: [ALERTA_ACTIVA, ALERTA_INACTIVA], ...parcial });
}

/**
 * Lo que haría la API con un `PATCH /pacientes/:id`: valida con el esquema del contrato, aplica
 * solo los campos conocidos y responde la ficha completa (no el cuerpo mandado).
 */
function editadoPorLaApi(p: Paciente, cuerpo: unknown): Paciente {
  const datos = editarPacienteSchema.parse(cuerpo);
  const limpio = Object.fromEntries(
    Object.entries(datos).filter(([k, v]) => v !== undefined && k !== 'confirmarCiDuplicada'),
  );
  return pacienteSchema.parse({ ...p, ...limpio });
}

const de = (pedidos: PedidoRegistrado[], metodo: string, ruta: string) =>
  pedidos.filter((p) => p.metodo === metodo && p.url.pathname === `/api/v1${ruta}`);

function seccion(nombre: string) {
  return within(screen.getByRole('region', { name: nombre }));
}

describe('Pacientes: pestañas de la ficha', () => {
  it('las pestañas clínicas solo se muestran con ficha_clinica:ver', () => {
    const pestanas = [
      { id: 'datos', clinica: false },
      { id: 'anamnesis', clinica: true },
    ];
    const recepcion = new Set(PERMISOS_RECEPCION.map((p) => `${p.modulo}:${p.accion}`));
    const odontologo = new Set(PERMISOS_ODONTOLOGO.map((p) => `${p.modulo}:${p.accion}`));
    expect(
      pestanasVisibles(pestanas, (m, a) => recepcion.has(`${m}:${a}`)).map((p) => p.id),
    ).toEqual(['datos']);
    expect(
      pestanasVisibles(pestanas, (m, a) => odontologo.has(`${m}:${a}`)).map((p) => p.id),
    ).toEqual(['datos', 'anamnesis']);
    // «Anamnesis» es clínica; «Historial» la ve quien ve la ficha (la API filtra lo clínico).
    expect(PESTANAS_FICHA.map((p) => [p.id, p.clinica])).toEqual([
      ['datos', false],
      ['anamnesis', true],
      ['historial', false],
    ]);
  });
});

describe('Pacientes: ficha', () => {
  it('cabecera con avatar, edad, CI, teléfono y alertas activas; abrirla pide la ficha', async () => {
    const f = montar({ 'GET /pacientes/:id': { cuerpo: ana() } }, RUTA_ANA, RECEPCION);
    expect(
      await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('34 años · CI 4.123.456 · 0981 123 456')).toBeInTheDocument();
    const alertas = within(screen.getByRole('region', { name: 'Alertas clínicas' }));
    expect(alertas.getByText('Alergia a la penicilina')).toBeInTheDocument();
    expect(alertas.queryByText('Embarazo')).toBeNull();
    expect(screen.getByRole('link', { name: 'Llamar' })).toHaveAttribute(
      'href',
      'tel:+595981123456',
    );
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      'https://wa.me/595981123456',
    );
    expect(de(f.pedidos, 'GET', RUTA_ANA)).toHaveLength(1);
    // Datos legibles.
    const datos = seccion('Datos personales');
    expect(datos.getByText('14 de mar de 1992 (34 años)')).toBeInTheDocument();
    expect(datos.getByText('Acepta')).toBeInTheDocument();
    expect(datos.getByText('Español')).toBeInTheDocument();
  });

  it('recepción: sin nota interna, sin pestañas clínicas y sin cargar alertas, pero ve las activas', async () => {
    montar({ 'GET /pacientes/:id': { cuerpo: ana() } }, RUTA_ANA, RECEPCION);
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    const pestanas = within(screen.getByRole('navigation', { name: 'Secciones de la ficha' }));
    expect(pestanas.getAllByRole('link').map((l) => l.textContent)).toEqual(['Datos', 'Historial']);
    expect(screen.queryByRole('region', { name: 'Nota interna' })).toBeNull();
    expect(screen.queryByText(/nota interna/i)).toBeNull();

    const alertas = seccion('Alertas');
    expect(alertas.getByText('Alergia a la penicilina')).toBeInTheDocument();
    expect(alertas.queryByText('Embarazo')).toBeNull();
    expect(alertas.queryByLabelText(/Nueva alerta/)).toBeNull();
    expect(alertas.queryByRole('button', { name: /Desactivar la alerta/ })).toBeNull();
    // Recepción edita datos y familia, pero no desactiva pacientes.
    expect(screen.getByRole('button', { name: 'Editar datos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar familiar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar paciente' })).toBeNull();
  });

  it('una pestaña que no existe (o que el rol no ve) vuelve a «Datos»', async () => {
    montar({ 'GET /pacientes/:id': { cuerpo: ana() } }, `${RUTA_ANA}/odontograma`, RECEPCION);
    expect(await screen.findByRole('link', { name: 'Datos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('odontólogo: ve y edita la nota interna, y carga y apaga alertas', async () => {
    let paciente = ana({ notaInterna: 'Prefiere turnos a la mañana.' });
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'PATCH /pacientes/:id': ({ cuerpo }) => {
          paciente = editadoPorLaApi(paciente, cuerpo);
          return { cuerpo: paciente };
        },
        'POST /pacientes/:id/alertas': ({ cuerpo }) => ({
          estado: 201,
          cuerpo: {
            id: uuid(713),
            tipo: (cuerpo as { tipo: 'alergia' | 'condicion' }).tipo,
            texto: (cuerpo as { texto: string }).texto,
            activa: true,
            creadaEn: '2026-11-20T15:00:00Z',
            creadaPor: 'Dr. Esteban Rojas',
          },
        }),
        'PATCH /alertas/:id': { cuerpo: { ...ALERTA_ACTIVA, activa: false } },
      },
      RUTA_ANA,
      ODONTOLOGO,
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });

    const nota = seccion('Nota interna');
    expect(nota.getByText('Prefiere turnos a la mañana.')).toBeInTheDocument();
    fireEvent.click(nota.getByRole('button', { name: 'Editar nota' }));
    fireEvent.change(nota.getByLabelText('Nota interna'), {
      target: { value: '  Prefiere turnos a la tarde.  ' },
    });
    fireEvent.click(nota.getByRole('button', { name: 'Guardar nota' }));
    expect(await nota.findByText('Prefiere turnos a la tarde.', { selector: 'p' })).toBeVisible();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA)[0]?.cuerpo).toEqual({
      notaInterna: 'Prefiere turnos a la tarde.',
    });

    // Vaciar la nota la borra (null).
    fireEvent.click(nota.getByRole('button', { name: 'Editar nota' }));
    fireEvent.change(nota.getByLabelText('Nota interna'), { target: { value: '' } });
    fireEvent.click(nota.getByRole('button', { name: 'Guardar nota' }));
    expect(await nota.findByText('Sin nota interna.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA)[1]?.cuerpo).toEqual({ notaInterna: null });

    const alertas = seccion('Alertas');
    // Con acceso clínico ve también las inactivas, con su estado.
    expect(alertas.getByText('Embarazo')).toBeInTheDocument();
    expect(alertas.getByText('Inactiva')).toBeInTheDocument();

    fireEvent.click(alertas.getByRole('button', { name: 'Agregar alerta' }));
    expect(await alertas.findByText('Escribí la alerta.')).toBeInTheDocument();
    expect(alertas.getByText('Elegí si es una alergia o una condición.')).toBeInTheDocument();
    fireEvent.click(alertas.getByRole('button', { name: 'Condición' }));
    fireEvent.change(alertas.getByLabelText(/Nueva alerta/), {
      target: { value: 'Toma anticoagulantes' },
    });
    fireEvent.click(alertas.getByRole('button', { name: 'Agregar alerta' }));
    expect(await alertas.findByText('Toma anticoagulantes')).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/alertas`)[0]?.cuerpo).toEqual({
      tipo: 'condicion',
      texto: 'Toma anticoagulantes',
    });
    // La nueva también aparece arriba, en sol (condición); la alergia sigue en coral.
    const cabecera = within(screen.getByRole('region', { name: 'Alertas clínicas' }));
    expect(cabecera.getByText('Toma anticoagulantes').closest('li')).toHaveClass(
      'cn-alerta--condicion',
    );
    expect(cabecera.getByText('Alergia a la penicilina').closest('li')).toHaveClass(
      'cn-alerta--alergia',
    );
    // En la lista, el tipo con su tono: alergia coral (atención), condición sol (progreso).
    const fila = (texto: string) => alertas.getByText(texto).closest('li') as HTMLElement;
    expect(
      within(fila('Alergia a la penicilina')).getByText('Alergia').closest('.cn-chip'),
    ).toHaveClass('cn-chip--atencion');
    expect(
      within(fila('Toma anticoagulantes')).getByText('Condición').closest('.cn-chip'),
    ).toHaveClass('cn-chip--progreso');

    fireEvent.click(
      alertas.getByRole('button', { name: 'Desactivar la alerta «Alergia a la penicilina»' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Alertas clínicas' })).queryByText(
          'Alergia a la penicilina',
        ),
      ).toBeNull(),
    );
    expect(de(f.pedidos, 'PATCH', `/alertas/${IDS_PACIENTES.alerta}`)[0]?.cuerpo).toEqual({
      activa: false,
    });
    expect(
      alertas.getByRole('button', { name: 'Activar la alerta «Alergia a la penicilina»' }),
    ).toBeInTheDocument();
  });

  it('un rol con ficha_clinica:ver sin editar ve la nota pero no la cambia ni carga alertas', async () => {
    montar(
      { 'GET /pacientes/:id': { cuerpo: ana({ notaInterna: 'Control cada 6 meses.' }) } },
      RUTA_ANA,
      {
        permisos: matriz([
          ['inicio', ['ver']],
          ['pacientes', ['ver']],
          ['ficha_clinica', ['ver']],
        ]),
      },
    );
    await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 });
    expect(seccion('Nota interna').getByText('Control cada 6 meses.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar nota' })).toBeNull();
    expect(screen.queryByLabelText(/Nueva alerta/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar datos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar familiar' })).toBeNull();
  });

  it('editar datos manda solo lo que cambió, y un campo vaciado va como null', async () => {
    let paciente = ana();
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'PATCH /pacientes/:id': ({ cuerpo }) => {
          paciente = editadoPorLaApi(paciente, cuerpo);
          return { cuerpo: paciente };
        },
      },
      RUTA_ANA,
      RECEPCION,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos del paciente' }));
    // El formulario muestra la CI y el teléfono como se escriben acá.
    expect(hoja.getByLabelText(/^Cédula/)).toHaveValue('4.123.456');
    expect(hoja.getByLabelText(/^Teléfono/)).toHaveValue('0981 123 456');

    // Sin cambios no se manda nada.
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await hoja.findByText('No hay cambios para guardar.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA)).toHaveLength(0);

    fireEvent.change(hoja.getByLabelText(/^Correo/), { target: { value: '' } });
    fireEvent.change(hoja.getByLabelText(/^Ciudad/), { target: { value: '   ' } });
    fireEvent.change(hoja.getByLabelText(/^Teléfono/), { target: { value: '0971 000 111' } });
    fireEvent.change(hoja.getByLabelText(/^Sexo/), { target: { value: '' } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Guardamos los cambios.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA)[0]?.cuerpo).toEqual({
      email: null,
      ciudad: null,
      telefono: '+595971000111',
      sexo: null,
    });
    expect(screen.getByText('34 años · CI 4.123.456 · 0971 000 111')).toBeInTheDocument();
  });

  it('editar con una CI que ya tiene otro paciente permite guardar igual', async () => {
    let paciente = ana();
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'PATCH /pacientes/:id': ({ cuerpo }) => {
          const c = cuerpo as { confirmarCiDuplicada?: boolean; ci?: string };
          if (!c.confirmarCiDuplicada) {
            return {
              estado: 409,
              cuerpo: {
                codigo: 'conflicto',
                mensaje: 'Esa cédula ya está cargada en otro paciente.',
                detalles: [{ campo: 'ci', mensaje: 'Ya la tiene Rosa Duarte.' }],
                existente: resumenDe({
                  id: IDS_PACIENTES.rosa,
                  nombres: 'Rosa',
                  apellidos: 'Duarte',
                  ci: '3333333',
                }),
              },
            };
          }
          paciente = editadoPorLaApi(paciente, c);
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
    expect(await hoja.findByText('La cédula 3.333.333 ya está cargada')).toBeInTheDocument();
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar igual' }));
    expect(await screen.findByText('Guardamos los cambios.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', RUTA_ANA).map((p) => p.cuerpo)).toEqual([
      { ci: '3333333' },
      { ci: '3333333', confirmarCiDuplicada: true },
    ]);
  });

  it('grupo familiar: busca al familiar, marca las dos puntas, edita las marcas y quita el vínculo', async () => {
    let paciente = ana();
    /** Lo que guarda la API, visto desde la ficha de Ana. */
    let relacion = {
      id: IDS_PACIENTES.relacion,
      familiar: { id: MATEO.id, nombre: 'Mateo Giménez', edad: 7, ci: null },
      tipo: 'hijo' as const,
      esTutorLegal: false,
      esResponsablePago: false,
      familiarEsTutorLegal: false,
      familiarEsResponsablePago: false,
    };
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'GET /pacientes': { cuerpo: { items: [resumenDe(), MATEO], siguienteCursor: null } },
        'POST /pacientes/:id/relaciones': ({ cuerpo }) => {
          const c = crearRelacionSchema.parse(cuerpo);
          relacion = {
            ...relacion,
            tipo: c.tipo as 'hijo',
            esTutorLegal: c.esTutorLegal,
            esResponsablePago: c.esResponsablePago,
            familiarEsTutorLegal: c.familiarEsTutorLegal,
            familiarEsResponsablePago: c.familiarEsResponsablePago,
          };
          paciente = { ...paciente, relaciones: [relacion] };
          return { estado: 201, cuerpo: relacion };
        },
        'PATCH /relaciones/:id': ({ cuerpo }) => {
          relacion = { ...relacion, ...(cuerpo as Partial<typeof relacion>) };
          paciente = { ...paciente, relaciones: [relacion] };
          return { cuerpo: relacion };
        },
        'DELETE /relaciones/:id': { estado: 204 },
      },
      RUTA_ANA,
      RECEPCION,
    );
    const familia = await screen.findByRole('region', { name: 'Grupo familiar' });
    expect(within(familia).getByText('Sin familiares vinculados.')).toBeInTheDocument();
    fireEvent.click(within(familia).getByRole('button', { name: 'Agregar familiar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Agregar familiar' }));

    // Sin familiar ni vínculo no se guarda.
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar vínculo' }));
    expect(await hoja.findByText('Elegí al familiar.')).toBeInTheDocument();
    expect(hoja.getByText('Elegí el vínculo.')).toBeInTheDocument();

    fireEvent.change(hoja.getByLabelText(/^Buscá al familiar/), { target: { value: 'Giménez' } });
    const opcion = await hoja.findByRole('button', { name: 'Elegir a Mateo Giménez' });
    // Ana no aparece: es la ficha abierta.
    expect(hoja.queryByRole('button', { name: 'Elegir a Ana Giménez' })).toBeNull();
    const busqueda = de(f.pedidos, 'GET', '/pacientes')[0]?.url.searchParams;
    expect(busqueda?.get('q')).toBe('Giménez');
    expect(busqueda?.get('limite')).toBe('20');
    fireEvent.click(opcion);

    // `tipo` dice qué es el familiar de quien está en la ficha: Mateo es hijo de Ana.
    fireEvent.change(hoja.getByLabelText('¿Qué es Mateo Giménez de Ana Giménez?'), {
      target: { value: 'hijo' },
    });
    // Las marcas de los dos lados, con los nombres y el género de cada uno.
    expect(hoja.getByLabelText('Mateo es tutor legal de Ana')).not.toBeChecked();
    expect(hoja.getByLabelText('Mateo paga los tratamientos de Ana')).not.toBeChecked();
    fireEvent.click(hoja.getByLabelText('Ana es tutora legal de Mateo'));
    fireEvent.click(hoja.getByLabelText('Ana paga los tratamientos de Mateo'));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar vínculo' }));

    expect(await screen.findByText('Agregamos el vínculo en las dos fichas.')).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/relaciones`)[0]?.cuerpo).toEqual({
      familiarId: MATEO.id,
      tipo: 'hijo',
      esTutorLegal: true,
      esResponsablePago: true,
      familiarEsTutorLegal: false,
      familiarEsResponsablePago: false,
    });
    const filas = within(screen.getByRole('region', { name: 'Grupo familiar' }));
    expect(filas.getByRole('link', { name: 'Mateo Giménez' })).toHaveAttribute(
      'href',
      `/pacientes/${MATEO.id}`,
    );
    const chipVinculo = filas
      .getByText('Hijo/a', { selector: '.cn-chip span' })
      .closest('.cn-chip');
    expect(chipVinculo).toHaveClass('cn-chip--familia');
    expect(chipVinculo?.querySelector('svg')).not.toBeNull();
    expect(filas.getByText('Ana es tutora legal')).toBeInTheDocument();
    expect(filas.getByText('Ana paga sus tratamientos')).toBeInTheDocument();

    // Editar las marcas: manda solo lo que cambió y muestra lo que respondió la API.
    fireEvent.click(
      filas.getByRole('button', {
        name: 'Editar tutor legal y pago del vínculo con Mateo Giménez',
      }),
    );
    const marcas = within(await screen.findByRole('dialog', { name: 'Vínculo con Mateo Giménez' }));
    expect(marcas.getByLabelText('Ana es tutora legal de Mateo Giménez')).toBeChecked();
    fireEvent.click(marcas.getByRole('button', { name: 'Guardar cambios' }));
    expect(await marcas.findByText('No hay cambios para guardar.')).toBeInTheDocument();
    fireEvent.click(marcas.getByLabelText('Ana paga los tratamientos de Mateo Giménez'));
    fireEvent.click(marcas.getByLabelText('Mateo Giménez paga los tratamientos de Ana'));
    fireEvent.click(marcas.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Guardamos los cambios del vínculo.')).toBeInTheDocument();
    expect(de(f.pedidos, 'PATCH', `/relaciones/${IDS_PACIENTES.relacion}`)[0]?.cuerpo).toEqual({
      esResponsablePago: false,
      familiarEsResponsablePago: true,
    });
    expect(filas.queryByText('Ana paga sus tratamientos')).toBeNull();
    expect(filas.getByText('Mateo Giménez paga sus tratamientos')).toBeInTheDocument();
    expect(filas.getByText('Ana es tutora legal')).toBeInTheDocument();

    fireEvent.click(filas.getByRole('button', { name: 'Quitar el vínculo con Mateo Giménez' }));
    const confirmar = within(
      await screen.findByRole('dialog', { name: '¿Quitar el vínculo con Mateo Giménez?' }),
    );
    fireEvent.click(confirmar.getByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByText('Quitamos el vínculo.')).toBeInTheDocument();
    expect(de(f.pedidos, 'DELETE', `/relaciones/${IDS_PACIENTES.relacion}`)).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'Grupo familiar' })).getByText(
        'Sin familiares vinculados.',
      ),
    ).toBeInTheDocument();
  });

  it('desactivar pide motivo; reactivar vuelve a dejarlo activo (pacientes:anular)', async () => {
    let paciente = ana();
    const respuesta = diferida<RespuestaFalsa>();
    const f = montar(
      {
        'GET /pacientes/:id': () => ({ cuerpo: paciente }),
        'POST /pacientes/:id/desactivar': async ({ cuerpo }) => {
          await respuesta.promesa;
          paciente = {
            ...paciente,
            activo: false,
            motivoBaja: (cuerpo as { motivo: string }).motivo,
          };
          return { cuerpo: paciente };
        },
        'POST /pacientes/:id/reactivar': () => {
          paciente = { ...paciente, activo: true, motivoBaja: null };
          return { cuerpo: paciente };
        },
      },
      RUTA_ANA,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar paciente' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Desactivar a Ana Giménez' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Desactivar' }));
    expect(await hoja.findByText('Contanos el motivo de la baja.')).toBeInTheDocument();
    fireEvent.change(hoja.getByLabelText(/Motivo/), {
      target: { value: 'Se mudó a Encarnación' },
    });
    // Doble clic: un solo pedido.
    fireEvent.click(hoja.getByRole('button', { name: 'Desactivar' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(de(f.pedidos, 'POST', `${RUTA_ANA}/desactivar`)).toHaveLength(1));
    respuesta.resolver({});

    expect(await screen.findByText('Este paciente está inactivo')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Se mudó a Encarnación')).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/desactivar`)[0]?.cuerpo).toEqual({
      motivo: 'Se mudó a Encarnación',
    });
    // Inactivo: no se edita.
    expect(screen.queryByRole('button', { name: 'Editar datos' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivar paciente' }));
    expect(await screen.findByText('El paciente está activo de nuevo.')).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/reactivar`)[0]?.cuerpo).toBeUndefined();
    expect(screen.queryByText('Este paciente está inactivo')).toBeNull();
  });

  it('un paciente que no existe lo dice y ofrece volver', async () => {
    montar(
      {
        'GET /pacientes/:id': {
          estado: 404,
          cuerpo: { codigo: 'no_encontrado', mensaje: 'No encontramos ese paciente.' },
        },
      },
      RUTA_ANA,
    );
    expect(
      await screen.findByText(
        'No encontramos este paciente. Puede que el enlace esté mal o que no sea de esta clínica.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Volver a pacientes' })[0]).toHaveAttribute(
      'href',
      '/pacientes',
    );
  });
});
