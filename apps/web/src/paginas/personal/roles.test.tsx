import { ACCIONES, MODULOS, type CrearRol, type EditarRol } from '@conecta/shared';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  PERMISOS_ADMINISTRACION,
  ROL_RECEPCION,
  sesionDe,
  uuid,
} from '../../test/fabricas.js';
import {
  permisos,
  PERMISOS_SOLO_VER_EQUIPO,
  renderPersonal,
  rolDe,
  ROL_DUENO_COMPLETO,
} from './pruebas.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
});
