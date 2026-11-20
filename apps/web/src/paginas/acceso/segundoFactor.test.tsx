import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  renderApp,
  sesionDe,
  type AuthFalso,
} from '../../test/fabricas.js';

const MFA_REQUERIDO = {
  estado: 403,
  cuerpo: { codigo: 'mfa_requerido', mensaje: 'Confirmá con tu código.' },
};

/** La API real: con token aal1 y un rol que exige doble factor, todo responde mfa_requerido. */
function sesionSegunNivel(auth: AuthFalso) {
  return () => (auth.estado.nivel.actual === 'aal2' ? { cuerpo: sesionDe() } : MFA_REQUERIDO);
}

function escribirCodigo(codigo: string, boton: string) {
  fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: codigo } });
  fireEvent.click(screen.getByRole('button', { name: boton }));
}

describe('mfa_requerido al pedir /sesion', () => {
  it('con un factor verificado: pide el código y después vuelve a pedir /sesion', async () => {
    const auth = crearAuthFalso({
      conSesion: true,
      factores: [{ id: IDS.factor, nombre: 'Conecta', verificado: true }],
    });
    const f = crearFetchFalso({ 'GET /sesion': sesionSegunNivel(auth) });
    renderApp({ auth, fetch: f.fetch });
    expect(
      await screen.findByRole('heading', { name: 'Confirmá que sos vos' }),
    ).toBeInTheDocument();
    escribirCodigo('123456', 'Verificar');
    expect(await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" })).toBeInTheDocument();
    expect(auth.verificarCodigo).toHaveBeenCalledWith(IDS.factor, '123456');
    expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion')).toHaveLength(2);
  });

  it('sin factor: activación obligatoria (QR, clave manual, código) y después /sesion', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': sesionSegunNivel(auth),
      'GET /sedes': { cuerpo: [] },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(
      await screen.findByRole('heading', { name: 'Activá el doble factor' }),
    ).toBeInTheDocument();
    // No hay navegación ni forma de saltearla: solo activar o cerrar sesión.
    expect(screen.queryByRole('navigation', { name: 'Módulos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Activar doble factor' }));
    expect(await screen.findByRole('img', { name: /Código QR/ })).toBeInTheDocument();
    expect(screen.getByText('ABCDEF123456')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();

    escribirCodigo('654321', 'Confirmar y activar');
    // Vuelve a donde quería ir.
    expect(await screen.findByText('Todavía no hay sedes.')).toBeInTheDocument();
    expect(auth.verificarCodigo).toHaveBeenCalledWith(IDS.factor, '654321');
    expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion')).toHaveLength(2);
  });

  it('desde la activación obligatoria se puede cerrar sesión', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': MFA_REQUERIDO });
    renderApp({ auth, fetch: f.fetch });
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });
});

describe('mfa_requerido desde otro endpoint, ya dentro de la app', () => {
  function rutasConSedesPidiendoMfa(auth: AuthFalso) {
    let dentro = false;
    return crearFetchFalso({
      'GET /sesion': () => {
        if (!dentro) {
          dentro = true;
          return { cuerpo: sesionDe() };
        }
        return sesionSegunNivel(auth)();
      },
      // El factor se quitó en otro dispositivo, o la API ahora exige aal2: todo pide el código.
      'GET /sedes': () => (auth.estado.nivel.actual === 'aal2' ? { cuerpo: [] } : MFA_REQUERIDO),
    });
  }

  it('con un factor verificado: pasa al código y vuelve a entrar', async () => {
    const auth = crearAuthFalso({
      conSesion: true,
      factores: [{ id: IDS.factor, nombre: 'Conecta', verificado: true }],
    });
    const f = rutasConSedesPidiendoMfa(auth);
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(
      await screen.findByRole('heading', { name: 'Confirmá que sos vos' }),
    ).toBeInTheDocument();
    escribirCodigo('123456', 'Verificar');
    expect(await screen.findByText('Todavía no hay sedes.')).toBeInTheDocument();
  });

  it('sin factor: pasa a la activación obligatoria', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = rutasConSedesPidiendoMfa(auth);
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(
      await screen.findByRole('heading', { name: 'Activá el doble factor' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activar doble factor' }));
    await screen.findByRole('img', { name: /Código QR/ });
    escribirCodigo('654321', 'Confirmar y activar');
    expect(await screen.findByText('Todavía no hay sedes.')).toBeInTheDocument();
    await waitFor(() => expect(auth.verificarCodigo).toHaveBeenCalledOnce());
  });
});
