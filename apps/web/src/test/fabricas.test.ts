import { RUTAS_API } from '@conecta/shared';
import { describe, expect, it } from 'vitest';
import { crearFetchFalso, IDS, IDS_PERSONAL, sesionDe } from './fabricas.js';
import { ENTRADA_POR_RUTA, rutaDelContrato } from './pedidosContrato.js';
import { tomarPedidosInvalidos } from './rutasNoSimuladas.js';

const pedir = (f: typeof fetch, metodo: string, ruta: string, cuerpo?: unknown, cabeceras = {}) =>
  f(`/api/v1${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...cabeceras },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });

describe('fetch falso: valida los pedidos contra el contrato', () => {
  it('cubre todas las rutas del contrato, ni una más', () => {
    const delContrato = RUTAS_API.map((r) => r.split(' ').slice(0, 2).join(' ')).sort();
    expect(Object.keys(ENTRADA_POR_RUTA).sort()).toEqual(delContrato);
  });

  it('lo literal gana a lo parametrizado al buscar la ruta', () => {
    expect(rutaDelContrato('POST /invitaciones/consultar')).toBe('POST /invitaciones/consultar');
    expect(rutaDelContrato(`POST /invitaciones/${IDS.usuario}/reenviar`)).toBe(
      'POST /invitaciones/:id/reenviar',
    );
    expect(rutaDelContrato(`GET /sedes/${IDS.sedeCentro}/agenda`)).toBe('GET /sedes/:id/agenda');
    expect(rutaDelContrato('GET /no-existe')).toBeNull();
  });

  it('un cuerpo que no cumple el esquema responde 400 y queda registrado (la prueba falla)', async () => {
    const f = crearFetchFalso({ 'POST /invitaciones': { estado: 201, cuerpo: {} } });
    const r = await pedir(f.fetch, 'POST', '/invitaciones', { nombre: 'G', email: 'no-es-correo' });
    expect(r.status).toBe(400);
    const invalidos = tomarPedidosInvalidos();
    expect(invalidos.join(' ')).toMatch(/POST \/invitaciones: .*nombre/);
    expect(invalidos.join(' ')).toMatch(/email/);
  });

  it('un campo que el contrato no tiene también falla (p. ej. la clave al aceptar)', async () => {
    const f = crearFetchFalso({ 'POST /invitaciones/aceptar': { cuerpo: {} } });
    await pedir(
      f.fetch,
      'POST',
      '/invitaciones/aceptar',
      { token: 't'.repeat(30), clave: 'unaClaveLarga1' },
      { Authorization: 'Bearer x' },
    );
    expect(tomarPedidosInvalidos()).toEqual([
      'POST /invitaciones/aceptar: campos que el contrato no tiene: clave',
    ]);
  });

  it('aceptar sin Authorization falla', async () => {
    const f = crearFetchFalso({ 'POST /invitaciones/aceptar': { cuerpo: {} } });
    await pedir(f.fetch, 'POST', '/invitaciones/aceptar', { token: 't'.repeat(30) });
    expect(tomarPedidosInvalidos()).toEqual(['POST /invitaciones/aceptar exige Authorization']);
  });

  it('sedes que quien pide no ve (según la sesión que respondió) fallan como en la API', async () => {
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'PATCH /personal/:id': { cuerpo: {} },
    });
    await pedir(f.fetch, 'GET', '/sesion');
    await pedir(f.fetch, 'PATCH', `/personal/${IDS_PERSONAL.ana}`, {
      sedeIds: [IDS_PERSONAL.sedeOculta, IDS.sedeCentro],
    });
    const invalidos = tomarPedidosInvalidos();
    expect(invalidos).toHaveLength(1);
    expect(invalidos[0]).toContain(IDS_PERSONAL.sedeOculta);
    // Con solo las visibles, pasa.
    await pedir(f.fetch, 'PATCH', `/personal/${IDS_PERSONAL.ana}`, { sedeIds: [IDS.sedeCentro] });
    expect(tomarPedidosInvalidos()).toEqual([]);
  });

  it('una ruta sin cuerpo no acepta cuerpo', async () => {
    const f = crearFetchFalso({ 'POST /personal/:id/reactivar': { cuerpo: {} } });
    await pedir(f.fetch, 'POST', `/personal/${IDS_PERSONAL.ana}/reactivar`, { motivo: 'x' });
    expect(tomarPedidosInvalidos()).toEqual(['POST /personal/:id/reactivar no lleva cuerpo']);
  });

  it('archivos: multipart, categoria antes que archivo y sin Content-Type a mano', async () => {
    const f = crearFetchFalso({ 'POST /archivos': { estado: 201, cuerpo: {} } });
    const alReves = new FormData();
    alReves.append('archivo', new Blob(['x']), 'a.png');
    alReves.append('categoria', 'firma_profesional');
    await f.fetch('/api/v1/archivos', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: alReves,
    });
    const invalidos = tomarPedidosInvalidos();
    expect(invalidos.some((i) => i.includes('Content-Type'))).toBe(true);
    expect(invalidos.some((i) => i.includes('orden categoria, archivo'))).toBe(true);
  });
});

describe('fetch falso: parámetros de consulta', () => {
  it('valida los parámetros de GET /pacientes y GET /buscar contra el contrato', async () => {
    const f = crearFetchFalso({
      'GET /pacientes': { cuerpo: { items: [], siguienteCursor: null } },
      'GET /buscar': { cuerpo: { pacientes: [] } },
    });
    await f.fetch('/api/v1/pacientes?filtro=con_saldo&orden=nombre');
    const invalidos = tomarPedidosInvalidos();
    expect(invalidos.some((i) => i.includes('filtro'))).toBe(true);
    expect(invalidos.some((i) => i.includes('parámetros que el contrato no tiene: orden'))).toBe(
      true,
    );
    await f.fetch('/api/v1/pacientes?q=gonzalez&filtro=pediatricos&cursor=abc');
    await f.fetch('/api/v1/buscar?q=an');
    expect(tomarPedidosInvalidos()).toEqual([]);
  });
});
