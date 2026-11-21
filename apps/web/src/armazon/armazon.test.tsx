import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moduloDeRuta } from '../modulos.js';
import { sedeInicial } from '../sesion/ProveedorSesion.js';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  PERMISOS_LECTURA_SEDES,
  PERMISOS_RECEPCION,
  renderApp,
  ROL_LECTURA_SEDES,
  ROL_RECEPCION,
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

  it('recepción (matriz real) no ve Sedes ni Auditoría, y sus rutas muestran el candado', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: PERMISOS_RECEPCION, rol: ROL_RECEPCION }) },
    });
    const { unmount } = renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    expect(
      await screen.findByRole('heading', { name: 'Tu rol no tiene acceso a esto' }),
    ).toBeInTheDocument();
    expect(navegacion().queryByRole('link', { name: 'Auditoría' })).toBeNull();
    expect(navegacion().queryByRole('link', { name: 'Sedes' })).toBeNull();
    expect(navegacion().getByRole('link', { name: 'Inicio' })).toBeInTheDocument();
    unmount();

    renderApp({ auth, fetch: f.fetch, ruta: '/auditoria' });
    expect(
      await screen.findByRole('heading', { name: 'Tu rol no tiene acceso a esto' }),
    ).toBeInTheDocument();
    // Ni la lista de sedes ni la auditoría se piden: solo la sesión.
    expect(f.pedidos.every((p) => p.url.pathname === '/api/v1/sesion')).toBe(true);
  });

  it('un rol que solo ve sedes no ve Nueva sede, Editar, Dar de baja ni el alta de sillones', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({ permisos: PERMISOS_LECTURA_SEDES, rol: ROL_LECTURA_SEDES }),
      },
      'GET /sedes': { cuerpo: [sedeDe()] },
      'GET /sedes/:id': {
        cuerpo: sedeDe({
          horarios: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 }],
          sillones: [{ id: IDS.factor, sedeId: IDS.sedeCentro, nombre: 'Sillón 1', activo: true }],
        }),
      },
      'GET /sedes/:id/agenda': {
        cuerpo: {
          sedeId: IDS.sedeCentro,
          anticipacionMin: 120,
          diasAdelante: 14,
          reservaOnlineActiva: false,
        },
      },
    });
    const { unmount } = renderApp({ auth, fetch: f.fetch, ruta: '/sedes' });
    await screen.findAllByText('Centro');
    expect(screen.queryByRole('button', { name: 'Nueva sede' })).toBeNull();
    unmount();

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

  it('sedeInicial: elegida en esta sesión > por defecto > recordada > todas > primera', () => {
    const s = sesionDe();
    const centro = { tipo: 'sede', id: IDS.sedeCentro };
    const norte = { tipo: 'sede', id: IDS.sedeNorte };
    const nada = { elegidaEnSesion: null, recordada: null };
    expect(sedeInicial(s, nada)).toEqual(centro);
    // La recordada de otra sesión NO le gana a la sede por defecto…
    expect(sedeInicial(s, { ...nada, recordada: IDS.sedeNorte })).toEqual(centro);
    expect(sedeInicial(s, { ...nada, recordada: '*' })).toEqual(centro);
    // …pero la elegida a mano en esta sesión sí.
    expect(sedeInicial(s, { ...nada, elegidaEnSesion: IDS.sedeNorte })).toEqual(norte);
    expect(sedeInicial(s, { ...nada, elegidaEnSesion: '*' })).toEqual({ tipo: 'todas' });
    expect(
      sedeInicial({ ...s, puedeVerTodasLasSedes: false }, { ...nada, elegidaEnSesion: '*' }),
    ).toEqual(centro);
    expect(sedeInicial(s, { ...nada, elegidaEnSesion: 'otra' })).toEqual(centro);
    // Sin sede por defecto, manda la recordada.
    const sinDefecto = { ...s, sedeDefectoId: null };
    expect(sedeInicial(sinDefecto, { ...nada, recordada: IDS.sedeNorte })).toEqual(norte);
    expect(sedeInicial(sinDefecto, nada)).toEqual({ tipo: 'todas' });
    expect(sedeInicial({ ...sinDefecto, puedeVerTodasLasSedes: false }, nada)).toEqual(centro);
    // «Todas» y «ninguna» no se confunden.
    expect(sedeInicial({ ...s, sedes: [], sedeDefectoId: null }, nada)).toEqual({
      tipo: 'ninguna',
    });
  });

  it('al ingresar arranca en la sede por defecto aunque la última usada sea otra', async () => {
    window.localStorage.setItem(`conecta.sede.${IDS.usuario}.${IDS.clinicaA}`, IDS.sedeNorte);
    const auth = crearAuthFalso();
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    renderApp({ auth, fetch: f.fetch, ruta: '/acceso' });
    fireEvent.change(await screen.findByLabelText('Correo'), {
      target: { value: 'lorena@ejemplo.test' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'buena' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(
      await screen.findByRole('button', { name: 'Sede: Centro. Cambiar sede' }),
    ).toBeInTheDocument();
  });

  it('sin sede por defecto, arranca en la última usada', async () => {
    window.localStorage.setItem(`conecta.sede.${IDS.usuario}.${IDS.clinicaA}`, IDS.sedeNorte);
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe({ sedeDefectoId: null }) } });
    renderApp({ auth, fetch: f.fetch });
    expect(
      await screen.findByRole('button', { name: 'Sede: Norte. Cambiar sede' }),
    ).toBeInTheDocument();
  });

  it('sin ninguna sede visible: «Sin sede asignada», no «Todas las sedes»', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({ sedes: [], sedeDefectoId: null, puedeVerTodasLasSedes: true }),
      },
    });
    renderApp({ auth, fetch: f.fetch });
    await screen.findByRole('heading', { name: "Mba'éichapa, Lorena" });
    expect(screen.getAllByText('Sin sede asignada').length).toBeGreaterThan(0);
    expect(screen.queryByText('Todas las sedes')).toBeNull();
    expect(screen.queryByRole('button', { name: /Cambiar sede/ })).toBeNull();
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

  it('cerrar sesión avisa a la API (POST /sesion/cerrar) antes del signOut y vuelve a Acceso', async () => {
    const orden: string[] = [];
    const auth = crearAuthFalso({ conSesion: true });
    auth.cerrarSesion.mockImplementation(() => {
      orden.push('signOut');
      auth.estado.sesion = null;
      return Promise.resolve();
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'POST /sesion/cerrar': ({ cabeceras }) => {
        orden.push(`cerrar ${cabeceras.get('authorization')}`);
        return { estado: 204 };
      },
    });
    renderApp({ auth, fetch: f.fetch });
    fireEvent.click(await screen.findByRole('button', { name: 'Perfil de Lorena Fretes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(orden).toEqual(['cerrar Bearer token-de-prueba', 'signOut']);
  });

  it('si el aviso de cierre a la API falla, sale igual', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'POST /sesion/cerrar': {
        estado: 503,
        cuerpo: { codigo: 'servicio_no_disponible', mensaje: 'No responde.' },
      },
    });
    renderApp({ auth, fetch: f.fetch });
    fireEvent.click(await screen.findByRole('button', { name: 'Perfil de Lorena Fretes' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
  });
});

describe('Experimentos', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('/experimentos/odontograma no existe fuera de desarrollo, ni siquiera para un dueño', async () => {
    vi.stubEnv('DEV', false);
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    renderApp({ auth, fetch: f.fetch, ruta: '/experimentos/odontograma' });
    expect(await screen.findByText('No encontramos esta página.')).toBeInTheDocument();
  });
});

describe('moduloDeRuta', () => {
  it('Roles cuelga de Equipo en la navegación', () => {
    expect(moduloDeRuta('/roles')).toBe('personal');
    expect(moduloDeRuta('/personal/abc')).toBe('personal');
    expect(moduloDeRuta('/rolesx')).toBeUndefined();
  });
});
