import type { InvitacionPublica } from '@conecta/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  renderApp,
  sesionDe,
  type PedidoRegistrado,
  type RespuestaFalsa,
} from '../../test/fabricas.js';

const TOKEN = 'tokentokentokentokentoken123';
const RUTA = `/invitacion?token=${TOKEN}`;
const ROSA = { usuarioId: IDS.usuario, email: 'rosa@ejemplo.test' };

function invitacion(parcial: Partial<InvitacionPublica> = {}): InvitacionPublica {
  return {
    clinica: 'Clínica Sonrisa Norte',
    rol: 'Recepción y caja',
    nombre: 'Rosa Duarte',
    emailEnmascarado: 'ro***@ejemplo.test',
    siguientePaso: 'revisa_tu_correo',
    venceEn: '2099-11-27T12:00:00Z',
    ...parcial,
  };
}

/** Sesión de Rosa ya en la clínica nueva. */
const SESION_ROSA = sesionDe({
  usuario: { id: IDS.usuario, nombre: 'Rosa Duarte', email: 'rosa@ejemplo.test', mfaActivo: false },
  clinicas: [{ id: IDS.clinicaB, nombre: 'Clínica Sonrisa Norte' }],
  clinica: { id: IDS.clinicaB, nombre: 'Clínica Sonrisa Norte', zonaHoraria: 'America/Asuncion' },
});

/**
 * API de una cuenta que todavía no es miembro activo de ninguna clínica: `GET /sesion` responde
 * `sin_membresia` hasta que se acepta la invitación.
 */
function apiDeInvitacion(inv: InvitacionPublica) {
  let aceptada = false;
  const f = crearFetchFalso({
    'POST /invitaciones/consultar': { cuerpo: inv },
    'POST /invitaciones/aceptar': () => {
      aceptada = true;
      return { cuerpo: { email: 'rosa@ejemplo.test', clinicaId: IDS.clinicaB } };
    },
    'GET /sesion': (): RespuestaFalsa =>
      aceptada
        ? { cuerpo: SESION_ROSA }
        : {
            estado: 403,
            cuerpo: { codigo: 'sin_membresia', mensaje: 'No tenés acceso a ninguna clínica.' },
          },
  });
  return f;
}

const esAceptar = (p: PedidoRegistrado) => p.url.pathname.endsWith('/invitaciones/aceptar');
const esSesion = (p: PedidoRegistrado) => p.url.pathname === '/api/v1/sesion';

