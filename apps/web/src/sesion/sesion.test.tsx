import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { crearClienteConsultas } from '../App.js';
import { ProveedorIdioma } from '../i18n/idioma.js';
import {
  crearAuthFalso,
  crearFetchFalso,
  diferida,
  IDS,
  renderApp,
  sedeDe,
  sesionDe,
  type AuthFalso,
  type RespuestaFalsa,
} from '../test/fabricas.js';
import { ProveedorSesion, useSesion, type ValorSesion } from './ProveedorSesion.js';

const CLINICA_A = { id: IDS.clinicaA, nombre: 'Clínica Prueba', zonaHoraria: 'America/Asuncion' };
const CLINICA_B = { id: IDS.clinicaB, nombre: 'Clínica Dos', zonaHoraria: 'America/Asuncion' };
const DOS_CLINICAS = [
  { id: IDS.clinicaA, nombre: CLINICA_A.nombre },
  { id: IDS.clinicaB, nombre: CLINICA_B.nombre },
];

/** Proveedor con un espía que deja usar el contexto desde la prueba. */
function renderProveedor(auth: AuthFalso, fetchFalso: typeof fetch) {
  const ref: { actual: ValorSesion | null } = { actual: null };
  function Espia() {
    const v = useSesion();
    useEffect(() => {
      ref.actual = v;
    });
    const texto =
      v.estado.fase === 'lista' ? `Trabajando en ${v.estado.sesion.clinica.nombre}` : v.estado.fase;
    return <p data-testid="fase">{texto}</p>;
  }
  render(
    <ProveedorIdioma>
      <QueryClientProvider client={crearClienteConsultas()}>
        <ProveedorSesion auth={auth} fetch={fetchFalso}>
          <Espia />
        </ProveedorSesion>
      </QueryClientProvider>
    </ProveedorIdioma>,
  );
  return () => {
    if (!ref.actual) throw new Error('El proveedor todavía no montó');
    return ref.actual;
  };
}

const fase = () => screen.getByTestId('fase').textContent;

/** Deja correr las promesas pendientes y los renders que disparan. */
async function asentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe('respuestas tardías de /sesion', () => {
  it('una recarga que vuelve después de cerrar sesión no revive la app', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const tarde = diferida<RespuestaFalsa>();
    let pedidos = 0;
    const f = crearFetchFalso({
      'GET /sesion': () => (++pedidos === 1 ? { cuerpo: sesionDe() } : tarde.promesa),
    });
    const sesion = renderProveedor(auth, f.fetch);
    await waitFor(() => expect(fase()).toBe('Trabajando en Clínica Prueba'));

    let recarga!: Promise<void>;
    act(() => {
      recarga = sesion().recargarSesion();
    });
    await act(() => sesion().cerrarSesion());
    expect(fase()).toBe('sin_sesion');

    tarde.resolver({ cuerpo: sesionDe() });
    await act(() => recarga);
    await asentar();
    expect(fase()).toBe('sin_sesion');
  });

  it('cambiar de clínica con una recarga en vuelo: pantalla y X-Clinica-Id quedan en la nueva', async () => {
    window.localStorage.setItem(`conecta.clinica.${IDS.usuario}`, IDS.clinicaA);
    const auth = crearAuthFalso({ conSesion: true });
    const tardeA = diferida<RespuestaFalsa>();
    let pedidosA = 0;
    const f = crearFetchFalso({
      'GET /sesion': ({ cabeceras }) => {
        if (cabeceras.get('x-clinica-id') === IDS.clinicaB) {
          return { cuerpo: sesionDe({ clinicas: DOS_CLINICAS, clinica: CLINICA_B }) };
        }
        return ++pedidosA === 1
          ? { cuerpo: sesionDe({ clinicas: DOS_CLINICAS, clinica: CLINICA_A }) }
          : tardeA.promesa;
      },
      'GET /sedes': { cuerpo: [sedeDe()] },
    });
    const sesion = renderProveedor(auth, f.fetch);
    await waitFor(() => expect(fase()).toBe('Trabajando en Clínica Prueba'));

    let recarga!: Promise<void>;
    act(() => {
      recarga = sesion().recargarSesion();
    });
    act(() => sesion().irAElegirClinica());
    await act(() => sesion().elegirClinica(IDS.clinicaB));
    expect(fase()).toBe('Trabajando en Clínica Dos');

    // Llega tarde la respuesta de la clínica A.
    tardeA.resolver({ cuerpo: sesionDe({ clinicas: DOS_CLINICAS, clinica: CLINICA_A }) });
    await act(() => recarga);
    await asentar();
    expect(fase()).toBe('Trabajando en Clínica Dos');
    await act(() => sesion().api.sedes.listar());
    expect(f.pedidos.at(-1)?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaB);
  });
});

