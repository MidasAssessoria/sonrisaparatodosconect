import { reemplazarPreguntasSchema, type Pregunta } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PRUEBA,
  montar,
  preguntaDe,
  PERMISOS_ADMINISTRACION,
  PERMISOS_ODONTOLOGO,
  ROL_ODONTOLOGO,
  ROL_SESION_ADMINISTRACION,
  type PedidoRegistrado,
} from '../../test/fabricas.js';

const ODONTOLOGO = { permisos: PERMISOS_ODONTOLOGO, rol: ROL_ODONTOLOGO };
const ADMINISTRACION = { permisos: PERMISOS_ADMINISTRACION, rol: ROL_SESION_ADMINISTRACION };

/** Una pregunta que se desactivó antes: el catálogo completo la trae para poder reactivarla. */
const INACTIVA = preguntaDe({
  codigo: 'mate_diario',
  seccion: 3,
  orden: 5,
  texto: '¿Tomás mate o tereré todos los días?',
  activa: false,
});
const CATALOGO_COMPLETO = [...CATALOGO_PRUEBA, INACTIVA];

/** Lo que haría la API: valida, guarda y responde el catálogo completo. */
function rutasCatalogo() {
  return {
    'GET /anamnesis/preguntas/catalogo': { cuerpo: { preguntas: CATALOGO_COMPLETO } },
    'PUT /anamnesis/preguntas': ({ cuerpo }: { cuerpo: unknown }) => ({
      cuerpo: reemplazarPreguntasSchema.parse(cuerpo),
    }),
  };
}

const puts = (pedidos: PedidoRegistrado[]) =>
  pedidos.filter((p) => p.metodo === 'PUT' && p.url.pathname === '/api/v1/anamnesis/preguntas');

const seccion = (nombre: string | RegExp) => within(screen.getByRole('region', { name: nombre }));

const por0 = (lista: Pregunta[], codigo: string) => lista.find((p) => p.codigo === codigo);

const textosDe = (region: ReturnType<typeof seccion>) =>
  region
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.w-cuest-fila__texto')?.textContent);

