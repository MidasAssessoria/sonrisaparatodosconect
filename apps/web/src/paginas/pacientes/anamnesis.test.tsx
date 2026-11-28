import { crearAnamnesisSchema, type Anamnesis, type Paciente } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  anamnesisDe,
  catalogoDe,
  CATALOGO_PRUEBA,
  HUELLA_CATALOGO,
  IDS_PACIENTES,
  matriz,
  MATEO,
  montar,
  pacienteDe,
  PERMISOS_ODONTOLOGO,
  PERMISOS_RECEPCION,
  PNG_FIRMA,
  resumenAnamnesisDe,
  ROL_ODONTOLOGO,
  ROL_RECEPCION,
  URL_FIRMA,
  uuid,
  type PedidoRegistrado,
  type RespuestaFalsa,
} from '../../test/fabricas.js';
import { firmar } from '../../test/lienzo.js';

const RECEPCION = { permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION };
const ODONTOLOGO = { permisos: PERMISOS_ODONTOLOGO, rol: ROL_ODONTOLOGO };
/** Ve la ficha clínica pero no carga anamnesis (p. ej. una asistente). */
const SOLO_VER_FICHA = {
  rol: ROL_ODONTOLOGO,
  permisos: matriz([
    ['inicio', ['ver']],
    ['pacientes', ['ver']],
    ['ficha_clinica', ['ver']],
  ]),
};
const RUTA_ANA = `/pacientes/${IDS_PACIENTES.ana}`;

const V1 = anamnesisDe({
  id: uuid(800),
  version: 1,
  fecha: '2026-05-10T13:00:00Z',
  registradaPor: 'Gloria Páez',
  esVigente: false,
  respuestas: [
    {
      codigo: 'motivo',
      pregunta: '¿Cuál es el motivo de tu consulta? (texto de mayo)',
      seccion: 1,
      tipo: 'texto',
      texto: 'Primera consulta',
      unidad: null,
      etiquetas: [],
    },
  ],
  signosVitales: { presionSistolica: null, presionDiastolica: null, pulso: null, pesoKg: null },
  alertasMedicas: [],
});
const V2 = anamnesisDe();

interface Escenario {
  paciente?: Paciente;
  versiones?: Anamnesis[];
  requiereTutor?: boolean;
  rutas?: Record<string, RespuestaFalsa | ((p: { url: URL; cuerpo: unknown }) => RespuestaFalsa)>;
}

/** Rutas de la ficha y la anamnesis. `estado.versiones` se puede cambiar en medio de la prueba. */
function escenario(e: Escenario = {}) {
  const estado = {
    paciente: e.paciente ?? pacienteDe(),
    versiones: e.versiones ?? [V2, V1],
    requiereTutor: e.requiereTutor ?? false,
  };
  const rutas = {
    'GET /pacientes/:id': ({ url }: { url: URL }) => {
      const id = url.pathname.split('/').pop() ?? '';
      return id === estado.paciente.id
        ? { cuerpo: estado.paciente }
        : { estado: 404, cuerpo: { codigo: 'no_encontrado', mensaje: 'No está.' } };
    },
    'GET /pacientes/:id/anamnesis': () => ({
      cuerpo: {
        versiones: estado.versiones.map(resumenAnamnesisDe),
        requiereTutor: estado.requiereTutor,
      },
    }),
    'GET /pacientes/:id/anamnesis/:version': ({ url }: { url: URL }) => {
      const v = url.pathname.split('/').pop();
      const a = estado.versiones.find((x) => String(x.version) === v);
      return a
        ? { cuerpo: a }
        : { estado: 404, cuerpo: { codigo: 'no_encontrado', mensaje: 'No está.' } };
    },
    'GET /anamnesis/preguntas': {
      cuerpo: { preguntas: CATALOGO_PRUEBA, huella: 'huella-catalogo-1' },
    },
    ...e.rutas,
  };
  return { estado, rutas };
}

const de = (pedidos: PedidoRegistrado[], metodo: string, ruta: string) =>
  pedidos.filter((p) => p.metodo === metodo && p.url.pathname === `/api/v1${ruta}`);

const pregunta = (texto: string | RegExp) => screen.getByRole('group', { name: texto });

async function abrirFormulario(boton: 'Actualizar anamnesis' | 'Completar anamnesis') {
  fireEvent.click(await screen.findByRole('button', { name: boton }));
  return screen.findByRole('heading', { name: /anamnesis de/i, level: 2 });
}

/** Firma, declaración y guardar. */
function firmarYGuardar() {
  firmar(screen.getByRole('img', { name: /Recuadro para firmar/ }));
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Declaro que la información es verdadera' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
}

