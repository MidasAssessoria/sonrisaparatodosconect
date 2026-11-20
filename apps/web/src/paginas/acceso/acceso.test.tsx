import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorAuth } from '../../auth/servicioAuth.js';
import { crearAuthFalso, crearFetchFalso, IDS, renderApp, sesionDe } from '../../test/fabricas.js';

function llenar(correo: string, clave: string) {
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: correo } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: clave } });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
}

describe('Acceso', () => {
  it('sin sesión lleva a Acceso con el saludo y el selector de idioma', async () => {
    const auth = crearAuthFalso();
    renderApp({ auth, fetch: crearFetchFalso({}).fetch, ruta: '/sedes' });
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(screen.getByText("Mba'éichapa")).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Idioma de la interfaz' })).toBeInTheDocument();
    // Mostrar/ocultar contraseña
    const clave = screen.getByLabelText('Contraseña');
    expect(clave).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(clave).toHaveAttribute('type', 'text');
  });

  it('valida los campos antes de llamar a Supabase', async () => {
    const auth = crearAuthFalso();
    renderApp({ auth, fetch: crearFetchFalso({}).fetch, ruta: '/acceso' });
    await screen.findByLabelText('Correo');
    llenar('', '');
    expect(await screen.findByText('Escribí tu correo.')).toBeInTheDocument();
    expect(screen.getByText('Escribí tu contraseña.')).toBeInTheDocument();
    llenar('lorena', 'x');
    expect(await screen.findByText(/Revisá el correo/)).toBeInTheDocument();
    expect(auth.iniciarSesion).not.toHaveBeenCalled();
  });

  it('credenciales que no coinciden: mensaje con la voz del design system', async () => {
    const auth = crearAuthFalso();
    auth.iniciarSesion.mockRejectedValueOnce(new ErrorAuth('credenciales'));
    renderApp({ auth, fetch: crearFetchFalso({}).fetch, ruta: '/acceso' });
    await screen.findByLabelText('Correo');
    llenar('lorena@ejemplo.test', 'mala');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Usuario o contraseña no coinciden. Probá de nuevo.',
    );
  });

  it('aal1 con factor verificado: pide el código TOTP y después entra', async () => {
    const auth = crearAuthFalso({
      nivel: { actual: 'aal1', siguiente: 'aal2' },
      factores: [{ id: IDS.factor, nombre: 'Conecta', verificado: true }],
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ nivelAutenticacion: 'aal2' }) },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/acceso' });
    await screen.findByLabelText('Correo');
    llenar('lorena@ejemplo.test', 'buena');

    expect(
      await screen.findByRole('heading', { name: 'Confirmá que sos vos' }),
    ).toBeInTheDocument();
    expect(f.pedidos).toHaveLength(0);

    const campo = screen.getByLabelText('Código de 6 dígitos');
    fireEvent.change(campo, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('El código tiene 6 números.')).toBeInTheDocument();

    auth.verificarCodigo.mockRejectedValueOnce(new ErrorAuth('codigo_invalido'));
    fireEvent.change(campo, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido o ya venció/);

    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument();
    expect(auth.verificarCodigo).toHaveBeenLastCalledWith(IDS.factor, '123456');
    expect(f.pedidos[0]?.cabeceras.get('authorization')).toBe('Bearer token-de-prueba');
  });

  it('sin factor: entra directo y vuelve a la ruta que pedía', async () => {
    const auth = crearAuthFalso();
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': { cuerpo: [] },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    await screen.findByLabelText('Correo');
    llenar('lorena@ejemplo.test', 'buena');
    expect(await screen.findByRole('heading', { name: 'Sedes' })).toBeInTheDocument();
  });

  it('la API responde mfa_requerido: pasa al segundo factor', async () => {
    const auth = crearAuthFalso({
      conSesion: true,
      factores: [{ id: IDS.factor, nombre: null, verificado: true }],
    });
    const f = crearFetchFalso({
      'GET /sesion': {
        estado: 403,
        cuerpo: { codigo: 'mfa_requerido', mensaje: 'Confirmá el código.' },
      },
    });
    renderApp({ auth, fetch: f.fetch });
    expect(
      await screen.findByRole('heading', { name: 'Confirmá que sos vos' }),
    ).toBeInTheDocument();
  });

  it('«Olvidé mi contraseña» manda el correo de recuperación', async () => {
    const auth = crearAuthFalso();
    renderApp({ auth, fetch: crearFetchFalso({}).fetch, ruta: '/acceso' });
    fireEvent.click(await screen.findByRole('button', { name: 'Olvidé mi contraseña' }));
    expect(
      await screen.findByRole('heading', { name: 'Recuperá tu contraseña' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'lorena@ejemplo.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(await screen.findByText(/te llega el enlace/)).toBeInTheDocument();
    expect(auth.enviarRecuperacion).toHaveBeenCalledWith(
      'lorena@ejemplo.test',
      `${window.location.origin}/acceso/nueva-clave`,
    );
  });

  it('el enlace de recuperación permite definir la contraseña nueva', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    renderApp({ auth, fetch: f.fetch, ruta: '/acceso' });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    auth.emitir('recuperacion');
    expect(
      await screen.findByRole('heading', { name: 'Definí tu contraseña nueva' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByText('Usá al menos 8 caracteres.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Contraseña nueva'), {
      target: { value: 'una-clave-larga' },
    });
    fireEvent.change(screen.getByLabelText('Repetí la contraseña'), {
      target: { value: 'una-clave-larga' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByText('Tu contraseña quedó cambiada.')).toBeInTheDocument();
    expect(auth.cambiarClave).toHaveBeenCalledWith('una-clave-larga');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a Conecta' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument(),
    );
  });
});
