import { CODIGOS_ERROR, type CodigoError } from '@conecta/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearFetchFalso, IDS, sedeDe, sesionDe } from '../test/fabricas.js';
import { crearClienteConsultas } from '../App.js';
import { baseApi, crearClienteApi, reintentarDesde } from './cliente.js';
import {
  ErrorConecta,
  esReintentable,
  mensajeDeError,
  reaccionPorCodigo,
  TEXTO_DEMASIADOS_PEDIDOS,
  TEXTO_SIN_ACCESO,
} from './errores.js';

function cliente(
  fetchImpl: typeof fetch,
  extra: { clinica?: string | null; token?: string | null } = {},
) {
  const alError = vi.fn();
  const api = crearClienteApi({
    fetch: fetchImpl,
    obtenerToken: () => Promise.resolve(extra.token === undefined ? 'tok' : extra.token),
    obtenerClinicaId: () => (extra.clinica === undefined ? IDS.clinicaA : extra.clinica),
    alError,
  });
  return { api, alError };
}

describe('cliente de API', () => {
  it('manda Authorization y X-Clinica-Id, y valida la respuesta', async () => {
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    const { api } = cliente(f.fetch);
    const s = await api.sesion.obtener();
    expect(s.clinica.id).toBe(IDS.clinicaA);
    const p = f.pedidos[0];
    expect(p?.url.pathname).toBe('/api/v1/sesion');
    expect(p?.cabeceras.get('authorization')).toBe('Bearer tok');
    expect(p?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaA);
  });

  it('omite las cabeceras cuando no hay token ni clínica', async () => {
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    const { api } = cliente(f.fetch, { token: null, clinica: null });
    await api.sesion.obtener();
    expect(f.pedidos[0]?.cabeceras.has('authorization')).toBe(false);
    expect(f.pedidos[0]?.cabeceras.has('x-clinica-id')).toBe(false);
  });

  it('permite pedir la sesión con una clínica explícita o sin cabecera', async () => {
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    const { api } = cliente(f.fetch);
    await api.sesion.obtener(IDS.clinicaB);
    await api.sesion.obtener(null);
    expect(f.pedidos[0]?.cabeceras.get('x-clinica-id')).toBe(IDS.clinicaB);
    expect(f.pedidos[1]?.cabeceras.has('x-clinica-id')).toBe(false);
  });

  it('manda el cuerpo como JSON', async () => {
    const f = crearFetchFalso({ 'POST /sedes': { estado: 201, cuerpo: sedeDe() } });
    const { api } = cliente(f.fetch);
    await api.sedes.crear({ nombre: 'Centro', estado: 'abierta' });
    expect(f.pedidos[0]?.metodo).toBe('POST');
    expect(f.pedidos[0]?.cabeceras.get('content-type')).toBe('application/json');
    expect(f.pedidos[0]?.cuerpo).toEqual({ nombre: 'Centro', estado: 'abierta' });
  });

  it('acepta 204 en la baja y manda el motivo', async () => {
    const f = crearFetchFalso({ 'DELETE /sedes/:id': { estado: 204 } });
    const { api } = cliente(f.fetch);
    await expect(
      api.sedes.darDeBaja(IDS.sedeCentro, { motivo: 'Se mudó' }),
    ).resolves.toBeUndefined();
    expect(f.pedidos[0]?.cuerpo).toEqual({ motivo: 'Se mudó' });
  });

  it('arma la consulta de auditoría sin parámetros vacíos', async () => {
    const f = crearFetchFalso({
      'GET /auditoria': { cuerpo: { items: [], siguienteCursor: null } },
    });
    const { api } = cliente(f.fetch);
    await api.auditoria.listar({ accion: 'editar', limite: 50, cursor: 'abc' });
    const qs = f.pedidos[0]?.url.searchParams;
    expect(qs?.get('accion')).toBe('editar');
    expect(qs?.get('cursor')).toBe('abc');
    expect(qs?.has('entidad')).toBe(false);
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: { usuario: 'no' } } });
    const { api, alError } = cliente(f.fetch);
    const error = await api.sesion.obtener().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorConecta);
    expect((error as ErrorConecta).codigo).toBe('respuesta_invalida');
    expect(alError).toHaveBeenCalledWith(error);
  });

  it.each(CODIGOS_ERROR.map((c) => [c]))(
    'convierte el error «%s» en ErrorConecta',
    async (codigo) => {
      const f = crearFetchFalso({
        'GET /sedes': { estado: 400, cuerpo: { codigo, mensaje: `Mensaje de ${codigo}` } },
      });
      const { api, alError } = cliente(f.fetch);
      const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
      expect(error.codigo).toBe(codigo);
      expect(error.estado).toBe(400);
      expect(alError).toHaveBeenCalledOnce();
    },
  );

  it('guarda los detalles por campo', async () => {
    const f = crearFetchFalso({
      'POST /sedes': {
        estado: 400,
        cuerpo: {
          codigo: 'datos_invalidos',
          mensaje: 'Revisá los datos.',
          detalles: [{ campo: 'nombre', mensaje: 'Poné el nombre de la sede.' }],
        },
      },
    });
    const { api } = cliente(f.fetch);
    const error = (await api.sedes
      .crear({ nombre: 'x', estado: 'abierta' })
      .catch((e: unknown) => e)) as ErrorConecta;
    expect(error.detalles).toEqual([{ campo: 'nombre', mensaje: 'Poné el nombre de la sede.' }]);
  });

  it('un 502 sin JSON se vuelve error_interno con mensaje que dice qué hacer', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('Bad gateway', { status: 502 })));
    const { api } = cliente(fetchImpl);
    const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
    expect(error.codigo).toBe('error_interno');
    expect(error.message).toMatch(/Probá de nuevo/);
  });

  it('un 401 sin cuerpo se vuelve no_autenticado', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 401 })));
    const { api } = cliente(fetchImpl);
    const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
    expect(error.codigo).toBe('no_autenticado');
  });

  it('sin red: sin_conexion', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const { api } = cliente(fetchImpl);
    const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
    expect(error.codigo).toBe('sin_conexion');
    expect(error.message).toMatch(/Revisá tu conexión/);
  });
});

