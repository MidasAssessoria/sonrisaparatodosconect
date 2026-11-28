import { type Sesion } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorAuth } from '../../auth/servicioAuth.js';
import {
  anamnesisDe,
  catalogoDe,
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  IDS_PACIENTES,
  MATEO,
  pacienteDe,
  PERMISOS_ODONTOLOGO,
  renderApp,
  ROL_ODONTOLOGO,
  sesionDe,
  type OpcionesAuthFalso,
  type PedidoRegistrado,
} from '../../test/fabricas.js';
import { firmar } from '../../test/lienzo.js';

const ODONTOLOGO: Partial<Sesion> = { permisos: PERMISOS_ODONTOLOGO, rol: ROL_ODONTOLOGO };
const RUTA_MATEO = `/pacientes/${IDS_PACIENTES.mateo}`;
const CLAVE_MODO = 'conecta.modo-paciente';

/** Mateo, menor, con su madre Ana como tutora legal (el vínculo trae la CI de Ana). */
const mateo = pacienteDe({
  ...MATEO,
  relaciones: [
    {
      id: IDS_PACIENTES.relacion,
      familiar: { id: IDS_PACIENTES.ana, nombre: 'Ana Giménez', edad: 34, ci: '4123456' },
      tipo: 'madre',
      esTutorLegal: false,
      esResponsablePago: false,
      familiarEsTutorLegal: true,
      familiarEsResponsablePago: true,
    },
  ],
});

function montar(op: OpcionesAuthFalso = {}, ruta = `${RUTA_MATEO}/anamnesis`) {
  const estado = { versiones: [] as ReturnType<typeof anamnesisDe>[] };
  const auth = crearAuthFalso({ conSesion: true, ...op });
  const f = crearFetchFalso({
    'GET /sesion': { cuerpo: sesionDe(ODONTOLOGO) },
    'GET /pacientes/:id': { cuerpo: mateo },
    'GET /pacientes/:id/anamnesis': () => ({
      cuerpo: {
        versiones: estado.versiones.map((a) => ({
          version: a.version,
          fecha: a.fecha,
          registradaPor: a.registradaPor,
          firmante: { nombre: a.firmante.nombre, esTutor: a.firmante.esTutor },
          alertas: a.alertasMedicas.length,
        })),
        requiereTutor: true,
      },
    }),
    'GET /pacientes/:id/anamnesis/:version': () => ({ cuerpo: estado.versiones[0] }),
    'GET /anamnesis/preguntas': { cuerpo: catalogoDe() },
    'POST /pacientes/:id/anamnesis': () => {
      const v1 = anamnesisDe({
        pacienteId: IDS_PACIENTES.mateo,
        version: 1,
        firmante: { nombre: 'Ana Giménez', ci: '4123456', esTutor: true },
      });
      estado.versiones = [v1];
      return { estado: 201, cuerpo: v1 };
    },
  });
  renderApp({ auth, fetch: f.fetch, ruta });
  return { ...f, auth };
}

const de = (pedidos: PedidoRegistrado[], metodo: string, ruta: string) =>
  pedidos.filter((p) => p.metodo === metodo && p.url.pathname === `/api/v1${ruta}`);

/** Desde la pestaña Anamnesis: «Pasar la tablet al paciente» y confirmar. */
async function pasarTablet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Pasar la tablet al paciente' }));
  const hoja = await screen.findByRole('dialog', { name: '¿Pasar la tablet al paciente?' });
  fireEvent.click(within(hoja).getByRole('button', { name: 'Pasar la tablet' }));
  await screen.findByRole('heading', { name: 'Cuestionario de salud', level: 1 });
}

function bloquear(valor: string) {
  window.localStorage.setItem(CLAVE_MODO, valor);
}

const BLOQUEADO = JSON.stringify({
  usuarioId: IDS.usuario,
  pacienteId: IDS_PACIENTES.mateo,
  fase: 'bloqueado',
});