describe('inactividad al arrancar', () => {
  it('con la última actividad vencida, cierra la sesión en vez de entrar', async () => {
    window.localStorage.setItem('conecta.actividad', String(Date.now() - 20 * 60_000));
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ inactividadMin: 15 }) } });
    renderApp({ auth, fetch: f.fetch });
    expect(
      await screen.findByText(
        'Cerramos tu sesión porque pasaron 15 minutos sin actividad. Ingresá de nuevo para seguir.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeNull();
    expect(auth.cerrarSesion).toHaveBeenCalled();
    expect(f.pedidos.some((p) => p.url.pathname === '/api/v1/sesion/cerrar')).toBe(true);
  });

  it('con actividad reciente entra, y la marca guardada no se pisa al montar', async () => {
    const marca = Date.now() - 5 * 60_000;
    window.localStorage.setItem('conecta.actividad', String(marca));
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ inactividadMin: 15 }) } });
    renderApp({ auth, fetch: f.fetch });
    expect(await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument();
    expect(window.localStorage.getItem('conecta.actividad')).toBe(String(marca));
  });

  it('ingresar con contraseña cuenta como actividad aunque la marca vieja esté vencida', async () => {
    window.localStorage.setItem('conecta.actividad', String(Date.now() - 60 * 60_000));
    const auth = crearAuthFalso();
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ inactividadMin: 15 }) } });
    renderApp({ auth, fetch: f.fetch, ruta: '/acceso' });
    fireEvent.change(await screen.findByLabelText('Correo'), {
      target: { value: 'lorena@ejemplo.test' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'buena' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument();
  });
});

describe('429, 503 y sin_membresia ya dentro', () => {
  it('429: mensaje fijo, sin reintento automático y el botón espera a Retry-After', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    let pedidosSedes = 0;
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': () =>
        ++pedidosSedes === 1
          ? {
              estado: 429,
              cabeceras: { 'Retry-After': '1' },
              cuerpo: { codigo: 'demasiados_pedidos', mensaje: 'Rate limit' },
            }
          : { cuerpo: [] },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Hay muchos pedidos seguidos. Esperá un momento y probá de nuevo.',
    );
    const boton = screen.getByRole('button', { name: /Probá de nuevo/ });
    expect(boton).toBeDisabled();
    expect(boton).toHaveTextContent('Probá de nuevo en 1 s');
    expect(pedidosSedes).toBe(1);

    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Probá de nuevo' })).toBeEnabled(),
      {
        timeout: 2500,
      },
    );
    expect(pedidosSedes).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Probá de nuevo' }));
    expect(await screen.findByText('Todavía no hay sedes.')).toBeInTheDocument();
    expect(auth.cerrarSesion).not.toHaveBeenCalled();
  });

  it('503 ya dentro: no cierra la sesión, no reintenta solo y deja reintentar a mano', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    let pedidosSedes = 0;
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      // 503 de un proxy, sin cuerpo JSON: antes se volvía error_interno y se reintentaba solo.
      'GET /sedes': () =>
        ++pedidosSedes === 1 ? { estado: 503, cuerpo: 'Service Unavailable' } : { cuerpo: [] },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El servicio no responde en este momento. Esperá unos minutos y probá de nuevo.',
    );
    expect(pedidosSedes).toBe(1);
    expect(auth.cerrarSesion).not.toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: 'Módulos' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Probá de nuevo' }));
    expect(await screen.findByText('Todavía no hay sedes.')).toBeInTheDocument();
  });

  it('503 al arrancar: pantalla de error con reintento manual, sin olvidar la clínica', async () => {
    window.localStorage.setItem(`conecta.clinica.${IDS.usuario}`, IDS.clinicaA);
    const auth = crearAuthFalso({ conSesion: true });
    let pedidosSesion = 0;
    const f = crearFetchFalso({
      'GET /sesion': () =>
        ++pedidosSesion === 1
          ? {
              estado: 503,
              cuerpo: { codigo: 'servicio_no_disponible', mensaje: 'Probá en unos minutos.' },
            }
          : { cuerpo: sesionDe() },
    });
    renderApp({ auth, fetch: f.fetch });
    expect(await screen.findByRole('alert')).toHaveTextContent('Probá en unos minutos.');
    expect(pedidosSesion).toBe(1);
    expect(window.localStorage.getItem(`conecta.clinica.${IDS.usuario}`)).toBe(IDS.clinicaA);
    expect(auth.cerrarSesion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Probá de nuevo' }));
    expect(await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument();
  });

  it('sin_membresia ya dentro (usuario desactivado): cierra la sesión con un mensaje claro', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': {
        estado: 403,
        cuerpo: { codigo: 'sin_membresia', mensaje: 'No tenés membresía activa.' },
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(
      screen.getByText(/Cerramos tu sesión porque tu cuenta ya no está activa en esta clínica/),
    ).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });
});
