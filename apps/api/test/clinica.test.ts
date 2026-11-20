import { sedeSchema, sesionSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';

describe('resolución de la clínica del pedido', () => {
  let prueba: Prueba;
  let a: Clinica;
  let b: Clinica;
  let c: Clinica;
  /** Administración en A (más antigua) y en B. */
  let doble: Persona;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { nombre: 'Clínica A' });
    b = await crearClinica(prueba, { nombre: 'Clínica B' });
    c = await crearClinica(prueba, { nombre: 'Clínica C' });
    doble = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await crearPersona(prueba, b.clinicaId, { rol: 'administracion', usuarioId: doble.usuarioId });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('una sola membresía y sin cabecera: usa esa clínica en todo', async () => {
    const token = await a.dueno.token();
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token }).expect(200)).body,
    );
    expect(sesion.clinica.id).toBe(a.clinicaId);
    const sedes = segun(
      z.array(sedeSchema),
      (await prueba.pedir('get', '/sedes', { token }).expect(200)).body,
    );
    expect(sedes.map((s) => s.id).sort()).toEqual(a.sedes.map((s) => s.sedeId).sort());
  });

  it('varias membresías sin cabecera: /sesion responde con la más antigua y la lista completa', async () => {
    const token = await doble.token();
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token }).expect(200)).body,
    );
    expect(sesion.clinica.id).toBe(a.clinicaId);
    expect(sesion.clinicas).toEqual([
      { id: a.clinicaId, nombre: 'Clínica A' },
      { id: b.clinicaId, nombre: 'Clínica B' },
    ]);
  });

  it('varias membresías sin cabecera: el resto responde clinica_requerida', async () => {
    const token = await doble.token();
    await esperarError(prueba.pedir('get', '/sedes', { token }), 400, 'clinica_requerida');
    await esperarError(prueba.pedir('get', '/auditoria', { token }), 400, 'clinica_requerida');
    await esperarError(
      prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'Nueva' } }),
      400,
      'clinica_requerida',
    );
  });

  it('varias membresías con cabecera: trabaja en la elegida', async () => {
    const token = await doble.token();
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token, clinica: b.clinicaId }).expect(200)).body,
    );
    expect(sesion.clinica.id).toBe(b.clinicaId);
    const sedes = segun(
      z.array(sedeSchema),
      (await prueba.pedir('get', '/sedes', { token, clinica: b.clinicaId }).expect(200)).body,
    );
    expect(sedes.map((s) => s.id).sort()).toEqual(b.sedes.map((s) => s.sedeId).sort());
  });

  it('la cabecera en mayúsculas se normaliza', async () => {
    const token = await doble.token();
    const sesion = segun(
      sesionSchema,
      (
        await prueba
          .pedir('get', '/sesion', { token, clinica: b.clinicaId.toUpperCase() })
          .expect(200)
      ).body,
    );
    expect(sesion.clinica.id).toBe(b.clinicaId);
  });

  it('cabecera de una clínica ajena → sin_membresia (también en /sesion)', async () => {
    const token = await doble.token();
    await esperarError(
      prueba.pedir('get', '/sesion', { token, clinica: c.clinicaId }),
      403,
      'sin_membresia',
    );
    await esperarError(
      prueba.pedir('get', '/sedes', { token, clinica: c.clinicaId }),
      403,
      'sin_membresia',
    );
  });

  it('cabecera de una clínica que no existe → sin_membresia', async () => {
    const token = await a.dueno.token();
    await esperarError(
      prueba.pedir('get', '/sedes', { token, clinica: '00000000-0000-4000-8000-000000000000' }),
      403,
      'sin_membresia',
    );
  });

  it('cabecera que no es UUID → datos_invalidos', async () => {
    const token = await a.dueno.token();
    for (const valor of [
      'abc',
      "' or 1=1 --",
      `${a.clinicaId},${b.clinicaId}`,
      a.clinicaId + 'x',
    ]) {
      const respuesta = await esperarError(
        prueba.pedir('get', '/sesion', { token }).set('X-Clinica-Id', valor),
        400,
        'datos_invalidos',
      );
      expect((respuesta.body as { detalles: { campo: string }[] }).detalles[0]?.campo).toBe(
        'X-Clinica-Id',
      );
    }
  });

  it('membresía pendiente o inactiva → sin_membresia', async () => {
    const pendiente = await crearPersona(prueba, a.clinicaId, { estado: 'pendiente' });
    const inactiva = await crearPersona(prueba, a.clinicaId, { estado: 'inactivo' });
    for (const persona of [pendiente, inactiva]) {
      const token = await persona.token();
      await esperarError(prueba.pedir('get', '/sesion', { token }), 403, 'sin_membresia');
      await esperarError(
        prueba.pedir('get', '/sesion', { token, clinica: a.clinicaId }),
        403,
        'sin_membresia',
      );
    }
  });

  it('membresía activa en una clínica e inactiva en otra: la inactiva no cuenta', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await crearPersona(prueba, b.clinicaId, {
      rol: 'administracion',
      usuarioId: persona.usuarioId,
      estado: 'inactivo',
    });
    const token = await persona.token();
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token }).expect(200)).body,
    );
    expect(sesion.clinicas).toEqual([{ id: a.clinicaId, nombre: 'Clínica A' }]);
    // Sin cabecera alcanza: tiene una sola membresía activa.
    await prueba.pedir('get', '/sedes', { token }).expect(200);
    await esperarError(
      prueba.pedir('get', '/sedes', { token, clinica: b.clinicaId }),
      403,
      'sin_membresia',
    );
  });

  it('desactivar la membresía corta el acceso en el siguiente pedido', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const token = await persona.token();
    await prueba.pedir('get', '/sedes', { token }).expect(200);
    await comoSistema(
      prueba.admin,
      a.clinicaId,
      "update app.membresia set estado = 'inactivo' where id = $1",
      [persona.membresiaId],
    );
    await esperarError(prueba.pedir('get', '/sedes', { token }), 403, 'sin_membresia');
  });

  it('clínica desactivada → sin_membresia', async () => {
    const d = await crearClinica(prueba, { sedes: 1 });
    const token = await d.dueno.token();
    await prueba.pedir('get', '/sesion', { token }).expect(200);
    await comoSistema(
      prueba.admin,
      d.clinicaId,
      'update app.clinica set activo = false where id = $1',
      [d.clinicaId],
    );
    await esperarError(prueba.pedir('get', '/sesion', { token }), 403, 'sin_membresia');
    await esperarError(
      prueba.pedir('get', '/sedes', { token, clinica: d.clinicaId }),
      403,
      'sin_membresia',
    );
  });
});
