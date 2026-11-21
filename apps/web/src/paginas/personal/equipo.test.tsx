import type { CrearInvitacion, Persona } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  diferida,
  IDS,
  IDS_PERSONAL,
  matriz,
  PERMISOS_ADMINISTRACION,
  PERMISOS_SOLO_VER_EQUIPO,
  personaDe,
  portapapelesFalso,
  renderApp as renderPersonal,
  rolDe,
  ROL_ADMINISTRACION_COMPLETO,
  ROL_DUENO_COMPLETO,
  ROL_SESION_ADMINISTRACION,
  sesionDe,
  uuid,
  type RespuestaFalsa,
} from '../../test/fabricas.js';
import { coincideConMascara } from './consultas.js';

const PENDIENTE = personaDe({
  membresiaId: IDS_PERSONAL.gloria,
  usuarioId: null,
  nombre: 'Gloria Páez',
  email: 'gloria@ejemplo.test',
  estado: 'pendiente',
  ultimoAcceso: null,
  invitacionVenceEn: '2099-11-27T12:00:00Z',
});
const INACTIVA = personaDe({
  membresiaId: IDS_PERSONAL.carlos,
  usuarioId: IDS_PERSONAL.usuarioCarlos,
  nombre: 'Carlos Ayala',
  email: 'carlos@ejemplo.test',
  estado: 'inactivo',
});
const ACTIVA = personaDe();
const EQUIPO = [ACTIVA, PENDIENTE, INACTIVA];

function creada(cuerpo: CrearInvitacion) {
  return {
    persona: personaDe({
      membresiaId: uuid(599),
      usuarioId: null,
      nombre: cuerpo.nombre,
      email: cuerpo.email,
      estado: 'pendiente',
      ultimoAcceso: null,
      invitacionVenceEn: '2099-11-27T12:00:00Z',
    }),
    enlace: '/invitacion?token=abcdefghijklmnopqrstuvwxyz0123456789',
    venceEn: '2099-11-27T12:00:00Z',
  };
}

describe('coincideConMascara', () => {
  it('compara dominio y comienzo visible', () => {
    expect(coincideConMascara('marta@gmail.com', 'ma***@gmail.com')).toBe(true);
    expect(coincideConMascara('MARTA@gmail.com', 'ma***@gmail.com')).toBe(true);
    expect(coincideConMascara('lorena@gmail.com', 'ma***@gmail.com')).toBe(false);
    expect(coincideConMascara('marta@hotmail.com', 'ma***@gmail.com')).toBe(false);
  });
});