describe('reacción por código', () => {
  const esperado: Record<CodigoError, string> = {
    no_autenticado: 'cerrar_sesion',
    mfa_requerido: 'segundo_factor',
    clinica_requerida: 'elegir_clinica',
    sin_permiso: 'sin_acceso',
    sede_no_permitida: 'sin_acceso',
    sin_membresia: 'sin_membresia',
    demasiados_pedidos: 'mensaje',
    servicio_no_disponible: 'mensaje',
    no_encontrado: 'mensaje',
    datos_invalidos: 'mensaje',
    conflicto: 'mensaje',
    error_interno: 'mensaje',
  };
  it.each(Object.entries(esperado))('%s → %s', (codigo, tipo) => {
    expect(reaccionPorCodigo(codigo as CodigoError).tipo).toBe(tipo);
  });

  it('sin permiso muestra «Tu rol no tiene acceso a esto»; el resto, el mensaje de la API', () => {
    expect(mensajeDeError(new ErrorConecta('sin_permiso', 'Forbidden'))).toBe(TEXTO_SIN_ACCESO);
    expect(mensajeDeError(new ErrorConecta('sede_no_permitida', 'x'))).toBe(TEXTO_SIN_ACCESO);
    expect(mensajeDeError(new ErrorConecta('conflicto', 'Ese nombre ya existe. Elegí otro.'))).toBe(
      'Ese nombre ya existe. Elegí otro.',
    );
    expect(mensajeDeError(new Error('raro'))).toMatch(/Probá de nuevo/);
  });
});

