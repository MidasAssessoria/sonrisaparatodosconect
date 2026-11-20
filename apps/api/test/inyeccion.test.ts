/**
 * Valores maliciosos en filtros, cursor, cabeceras, ids y cuerpos: no rompen nada, no cambian el
 * alcance de la consulta y los errores no dejan ver SQL ni trazas.
 */
import { paginaAuditoriaSchema, sedeSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  crearClinica,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

const SIN_FILTRACIONES =
  /select |insert |update |delete from|constraint|duplicate key|violates|\bat \w+ \(|node_modules|pg_|app\.\w+|stack/i;

describe('inyección y valores maliciosos', () => {
  let prueba: Prueba;
  let a: Clinica;
  let token: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    token = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  async function sedesSiguenAhi(): Promise<void> {
    const sedes = segun(
      z.array(sedeSchema),
      (await prueba.pedir('get', '/sedes', { token }).expect(200)).body,
    );
    expect(sedes.length).toBeGreaterThan(0);
  }

  it('filtros de auditoría con SQL se tratan como texto', async () => {
    for (const entidad of [
      "sede' OR '1'='1",
      "x'); drop table app.sede; --",
      'sede" or 1=1 --',
      '%',
      'sede\\',
      '$1',
    ]) {
      const pagina = segun(
        paginaAuditoriaSchema,
        (
          await prueba
            .pedir('get', `/auditoria?entidad=${encodeURIComponent(entidad)}`, { token })
            .expect(200)
        ).body,
      );
      expect(pagina.items).toEqual([]);
    }
    await sedesSiguenAhi();
  });

  it('fechas y accion con SQL → datos_invalidos sin filtrar nada', async () => {
    for (const consulta of [
      `?desde=${encodeURIComponent("2026-01-01T00:00:00Z' or 1=1 --")}`,
      `?accion=${encodeURIComponent("crear' or '1'='1")}`,
      `?entidadId=${encodeURIComponent("00000000-0000-4000-8000-000000000000' or 1=1 --")}`,
      `?limite=${encodeURIComponent('1; drop table app.audit_log')}`,
    ]) {
      const respuesta = await esperarError(
        prueba.pedir('get', `/auditoria${consulta}`, { token }),
        400,
        'datos_invalidos',
      );
      expect(JSON.stringify(respuesta.body)).not.toMatch(SIN_FILTRACIONES);
    }
  });

  it('cursores manipulados → datos_invalidos', async () => {
    const b64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url');
    const id = '00000000-0000-4000-8000-000000000000';
    for (const cursor of [
      "' OR 1=1 --",
      'no-es-base64!!',
      b64(["2026-01-01T00:00:00.000000Z' or 1=1 --", id]),
      b64(['2026-01-01T00:00:00.000000Z', "x' or '1'='1"]),
      b64({ fecha: '2026-01-01T00:00:00.000000Z', id }),
      b64(['2026-01-01T00:00:00.000000Z', id, 'extra']),
      b64('texto'),
      Buffer.from('{"a":').toString('base64url'),
      'A'.repeat(201),
    ]) {
      const respuesta = await esperarError(
        prueba.pedir('get', `/auditoria?cursor=${encodeURIComponent(cursor)}`, { token }),
        400,
        'datos_invalidos',
      );
      expect(JSON.stringify(respuesta.body)).not.toMatch(SIN_FILTRACIONES);
    }
    // Un cursor bien formado pero inventado solo mueve la posición dentro de la propia clínica.
    const futuro = b64(['2999-01-01T00:00:00.000000Z', 'ffffffff-ffff-4fff-bfff-ffffffffffff']);
    const pagina = segun(
      paginaAuditoriaSchema,
      (await prueba.pedir('get', `/auditoria?cursor=${futuro}&limite=5`, { token }).expect(200))
        .body,
    );
    expect(pagina.items).toHaveLength(5);
  });

  it('cabeceras maliciosas no rompen ni se reflejan', async () => {
    await esperarError(
      prueba.pedir('get', '/sedes', { token }).set('X-Clinica-Id', "'; drop table app.sede; --"),
      400,
      'datos_invalidos',
    );
    const respuesta = await prueba
      .pedir('get', '/sedes', { token })
      .set('X-Request-Id', '<script>alert(1)</script>')
      .set('X-Forwarded-For', "1.2.3.4' or 1=1 --")
      .expect(200);
    expect(respuesta.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const conId = await prueba
      .pedir('get', '/salud')
      .set('X-Request-Id', 'pedido-web-123')
      .expect(200);
    expect(conId.headers['x-request-id']).toBe('pedido-web-123');
    await sedesSiguenAhi();
  });

  it('ids de ruta con SQL → no_encontrado', async () => {
    for (const id of ["1' or '1'='1", '1;drop table app.sede', '..%2F..%2Fsalud', '%00']) {
      await esperarError(
        prueba.pedir('get', `/sedes/${encodeURIComponent(id)}`, { token }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('patch', `/sillones/${encodeURIComponent(id)}`, {
          token,
          cuerpo: { activo: false },
        }),
        404,
        'no_encontrado',
      );
    }
    await sedesSiguenAhi();
  });

  it('texto con SQL en el cuerpo se guarda literal', async () => {
    const nombre = "Robert'); DROP TABLE app.sede;--";
    const sede = segun(
      sedeSchema,
      (
        await prueba
          .pedir('post', '/sedes', { token, cuerpo: { nombre, direccion: '$1 $2 \\x00' } })
          .expect(201)
      ).body,
    );
    expect(sede.nombre).toBe(nombre);
    expect(sede.direccion).toBe('$1 $2 \\x00');
    await sedesSiguenAhi();
  });

  it('__proto__ y constructor en el cuerpo no contaminan nada', async () => {
    const respuesta = await prueba
      .pedir('post', '/sedes', { token })
      .set('Content-Type', 'application/json')
      .send(
        '{"nombre":"Prototipo","__proto__":{"esAdmin":true},"constructor":{"prototype":{"x":1}}}',
      )
      .expect(201);
    expect(segun(sedeSchema, respuesta.body).nombre).toBe('Prototipo');
    expect(({} as Record<string, unknown>)['esAdmin']).toBeUndefined();
  });

  it('un conflicto de la base no deja ver la restricción ni el SQL', async () => {
    await prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'Duplicada' } }).expect(201);
    const respuesta = await esperarError(
      prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'Duplicada' } }),
      409,
      'conflicto',
    );
    expect(JSON.stringify(respuesta.body)).not.toMatch(SIN_FILTRACIONES);
  });

  it('cuerpo demasiado grande → 413 datos_invalidos', async () => {
    const respuesta = await esperarError(
      prueba.pedir('post', '/sedes', {
        token,
        cuerpo: { nombre: 'Grande', direccion: 'x'.repeat(70_000) },
      }),
      413,
      'datos_invalidos',
    );
    expect(JSON.stringify(respuesta.body)).not.toMatch(SIN_FILTRACIONES);
  });
});