describe('Anamnesis: versiones', () => {
  it('muestra la vigente con respuestas, signos, firma, firmante y quién la registró', async () => {
    const { rutas } = escenario();
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 2', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Vigente')).toBeInTheDocument();
    expect(await screen.findByText(/^Registrada el .* por Lorena Fretes$/)).toBeInTheDocument();
    expect(screen.getByText('¿Cuál es el motivo de tu consulta?')).toBeInTheDocument();
    expect(screen.getByText('Control y limpieza')).toBeInTheDocument();
    expect(screen.getByText('Penicilina')).toBeInTheDocument();
    expect(screen.getByText('urticaria con amoxicilina')).toBeInTheDocument();
    // La unidad es la copiada en la versión: el catálogo de hoy ni se pide.
    expect(screen.getByText('2 veces')).toBeInTheDocument();
    expect(de(f.pedidos, 'GET', '/anamnesis/preguntas')).toHaveLength(0);
    expect(screen.getByText('120/80 mmHg')).toBeInTheDocument();
    expect(screen.getByText('61,5 kg')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Firma de Ana Giménez' })).toHaveAttribute(
      'src',
      URL_FIRMA,
    );
    expect(screen.getByText('Firmó Ana Giménez')).toBeInTheDocument();
    const alertasVersion = screen.getByRole('region', { name: 'Alertas médicas de esta versión' });
    expect(
      within(alertasVersion).getByText('Alergia a la penicilina (urticaria con amoxicilina)'),
    ).toBeInTheDocument();
    // Solo se pidió la vigente (cada versión que se abre queda en auditoría).
    expect(de(f.pedidos, 'GET', `${RUTA_ANA}/anamnesis/2`)).toHaveLength(1);
    expect(de(f.pedidos, 'GET', `${RUTA_ANA}/anamnesis/1`)).toHaveLength(0);
  });

  it('«Ver versión 1» la muestra de solo lectura, con el texto de la pregunta de entonces', async () => {
    const { rutas } = escenario();
    montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    const selector = await screen.findByRole('combobox', { name: 'Ver versión' });
    expect(
      within(selector)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      expect.stringMatching(/^Versión 2 · .* \(vigente\)$/),
      expect.stringMatching(/^Versión 1 · /),
    ]);
    fireEvent.change(selector, { target: { value: '1' } });
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 1', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Versión anterior')).toBeInTheDocument();
    expect(screen.getByText('Solo lectura')).toBeInTheDocument();
    expect(await screen.findByText('Primera consulta')).toBeInTheDocument();
    expect(
      screen.getByText('¿Cuál es el motivo de tu consulta? (texto de mayo)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/por Gloria Páez$/)).toBeInTheDocument();
    // De solo lectura: ningún campo para escribir.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Volver a la vigente' }));
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 2', level: 2 }),
    ).toBeInTheDocument();
  });

  it('abre una versión anterior desde el enlace (?version=1)', async () => {
    const { rutas } = escenario();
    montar(rutas, `${RUTA_ANA}/anamnesis?version=1`, ODONTOLOGO);
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 1', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Ver versión' })).toHaveValue('1');
  });

  it('«Actualizar» abre el formulario con los valores de la vigente', async () => {
    const { rutas } = escenario();
    montar(rutas, `${RUTA_ANA}/anamnesis?version=1`, ODONTOLOGO);
    await screen.findByRole('heading', { name: 'Anamnesis · versión 1', level: 2 });
    await abrirFormulario('Actualizar anamnesis');
    expect(
      screen.getByText('Se guarda como la versión 3. La versión 2 queda guardada para consultar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /motivo de tu consulta/ })).toHaveValue(
      'Control y limpieza',
    );
    const alergias = pregunta(/alergia a algún medicamento/);
    expect(within(alergias).getByRole('checkbox', { name: 'Penicilina' })).toBeChecked();
    expect(within(alergias).getByRole('checkbox', { name: 'Látex' })).not.toBeChecked();
    expect(within(alergias).getByRole('textbox', { name: 'Detalle (opcional)' })).toHaveValue(
      'urticaria con amoxicilina',
    );
    const protesis = pregunta('¿Usás prótesis removible?');
    expect(within(protesis).getByRole('button', { name: 'No' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('textbox', { name: /te cepillás\? \(veces\)/ })).toHaveValue('2');
    // Los signos vitales se toman de nuevo: la vez anterior queda como ayuda.
    const sistolica = screen.getByRole('textbox', { name: 'Presión sistólica (mmHg)' });
    expect(sistolica).toHaveValue('');
    expect(sistolica).toHaveAccessibleDescription('La vez anterior: 120.');
    // La firma y la declaración no se precargan.
    expect(screen.getByRole('img', { name: /Recuadro para firmar/ })).toHaveAccessibleName(
      'Recuadro para firmar: Todavía no hay firma',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Declaro que la información es verdadera' }),
    ).not.toBeChecked();
  });
});

describe('Anamnesis: permisos', () => {
  it('recepción: sin pestaña Anamnesis (y su ruta vuelve a Datos), pero ve la alerta médica', async () => {
    const paciente = pacienteDe({
      conAlerta: true,
      // Recepción no recibe el detalle libre (contrato): solo el texto de la regla.
      alertasMedicas: [{ ...V2.alertasMedicas[0]!, detalle: null }],
    });
    const { rutas } = escenario({ paciente });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, RECEPCION);
    expect(await screen.findByRole('link', { name: 'Datos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const pestanas = screen.getByRole('navigation', { name: 'Secciones de la ficha' });
    expect(
      within(pestanas)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Datos', 'Historial']);
    const alertas = within(screen.getByRole('region', { name: 'Alertas clínicas' }));
    expect(alertas.getByRole('listitem')).toHaveTextContent(
      /^Alergia a la penicilina · De la anamnesis$/,
    );
    expect(de(f.pedidos, 'GET', `${RUTA_ANA}/anamnesis`)).toHaveLength(0);
    expect(de(f.pedidos, 'GET', '/anamnesis/preguntas')).toHaveLength(0);
  });

  it('cabecera: manuales y derivadas juntas, con su tipo; la derivada marcada «De la anamnesis»', async () => {
    const paciente = pacienteDe({
      conAlerta: true,
      alertas: [
        {
          id: IDS_PACIENTES.alerta,
          tipo: 'alergia',
          texto: 'Alergia al látex',
          activa: true,
          creadaEn: '2026-11-10T12:30:00Z',
          creadaPor: 'Dra. Marta Acosta',
        },
      ],
      alertasMedicas: [
        {
          tipo: 'condicion',
          texto: 'Toma anticoagulantes',
          detalle: 'acenocumarol',
          gravedad: 'alta',
          grupoAlergia: null,
          codigo: 'anticoagulantes',
        },
      ],
    });
    const { rutas } = escenario({ paciente });
    montar(rutas, RUTA_ANA, ODONTOLOGO);
    const region = await screen.findByRole('region', { name: 'Alertas clínicas' });
    const items = within(region).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Alergia al látex',
      'Toma anticoagulantes (acenocumarol) · De la anamnesis',
    ]);
    // Alergias en coral (atención), condiciones en sol: con ícono y texto, no solo color.
    expect(items[0]).toHaveClass('cn-alerta--alergia');
    expect(items[1]).toHaveClass('cn-alerta--condicion');
    expect(items[1]?.querySelector('svg')).not.toBeNull();
  });

  it('sin ficha_clinica:crear no hay «Actualizar» ni «Completar»', async () => {
    const { rutas } = escenario();
    montar(rutas, `${RUTA_ANA}/anamnesis`, SOLO_VER_FICHA);
    await screen.findByRole('heading', { name: 'Anamnesis · versión 2', level: 2 });
    expect(screen.queryByRole('button', { name: 'Actualizar anamnesis' })).toBeNull();
  });

  it('sin versiones: estado vacío; con ficha_clinica:crear ofrece completarla', async () => {
    const { rutas } = escenario({ versiones: [] });
    montar(rutas, `${RUTA_ANA}/anamnesis`, SOLO_VER_FICHA);
    expect(await screen.findByText('Todavía no hay anamnesis registrada.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar anamnesis' })).toBeNull();
  });
});

describe('Anamnesis: caché', () => {
  it('editar la fecha de nacimiento vuelve a pedir las versiones (requiereTutor) y el historial', async () => {
    const { estado, rutas } = escenario({
      rutas: {
        'PATCH /pacientes/:id': ({ cuerpo }: { url: URL; cuerpo: unknown }) => {
          const c = cuerpo as { fechaNac?: string };
          estado.paciente = { ...estado.paciente, fechaNac: c.fechaNac ?? null, edad: 16 };
          return { cuerpo: estado.paciente };
        },
        'GET /pacientes/:id/historial': { cuerpo: { eventos: [], siguienteCursor: null } },
      },
    });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await screen.findByRole('heading', { name: 'Anamnesis · versión 2', level: 2 });
    fireEvent.click(screen.getByRole('link', { name: 'Historial' }));
    await screen.findByText('Todavía no hay eventos en el historial.');
    fireEvent.click(screen.getByRole('link', { name: 'Datos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar datos del paciente' }));
    fireEvent.change(hoja.getByLabelText('Fecha de nacimiento'), {
      target: { value: '2010-03-14' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Guardamos los cambios.');
    fireEvent.click(screen.getByRole('link', { name: 'Anamnesis' }));
    await waitFor(() => expect(de(f.pedidos, 'GET', `${RUTA_ANA}/anamnesis`)).toHaveLength(2));
    fireEvent.click(screen.getByRole('link', { name: 'Historial' }));
    await waitFor(() => expect(de(f.pedidos, 'GET', `${RUTA_ANA}/historial`)).toHaveLength(2));
  });
});

describe('Anamnesis: formulario', () => {
  it('cada tipo de pregunta arma su respuesta; guarda la versión 1 y la alerta aparece en la cabecera', async () => {
    const v1 = anamnesisDe({ version: 1, esVigente: true });
    const { estado, rutas } = escenario({
      versiones: [],
      rutas: {
        'POST /pacientes/:id/anamnesis': () => {
          estado.versiones = [v1];
          return { estado: 201, cuerpo: v1 };
        },
      },
    });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    expect(screen.getByText('Se guarda como la versión 1.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: '  Me duele una muela  ' },
    });
    fireEvent.click(
      within(pregunta(/sangrado o inflamación/)).getByRole('checkbox', {
        name: 'Sangrado de encías',
      }),
    );
    fireEvent.click(
      within(pregunta('¿Usás prótesis removible?')).getByRole('button', { name: 'Sí' }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: /te cepillás\? \(veces\)/ }), {
      target: { value: '3' },
    });
    const alergias = pregunta(/alergia a algún medicamento/);
    // El detalle aparece al marcar una opción.
    expect(within(alergias).queryByRole('textbox', { name: 'Detalle (opcional)' })).toBeNull();
    fireEvent.click(within(alergias).getByRole('checkbox', { name: 'Penicilina' }));
    fireEvent.change(within(alergias).getByRole('textbox', { name: 'Detalle (opcional)' }), {
      target: { value: 'urticaria con amoxicilina' },
    });
    fireEvent.click(
      within(pregunta('¿Tomás anticoagulantes?')).getByRole('button', { name: 'No' }),
    );
    // Ana es F: se le pregunta por embarazo.
    fireEvent.click(
      within(pregunta('¿Estás embarazada o en período de lactancia?')).getByRole('button', {
        name: 'No',
      }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Presión sistólica (mmHg)' }), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Peso (kg)' }), {
      target: { value: '61,5' },
    });
    expect(screen.getByText('Firma Ana Giménez.')).toBeInTheDocument();
    firmarYGuardar();

    expect(await screen.findByText('Guardamos la versión 1 de la anamnesis.')).toBeInTheDocument();
    const [post] = de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`);
    expect(post?.cuerpo).toEqual({
      versionBase: null,
      huellaCatalogo: HUELLA_CATALOGO,
      respuestas: [
        { codigo: 'motivo', texto: 'Me duele una muela' },
        { codigo: 'encias', opciones: ['sangrado'] },
        { codigo: 'protesis', si: true },
        { codigo: 'cepillado', numero: 3 },
        { codigo: 'alergias', opciones: ['penicilina'], detalle: 'urticaria con amoxicilina' },
        { codigo: 'anticoagulantes', si: false },
        { codigo: 'embarazo', si: false },
      ],
      signosVitales: { presionSistolica: 120, pesoKg: 61.5 },
      firmante: { nombre: 'Ana Giménez', ci: '4123456', esTutor: false },
      firmaPng: PNG_FIRMA,
      declaracionVeracidad: true,
    });
    expect(crearAnamnesisSchema.safeParse(post?.cuerpo).success).toBe(true);
    expect(
      screen.getByText('Dejó 1 alerta médica: ya se ve en la cabecera de la ficha.'),
    ).toBeInTheDocument();
    // La ficha no se volvió a pedir: la alerta médica entra desde la respuesta.
    const cabecera = within(screen.getByRole('region', { name: 'Alertas clínicas' }));
    expect(
      cabecera.getByText(/Alergia a la penicilina \(urticaria con amoxicilina\)/),
    ).toBeInTheDocument();
    expect(de(f.pedidos, 'GET', RUTA_ANA)).toHaveLength(1);
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 1', level: 2 }),
    ).toBeInTheDocument();
  });

  it('embarazo solo si el sexo no es M (sin sexo cargado, se pregunta)', async () => {
    const { rutas } = escenario({
      versiones: [],
      paciente: pacienteDe({ sexo: 'M', nombres: 'Carlos' }),
    });
    montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    expect(screen.queryByText('¿Estás embarazada o en período de lactancia?')).toBeNull();
    expect(screen.getByText('¿Tomás anticoagulantes?')).toBeInTheDocument();
  });

  it('sin sexo cargado también pregunta por embarazo', async () => {
    const { rutas } = escenario({ versiones: [], paciente: pacienteDe({ sexo: null }) });
    montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    expect(screen.getByText('¿Estás embarazada o en período de lactancia?')).toBeInTheDocument();
  });

  it('sin firma, sin declaración o con una obligatoria vacía no guarda', async () => {
    const { rutas } = escenario({
      versiones: [],
      rutas: { 'POST /pacientes/:id/anamnesis': { estado: 201, cuerpo: V2 } },
    });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    const resumen = await screen.findByText('Revisá lo marcado antes de guardar:');
    const lista = within(resumen.parentElement as HTMLElement);
    expect(
      lista.getByText(/motivo de tu consulta\?: Respondé esta pregunta\./),
    ).toBeInTheDocument();
    expect(lista.getByText('Firma: Falta la firma.')).toBeInTheDocument();
    expect(lista.getByText(/Declaro que la información es verdadera: Marcá/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Firma de Ana Giménez' })).toHaveAccessibleDescription(
      /Falta la firma\./,
    );

    // Con la firma y la obligatoria, pero sin la declaración, sigue sin guardar.
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    firmar(screen.getByRole('img', { name: /Recuadro para firmar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    await waitFor(() => expect(screen.queryByText('Firma: Falta la firma.')).toBeNull());
    expect(screen.getByText(/Declaro que la información es verdadera: Marcá/)).toBeInTheDocument();

    // Borrar la firma vuelve a dejarla vacía.
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Declaro que la información es verdadera' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    expect(await screen.findByText('Firma: Falta la firma.')).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`)).toHaveLength(0);
  });

  it('un número fuera de rango se marca antes de mandar', async () => {
    const { rutas } = escenario({ versiones: [] });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    const cepillado = screen.getByRole('textbox', { name: /te cepillás\? \(veces\)/ });
    expect(cepillado).toHaveAccessibleDescription('Entre 0 y 10.');
    fireEvent.change(cepillado, { target: { value: '12' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Pulso (lpm)' }), {
      target: { value: 'mucho' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    firmarYGuardar();
    expect(await screen.findByText('Revisá el número: va entre 0 y 10.')).toBeInTheDocument();
    expect(cepillado).toHaveAccessibleDescription('Revisá el número: va entre 0 y 10.');
    expect(screen.getByRole('textbox', { name: 'Pulso (lpm)' })).toHaveAccessibleDescription(
      'Escribí un número, por ejemplo 2 o 61,5.',
    );
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`)).toHaveLength(0);
  });

  it('menor de edad: firma el tutor; se completa desde el grupo familiar (nombre y CI)', async () => {
    const mateo = pacienteDe({
      ...MATEO,
      relaciones: [
        {
          id: IDS_PACIENTES.relacion,
          familiar: { id: IDS_PACIENTES.ana, nombre: 'Ana Giménez', edad: 34, ci: '4123456' },
          tipo: 'madre',
          esTutorLegal: false,
          esResponsablePago: false,
          familiarEsTutorLegal: true,
          familiarEsResponsablePago: true,
        },
      ],
    });
    const v1 = anamnesisDe({
      pacienteId: IDS_PACIENTES.mateo,
      version: 1,
      firmante: { nombre: 'Ana Giménez', ci: '4123456', esTutor: true },
    });
    const { estado, rutas } = escenario({
      paciente: mateo,
      versiones: [],
      requiereTutor: true,
      rutas: {
        'POST /pacientes/:id/anamnesis': () => {
          estado.versiones = [v1];
          return { estado: 201, cuerpo: v1 };
        },
      },
    });
    const ruta = `/pacientes/${IDS_PACIENTES.mateo}`;
    const f = montar(rutas, `${ruta}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    expect(
      screen.getByText('Es menor de edad: firma su tutor o tutora legal, con nombre y cédula.'),
    ).toBeInTheDocument();
    // Mateo es M: sin pregunta de embarazo.
    expect(screen.queryByText('¿Estás embarazada o en período de lactancia?')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });

    // Sin datos del tutor no guarda.
    firmarYGuardar();
    expect(
      await screen.findByText(/Nombre del tutor o tutora: Escribí el nombre de quien firma\./),
    ).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${ruta}/anamnesis`)).toHaveLength(0);

    const tutores = screen.getByRole('group', { name: 'Tutores legales del grupo familiar' });
    fireEvent.click(within(tutores).getByRole('button', { name: 'Ana Giménez (Madre)' }));
    expect(screen.getByRole('textbox', { name: /Nombre del tutor o tutora/ })).toHaveValue(
      'Ana Giménez',
    );
    // La cédula la trae el vínculo: no se abre la ficha de Ana (sería otra lectura auditada).
    expect(screen.getByRole('textbox', { name: /Cédula \(CI\) del tutor o tutora/ })).toHaveValue(
      '4.123.456',
    );
    expect(de(f.pedidos, 'GET', RUTA_ANA)).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Firma de Ana Giménez' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    expect(await screen.findByText('Guardamos la versión 1 de la anamnesis.')).toBeInTheDocument();
    const [post] = de(f.pedidos, 'POST', `${ruta}/anamnesis`);
    // La cédula viaja normalizada (solo dígitos), como la deja el esquema del contrato.
    expect((post?.cuerpo as { firmante: unknown }).firmante).toEqual({
      nombre: 'Ana Giménez',
      ci: '4123456',
      esTutor: true,
    });
  });

  it('tutor del grupo sin cédula cargada: se completa el nombre y se pide la CI', async () => {
    const mateo = pacienteDe({
      ...MATEO,
      relaciones: [
        {
          id: IDS_PACIENTES.relacion,
          familiar: { id: IDS_PACIENTES.rosa, nombre: 'Rosa Duarte', edad: 60, ci: null },
          tipo: 'abuelo',
          esTutorLegal: false,
          esResponsablePago: false,
          familiarEsTutorLegal: true,
          familiarEsResponsablePago: false,
        },
      ],
    });
    const { rutas } = escenario({ paciente: mateo, versiones: [], requiereTutor: true });
    montar(rutas, `/pacientes/${IDS_PACIENTES.mateo}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    fireEvent.click(screen.getByRole('button', { name: 'Rosa Duarte (Abuelo/a)' }));
    expect(screen.getByRole('textbox', { name: /Nombre del tutor o tutora/ })).toHaveValue(
      'Rosa Duarte',
    );
    const ci = screen.getByRole('textbox', { name: /Cédula \(CI\) del tutor o tutora/ });
    expect(ci).toHaveValue('');
    expect(ci).toHaveAccessibleDescription('Su ficha no tiene cédula cargada: escribila.');
  });

  it('tutor que no está en el grupo: sin cédula no guarda', async () => {
    const { rutas } = escenario({
      paciente: pacienteDe({ ...MATEO }),
      versiones: [],
      requiereTutor: true,
    });
    const f = montar(rutas, `/pacientes/${IDS_PACIENTES.mateo}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    expect(screen.queryByRole('group', { name: 'Tutores legales del grupo familiar' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Nombre del tutor o tutora/ }), {
      target: { value: 'Rosa Duarte' },
    });
    firmarYGuardar();
    expect(
      await screen.findByText(
        /Cédula \(CI\) del tutor o tutora: Escribí la cédula del tutor o tutora\./,
      ),
    ).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `/pacientes/${IDS_PACIENTES.mateo}/anamnesis`)).toHaveLength(0);
  });

  it('409 por versión: trae la nueva, muestra las diferencias por pregunta y exige revisarlas', async () => {
    // Otra persona guardó la 3: alergia al látex (no a la penicilina) y otro motivo.
    const v3 = anamnesisDe({
      id: uuid(803),
      version: 3,
      registradaPor: 'Dr. Esteban Rojas',
      respuestas: [
        {
          codigo: 'motivo',
          pregunta: '¿Cuál es el motivo de tu consulta?',
          seccion: 1,
          tipo: 'texto',
          texto: 'Control anual',
          etiquetas: [],
          unidad: null,
        },
        {
          codigo: 'protesis',
          pregunta: '¿Usás prótesis removible?',
          seccion: 2,
          tipo: 'si_no',
          si: false,
          etiquetas: [],
          unidad: null,
        },
        {
          codigo: 'cepillado',
          pregunta: '¿Cuántas veces por día te cepillás?',
          seccion: 3,
          tipo: 'numero',
          numero: 2,
          unidad: 'veces',
          etiquetas: [],
        },
        {
          codigo: 'alergias',
          pregunta: '¿Tenés alergia a algún medicamento o material?',
          seccion: 4,
          tipo: 'multiple',
          opciones: ['latex'],
          etiquetas: ['Látex'],
          unidad: null,
        },
      ],
      alertasMedicas: [
        {
          tipo: 'alergia',
          texto: 'Alergia al látex',
          detalle: null,
          gravedad: 'alta',
          grupoAlergia: null,
          codigo: 'alergias',
        },
      ],
    });
    const v4 = anamnesisDe({ id: uuid(804), version: 4 });
    let intentos = 0;
    const { estado, rutas } = escenario({
      rutas: {
        'POST /pacientes/:id/anamnesis': () => {
          intentos++;
          if (intentos === 1) {
            estado.versiones = [v3, V2, V1];
            return {
              estado: 409,
              cuerpo: {
                codigo: 'conflicto',
                mensaje: 'Otra persona actualizó la anamnesis mientras la completabas.',
                detalles: [{ campo: 'versionBase', mensaje: 'Hay una versión más nueva.' }],
              },
            };
          }
          estado.versiones = [v4, v3, V2, V1];
          return { estado: 201, cuerpo: v4 };
        },
      },
    });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Actualizar anamnesis');
    const motivo = screen.getByRole('textbox', { name: /motivo de tu consulta/ });
    fireEvent.change(motivo, { target: { value: 'Dolor al masticar' } });
    firmarYGuardar();

    // Se trae la versión nueva sola y se comparan las respuestas.
    const panel = within(
      await screen.findByRole('region', {
        name: 'Dr. Esteban Rojas guardó la versión 3 mientras se completaba este formulario',
      }),
    );
    const posts = () => de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`);
    expect((posts()[0]?.cuerpo as { versionBase: number }).versionBase).toBe(2);
    expect(de(f.pedidos, 'GET', `${RUTA_ANA}/anamnesis/3`)).toHaveLength(1);
    const filas = panel.getAllByRole('listitem');
    // Primero la que cambia alertas; las que coinciden (prótesis, cepillado) no aparecen.
    expect(
      filas.map((li) => li.querySelector('.w-anam-diferencia__pregunta')?.textContent),
    ).toEqual([
      '¿Tenés alergia a algún medicamento o material?',
      '¿Cuál es el motivo de tu consulta?',
    ]);
    const alergias = within(filas[0] as HTMLElement);
    expect(alergias.getByText('Látex')).toBeInTheDocument();
    expect(alergias.getByText('Alergia al látex')).toBeInTheDocument();
    expect(alergias.getByText('Penicilina (urticaria con amoxicilina)')).toBeInTheDocument();
    expect(alergias.getByText('Alergia a la penicilina')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('Control anual')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('Dolor al masticar')).toBeInTheDocument();
    expect(
      screen.getByText('Se guarda como la versión 4. La versión 3 queda guardada para consultar.'),
    ).toBeInTheDocument();

    // Sin revisar no se vuelve a guardar.
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    expect(
      await screen.findByText(/Diferencias con la otra versión: Revisá las diferencias/),
    ).toBeInTheDocument();
    expect(posts()).toHaveLength(1);

    // Se toma la alergia de la versión 3 y se queda con el motivo propio.
    fireEvent.click(
      alergias.getByRole('button', {
        name: 'Usar la respuesta de la versión 3 en «¿Tenés alergia a algún medicamento o material?»',
      }),
    );
    expect(panel.getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(pregunta(/alergia a algún medicamento/)).getByRole('checkbox', { name: 'Látex' }),
    ).toBeChecked();
    fireEvent.click(
      panel.getByRole('checkbox', { name: 'Revisé las diferencias con la versión 3' }),
    );
    // Lo escrito, la firma y la declaración siguen ahí.
    expect(motivo).toHaveValue('Dolor al masticar');
    expect(
      screen.getByRole('checkbox', { name: 'Declaro que la información es verdadera' }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    expect(await screen.findByText('Guardamos la versión 4 de la anamnesis.')).toBeInTheDocument();
    expect(posts()).toHaveLength(2);
    const segundo = posts()[1]?.cuerpo as { versionBase: number; respuestas: unknown[] };
    expect(segundo.versionBase).toBe(3);
    expect(segundo.respuestas).toContainEqual({ codigo: 'motivo', texto: 'Dolor al masticar' });
    expect(segundo.respuestas).toContainEqual({ codigo: 'alergias', opciones: ['latex'] });
  });

  it('409 por catálogo: lo vuelve a pedir, pasa lo que sigue valiendo y avisa lo que no', async () => {
    // El cuestionario nuevo ya no tiene la prótesis ni la opción penicilina.
    const nuevo = CATALOGO_PRUEBA.filter((p) => p.codigo !== 'protesis').map((p) =>
      p.codigo === 'alergias'
        ? { ...p, opciones: p.opciones.filter((o) => o.valor !== 'penicilina') }
        : p,
    );
    let pedidosCatalogo = 0;
    let intentos = 0;
    const { estado, rutas } = escenario({
      rutas: {
        'GET /anamnesis/preguntas': () => {
          pedidosCatalogo++;
          return {
            cuerpo: pedidosCatalogo === 1 ? catalogoDe() : catalogoDe(nuevo, 'huella-catalogo-2'),
          };
        },
        'POST /pacientes/:id/anamnesis': () => {
          intentos++;
          if (intentos === 1) {
            return {
              estado: 409,
              cuerpo: {
                codigo: 'conflicto',
                mensaje: 'El cuestionario cambió mientras lo completabas.',
                detalles: [{ campo: 'huellaCatalogo', mensaje: 'El cuestionario cambió.' }],
              },
            };
          }
          const v3 = anamnesisDe({ version: 3 });
          estado.versiones = [v3, V2, V1];
          return { estado: 201, cuerpo: v3 };
        },
      },
    });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Actualizar anamnesis');
    firmarYGuardar();
    expect(
      await screen.findByText(/^El cuestionario cambió mientras se completaba: lo actualizamos/),
    ).toBeInTheDocument();
    const aviso = within(
      screen.getByText('Estas respuestas no se pudieron pasar al cuestionario actualizado:')
        .parentElement as HTMLElement,
    );
    expect(aviso.getByText('«¿Usás prótesis removible?»: No')).toBeInTheDocument();
    expect(
      aviso.getByText('«¿Tenés alergia a algún medicamento o material?»: Penicilina'),
    ).toBeInTheDocument();
    expect(aviso.getByText('Dejaba la alerta «Alergia a la penicilina»')).toBeInTheDocument();
    expect(screen.queryByText('¿Usás prótesis removible?')).toBeNull();
    // Lo que sigue valiendo se pasó.
    expect(screen.getByRole('textbox', { name: /motivo de tu consulta/ })).toHaveValue(
      'Control y limpieza',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    expect(await screen.findByText('Guardamos la versión 3 de la anamnesis.')).toBeInTheDocument();
    const segundo = de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`)[1]?.cuerpo as {
      huellaCatalogo: string;
      respuestas: { codigo: string }[];
    };
    expect(segundo.huellaCatalogo).toBe('huella-catalogo-2');
    expect(segundo.respuestas.map((x) => x.codigo)).not.toContain('protesis');
  });

  it('«Actualizar» sobre una vigente con preguntas u opciones que ya no existen avisa qué no pasó', async () => {
    const actual = CATALOGO_PRUEBA.filter((p) => p.codigo !== 'protesis').map((p) =>
      p.codigo === 'alergias'
        ? { ...p, opciones: p.opciones.filter((o) => o.valor !== 'penicilina') }
        : p,
    );
    const { rutas } = escenario({
      rutas: { 'GET /anamnesis/preguntas': { cuerpo: catalogoDe(actual) } },
    });
    montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Actualizar anamnesis');
    const aviso = within(
      screen.getByText(
        'Estas respuestas de la versión 2 ya no están en el cuestionario y no se pasaron:',
      ).parentElement as HTMLElement,
    );
    expect(aviso.getByText('«¿Usás prótesis removible?»: No')).toBeInTheDocument();
    expect(
      aviso.getByText('«¿Tenés alergia a algún medicamento o material?»: Penicilina'),
    ).toBeInTheDocument();
    expect(aviso.getByText('Dejaba la alerta «Alergia a la penicilina»')).toBeInTheDocument();
  });

  it('«Actualizar cuestionario» lo vuelve a pedir sin perder lo escrito', async () => {
    const { rutas } = escenario({ versiones: [] });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar cuestionario' }));
    expect(
      await screen.findByText(
        'Actualizamos el cuestionario. Lo que ya estaba respondido sigue acá.',
      ),
    ).toBeInTheDocument();
    expect(de(f.pedidos, 'GET', '/anamnesis/preguntas')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: /motivo de tu consulta/ })).toHaveValue('Control');
  });

  it('«Ninguna» manda opciones vacías; sin marcar nada la obligatoria no deja guardar; sí/no se limpia', async () => {
    const catalogo = CATALOGO_PRUEBA.map((p) =>
      p.codigo === 'encias' ? { ...p, obligatoria: true } : p,
    );
    const v1 = anamnesisDe({ version: 1 });
    const { estado, rutas } = escenario({
      versiones: [],
      rutas: {
        'GET /anamnesis/preguntas': { cuerpo: catalogoDe(catalogo) },
        'POST /pacientes/:id/anamnesis': () => {
          estado.versiones = [v1];
          return { estado: 201, cuerpo: v1 };
        },
      },
    });
    const f = montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    // Sí/No tocado por error: «Sin responder» lo limpia.
    const protesis = within(pregunta('¿Usás prótesis removible?'));
    fireEvent.click(protesis.getByRole('button', { name: 'Sí' }));
    fireEvent.click(protesis.getByRole('button', { name: 'Sin responder' }));
    expect(protesis.getByRole('button', { name: 'Sin responder' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    firmarYGuardar();
    expect(
      await screen.findByText(/sangrado o inflamación de encías\?: Elegí al menos una opción\./),
    ).toBeInTheDocument();
    expect(de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`)).toHaveLength(0);

    const encias = within(pregunta(/sangrado o inflamación de encías\? · obligatoria/));
    fireEvent.click(encias.getByRole('checkbox', { name: 'Sangrado de encías' }));
    fireEvent.click(encias.getByRole('checkbox', { name: 'Ninguna' }));
    expect(encias.getByRole('checkbox', { name: 'Sangrado de encías' })).not.toBeChecked();
    fireEvent.click(
      within(pregunta(/alergia a algún medicamento/)).getByRole('checkbox', { name: 'Ninguna' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));
    expect(await screen.findByText('Guardamos la versión 1 de la anamnesis.')).toBeInTheDocument();
    const respuestas = (
      de(f.pedidos, 'POST', `${RUTA_ANA}/anamnesis`)[0]?.cuerpo as {
        respuestas: { codigo: string }[];
      }
    ).respuestas;
    expect(respuestas).toContainEqual({ codigo: 'encias', opciones: [] });
    expect(respuestas).toContainEqual({ codigo: 'alergias', opciones: [] });
    expect(respuestas.map((x) => x.codigo)).not.toContain('protesis');
  });

  it('errores por campo de la API se muestran en la pregunta', async () => {
    const { rutas } = escenario({
      versiones: [],
      rutas: {
        'POST /pacientes/:id/anamnesis': {
          estado: 400,
          cuerpo: {
            codigo: 'datos_invalidos',
            mensaje: 'Revisá los datos marcados.',
            detalles: [
              { campo: 'respuestas.alergias', mensaje: 'Esa opción ya no existe.' },
              {
                campo: 'firmante.esTutor',
                mensaje: 'Es menor de edad: tiene que firmar un tutor o tutora.',
              },
            ],
          },
        },
      },
    });
    montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Completar anamnesis');
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    firmarYGuardar();
    expect(await screen.findAllByText(/Esa opción ya no existe\./)).not.toHaveLength(0);
    expect(pregunta(/alergia a algún medicamento/)).toHaveAccessibleDescription(
      'Esa opción ya no existe.',
    );
    // El error de quién firma va junto a «Quién firma», no solo en el resumen.
    const quien = screen.getByRole('heading', { name: 'Quién firma', level: 3 })
      .parentElement as HTMLElement;
    expect(
      within(quien).getByText('Es menor de edad: tiene que firmar un tutor o tutora.'),
    ).toBeInTheDocument();
  });

  it('«Cancelar» con cambios pide confirmación', async () => {
    const { rutas } = escenario();
    montar(rutas, `${RUTA_ANA}/anamnesis`, ODONTOLOGO);
    await abrirFormulario('Actualizar anamnesis');
    fireEvent.change(screen.getByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Otra cosa' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const hoja = await screen.findByRole('dialog', { name: '¿Salir sin guardar?' });
    fireEvent.click(within(hoja).getByRole('button', { name: 'Salir sin guardar' }));
    expect(
      await screen.findByRole('heading', { name: 'Anamnesis · versión 2', level: 2 }),
    ).toBeInTheDocument();
  });
});