describe('origen de la API (VITE_API_URL)', () => {
  it('sin origen usa el mismo origen; con origen, la URL absoluta sin barra final', () => {
    expect(baseApi(undefined)).toBe('/api/v1');
    expect(baseApi('')).toBe('/api/v1');
    expect(baseApi('https://api.conecta.test/')).toBe('https://api.conecta.test/api/v1');
  });

  it('los pedidos van al origen configurado, no a una ruta relativa', async () => {
    const f = crearFetchFalso({ 'GET /sesion': { cuerpo: sesionDe() } });
    const api = crearClienteApi({
      fetch: f.fetch,
      base: baseApi('https://api.conecta.test'),
      obtenerToken: () => Promise.resolve('tok'),
      obtenerClinicaId: () => null,
    });
    await api.sesion.obtener();
    expect(f.pedidos[0]?.url.href).toBe('https://api.conecta.test/api/v1/sesion');
  });
});

describe('429 y 503', () => {
  it('429 con Retry-After: demasiados_pedidos, mensaje fijo y momento para reintentar', async () => {
    const f = crearFetchFalso({
      'GET /sedes': {
        estado: 429,
        cabeceras: { 'Retry-After': '30' },
        cuerpo: { codigo: 'demasiados_pedidos', mensaje: 'Too many' },
      },
    });
    const { api } = cliente(f.fetch);
    const antes = Date.now();
    const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
    expect(error.codigo).toBe('demasiados_pedidos');
    expect(mensajeDeError(error)).toBe(TEXTO_DEMASIADOS_PEDIDOS);
    expect(error.reintentarDesde).toBeGreaterThanOrEqual(antes + 30_000);
  });

  it('un 429 sin cuerpo JSON no se vuelve error_interno (que sí se reintenta)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('lento', { status: 429 })));
    const { api } = cliente(fetchImpl);
    const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
    expect(error.codigo).toBe('demasiados_pedidos');
    expect(esReintentable(error)).toBe(false);
    // Aunque la API mandara error_interno con 429, tampoco se reintenta.
    expect(esReintentable(new ErrorConecta('error_interno', 'x', { estado: 429 }))).toBe(false);
  });

  it('un 503 sin cuerpo es servicio_no_disponible y no se reintenta solo', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 503 })));
    const { api } = cliente(fetchImpl);
    const error = (await api.sedes.listar().catch((e: unknown) => e)) as ErrorConecta;
    expect(error.codigo).toBe('servicio_no_disponible');
    expect(reaccionPorCodigo(error.codigo).tipo).toBe('mensaje');
    expect(esReintentable(error)).toBe(false);
  });

  it('las consultas solo se reintentan solas ante la red o un 5xx genérico', () => {
    const reintentar = crearClienteConsultas().getDefaultOptions().queries?.retry as (
      intentos: number,
      error: unknown,
    ) => boolean;
    expect(reintentar(0, new ErrorConecta('sin_conexion', 'x'))).toBe(true);
    expect(reintentar(0, new ErrorConecta('error_interno', 'x', { estado: 500 }))).toBe(true);
    expect(reintentar(2, new ErrorConecta('error_interno', 'x', { estado: 500 }))).toBe(false);
    expect(reintentar(0, new ErrorConecta('demasiados_pedidos', 'x', { estado: 429 }))).toBe(false);
    expect(reintentar(0, new ErrorConecta('servicio_no_disponible', 'x', { estado: 503 }))).toBe(
      false,
    );
  });

  it('Retry-After acepta segundos o fecha HTTP', () => {
    const ahora = Date.UTC(2026, 10, 20, 12, 0, 0);
    expect(reintentarDesde('5', ahora)).toBe(ahora + 5000);
    expect(reintentarDesde('Fri, 20 Nov 2026 12:01:00 GMT', ahora)).toBe(ahora + 60_000);
    expect(reintentarDesde(null, ahora)).toBeNull();
    expect(reintentarDesde('mañana', ahora)).toBeNull();
  });
});
