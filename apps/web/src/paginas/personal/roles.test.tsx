import { ACCIONES, MODULOS, type CrearRol, type EditarRol } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  matriz as permisos,
  PERMISOS_ADMINISTRACION,
  PERMISOS_SOLO_VER_EQUIPO,
  renderApp as renderPersonal,
  rolDe,
  ROL_ADMINISTRACION_COMPLETO,
  ROL_DUENO_COMPLETO,
  ROL_RECEPCION,
  ROL_SESION_ADMINISTRACION,
  sesionDe,
  uuid,
} from '../../test/fabricas.js';

const ROLES = [ROL_DUENO_COMPLETO, rolDe()];

describe('Roles', () => {
  it('lista con personas por rol y matriz con nombres legibles (solo lectura sin configuracion:editar)', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: PERMISOS_SOLO_VER_EQUIPO }) },
      'GET /roles': { cuerpo: ROLES },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/roles' });
    expect((await screen.findAllByText('2 personas')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 persona').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Nuevo rol' })).toBeNull();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Ver permisos de Recepción y caja' })[0]!,
    );
    const detalle = within(await screen.findByRole('region', { name: 'Rol Recepción y caja' }));
    const matriz = detalle.getByRole('table', { name: 'Permisos por módulo' });
    // nombres legibles, no códigos
    expect(within(matriz).getByRole('rowheader', { name: 'Ficha clínica' })).toBeInTheDocument();
    expect(within(matriz).queryByText('ficha_clinica')).toBeNull();
    expect(within(matriz).getByText('Agenda, Crear: permitido')).toBeInTheDocument();
    expect(within(matriz).getByText('Sedes, Ver: no permitido')).toBeInTheDocument();
    expect(detalle.getByText('Solo las sedes asignadas')).toBeInTheDocument();
    expect(detalle.getByText('No exige doble factor')).toBeInTheDocument();
    expect(detalle.getByText('Cierra la sesión tras 30 minutos sin uso')).toBeInTheDocument();
    expect(detalle.queryByRole('button', { name: 'Editar rol' })).toBeNull();
    expect(detalle.queryByRole('checkbox')).toBeNull();
  });

  it('el rol Dueño/a es de solo lectura aunque se pueda editar la configuración', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({
          rol: {
            ...ROL_RECEPCION,
            id: IDS.rolAdministracion,
            codigo: 'administracion',
            nombre: 'Administración',
          },
          permisos: PERMISOS_ADMINISTRACION,
        }),
      },
      'GET /roles': { cuerpo: ROLES },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/roles?rol=${IDS.rol}` });
    const detalle = within(await screen.findByRole('region', { name: 'Rol Dueño/a' }));
    expect(detalle.getByText(/El rol Dueño\/a no se edita/)).toBeInTheDocument();
    expect(detalle.queryByRole('button', { name: 'Editar rol' })).toBeNull();
    expect(detalle.getByText('Exige doble factor')).toBeInTheDocument();
    expect(detalle.getByText('Ve todas las sedes')).toBeInTheDocument();
  });

  it('editar un rol de sistema manda la matriz completa, sin el nombre, una sola vez', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /roles': { cuerpo: ROLES },
      'PATCH /roles/:id': ({ cuerpo }) => ({ cuerpo: { ...rolDe(), ...(cuerpo as EditarRol) } }),
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/roles?rol=${IDS.rolRecepcion}` });
    const detalle = within(await screen.findByRole('region', { name: 'Rol Recepción y caja' }));
    fireEvent.click(detalle.getByRole('button', { name: 'Editar rol' }));
    expect(detalle.getByLabelText(/^Nombre del rol/)).toBeDisabled();
    expect(detalle.getByText(/no su nombre/)).toBeInTheDocument();
    fireEvent.click(detalle.getByRole('checkbox', { name: 'Sedes: Ver' }));
    fireEvent.click(detalle.getByRole('checkbox', { name: 'Caja: Editar' }));
    fireEvent.click(detalle.getByRole('checkbox', { name: 'Exige doble factor para entrar' }));
    fireEvent.change(detalle.getByLabelText('Minutos sin uso hasta cerrar la sesión'), {
      target: { value: '3' },
    });
    fireEvent.click(detalle.getByRole('button', { name: 'Guardar rol' }));
    expect(await detalle.findByText('Poné un número entre 5 y 240.')).toBeInTheDocument();
    fireEvent.change(detalle.getByLabelText('Minutos sin uso hasta cerrar la sesión'), {
      target: { value: '45' },
    });
    const guardar = detalle.getByRole('button', { name: 'Guardar rol' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    expect(await screen.findByText('Rol «Recepción y caja» guardado')).toBeInTheDocument();
    const patches = f.pedidos.filter((p) => p.metodo === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url.pathname).toBe(`/api/v1/roles/${IDS.rolRecepcion}`);
    const esperado = permisos([
      ['inicio', ['ver']],
      ['agenda', ['ver', 'crear', 'editar', 'anular']],
      ['pacientes', ['ver', 'crear', 'editar']],
      ['presupuestos', ['ver']],
      ['caja', ['ver', 'crear']],
      ['mensajeria', ['ver', 'crear']],
      ['sedes', ['ver']],
    ]);
    const enOrden = MODULOS.flatMap((m) =>
      ACCIONES.filter((a) => esperado.some((p) => p.modulo === m && p.accion === a)).map((a) => ({
        modulo: m,
        accion: a,
      })),
    );
    expect(patches[0]?.cuerpo).toEqual({
      todasLasSedes: false,
      exigeMfa: true,
      inactividadMin: 45,
      permisos: enOrden,
    });
  });

  it('crear un rol nuevo con su matriz', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /roles': { cuerpo: ROLES },
      'POST /roles': ({ cuerpo }) => ({
        estado: 201,
        cuerpo: rolDe({
          ...(cuerpo as CrearRol),
          id: uuid(80),
          codigo: null,
          esSistema: false,
          personas: 0,
        }),
      }),
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/roles' });
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo rol' }));
    const form = within(await screen.findByRole('region', { name: 'Nuevo rol' }));
    fireEvent.click(form.getByRole('button', { name: 'Crear rol' }));
    expect(await form.findByText(/Poné el nombre del rol/)).toBeInTheDocument();
    fireEvent.change(form.getByLabelText(/^Nombre del rol/), { target: { value: 'Laboratorio' } });
    fireEvent.click(form.getByRole('checkbox', { name: 'Inventario: Ver' }));
    const crear = form.getByRole('button', { name: 'Crear rol' });
    fireEvent.click(crear);
    fireEvent.click(crear);
    expect(await screen.findByText('Rol «Laboratorio» creado')).toBeInTheDocument();
    const posts = f.pedidos.filter((p) => p.metodo === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.cuerpo).toEqual({
      nombre: 'Laboratorio',
      todasLasSedes: false,
      exigeMfa: false,
      inactividadMin: 30,
      permisos: [{ modulo: 'inventario', accion: 'ver' }],
    });
  });

  it('desde Equipo se llega a Roles', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe({ permisos: PERMISOS_SOLO_VER_EQUIPO }) },
      'GET /personal': { cuerpo: [] },
      'GET /roles': { cuerpo: ROLES },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: '/personal' });
    fireEvent.click(await screen.findByRole('button', { name: 'Roles y permisos' }));
    expect(
      await screen.findByRole('heading', { name: 'Roles y permisos', level: 1 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver al equipo' }));
    expect(await screen.findByRole('heading', { name: 'Equipo', level: 1 })).toBeInTheDocument();
  });

  it('desactivar un rol de la clínica pide motivo y manda DELETE una sola vez', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const propio = rolDe({
      id: uuid(80),
      codigo: null,
      nombre: 'Laboratorio',
      esSistema: false,
      personas: 0,
      permisos: [{ modulo: 'inventario', accion: 'ver' }],
    });
    let activo = true;
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /roles': () => ({ cuerpo: [...ROLES, { ...propio, activo }] }),
      'DELETE /roles/:id': () => {
        activo = false;
        return { estado: 204 };
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/roles?rol=${uuid(80)}` });
    const detalle = within(await screen.findByRole('region', { name: 'Rol Laboratorio' }));
    fireEvent.click(detalle.getByRole('button', { name: 'Desactivar rol' }));
    const hoja = within(
      await screen.findByRole('dialog', { name: 'Desactivar el rol «Laboratorio»' }),
    );
    fireEvent.click(hoja.getByRole('button', { name: 'Confirmar desactivación' }));
    expect(await hoja.findByText('Contanos el motivo de la baja.')).toBeInTheDocument();
    fireEvent.change(hoja.getByLabelText(/^Motivo/), { target: { value: 'Ya no tercerizamos' } });
    const confirmar = hoja.getByRole('button', { name: 'Confirmar desactivación' });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(await screen.findByText('El rol «Laboratorio» quedó desactivado.')).toBeInTheDocument();
    const bajas = f.pedidos.filter((p) => p.metodo === 'DELETE');
    expect(bajas).toHaveLength(1);
    expect(bajas[0]?.url.pathname).toBe(`/api/v1/roles/${uuid(80)}`);
    expect(bajas[0]?.cuerpo).toEqual({ motivo: 'Ya no tercerizamos' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Desactivar rol' })).toBeNull(),
    );
  });

  it('los roles de sistema son de solo lectura para quien no es Dueño/a', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({ rol: ROL_SESION_ADMINISTRACION, permisos: PERMISOS_ADMINISTRACION }),
      },
      'GET /roles': { cuerpo: [...ROLES, ROL_ADMINISTRACION_COMPLETO] },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/roles?rol=${IDS.rolRecepcion}` });
    const detalle = within(await screen.findByRole('region', { name: 'Rol Recepción y caja' }));
    expect(detalle.getByText(/solo lo edita el Dueño\/a/)).toBeInTheDocument();
    expect(detalle.queryByRole('button', { name: 'Editar rol' })).toBeNull();
    expect(detalle.queryByRole('button', { name: 'Desactivar rol' })).toBeNull();
  });

  it('Administración muestra «Exige doble factor» fijo y lo manda siempre al guardar', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    // Un dato viejo sin doble factor: la pantalla igual lo muestra exigido.
    const admin = { ...ROL_ADMINISTRACION_COMPLETO, exigeMfa: false };
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /roles': { cuerpo: [...ROLES, admin] },
      'PATCH /roles/:id': ({ cuerpo }) => ({ cuerpo: { ...admin, ...(cuerpo as EditarRol) } }),
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/roles?rol=${IDS.rolAdministracion}` });
    const detalle = within(await screen.findByRole('region', { name: 'Rol Administración' }));
    expect(detalle.getByText('Exige doble factor')).toBeInTheDocument();
    fireEvent.click(detalle.getByRole('button', { name: 'Editar rol' }));
    const mfa = detalle.getByRole('checkbox', { name: 'Exige doble factor para entrar' });
    expect(mfa).toBeChecked();
    expect(mfa).toBeDisabled();
    fireEvent.click(detalle.getByRole('button', { name: 'Guardar rol' }));
    expect(await screen.findByText('Rol «Administración» guardado')).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'PATCH')?.cuerpo).toMatchObject({ exigeMfa: true });
  });

  it('quien no es Dueño/a solo puede dar los permisos que tiene, y no «todas las sedes» si no lo tiene', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const consulta = rolDe({
      id: uuid(81),
      codigo: null,
      nombre: 'Consulta',
      esSistema: false,
      permisos: permisos([['personal', ['ver']]]),
    });
    const cajero = rolDe({
      id: uuid(82),
      codigo: null,
      nombre: 'Cajero',
      esSistema: false,
      permisos: permisos([['caja', ['ver', 'crear']]]),
    });
    const f = crearFetchFalso({
      'GET /sesion': {
        cuerpo: sesionDe({ rol: ROL_SESION_ADMINISTRACION, permisos: PERMISOS_ADMINISTRACION }),
      },
      'GET /roles': {
        cuerpo: [
          ...ROLES,
          { ...ROL_ADMINISTRACION_COMPLETO, todasLasSedes: false },
          consulta,
          cajero,
        ],
      },
    });
    renderPersonal({ auth, fetch: f.fetch, ruta: `/roles?rol=${uuid(82)}` });
    // Un rol que da algo que Administración no tiene (caja:crear): no se edita.
    const cajeroDetalle = within(await screen.findByRole('region', { name: 'Rol Cajero' }));
    expect(cajeroDetalle.getByText(/da permisos que vos no tenés/)).toBeInTheDocument();
    expect(cajeroDetalle.queryByRole('button', { name: 'Editar rol' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Ver permisos de Consulta' })[0]!);
    const detalle = within(await screen.findByRole('region', { name: 'Rol Consulta' }));
    fireEvent.click(detalle.getByRole('button', { name: 'Editar rol' }));
    expect(detalle.getByRole('checkbox', { name: 'Caja: Crear' })).toBeDisabled();
    expect(detalle.getByRole('checkbox', { name: 'Caja: Ver' })).toBeEnabled();
    expect(
      detalle.getByRole('checkbox', { name: 'Ve todas las sedes de la clínica' }),
    ).toBeDisabled();
  });
});
