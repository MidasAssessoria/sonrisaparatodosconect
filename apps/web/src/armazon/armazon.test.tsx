import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sedeInicial } from '../sesion/ProveedorSesion.js';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  PERMISOS_RECEPCION,
  renderApp,
  sedeDe,
  sesionDe,
} from '../test/fabricas.js';

function navegacion() {
  return within(screen.getByRole('navigation', { name: 'Módulos' }));
}

describe('navegación y acciones según permisos', () => {
  it('el dueño ve Inicio, Sedes y Auditoría', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    renderApp({ auth, fetch: f.fetch });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    const nav = navegacion();
    expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
    expect(nav.getByRole('link', { name: 'Sedes' })).toHaveAttribute('href', '/sedes');
    expect(nav.getByRole('link', { name: 'Auditoría' })).toHaveAttribute('href', '/auditoria');
  });

  it('recepción no ve Auditoría ni «Nueva sede», y la ruta de Auditoría muestra el candado', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({
          permisos: PERMISOS_RECEPCION,
          rol: { id: IDS.rol, codigo: 'recepcion', nombre: 'Recepción' },
        }),
      },
      'GET /sedes': { cuerpo: [sedeDe()] },
      'GET /sedes/:id': { cuerpo: sedeDe() },
    });
    const { unmount } = renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('heading', { name: 'Sedes' })).toBeInTheDocument();
    expect(navegacion().queryByRole('link', { name: 'Auditoría' })).toBeNull();
    expect(navegacion().getByRole('link', { name: 'Sedes' })).toBeInTheDocument();
    await screen.findAllByText('Centro');
    expect(screen.queryByRole('button', { name: 'Nueva sede' })).toBeNull();
    unmount();

    renderApp({ auth, fetch: f.fetch, ruta: '/auditoria' });
    expect(
      await screen.findByRole('heading', { name: 'Tu rol no tiene acceso a esto' }),
    ).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.url.pathname.endsWith('/auditoria'))).toBe(false);
    unmount();
  });

  it('recepción en el detalle de sede no ve Editar, Dar de baja ni el alta de sillones', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: PERMISOS_RECEPCION }) },
      'GET /sedes/:id': {
        cuerpo: sedeDe({
          horarios: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 }],
          sillones: [{ id: IDS.factor, sedeId: IDS.sedeCentro, nombre: 'Sillón 1', activo: true }],
        }),
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: `/sedes/${IDS.sedeCentro}` });
    expect(await screen.findByRole('heading', { name: 'Centro', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('8:00 a 12:00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar datos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar sillón' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Desactivar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar horarios' })).toBeNull();
  });

  it('sin permiso de inicio, «/» lleva al primer módulo permitido', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: [{ modulo: 'sedes', accion: 'ver' }] }) },
      'GET /sedes': { cuerpo: [] },
    });
    renderApp({ auth, fetch: f.fetch });
    expect(await screen.findByRole('heading', { name: 'Sedes' })).toBeInTheDocument();
  });

  it('una respuesta sin_permiso de la API muestra «Tu rol no tiene acceso a esto»', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': {
        estado: 403,
        cuerpo: { codigo: 'sede_no_permitida', mensaje: 'Sede no permitida' },
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu rol no tiene acceso a esto.');
  });

  it('no_autenticado de la API cierra la sesión y vuelve a Acceso', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /sedes': {
        estado: 401,
        cuerpo: { codigo: 'no_autenticado', mensaje: 'Sesión vencida' },
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(screen.getByText('Tu sesión venció. Ingresá de nuevo para seguir.')).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });

  it('debeActivarMfa: aviso persistente con acceso a Seguridad', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ debeActivarMfa: true }) } });
    renderApp({ auth, fetch: f.fetch });
    expect(
      await screen.findByText('Tu rol pide doble factor y todavía no lo activaste.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Activar doble factor' }));
    expect(await screen.findByRole('heading', { name: 'Seguridad', level: 1 })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Activar doble factor' }));
    expect(await screen.findByRole('img', { name: /Código QR/ })).toBeInTheDocument();
    expect(screen.getByText('ABCDEF123456')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '654321' } });
    auth.estado.factores = [{ id: IDS.factor, nombre: 'Conecta', verificado: true }];
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y activar' }));
    expect(await screen.findByText('El doble factor quedó activado.')).toBeInTheDocument();
    expect(auth.verificarCodigo).toHaveBeenCalledWith(IDS.factor, '654321');
    expect(await screen.findByRole('button', { name: 'Quitar doble factor' })).toBeInTheDocument();
  });
});

