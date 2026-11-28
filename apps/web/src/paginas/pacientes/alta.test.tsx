import type { CrearPaciente } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  diferida,
  IDS_PACIENTES,
  montar,
  pacienteDe,
  PERMISOS_RECEPCION,
  resumenDe,
  ROL_RECEPCION,
  uuid,
  type PedidoRegistrado,
  type RespuestaFalsa,
} from '../../test/fabricas.js';

const ROSA_ID = uuid(705);
const RECEPCION = { permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION };

const altas = (pedidos: PedidoRegistrado[]) =>
  pedidos.filter((p) => p.metodo === 'POST' && p.url.pathname === '/api/v1/pacientes');

/** El paciente que la API devolvería con lo que se mandó. */
function creado(cuerpo: CrearPaciente, id = ROSA_ID) {
  return pacienteDe({
    id,
    nombres: cuerpo.nombres,
    apellidos: cuerpo.apellidos ?? null,
    ci: cuerpo.ci ?? null,
    telefono: cuerpo.telefono ?? null,
    fechaNac: null,
    edad: null,
    sexo: null,
    email: null,
    ciudad: null,
    aceptaWhatsapp: cuerpo.aceptaWhatsapp ?? false,
  });
}

async function abrirAlta() {
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo paciente' }));
  return within(await screen.findByRole('dialog', { name: 'Nuevo paciente' }));
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

const listaVacia: RespuestaFalsa = { cuerpo: { items: [], siguienteCursor: null } };

describe('Pacientes: alta', () => {
  it('con solo el nombre guarda y abre la ficha', async () => {
    const f = montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': ({ cuerpo }) => ({
          estado: 201,
          cuerpo: creado(cuerpo as CrearPaciente),
        }),
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    expect(
      hoja.getByText('Solo el nombre es obligatorio. Lo demás lo podés completar después.'),
    ).toBeInTheDocument();
    escribir(hoja, /^Nombre/, 'Rosa');
    escribir(hoja, /^Apellido/, 'Duarte');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));

    expect(
      await screen.findByRole('heading', { name: 'Rosa Duarte', level: 1 }),
    ).toBeInTheDocument();
    expect(altas(f.pedidos)).toHaveLength(1);
    expect(altas(f.pedidos)[0]?.cuerpo).toEqual({
      nombres: 'Rosa',
      apellidos: 'Duarte',
      idioma: 'es',
      aceptaWhatsapp: false,
    });
    // La ficha recién creada no se vuelve a pedir.
    expect(f.pedidos.some((p) => p.url.pathname === `/api/v1/pacientes/${ROSA_ID}`)).toBe(false);
  });

  it('valida en vivo con el contrato y no manda nada con errores', async () => {
    const f = montar({ 'GET /pacientes': listaVacia }, '/pacientes', RECEPCION);
    const hoja = await abrirAlta();

    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    expect(await hoja.findByText('Poné el nombre.')).toBeInTheDocument();

    escribir(hoja, /^Cédula/, '12');
    expect(hoja.getByText('La cédula va con 5 a 9 números.')).toBeInTheDocument();
    escribir(hoja, /^Teléfono/, '123');
    expect(
      hoja.getByText('Escribí un teléfono válido, por ejemplo 0981 123 456.'),
    ).toBeInTheDocument();
    escribir(hoja, /^RUC/, '80012345-3');
    expect(
      hoja.getByText('Revisá el RUC: va con guion y su dígito verificador.'),
    ).toBeInTheDocument();
    escribir(hoja, /^Correo/, 'tomas@');
    expect(hoja.getByText('Escribí un correo válido.')).toBeInTheDocument();

    // Al corregir, el error se va mientras se escribe.
    fireEvent.change(hoja.getByLabelText(/^Cédula/), { target: { value: '4.123.456' } });
    expect(hoja.queryByText('La cédula va con 5 a 9 números.')).toBeNull();

    escribir(hoja, /^Nombre/, 'Tomás');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    await waitFor(() => expect(hoja.getByLabelText(/^Teléfono/)).toHaveAttribute('aria-invalid'));
    expect(altas(f.pedidos)).toHaveLength(0);
  });

  it('manda los datos normalizados por el esquema del contrato', async () => {
    const f = montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': ({ cuerpo }) => ({
          estado: 201,
          cuerpo: creado(cuerpo as CrearPaciente),
        }),
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    escribir(hoja, /^Nombre/, ' Tomás ');
    escribir(hoja, /^Apellido/, 'Villalba');
    escribir(hoja, /^Cédula/, '5.234.567');
    escribir(hoja, /^Teléfono/, '0981 555 444');
    escribir(hoja, /^Correo/, 'Tomas@Ejemplo.test');
    fireEvent.change(hoja.getByLabelText(/^Idioma del paciente/), { target: { value: 'gn' } });
    fireEvent.click(hoja.getByLabelText('Acepta recordatorios por WhatsApp'));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    await screen.findByRole('heading', { name: 'Tomás Villalba', level: 1 });
    expect(altas(f.pedidos)[0]?.cuerpo).toEqual({
      nombres: 'Tomás',
      apellidos: 'Villalba',
      ci: '5234567',
      telefono: '+595981555444',
      email: 'tomas@ejemplo.test',
      idioma: 'gn',
      aceptaWhatsapp: true,
    });
  });

  it('CI duplicada: muestra quién la tiene y «Guardar igual» reenvía con confirmación', async () => {
    const f = montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': ({ cuerpo }) => {
          const c = cuerpo as CrearPaciente;
          if (!c.confirmarCiDuplicada) {
            return {
              estado: 409,
              cuerpo: {
                codigo: 'conflicto',
                mensaje: 'Esa cédula ya está cargada en otro paciente.',
                detalles: [{ campo: 'ci', mensaje: 'Ya la tiene Ana Giménez.' }],
                existente: resumenDe(),
              },
            };
          }
          return { estado: 201, cuerpo: creado(c) };
        },
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    escribir(hoja, /^Nombre/, 'Rosa');
    escribir(hoja, /^Apellido/, 'Duarte');
    escribir(hoja, /^Cédula/, '4123456');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));

    expect(await hoja.findByText('La cédula 4.123.456 ya está cargada')).toBeInTheDocument();
    expect(hoja.getByText('Ana Giménez')).toBeInTheDocument();
    expect(hoja.getByRole('button', { name: 'Abrir su ficha' })).toBeInTheDocument();
    // La hoja sigue abierta: no se guardó.
    expect(screen.queryByRole('heading', { name: 'Rosa Duarte', level: 1 })).toBeNull();

    fireEvent.click(hoja.getByRole('button', { name: 'Guardar igual' }));
    await screen.findByRole('heading', { name: 'Rosa Duarte', level: 1 });
    expect(altas(f.pedidos)).toHaveLength(2);
    expect(altas(f.pedidos)[1]?.cuerpo).toEqual({
      nombres: 'Rosa',
      apellidos: 'Duarte',
      ci: '4123456',
      idioma: 'es',
      aceptaWhatsapp: false,
      confirmarCiDuplicada: true,
    });
  });

  it('CI duplicada: «Abrir su ficha» lleva a la ficha existente', async () => {
    montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': {
          estado: 409,
          cuerpo: {
            codigo: 'conflicto',
            mensaje: 'Esa cédula ya está cargada en otro paciente.',
            existente: resumenDe(),
          },
        },
        'GET /pacientes/:id': { cuerpo: pacienteDe() },
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    escribir(hoja, /^Nombre/, 'Ana');
    escribir(hoja, /^Cédula/, '4.123.456');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar paciente' }));
    fireEvent.click(await hoja.findByRole('button', { name: 'Abrir su ficha' }));
    expect(
      await screen.findByRole('heading', { name: 'Ana Giménez', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Nuevo paciente' })).toBeNull();
  });

  it('un doble clic en «Guardar paciente» manda un solo pedido', async () => {
    const respuesta = diferida<RespuestaFalsa>();
    const f = montar(
      {
        'GET /pacientes': listaVacia,
        'POST /pacientes': () => respuesta.promesa,
      },
      '/pacientes',
      RECEPCION,
    );
    const hoja = await abrirAlta();
    escribir(hoja, /^Nombre/, 'Carlos');
    const guardar = hoja.getByRole('button', { name: 'Guardar paciente' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    await waitFor(() => expect(altas(f.pedidos)).toHaveLength(1));
    respuesta.resolver({
      estado: 201,
      cuerpo: creado({ nombres: 'Carlos' }, IDS_PACIENTES.carlos),
    });
    await screen.findByRole('heading', { name: 'Carlos', level: 1 });
    expect(altas(f.pedidos)).toHaveLength(1);
  });
});