describe('Cuestionario de salud', () => {
  it('se edita y se guarda entero: reordenar, desactivar, editar y agregar con alertas', async () => {
    const f = montar(rutasCatalogo(), '/cuestionario');
    expect(
      await screen.findByRole('heading', { name: 'Cuestionario de salud', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Cuestionario de salud/ }).length).toBeGreaterThan(
      0,
    );
    await screen.findByRole('region', { name: '4. Antecedentes médicos' });
    const s4 = () => seccion('4. Antecedentes médicos');
    expect(textosDe(s4())).toEqual([
      '¿Tenés alergia a algún medicamento o material?',
      '¿Tomás anticoagulantes?',
      '¿Estás embarazada o en período de lactancia?',
    ]);
    expect(
      within(s4().getAllByRole('listitem')[0]!).getByText('Genera 2 alertas'),
    ).toBeInTheDocument();
    const guardar = screen.getByRole('button', { name: 'Guardar cuestionario' });
    expect(guardar).toBeDisabled();

    // Reordenar.
    expect(
      s4().getByRole('button', { name: 'Subir «¿Tenés alergia a algún medicamento o material?»' }),
    ).toBeDisabled();
    fireEvent.click(
      s4().getByRole('button', { name: 'Bajar «¿Tenés alergia a algún medicamento o material?»' }),
    );
    expect(textosDe(s4())).toEqual([
      '¿Tomás anticoagulantes?',
      '¿Tenés alergia a algún medicamento o material?',
      '¿Estás embarazada o en período de lactancia?',
    ]);
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument();

    // Desactivar.
    const s2 = seccion('2. Antecedentes odontológicos');
    fireEvent.click(s2.getByRole('button', { name: 'Desactivar «¿Usás prótesis removible?»' }));
    expect(s2.getByText('Inactiva')).toBeInTheDocument();
    expect(
      s2.getByRole('button', { name: 'Activar «¿Usás prótesis removible?»' }),
    ).toBeInTheDocument();

    // Editar: el código no cambia.
    fireEvent.click(s4().getByRole('button', { name: 'Editar «¿Tomás anticoagulantes?»' }));
    let hoja = within(await screen.findByRole('dialog', { name: 'Editar pregunta' }));
    expect(hoja.getByText('anticoagulantes')).toBeInTheDocument();
    expect(hoja.queryByRole('textbox', { name: 'Código' })).toBeNull();
    expect(
      hoja.getByRole('checkbox', { name: 'Responder «Sí» genera una alerta médica' }),
    ).toBeChecked();
    expect(hoja.getByRole('textbox', { name: /Texto de la alerta/ })).toHaveValue(
      'Toma anticoagulantes',
    );
    fireEvent.change(hoja.getByRole('textbox', { name: /^Pregunta/ }), {
      target: { value: '¿Tomás anticoagulantes o antiagregantes?' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Agregar un sí/no con alerta en la sección 2.
    fireEvent.click(
      s2.getByRole('button', { name: 'Agregar pregunta en «Antecedentes odontológicos»' }),
    );
    hoja = within(await screen.findByRole('dialog', { name: 'Nueva pregunta' }));
    // Sin texto no se confirma.
    fireEvent.click(hoja.getByRole('button', { name: 'Listo' }));
    expect(hoja.getByText('Escribí la pregunta (al menos 3 letras).')).toBeInTheDocument();
    fireEvent.change(hoja.getByRole('textbox', { name: /^Pregunta/ }), {
      target: { value: '¿Te sangran las encías al cepillarte?' },
    });
    fireEvent.click(
      hoja.getByRole('checkbox', { name: 'Responder «Sí» genera una alerta médica' }),
    );
    fireEvent.click(hoja.getByRole('button', { name: 'Listo' }));
    expect(
      hoja.getByText('Escribí el texto de la alerta (al menos 3 letras).'),
    ).toBeInTheDocument();
    fireEvent.change(hoja.getByRole('textbox', { name: /Texto de la alerta/ }), {
      target: { value: 'Sangrado de encías' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(textosDe(seccion('2. Antecedentes odontológicos'))).toEqual([
      '¿Usás prótesis removible?',
      '¿Te sangran las encías al cepillarte?',
    ]);

    // Agregar una de opción múltiple en la sección 5, con una opción que genera alerta.
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar pregunta en «Datos complementarios»' }),
    );
    hoja = within(await screen.findByRole('dialog', { name: 'Nueva pregunta' }));
    fireEvent.change(hoja.getByRole('textbox', { name: /^Pregunta/ }), {
      target: { value: '¿Tenés o tuviste alguna de estas condiciones?' },
    });
    fireEvent.change(hoja.getByRole('textbox', { name: 'Código' }), {
      target: { value: 'otras_condiciones' },
    });
    fireEvent.change(hoja.getByRole('combobox', { name: 'Tipo de respuesta' }), {
      target: { value: 'multiple' },
    });
    fireEvent.change(hoja.getByRole('textbox', { name: 'Opción 1' }), {
      target: { value: 'Hepatitis' },
    });
    fireEvent.click(hoja.getByRole('checkbox', { name: 'Marcarla genera una alerta médica' }));
    fireEvent.change(hoja.getByRole('combobox', { name: 'Tipo de alerta' }), {
      target: { value: 'condicion' },
    });
    fireEvent.change(hoja.getByRole('textbox', { name: /Texto de la alerta/ }), {
      target: { value: 'Hepatitis' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Agregar opción' }));
    fireEvent.change(hoja.getByRole('textbox', { name: 'Opción 2' }), {
      target: { value: 'Epilepsia' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(guardar);
    expect(await screen.findByText('Guardamos el cuestionario.')).toBeInTheDocument();
    expect(screen.queryByText('Hay cambios sin guardar.')).toBeNull();
    const [put] = puts(f.pedidos);
    const enviadas = (put?.cuerpo as { preguntas: Pregunta[] }).preguntas;
    expect(enviadas).toHaveLength(CATALOGO_COMPLETO.length + 2);
    // La inactiva viaja tal cual (sigue inactiva).
    expect(por0(enviadas, 'mate_diario')?.activa).toBe(false);
    const por = (codigo: string) => enviadas.find((p) => p.codigo === codigo);
    // Sección 4 renumerada en el orden nuevo.
    expect(enviadas.filter((p) => p.seccion === 4).map((p) => [p.codigo, p.orden])).toEqual([
      ['anticoagulantes', 0],
      ['alergias', 5],
      ['embarazo', 10],
    ]);
    expect(por('anticoagulantes')?.texto).toBe('¿Tomás anticoagulantes o antiagregantes?');
    expect(por('protesis')?.activa).toBe(false);
    expect(por('te_sangran_las_encias_al_cepillarte')).toMatchObject({
      seccion: 2,
      orden: 5,
      tipo: 'si_no',
      alertaSiSi: {
        tipo: 'condicion',
        texto: 'Sangrado de encías',
        gravedad: 'alta',
        grupoAlergia: null,
      },
    });
    expect(por('otras_condiciones')).toMatchObject({
      seccion: 5,
      orden: 0,
      tipo: 'multiple',
      opciones: [
        {
          valor: 'hepatitis',
          etiqueta: 'Hepatitis',
          alerta: { tipo: 'condicion', texto: 'Hepatitis', gravedad: 'alta', grupoAlergia: null },
        },
        { valor: 'epilepsia', etiqueta: 'Epilepsia', alerta: null },
      ],
    });
    // Las opciones que ya existían conservan su valor.
    expect(por('alergias')?.opciones.map((o) => o.valor)).toEqual(['penicilina', 'latex']);
  });

  it('un código repetido no se acepta', async () => {
    montar(rutasCatalogo(), '/cuestionario');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar pregunta en «Hábitos»' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Nueva pregunta' }));
    fireEvent.change(hoja.getByRole('textbox', { name: /^Pregunta/ }), {
      target: { value: '¿Usás prótesis?' },
    });
    fireEvent.change(hoja.getByRole('textbox', { name: 'Código' }), {
      target: { value: 'protesis' },
    });
    fireEvent.click(hoja.getByRole('button', { name: 'Listo' }));
    expect(hoja.getByText('Ya hay una pregunta con ese código.')).toBeInTheDocument();
  });

  it('sin configuracion:editar no aparece y su ruta muestra el candado (sin pedir nada)', async () => {
    const f = montar(rutasCatalogo(), '/cuestionario', ODONTOLOGO);
    expect(await screen.findByText('Tu rol no tiene acceso a esto')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Cuestionario de salud/ })).toBeNull();
    expect(f.pedidos.some((p) => p.url.pathname.includes('/anamnesis/'))).toBe(false);
  });

  it('Administración (configuracion:editar sin ficha clínica) lo ve, reactiva una pregunta y guarda', async () => {
    const f = montar(rutasCatalogo(), '/cuestionario', ADMINISTRACION);
    await screen.findByRole('region', { name: '3. Hábitos' });
    expect(screen.getAllByRole('link', { name: /Cuestionario de salud/ }).length).toBeGreaterThan(
      0,
    );
    // Pide el catálogo completo, no el del formulario (que exige ficha clínica).
    expect(
      f.pedidos.filter((p) => p.url.pathname === '/api/v1/anamnesis/preguntas/catalogo'),
    ).toHaveLength(1);
    expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/anamnesis/preguntas')).toHaveLength(
      0,
    );
    const s3 = seccion('3. Hábitos');
    expect(s3.getByText('Inactiva')).toBeInTheDocument();
    fireEvent.click(
      s3.getByRole('button', { name: 'Activar «¿Tomás mate o tereré todos los días?»' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cuestionario' }));
    expect(await screen.findByText('Guardamos el cuestionario.')).toBeInTheDocument();
    const [put] = puts(f.pedidos);
    expect(por0((put?.cuerpo as { preguntas: Pregunta[] }).preguntas, 'mate_diario')?.activa).toBe(
      true,
    );
  });
});