describe('selector de sede', () => {
  it('arranca en la sede por defecto, cambia y recuerda la elección', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    const { unmount } = renderApp({ auth, fetch: f.fetch });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    fireEvent.click(screen.getByRole('button', { name: 'Sede: Centro. Cambiar sede' }));
    expect(screen.getByRole('menuitemradio', { name: 'Todas las sedes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Norte' }));
    expect(
      await screen.findByRole('button', { name: 'Sede: Norte. Cambiar sede' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Próxima apertura')).toBeInTheDocument();
    unmount();

    renderApp({ auth, fetch: f.fetch });
    expect(
      await screen.findByRole('button', { name: 'Sede: Norte. Cambiar sede' }),
    ).toBeInTheDocument();
  });

  it('sin «todas las sedes» no ofrece esa opción', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ puedeVerTodasLasSedes: false }) },
    });
    renderApp({ auth, fetch: f.fetch });
    fireEvent.click(await screen.findByRole('button', { name: 'Sede: Centro. Cambiar sede' }));
    expect(screen.queryByRole('menuitemradio', { name: 'Todas las sedes' })).toBeNull();
  });

  it('sedeInicial respeta lo guardado, la sede por defecto y el permiso de ver todas', () => {
    const s = sesionDe();
    expect(sedeInicial(s, null)).toBe(IDS.sedeCentro);
    expect(sedeInicial(s, IDS.sedeNorte)).toBe(IDS.sedeNorte);
    expect(sedeInicial(s, '*')).toBeNull();
    expect(sedeInicial({ ...s, puedeVerTodasLasSedes: false }, '*')).toBe(IDS.sedeCentro);
    expect(sedeInicial(s, 'otra')).toBe(IDS.sedeCentro);
    expect(sedeInicial({ ...s, sedeDefectoId: null, puedeVerTodasLasSedes: false }, null)).toBe(
      IDS.sedeCentro,
    );
  });
});

describe('selector de clínica', () => {
  const dosClinicas = [
    { id: IDS.clinicaA, nombre: 'Clínica Prueba' },
    { id: IDS.clinicaB, nombre: 'Clínica Dos' },
  ];

  it('con varias clínicas pide elegir, manda X-Clinica-Id y recuerda la elegida', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': ({ cabeceras }) => {
        const id = cabeceras.get('x-clinica-id');
        const clinica =
          id === IDS.clinicaB
            ? { id: IDS.clinicaB, nombre: 'Clínica Dos', zonaHoraria: 'America/Asuncion' }
            : { id: IDS.clinicaA, nombre: 'Clínica Prueba', zonaHoraria: 'America/Asuncion' };
        return { cuerpo: sesionDe({ clinicas: dosClinicas, clinica }) };
      },
    });
    const { unmount } = renderApp({ auth, fetch: f.fetch });
    expect(await screen.findByRole('heading', { name: 'Elegí la clínica' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clínica Dos' }));
    expect(await screen.findByText('Clínica Dos', { selector: 'dd' })).toBeInTheDocument();
    expect(f.pedidos.at(-1)?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaB);
    unmount();

    // Segunda vez: no pregunta, usa la recordada.
    const antes = f.pedidos.length;
    renderApp({ auth, fetch: f.fetch });
    expect(await screen.findByText('Clínica Dos', { selector: 'dd' })).toBeInTheDocument();
    expect(f.pedidos[antes]?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaB);
  });

  it('desde el menú de usuario se puede cambiar de clínica', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    window.localStorage.setItem(`conecta.clinica.${IDS.usuario}`, IDS.clinicaA);
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ clinicas: dosClinicas }) } });
    renderApp({ auth, fetch: f.fetch });
    fireEvent.click(await screen.findByRole('button', { name: 'Perfil de Lorena Fretes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cambiar de clínica' }));
    expect(await screen.findByRole('heading', { name: 'Elegí la clínica' })).toBeInTheDocument();
  });

  it('si la clínica recordada ya no sirve, la olvida y vuelve a preguntar', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    window.localStorage.setItem(`conecta.clinica.${IDS.usuario}`, IDS.clinicaB);
    const f = crearFetchFalso({
      'GET /sesion': ({ cabeceras }) =>
        cabeceras.get('x-clinica-id') === IDS.clinicaB
          ? { estado: 403, cuerpo: { codigo: 'sin_membresia', mensaje: 'Sin membresía' } }
          : { cuerpo: sesionDe({ clinicas: dosClinicas }) },
    });
    renderApp({ auth, fetch: f.fetch });
    expect(await screen.findByRole('heading', { name: 'Elegí la clínica' })).toBeInTheDocument();
    await waitFor(() =>
      expect(window.localStorage.getItem(`conecta.clinica.${IDS.usuario}`)).toBeNull(),
    );
  });

  it('cerrar sesión desde el menú vuelve a Acceso', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    renderApp({ auth, fetch: f.fetch });
    fireEvent.click(await screen.findByRole('button', { name: 'Perfil de Lorena Fretes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });
});
