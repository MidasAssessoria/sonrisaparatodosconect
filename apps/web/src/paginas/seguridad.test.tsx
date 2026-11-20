import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  renderApp,
  ROL_DUENO,
  ROL_RECEPCION,
  PERMISOS_RECEPCION,
  sesionDe,
} from '../test/fabricas.js';

const FACTOR = { id: IDS.factor, nombre: 'Conecta', verificado: true };

describe('Seguridad', () => {
  it('activar: QR, clave manual, código y queda activo (con ícono)', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({
          rol: ROL_RECEPCION,
          permisos: PERMISOS_RECEPCION,
          nivelAutenticacion: 'aal1',
        }),
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/seguridad' });
    expect(await screen.findByRole('heading', { name: 'Seguridad', level: 1 })).toBeInTheDocument();
    const inactivo = await screen.findByText('No activado');
    expect(inactivo.closest('.cn-chip')?.querySelector('svg')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Activar doble factor' }));
    expect(await screen.findByRole('img', { name: /Código QR/ })).toBeInTheDocument();
    expect(screen.getByText('ABCDEF123456')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y activar' }));
    expect(await screen.findByText('El código tiene 6 números.')).toBeInTheDocument();
    expect(auth.verificarCodigo).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y activar' }));
    expect(await screen.findByText('El doble factor quedó activado.')).toBeInTheDocument();
    expect(auth.verificarCodigo).toHaveBeenCalledWith(IDS.factor, '654321');
    const activo = await screen.findByText('Activo');
    expect(activo.closest('.cn-chip')?.querySelector('svg')).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Quitar doble factor' })).toBeInTheDocument();
    // La sesión se recarga (mfaActivo lo mantiene la API).
    await waitFor(() =>
      expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion')).toHaveLength(2),
    );
  });

  it('quitar: unenroll en Supabase, DELETE /sesion/mfa con el token aal2 y recién después refresca', async () => {
    const orden: string[] = [];
    const auth = crearAuthFalso({
      conSesion: true,
      nivel: { actual: 'aal2', siguiente: 'aal2' },
      factores: [FACTOR],
    });
    const quitarOriginal = auth.quitarFactor.getMockImplementation()!;
    auth.quitarFactor.mockImplementation((id) => {
      orden.push('quitarFactor');
      return quitarOriginal(id);
    });
    const refrescarOriginal = auth.refrescarSesion.getMockImplementation()!;
    auth.refrescarSesion.mockImplementation(() => {
      orden.push('refrescarSesion');
      return refrescarOriginal();
    });
    auth.obtenerToken.mockImplementation(() =>
      Promise.resolve(`token-${auth.estado.nivel.actual}`),
    );
    const sinRolExigido = sesionDe({
      rol: ROL_RECEPCION,
      permisos: PERMISOS_RECEPCION,
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sinRolExigido },
      'DELETE /sesion/mfa': ({ cabeceras }) => {
        orden.push(`DELETE /sesion/mfa con ${cabeceras.get('authorization')}`);
        return { estado: 204 };
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/seguridad' });
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar doble factor' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Quitar el doble factor' }));
    expect(
      hoja.getByText('Tu cuenta va a quedar protegida solo con la contraseña.'),
    ).toBeInTheDocument();
    fireEvent.click(hoja.getByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByText('Quitamos el doble factor.')).toBeInTheDocument();
    expect(orden).toEqual([
      'quitarFactor',
      'DELETE /sesion/mfa con Bearer token-aal2',
      'refrescarSesion',
    ]);
    expect(await screen.findByRole('button', { name: 'Activar doble factor' })).toBeInTheDocument();
  });

  it('si el aviso a la API falla, no refresca el token y deja terminarlo', async () => {
    const auth = crearAuthFalso({
      conSesion: true,
      nivel: { actual: 'aal2', siguiente: 'aal2' },
      factores: [FACTOR],
    });
    let falla = true;
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ rol: ROL_RECEPCION, permisos: PERMISOS_RECEPCION }) },
      'DELETE /sesion/mfa': () =>
        falla
          ? { estado: 503, cuerpo: { codigo: 'servicio_no_disponible', mensaje: 'No responde.' } }
          : { estado: 204 },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/seguridad' });
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar doble factor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByText(/no pudimos avisarle al servidor/)).toBeInTheDocument();
    expect(auth.refrescarSesion).not.toHaveBeenCalled();

    falla = false;
    fireEvent.click(screen.getByRole('button', { name: 'Terminar de quitarlo' }));
    expect(await screen.findByText('Quitamos el doble factor.')).toBeInTheDocument();
    expect(auth.refrescarSesion).toHaveBeenCalledOnce();
    expect(f.pedidos.filter((p) => p.metodo === 'DELETE')).toHaveLength(2);
  });

  it('si el rol exige doble factor, avisa antes de quitarlo y después obliga a activarlo', async () => {
    const auth = crearAuthFalso({
      conSesion: true,
      nivel: { actual: 'aal2', siguiente: 'aal2' },
      factores: [FACTOR],
    });
    const f = crearFetchFalso({
      // Como la API real: rol con exige_mfa y token aal1 → mfa_requerido.
      'GET /sesion': () =>
        auth.estado.nivel.actual === 'aal2'
          ? { cuerpo: sesionDe({ rol: ROL_DUENO }) }
          : {
              estado: 403,
              cuerpo: { codigo: 'mfa_requerido', mensaje: 'Activá el doble factor.' },
            },
      'DELETE /sesion/mfa': { estado: 204 },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/seguridad' });
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar doble factor' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Quitar el doble factor' }));
    expect(
      hoja.getByText(
        'Tu rol pide doble factor: si lo quitás, vas a tener que activarlo de nuevo para seguir usando Conecta.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(hoja.getByRole('button', { name: 'Sí, quitar' }));
    expect(
      await screen.findByRole('heading', { name: 'Activá el doble factor' }),
    ).toBeInTheDocument();
    expect(
      f.pedidos.some((p) => p.metodo === 'DELETE' && p.url.pathname === '/api/v1/sesion/mfa'),
    ).toBe(true);
  });
});