describe('Equipo', () => {
  it('lista los tres estados con Chip (color + ícono + texto) y filtra por estado', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: EQUIPO },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    expect((await screen.findAllByRole('link', { name: 'Gloria Páez' }))[0]).toHaveAttribute(
      'href',
      `/personal/${IDS_PERSONAL.gloria}`,
    );
    for (const texto of ['Activo', 'Pendiente de aceptar', 'Inactivo']) {
      const chip = screen.getAllByText(texto, { selector: '.cn-chip span' })[0];
      expect(chip?.closest('.cn-chip')?.querySelector('svg')).not.toBeNull();
    }
    expect(screen.getAllByText(/El enlace vence el/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Centro').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Pendiente de aceptar \(1\)/ }));
    expect(screen.queryAllByRole('link', { name: 'Marta Acosta' })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Gloria Páez' }).length).toBeGreaterThan(0);
    // la cabecera de pedidos lleva la clínica
    expect(
      f.pedidos.find((p) => p.url.pathname === '/api/v1/personal')?.cabeceras.get('x-clinica-id'),
    ).toBe(IDS.clinicaA);
  });

  it('sin personal:crear no aparece «Invitar» ni las acciones de pendientes', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: PERMISOS_SOLO_VER_EQUIPO }) },
      'GET /personal': { cuerpo: EQUIPO },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    await screen.findAllByRole('link', { name: 'Gloria Páez' });
    expect(screen.queryByRole('button', { name: 'Invitar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reenviar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Anular/ })).toBeNull();
  });

  it('invitar: valida, ofrece solo las sedes visibles, muestra el enlace una vez, copia y arma el WhatsApp', async () => {
    const copiar = portapapelesFalso();
    const auth = crearAuthFalso({ conSesion: true });
    let equipo: Persona[] = [ACTIVA];
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({
          sedes: [{ id: IDS.sedeCentro, nombre: 'Centro', estado: 'abierta', color: null }],
        }),
      },
      'GET /personal': () => ({ cuerpo: equipo }),
      'GET /roles': {
        cuerpo: [
          ROL_DUENO_COMPLETO,
          rolDe(),
          rolDe({ id: uuid(36), nombre: 'Viejo', activo: false }),
        ],
      },
      'POST /invitaciones': ({ cuerpo }) => {
        const r = creada(cuerpo as CrearInvitacion);
        equipo = [ACTIVA, r.persona];
        return { estado: 201, cuerpo: r };
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    fireEvent.click(await screen.findByRole('button', { name: 'Invitar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Invitar a una persona' }));
    await hoja.findByLabelText(/^Correo/);

    // solo roles activos; Dueño/a aparece porque quien invita es Dueño/a
    const rol = hoja.getByLabelText(/^Rol/);
    expect(within(rol).queryByRole('option', { name: 'Viejo' })).toBeNull();
    expect(within(rol).getByRole('option', { name: 'Recepción y caja' })).toBeInTheDocument();
    // solo la sede que ve quien invita
    expect(hoja.getByRole('checkbox', { name: 'Centro' })).toBeInTheDocument();
    expect(hoja.queryByRole('checkbox', { name: 'Norte' })).toBeNull();

    fireEvent.click(hoja.getByRole('button', { name: 'Crear invitación' }));
    expect(await hoja.findByText('Poné el nombre.')).toBeInTheDocument();
    expect(hoja.getByText('Escribí un correo válido.')).toBeInTheDocument();
    expect(hoja.getByText('Elegí el rol.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(hoja.getByLabelText(/^Nombre y apellido/), {
      target: { value: 'Gloria Páez' },
    });
    fireEvent.change(hoja.getByLabelText(/^Correo/), { target: { value: 'Gloria@Ejemplo.test ' } });
    fireEvent.change(rol, { target: { value: IDS.rolRecepcion } });
    fireEvent.change(hoja.getByLabelText('Sede por defecto'), {
      target: { value: IDS.sedeCentro },
    });
    const enviar = hoja.getByRole('button', { name: 'Crear invitación' });
    fireEvent.click(enviar);
    fireEvent.click(enviar);

    expect(await screen.findByText('Invitación para Gloria Páez creada')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    expect(f.pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toEqual({
      nombre: 'Gloria Páez',
      email: 'gloria@ejemplo.test',
      rolId: IDS.rolRecepcion,
      sedeIds: [IDS.sedeCentro],
      sedeDefectoId: IDS.sedeCentro,
    });
    const url = `${window.location.origin}/invitacion?token=abcdefghijklmnopqrstuvwxyz0123456789`;
    expect(screen.getByLabelText('Enlace de la invitación')).toHaveValue(url);
    expect(screen.getByText(/se muestra una sola vez/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(await screen.findByText('Enlace copiado')).toBeInTheDocument();
    expect(copiar).toHaveBeenCalledWith(url);

    const wa = screen.getByRole('link', { name: 'Enviar por WhatsApp' });
    const href = wa.getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const texto = decodeURIComponent(href.slice('https://wa.me/?text='.length));
    expect(texto).toContain('Hola Gloria Páez, te invitamos a sumarte al equipo de Clínica Prueba');
    expect(texto).toContain(url);
    // La invitación llega por correo: el enlace solo no alcanza para entrar.
    expect(texto).toContain('te va a llegar un correo para crear tu contraseña');
    expect(texto).toContain('Si ya tenés cuenta, entrá con tu correo y tu contraseña');
    expect(screen.getByText(/le llega un correo para crear su contraseña/)).toBeInTheDocument();
    expect(wa).toHaveAttribute('target', '_blank');

    // Al cerrarlo, el enlace no vuelve a aparecer.
    fireEvent.click(screen.getByRole('button', { name: 'Listo, ya lo mandé' }));
    expect(screen.queryByLabelText('Enlace de la invitación')).toBeNull();
    expect(screen.queryByText(url)).toBeNull();
  });

  it('invitar: el error de invitación duplicada se muestra con el mensaje de la API', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: [ACTIVA] },
      'GET /roles': { cuerpo: [rolDe()] },
      'POST /invitaciones': {
        estado: 409,
        cuerpo: {
          codigo: 'conflicto',
          mensaje: 'Ya hay una invitación abierta para ese correo. Reenviala desde la lista.',
        },
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    fireEvent.click(await screen.findByRole('button', { name: 'Invitar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Invitar a una persona' }));
    fireEvent.change(await hoja.findByLabelText(/^Nombre y apellido/), {
      target: { value: 'Marta Acosta' },
    });
    fireEvent.change(hoja.getByLabelText(/^Correo/), { target: { value: 'marta@ejemplo.test' } });
    fireEvent.change(hoja.getByLabelText(/^Rol/), { target: { value: IDS.rolRecepcion } });
    fireEvent.click(hoja.getByRole('button', { name: 'Crear invitación' }));
    expect(await hoja.findByRole('alert')).toHaveTextContent(
      'Ya hay una invitación abierta para ese correo. Reenviala desde la lista.',
    );
    expect(screen.queryByLabelText('Enlace de la invitación')).toBeNull();
  });

  it('reenviar genera un enlace nuevo (un solo pedido) y anular pide motivo', async () => {
    portapapelesFalso();
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: EQUIPO },
      'GET /roles': { cuerpo: [rolDe()] },
      'POST /invitaciones/:id/reenviar': {
        cuerpo: {
          persona: PENDIENTE,
          enlace: '/invitacion?token=nuevonuevonuevonuevonuevo',
          venceEn: '2099-12-01T12:00:00Z',
        },
      },
      'DELETE /invitaciones/:id': { estado: 204 },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Reenviar la invitación de Gloria Páez' }))[0]!,
    );
    const hoja = within(
      await screen.findByRole('dialog', { name: 'Reenviar la invitación de Gloria Páez' }),
    );
    expect(hoja.getByText(/el anterior deja de servir/)).toBeInTheDocument();
    const generar = hoja.getByRole('button', { name: 'Generar enlace nuevo' });
    fireEvent.click(generar);
    fireEvent.click(generar);
    expect(await screen.findByText('Enlace nuevo para Gloria Páez')).toBeInTheDocument();
    expect(screen.getByText(/El enlace anterior ya no sirve/)).toBeInTheDocument();
    expect(screen.getByLabelText('Enlace de la invitación')).toHaveValue(
      `${window.location.origin}/invitacion?token=nuevonuevonuevonuevonuevo`,
    );
    const reenvios = f.pedidos.filter((p) => p.url.pathname.endsWith('/reenviar'));
    expect(reenvios).toHaveLength(1);
    expect(reenvios[0]?.url.pathname).toBe(`/api/v1/invitaciones/${IDS_PERSONAL.gloria}/reenviar`);

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Anular la invitación de Gloria Páez' })[0]!,
    );
    const anular = within(
      await screen.findByRole('dialog', { name: 'Anular la invitación de Gloria Páez' }),
    );
    fireEvent.click(anular.getByRole('button', { name: 'Anular invitación' }));
    expect(await anular.findByText('Contanos el motivo de la baja.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);
    fireEvent.change(anular.getByLabelText(/^Motivo/), {
      target: { value: 'Se equivocó de correo' },
    });
    const confirmar = anular.getByRole('button', { name: 'Anular invitación' });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(
      await screen.findByText('La invitación de Gloria Páez quedó anulada.'),
    ).toBeInTheDocument();
    const bajas = f.pedidos.filter((p) => p.metodo === 'DELETE');
    expect(bajas).toHaveLength(1);
    expect(bajas[0]?.url.pathname).toBe(`/api/v1/invitaciones/${IDS_PERSONAL.gloria}`);
    expect(bajas[0]?.cuerpo).toEqual({ motivo: 'Se equivocó de correo' });
  });
});

describe('Persona', () => {
  it('muestra datos, doble factor y edita rol y sedes: manda solo las sedes que ve (un solo PATCH)', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const persona = personaDe({
      mfaActivo: true,
      sedeIds: [IDS.sedeCentro, IDS_PERSONAL.sedeOculta],
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: [persona] },
      'GET /roles': {
        cuerpo: [
          ROL_DUENO_COMPLETO,
          rolDe(),
          rolDe({ id: uuid(34), codigo: 'asistente', nombre: 'Asistente' }),
        ],
      },
      'PATCH /personal/:id': ({ cuerpo }) => ({
        cuerpo: {
          ...persona,
          ...(cuerpo as object),
          rol: { id: uuid(34), codigo: 'asistente', nombre: 'Asistente' },
        },
      }),
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.ana}` });
    expect(
      await screen.findByRole('heading', { name: 'Marta Acosta', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Centro, 1 sede que no ves')).toBeInTheDocument();
    const mfa = screen.getByText('Activado', { selector: '.cn-chip span' });
    expect(mfa.closest('.cn-chip')?.querySelector('svg')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Editar rol y sedes' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar rol y sedes' }));
    fireEvent.change(await hoja.findByLabelText('Rol'), { target: { value: uuid(34) } });
    fireEvent.click(hoja.getByRole('checkbox', { name: 'Norte' }));
    fireEvent.change(hoja.getByLabelText('Sede por defecto'), { target: { value: IDS.sedeNorte } });
    const guardar = hoja.getByRole('button', { name: 'Guardar cambios' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    const patches = f.pedidos.filter((p) => p.metodo === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.cuerpo).toEqual({
      rolId: uuid(34),
      // La sede que quien edita no ve no viaja: la conserva la API (mandarla da 403).
      sedeIds: [IDS.sedeCentro, IDS.sedeNorte],
      sedeDefectoId: IDS.sedeNorte,
    });
  });

  it('con la sede por defecto oculta: no manda sedeDefectoId ni la sede oculta', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const persona = personaDe({
      sedeIds: [IDS_PERSONAL.sedeOculta, IDS.sedeCentro],
      sedeDefectoId: IDS_PERSONAL.sedeOculta,
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: [persona] },
      'GET /roles': {
        cuerpo: [ROL_DUENO_COMPLETO, rolDe(), rolDe({ id: uuid(34), nombre: 'Asistente' })],
      },
      'PATCH /personal/:id': { cuerpo: persona },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.ana}` });
    fireEvent.click(await screen.findByRole('button', { name: 'Editar rol y sedes' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar rol y sedes' }));
    fireEvent.change(await hoja.findByLabelText('Rol'), { target: { value: uuid(34) } });
    expect(hoja.getByLabelText('Sede por defecto')).toHaveValue('');
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'PATCH')?.cuerpo).toEqual({
      rolId: uuid(34),
      sedeIds: [IDS.sedeCentro],
    });
  });

  it('sin personal:editar el detalle es de solo lectura', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: PERMISOS_SOLO_VER_EQUIPO }) },
      'GET /personal': { cuerpo: EQUIPO },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.carlos}` });
    await screen.findByRole('heading', { name: 'Carlos Ayala', level: 1 });
    for (const nombre of ['Editar rol y sedes', 'Desactivar', 'Reactivar', 'Reenviar', 'Anular']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull();
    }
  });

  it('la propia membresía no se ofrece para editar y explica por qué', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: [personaDe({ usuarioId: IDS.usuario, nombre: 'Lorena Fretes' })] },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.ana}` });
    expect(await screen.findByText(/Esta es tu cuenta/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar rol y sedes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).toBeNull();
  });

  it('desactivar con motivo y reactivar: la pantalla usa la Persona que responde la API', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    // La lista se pide una vez; las recargas posteriores no vuelven nunca: lo que cambia en
    // pantalla sale de la respuesta de desactivar y reactivar.
    const colgada = diferida<RespuestaFalsa>();
    let pedidosLista = 0;
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': () => (++pedidosLista === 1 ? { cuerpo: [personaDe()] } : colgada.promesa),
      'POST /personal/:id/desactivar': { cuerpo: personaDe({ estado: 'inactivo' }) },
      'POST /personal/:id/reactivar': { cuerpo: personaDe({ estado: 'activo' }) },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.ana}` });
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Desactivar a Marta Acosta' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Confirmar desactivación' }));
    expect(await hoja.findByText('Contanos el motivo de la baja.')).toBeInTheDocument();
    fireEvent.change(hoja.getByLabelText(/^Motivo/), { target: { value: 'Dejó la clínica' } });
    const confirmar = hoja.getByRole('button', { name: 'Confirmar desactivación' });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(await screen.findByText('La persona quedó desactivada.')).toBeInTheDocument();
    const bajas = f.pedidos.filter((p) => p.url.pathname.endsWith('/desactivar'));
    expect(bajas).toHaveLength(1);
    expect(bajas[0]?.cuerpo).toEqual({ motivo: 'Dejó la clínica' });
    expect(screen.getByText('Inactivo', { selector: '.cn-chip span' })).toBeInTheDocument();

    const reactivar = await screen.findByRole('button', { name: 'Reactivar' });
    fireEvent.click(reactivar);
    fireEvent.click(reactivar);
    expect(await screen.findByText('La persona volvió a tener acceso.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    await waitFor(() =>
      expect(f.pedidos.filter((p) => p.url.pathname.endsWith('/reactivar'))).toHaveLength(1),
    );
  });
});

describe('Límites de quien administra', () => {
  /** Administración sin «todas las sedes» que ve solo Centro. */
  const ADMIN_PROPIO = rolDe({
    ...ROL_ADMINISTRACION_COMPLETO,
    todasLasSedes: false,
  });
  const sesionAdmin = (parcial = {}) =>
    sesionDe({
      rol: ROL_SESION_ADMINISTRACION,
      permisos: PERMISOS_ADMINISTRACION,
      sedes: [{ id: IDS.sedeCentro, nombre: 'Centro', estado: 'abierta', color: null }],
      puedeVerTodasLasSedes: false,
      ...parcial,
    });
  const SOLO_EQUIPO = matriz([
    ['inicio', ['ver']],
    ['personal', ['ver']],
  ]);
  const ROLES = [
    ROL_DUENO_COMPLETO,
    ADMIN_PROPIO,
    // Recepción crea turnos: Administración no tiene agenda:crear.
    rolDe(),
    rolDe({
      id: uuid(70),
      codigo: null,
      nombre: 'Consulta global',
      esSistema: false,
      todasLasSedes: true,
      permisos: SOLO_EQUIPO,
    }),
    rolDe({
      id: uuid(71),
      codigo: null,
      nombre: 'Consulta de sede',
      esSistema: false,
      permisos: SOLO_EQUIPO,
    }),
  ];

  it('al invitar ofrece solo roles incluidos en los permisos propios y sin «todas las sedes» si no lo tiene', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionAdmin() },
      'GET /personal': { cuerpo: [] },
      'GET /roles': { cuerpo: ROLES },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    fireEvent.click(await screen.findByRole('button', { name: 'Invitar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Invitar a una persona' }));
    const rol = await hoja.findByLabelText(/^Rol/);
    const opciones = within(rol)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(opciones).toEqual(['Elegí un rol', 'Administración', 'Consulta de sede']);
  });

  it('el Dueño/a puede asignar cualquier rol activo', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': { cuerpo: [] },
      'GET /roles': { cuerpo: ROLES },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    fireEvent.click(await screen.findByRole('button', { name: 'Invitar' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Invitar a una persona' }));
    const rol = await hoja.findByLabelText(/^Rol/);
    expect(within(rol).getAllByRole('option')).toHaveLength(ROLES.length + 1);
  });

  it('quien no ve todas las sedes no ve acciones sobre personas de otras sedes', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const deOtraSede = personaDe({
      membresiaId: IDS_PERSONAL.gloria,
      usuarioId: null,
      nombre: 'Gloria Páez',
      estado: 'pendiente',
      sedeIds: [IDS.sedeCentro, IDS_PERSONAL.sedeOculta],
      invitacionVenceEn: '2099-11-27T12:00:00Z',
    });
    const deMiSede = personaDe({
      membresiaId: IDS_PERSONAL.carlos,
      usuarioId: null,
      nombre: 'Carlos Ayala',
      estado: 'pendiente',
      invitacionVenceEn: '2099-11-27T12:00:00Z',
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionAdmin() },
      'GET /personal': {
        cuerpo: [
          deOtraSede,
          deMiSede,
          personaDe({ sedeIds: [IDS_PERSONAL.sedeOculta], sedeDefectoId: null }),
        ],
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    expect(
      (await screen.findAllByRole('button', { name: 'Reenviar la invitación de Carlos Ayala' }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Reenviar la invitación de Gloria Páez' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Anular la invitación de Gloria Páez' }),
    ).toBeNull();
  });

  it('en el detalle de una persona de otra sede no hay acciones y se explica por qué', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionAdmin() },
      'GET /personal': {
        cuerpo: [personaDe({ sedeIds: [IDS.sedeCentro, IDS_PERSONAL.sedeOculta] })],
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.ana}` });
    expect(await screen.findByText(/trabaja también en sedes que vos no ves/)).toBeInTheDocument();
    for (const nombre of ['Editar rol y sedes', 'Desactivar']) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull();
    }
  });

  it('si la API igual rechaza, muestra su mensaje (no el genérico)', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionAdmin() },
      'GET /personal': { cuerpo: [personaDe()] },
      'GET /roles': { cuerpo: ROLES },
      'PATCH /personal/:id': {
        estado: 403,
        cuerpo: {
          codigo: 'sin_permiso',
          mensaje: 'No podés asignar un rol con permisos que vos no tenés. Pedíselo al Dueño/a.',
        },
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/personal/${IDS_PERSONAL.ana}` });
    fireEvent.click(await screen.findByRole('button', { name: 'Editar rol y sedes' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Editar rol y sedes' }));
    fireEvent.change(await hoja.findByLabelText('Rol'), { target: { value: uuid(71) } });
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await hoja.findByRole('alert')).toHaveTextContent(
      'No podés asignar un rol con permisos que vos no tenés. Pedíselo al Dueño/a.',
    );
  });
});

describe('Equipo con el cliente de API único', () => {
  it('mfa_requerido pide el código (sin volver a pedir la sesión de rebote)', async () => {
    const auth = crearAuthFalso({
      conSesion: true,
      factores: [{ id: IDS.factor, nombre: 'Conecta', verificado: true }],
    });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /personal': {
        estado: 401,
        cuerpo: { codigo: 'mfa_requerido', mensaje: 'Confirmá el código de tu app.' },
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    expect(await screen.findByLabelText('Código de 6 dígitos')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.url.pathname === '/api/v1/sesion')).toHaveLength(1);
  });
});