describe('Modo paciente', () => {
  it('el formulario va en pantalla completa, sin menú ni enlaces, y la CI del tutor no se ve', async () => {
    const f = montar();
    await pasarTablet();
    // Fuera del armazón: sin navegación, buscador ni pestañas de la ficha.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Para Mateo Giménez')).toBeInTheDocument();
    expect(window.localStorage.getItem(CLAVE_MODO)).toContain('"fase":"formulario"');

    fireEvent.change(await screen.findByRole('textbox', { name: /motivo de tu consulta/ }), {
      target: { value: 'Control' },
    });
    const tutores = screen.getByRole('group', { name: 'Tutores legales del grupo familiar' });
    fireEvent.click(within(tutores).getByRole('button', { name: 'Ana Giménez (Madre)' }));
    // La cédula de Ana se usa sin mostrarla.
    expect(screen.getByText('Usamos la cédula cargada en su ficha.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Cédula/ })).toBeNull();
    expect(screen.queryByText(/4\.?123\.?456/)).toBeNull();

    firmar(screen.getByRole('img', { name: /Recuadro para firmar/ }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Declaro que la información es verdadera' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Guardar anamnesis' }));

    expect(
      await screen.findByRole('heading', { name: 'Devolvé la tablet a la clínica', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gracias. Guardamos tu cuestionario.')).toBeInTheDocument();
    const [post] = de(f.pedidos, 'POST', `${RUTA_MATEO}/anamnesis`);
    expect((post?.cuerpo as { firmante: unknown }).firmante).toEqual({
      nombre: 'Ana Giménez',
      ci: '4123456',
      esTutor: true,
    });
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(window.localStorage.getItem(CLAVE_MODO)).toContain('"fase":"bloqueado"');
  });

  it('sin doble factor se desbloquea con la contraseña de la cuenta abierta y vuelve a la ficha', async () => {
    const { auth } = montar();
    await pasarTablet();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    const hoja = await screen.findByRole('dialog', { name: '¿Terminar sin guardar?' });
    fireEvent.click(within(hoja).getByRole('button', { name: 'Terminar sin guardar' }));
    await screen.findByRole('heading', { name: 'Devolvé la tablet a la clínica' });
    expect(screen.queryByText('Gracias. Guardamos tu cuestionario.')).toBeNull();

    const clave = await screen.findByLabelText('Contraseña');
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(await screen.findByText('Escribí tu contraseña.')).toBeInTheDocument();

    auth.iniciarSesion.mockRejectedValueOnce(new ErrorAuth('credenciales'));
    fireEvent.change(clave, { target: { value: 'otra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(await screen.findByText(/no coinciden.*Quedan 4 intentos\./)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'laBuena123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(
      await screen.findByRole('heading', { name: 'Mateo Giménez', level: 1 }),
    ).toBeInTheDocument();
    expect(auth.iniciarSesion).toHaveBeenLastCalledWith('lorena@ejemplo.test', 'laBuena123');
    expect(screen.getByRole('link', { name: 'Anamnesis' })).toHaveAttribute('aria-current', 'page');
    expect(window.localStorage.getItem(CLAVE_MODO)).toBeNull();
  });

  it('con doble factor pide el código (sin bajar la sesión a aal1)', async () => {
    const { auth } = montar({
      factores: [{ id: IDS.factor, nombre: 'Conecta', verificado: true }],
      nivel: { actual: 'aal2', siguiente: 'aal2' },
    });
    bloquear(BLOQUEADO);
    window.dispatchEvent(new StorageEvent('storage', { key: CLAVE_MODO }));
    const codigo = await screen.findByLabelText('Código de 6 dígitos');
    auth.verificarCodigo.mockRejectedValueOnce(new ErrorAuth('codigo_invalido'));
    fireEvent.change(codigo, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(await screen.findByText(/Quedan 4 intentos\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() => expect(window.localStorage.getItem(CLAVE_MODO)).toBeNull());
    expect(auth.verificarCodigo).toHaveBeenLastCalledWith(IDS.factor, '123456');
    // Nunca la contraseña: un ingreso nuevo dejaría la sesión en aal1.
    expect(auth.iniciarSesion).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: 'Mateo Giménez', level: 1 }),
    ).toBeInTheDocument();
  });

  it('el bloqueo sobrevive a recargar y a cualquier ruta (Atrás), y uno ilegible también bloquea', async () => {
    bloquear(BLOQUEADO);
    montar({}, '/pacientes');
    expect(
      await screen.findByRole('heading', { name: 'Devolvé la tablet a la clínica' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Pacientes')).toBeNull();
  });

  it('un estado ilegible en el almacenamiento también bloquea', async () => {
    bloquear('{roto');
    montar({}, '/');
    expect(
      await screen.findByRole('heading', { name: 'Devolvé la tablet a la clínica' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('otra pestaña que pasa a modo paciente bloquea esta también', async () => {
    montar({}, '/pacientes');
    await screen.findAllByRole('navigation');
    bloquear(BLOQUEADO);
    window.dispatchEvent(new StorageEvent('storage', { key: CLAVE_MODO }));
    expect(
      await screen.findByRole('heading', { name: 'Devolvé la tablet a la clínica' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('después de varios intentos fallidos cierra la sesión (y el bloqueo se borra con ella)', async () => {
    bloquear(BLOQUEADO);
    const { auth } = montar({}, '/');
    const clave = await screen.findByLabelText('Contraseña');
    auth.iniciarSesion.mockRejectedValue(new ErrorAuth('credenciales'));
    for (let i = 0; i < 5; i++) {
      fireEvent.change(clave, { target: { value: `mala${i}` } });
      fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
      await waitFor(() => expect(auth.iniciarSesion).toHaveBeenCalledTimes(i + 1));
    }
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
    expect(window.localStorage.getItem(CLAVE_MODO)).toBeNull();
  });

  it('«Cerrar sesión» desde el bloqueo lleva al ingreso', async () => {
    bloquear(BLOQUEADO);
    const { auth } = montar({}, '/');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingresá a Conecta' })).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalled();
    expect(window.localStorage.getItem(CLAVE_MODO)).toBeNull();
  });
});
