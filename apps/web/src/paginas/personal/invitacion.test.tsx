import type { InvitacionPublica } from '@conecta/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearAuthFalso, crearFetchFalso, IDS, sesionDe } from '../../test/fabricas.js';
import { renderPersonal } from './pruebas.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKEN = 'tokentokentokentokentoken123';
const RUTA = `/invitacion?token=${TOKEN}`;

function invitacion(parcial: Partial<InvitacionPublica> = {}): InvitacionPublica {
  return {
    clinica: 'Clínica Sonrisa Norte',
    rol: 'Recepción y caja',
    nombre: 'Rosa Duarte',
    emailEnmascarado: 'ro***@ejemplo.test',
    requiereIngreso: false,
    venceEn: '2099-11-27T12:00:00Z',
    ...parcial,
  };
}

describe('Aceptar invitación', () => {
  it('token inválido: un solo mensaje amable que pide un enlace nuevo', async () => {
    const auth = crearAuthFalso();
    const f = crearFetchFalso({
      'POST /invitaciones/consultar': {
        estado: 404,
        cuerpo: { codigo: 'no_encontrado', mensaje: 'No encontramos esa invitación.' },
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: RUTA });
    expect(await screen.findByText('Este enlace ya no sirve')).toBeInTheDocument();
    expect(
      screen.getByText(/Pedile a quien te invitó que te mande un enlace nuevo/),
    ).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toEqual({ token: TOKEN });
  });

  it('sin token en la URL: el mismo mensaje, sin pedir nada a la API', async () => {
    const auth = crearAuthFalso();
    const f = crearFetchFalso({});
    renderPersonal({ auth, fetch: f.fetch, ruta: '/invitacion' });
    expect(await screen.findByText('Este enlace ya no sirve')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.url.pathname.includes('invitaciones'))).toHaveLength(0);
  });

  it('cuenta nueva: valida las contraseñas, acepta una vez e ingresa con ese correo', async () => {
    const auth = crearAuthFalso();
    auth.iniciarSesion.mockImplementation((email: string) => {
      const u = { usuarioId: IDS.usuario, email };
      auth.estado.sesion = u;
      return Promise.resolve(u);
    });
    const f = crearFetchFalso({
      'POST /invitaciones/consultar': { cuerpo: invitacion() },
      'POST /invitaciones/aceptar': {
        cuerpo: { email: 'rosa@ejemplo.test', clinicaId: IDS.clinicaA },
      },
      'GET /sesion': {
        cuerpo: sesionDe({
          usuario: {
            id: IDS.usuario,
            nombre: 'Rosa Duarte',
            email: 'rosa@ejemplo.test',
            mfaActivo: false,
          },
        }),
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: RUTA });
    expect(
      await screen.findByText('Te invitan a sumarte a Clínica Sonrisa Norte'),
    ).toBeInTheDocument();
    expect(screen.getByText('ro***@ejemplo.test')).toBeInTheDocument();
    expect(screen.getByText('Recepción y caja')).toBeInTheDocument();

    const clave = screen.getByLabelText('Contraseña');
    const repetida = screen.getByLabelText('Repetí la contraseña');
    const crear = screen.getByRole('button', { name: 'Crear mi acceso' });

    fireEvent.change(clave, { target: { value: 'corta' } });
    fireEvent.change(repetida, { target: { value: 'corta' } });
    fireEvent.click(crear);
    expect(await screen.findByText('Usá al menos 10 caracteres.')).toBeInTheDocument();

    fireEvent.change(clave, { target: { value: 'unaClaveLarga1' } });
    fireEvent.change(repetida, { target: { value: 'otraClaveLarga1' } });
    fireEvent.click(crear);
    expect(await screen.findByText(/Las contraseñas no coinciden/)).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.url.pathname.endsWith('/aceptar'))).toBe(false);

    fireEvent.change(repetida, { target: { value: 'unaClaveLarga1' } });
    fireEvent.click(crear);
    fireEvent.click(crear);

    // Entró: la app sigue su flujo normal y termina en el inicio.
    expect(await screen.findByText(/Mba'éichapa, Rosa/)).toBeInTheDocument();
    const aceptar = f.pedidos.filter((p) => p.url.pathname.endsWith('/aceptar'));
    expect(aceptar).toHaveLength(1);
    expect(aceptar[0]?.cuerpo).toEqual({ token: TOKEN, clave: 'unaClaveLarga1' });
    expect(aceptar[0]?.cabeceras.get('authorization')).toBeNull();
    expect(auth.iniciarSesion).toHaveBeenCalledTimes(1);
    expect(auth.iniciarSesion).toHaveBeenCalledWith('rosa@ejemplo.test', 'unaClaveLarga1');
    // no vuelve a consultar el token ya usado
    expect(f.pedidos.filter((p) => p.url.pathname.endsWith('/consultar'))).toHaveLength(1);
  });

  it('cuenta existente: ingresa en la misma página y acepta con el token de la sesión', async () => {
    const auth = crearAuthFalso();
    const f = crearFetchFalso({
      'POST /invitaciones/consultar': {
        cuerpo: invitacion({ requiereIngreso: true, emailEnmascarado: 'lo***@ejemplo.test' }),
      },
      'POST /invitaciones/aceptar': {
        cuerpo: { email: 'lorena@ejemplo.test', clinicaId: IDS.clinicaB },
      },
      'GET /sesion': ({ cabeceras }) =>
        cabeceras.get('x-clinica-id') === IDS.clinicaB
          ? {
              cuerpo: sesionDe({
                clinicas: [
                  { id: IDS.clinicaA, nombre: 'Clínica Prueba' },
                  { id: IDS.clinicaB, nombre: 'Clínica Sonrisa Norte' },
                ],
                clinica: {
                  id: IDS.clinicaB,
                  nombre: 'Clínica Sonrisa Norte',
                  zonaHoraria: 'America/Asuncion',
                },
              }),
            }
          : { cuerpo: sesionDe() },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: RUTA });
    expect(await screen.findByText(/Ese correo ya tiene una cuenta/)).toBeInTheDocument();

    const correo = screen.getByLabelText('Correo');
    fireEvent.change(correo, { target: { value: 'marta@ejemplo.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'miclave123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar y aceptar' }));
    expect(await screen.findByText(/Ese no es el correo de la invitación/)).toBeInTheDocument();
    expect(auth.iniciarSesion).not.toHaveBeenCalled();

    fireEvent.change(correo, { target: { value: 'lorena@ejemplo.test' } });
    const ingresar = screen.getByRole('button', { name: 'Ingresar y aceptar' });
    fireEvent.click(ingresar);
    fireEvent.click(ingresar);

    await waitFor(() => {
      const ultima = f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion').at(-1);
      expect(ultima?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaB);
    });
    expect(auth.iniciarSesion).toHaveBeenCalledTimes(1);
    expect(auth.iniciarSesion).toHaveBeenCalledWith('lorena@ejemplo.test', 'miclave123456');
    const aceptar = f.pedidos.filter((p) => p.url.pathname.endsWith('/aceptar'));
    expect(aceptar).toHaveLength(1);
    expect(aceptar[0]?.cuerpo).toEqual({ token: TOKEN });
    expect(aceptar[0]?.cabeceras.get('authorization')).toBe('Bearer token-de-prueba');
    expect(await screen.findByText('Clínica Sonrisa Norte')).toBeInTheDocument();
  });

  it('con sesión abierta y el mismo correo: un botón para unirse (un solo pedido)', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'POST /invitaciones/consultar': {
        cuerpo: invitacion({ requiereIngreso: true, emailEnmascarado: 'lo***@ejemplo.test' }),
      },
      'POST /invitaciones/aceptar': {
        cuerpo: { email: 'lorena@ejemplo.test', clinicaId: IDS.clinicaA },
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: RUTA });
    const unirme = await screen.findByRole('button', { name: 'Unirme a Clínica Sonrisa Norte' });
    expect(f.pedidos.some((p) => p.url.pathname.endsWith('/aceptar'))).toBe(false);
    fireEvent.click(unirme);
    fireEvent.click(unirme);
    await waitFor(() =>
      expect(f.pedidos.filter((p) => p.url.pathname.endsWith('/aceptar'))).toHaveLength(1),
    );
  });

  it('sesión abierta con otro correo: avisa y ofrece cerrar sesión para seguir', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'POST /invitaciones/consultar': { cuerpo: invitacion() },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: RUTA });
    expect(await screen.findByText('Tenés abierta otra cuenta')).toBeInTheDocument();
    expect(screen.getByText(/Ingresaste como lorena@ejemplo.test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión y seguir' }));
    // Sin sesión, la misma página ofrece crear el acceso.
    expect(await screen.findByLabelText('Repetí la contraseña')).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalledTimes(1);
    expect(f.pedidos.some((p) => p.url.pathname.endsWith('/aceptar'))).toBe(false);
  });
});