/** `aceptar` salió una vez, con el token de la sesión y sin clínica, antes de todo `GET /sesion`. */
function esperarAceptadaAntesDeLaSesion(pedidos: PedidoRegistrado[]) {
  const aceptar = pedidos.filter(esAceptar);
  expect(aceptar).toHaveLength(1);
  expect(aceptar[0]?.cuerpo).toEqual({ token: TOKEN });
  expect(aceptar[0]?.cabeceras.get('authorization')).toBe('Bearer token-de-prueba');
  expect(aceptar[0]?.cabeceras.has('x-clinica-id')).toBe(false);
  const primeraSesion = pedidos.findIndex(esSesion);
  expect(primeraSesion).toBeGreaterThan(pedidos.findIndex(esAceptar));
  expect(pedidos[primeraSesion]?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaB);
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
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    expect(await screen.findByText('Este enlace ya no sirve')).toBeInTheDocument();
    expect(
      screen.getByText(/Pedile a quien te invitó que te mande un enlace nuevo/),
    ).toBeInTheDocument();
    expect(screen.queryByText('No encontramos esa invitación.')).toBeNull();
    const consultar = f.pedidos.find((p) => p.metodo === 'POST');
    expect(consultar?.cuerpo).toEqual({ token: TOKEN });
    expect(consultar?.cabeceras.has('authorization')).toBe(false);
  });

  it('sin token en la URL: el mismo mensaje, sin pedir nada a la API', async () => {
    const auth = crearAuthFalso();
    const f = crearFetchFalso({});
    renderApp({ auth, fetch: f.fetch, ruta: '/invitacion' });
    expect(await screen.findByText('Este enlace ya no sirve')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.url.pathname.includes('invitaciones'))).toHaveLength(0);
  });

  it('cuenta nueva sin sesión: le dice que revise el correo, sin formulario de contraseña', async () => {
    const auth = crearAuthFalso();
    const f = apiDeInvitacion(invitacion());
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    expect(
      await screen.findByText(
        'Te mandamos un correo a ro***@ejemplo.test: abrilo para crear tu contraseña.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Recepción y caja')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(f.pedidos.some(esAceptar)).toBe(false);
  });

  it('enlace del correo vencido (Supabase vuelve con error en el hash): un mensaje claro', async () => {
    const auth = crearAuthFalso();
    const f = apiDeInvitacion(invitacion());
    renderApp({
      auth,
      fetch: f.fetch,
      ruta: `${RUTA}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid`,
    });
    expect(await screen.findByText('El enlace del correo ya no sirve')).toBeInTheDocument();
    expect(screen.getByText(/reenvíe la invitación/)).toBeInTheDocument();
  });

  it('cuenta nueva de vuelta desde el correo (ya con sesión): elige la contraseña, la guarda y acepta antes de cargar la sesión', async () => {
    const auth = crearAuthFalso({ conSesion: true, usuario: ROSA });
    const f = apiDeInvitacion(invitacion());
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    const clave = await screen.findByLabelText('Contraseña');
    const repetida = screen.getByLabelText('Repetí la contraseña');
    const guardar = screen.getByRole('button', { name: 'Guardar contraseña y unirme' });
    // Con la cuenta abierta no se pidió la sesión de la app (todavía no es miembro de nada).
    expect(f.pedidos.some(esSesion)).toBe(false);
    expect(screen.queryByText('No pudimos cargar tu sesión.')).toBeNull();

    fireEvent.change(clave, { target: { value: 'corta' } });
    fireEvent.change(repetida, { target: { value: 'corta' } });
    fireEvent.click(guardar);
    expect(await screen.findByText('Usá al menos 10 caracteres.')).toBeInTheDocument();

    fireEvent.change(clave, { target: { value: 'unaClaveLarga1' } });
    fireEvent.change(repetida, { target: { value: 'otraClaveLarga1' } });
    fireEvent.click(guardar);
    expect(await screen.findByText(/Las contraseñas no coinciden/)).toBeInTheDocument();
    expect(auth.cambiarClave).not.toHaveBeenCalled();

    fireEvent.change(repetida, { target: { value: 'unaClaveLarga1' } });
    fireEvent.click(guardar);
    fireEvent.click(guardar);

    expect(await screen.findByText(/Mba'éichapa, Rosa/)).toBeInTheDocument();
    expect(auth.cambiarClave).toHaveBeenCalledTimes(1);
    expect(auth.cambiarClave).toHaveBeenCalledWith('unaClaveLarga1');
    esperarAceptadaAntesDeLaSesion(f.pedidos);
  });

  it('cuenta existente sin ninguna clínica activa: ingresa en la página, acepta y recién después carga la sesión', async () => {
    const auth = crearAuthFalso({ usuario: ROSA });
    const f = apiDeInvitacion(invitacion({ siguientePaso: 'cuenta_existente' }));
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    expect(await screen.findByText(/Ese correo ya tiene una cuenta/)).toBeInTheDocument();

    const correo = screen.getByLabelText('Correo');
    fireEvent.change(correo, { target: { value: 'marta@ejemplo.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'miclave123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar y aceptar' }));
    expect(await screen.findByText(/Ese no es el correo de la invitación/)).toBeInTheDocument();
    expect(auth.iniciarSesion).not.toHaveBeenCalled();

    fireEvent.change(correo, { target: { value: 'rosa@ejemplo.test' } });
    const ingresar = screen.getByRole('button', { name: 'Ingresar y aceptar' });
    fireEvent.click(ingresar);
    fireEvent.click(ingresar);

    expect(await screen.findByText(/Mba'éichapa, Rosa/)).toBeInTheDocument();
    expect(auth.iniciarSesion).toHaveBeenCalledTimes(1);
    expect(auth.iniciarSesion).toHaveBeenCalledWith('rosa@ejemplo.test', 'miclave123456');
    esperarAceptadaAntesDeLaSesion(f.pedidos);
    expect(screen.queryByText('No pudimos cargar tu sesión.')).toBeNull();
  });

  it('cuenta existente con doble factor: el ingreso pide el código primero y después acepta', async () => {
    const auth = crearAuthFalso({
      usuario: ROSA,
      nivel: { actual: 'aal1', siguiente: 'aal2' },
      factores: [{ id: IDS.factor, nombre: 'Conecta', verificado: true }],
    });
    const f = apiDeInvitacion(invitacion({ siguientePaso: 'cuenta_existente' }));
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    fireEvent.change(await screen.findByLabelText('Correo'), {
      target: { value: 'rosa@ejemplo.test' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'miclave123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar y aceptar' }));

    const codigo = await screen.findByLabelText('Código de 6 dígitos');
    expect(f.pedidos.some(esAceptar)).toBe(false);
    fireEvent.change(codigo, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verificar' }));

    expect(await screen.findByText(/Mba'éichapa, Rosa/)).toBeInTheDocument();
    expect(auth.verificarCodigo).toHaveBeenCalledWith(IDS.factor, '123456');
    esperarAceptadaAntesDeLaSesion(f.pedidos);
  });

  it('con la cuenta ya abierta y el mismo correo: un botón para unirse (un solo pedido)', async () => {
    const auth = crearAuthFalso({ conSesion: true, usuario: ROSA });
    const f = apiDeInvitacion(invitacion({ siguientePaso: 'cuenta_existente' }));
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    const unirme = await screen.findByRole('button', { name: 'Unirme a Clínica Sonrisa Norte' });
    expect(f.pedidos.some(esAceptar)).toBe(false);
    expect(f.pedidos.some(esSesion)).toBe(false);
    fireEvent.click(unirme);
    fireEvent.click(unirme);
    expect(await screen.findByText(/Mba'éichapa, Rosa/)).toBeInTheDocument();
    esperarAceptadaAntesDeLaSesion(f.pedidos);
  });

  it('sesión abierta con otro correo: avisa y ofrece cerrar sesión para seguir', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = apiDeInvitacion(invitacion());
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    expect(await screen.findByText('Tenés abierta otra cuenta')).toBeInTheDocument();
    expect(screen.getByText(/Ingresaste como lorena@ejemplo.test/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión y seguir' }));
    // Sin sesión, la misma página dice qué hacer con el correo de la invitación.
    expect(
      await screen.findByText(/Te mandamos un correo a ro\*\*\*@ejemplo.test/),
    ).toBeInTheDocument();
    expect(auth.cerrarSesion).toHaveBeenCalledTimes(1);
    expect(f.pedidos.some(esAceptar)).toBe(false);
    expect(f.pedidos.some(esSesion)).toBe(false);
  });

  it('si la API rechaza la aceptación, muestra su mensaje y no entra', async () => {
    const auth = crearAuthFalso({ conSesion: true, usuario: ROSA });
    const f = crearFetchFalso({
      'POST /invitaciones/consultar': { cuerpo: invitacion({ siguientePaso: 'cuenta_existente' }) },
      'POST /invitaciones/aceptar': {
        estado: 403,
        cuerpo: {
          codigo: 'sin_permiso',
          mensaje: 'Confirmá tu correo antes de aceptar: abrí el enlace que te mandamos.',
        },
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: RUTA });
    fireEvent.click(await screen.findByRole('button', { name: 'Unirme a Clínica Sonrisa Norte' }));
    expect(
      await screen.findByText(
        'Confirmá tu correo antes de aceptar: abrí el enlace que te mandamos.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(f.pedidos.some(esSesion)).toBe(false));
  });
});
