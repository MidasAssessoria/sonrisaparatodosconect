import { randomUUID } from 'node:crypto';
import {
  ErrorDeContexto,
  ErrorDeMembresia,
  RESTRICCIONES_ACCESO,
  conContextoCliente,
} from '@conecta/db';
import { errorApiSchema } from '@conecta/shared';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { traducirError } from '../src/errores/traducir.js';
import { comoSistema, crearClinica, crearPersona, crearPrueba, type Prueba } from './ayudas.js';

/** Error con la forma de un DatabaseError de `pg`. */
function errorPg(code: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`mensaje de Postgres con datos: Key (nombre)=(Secreto)`), {
    code,
    severity: 'ERROR',
    ...extra,
  });
}

/** Como lo envuelve Drizzle: el mensaje lleva la consulta y sus parámetros. */
function envuelto(causa: Error): Error {
  return new DrizzleQueryError('insert into "app"."sede" values ($1)', ['Dato privado'], causa);
}

const SIN_DETALLES_INTERNOS =
  /select |insert |update |constraint|violates|app\.|pg_|proteger_acceso|42501|23514|Secreto|Dato privado/i;

describe('traducción de errores', () => {
  it('único con mensaje propio → conflicto con mensaje útil según la restricción', () => {
    const t = traducirError(envuelto(errorPg('23505', { constraint: 'sede_nombre_unico' })));
    expect(t.estado).toBe(409);
    expect(t.cuerpo).toEqual({
      codigo: 'conflicto',
      mensaje: 'Ya hay una sede con ese nombre. Elegí otro nombre.',
    });
  });

  it('único y FK sin mensaje propio responden exactamente lo mismo', () => {
    const unico = traducirError(envuelto(errorPg('23505', { constraint: 'usuario_sede_unico' })));
    const fk = traducirError(
      envuelto(errorPg('23503', { constraint: 'usuario_sede_membresia_fk' })),
    );
    expect(unico).toEqual(fk);
    expect(unico.estado).toBe(409);
    expect(unico.cuerpo.codigo).toBe('conflicto');
  });

  it('fila bloqueada por RLS → no_encontrado', () => {
    const rls = errorPg('42501');
    rls.message = 'new row violates row-level security policy for table "sede"';
    expect(traducirError(envuelto(rls))).toMatchObject({
      estado: 404,
      cuerpo: { codigo: 'no_encontrado' },
    });
  });

  it('cada regla de acceso de la base tiene una respuesta del contrato, en voseo y sin detalles internos', () => {
    const esperado: Record<string, [number, string]> = {
      acceso_sin_actor: [403, 'sin_permiso'],
      acceso_sin_membresia: [403, 'sin_membresia'],
      acceso_sin_permiso: [403, 'sin_permiso'],
      acceso_propio: [403, 'sin_permiso'],
      acceso_rol_dueno: [403, 'sin_permiso'],
      membresia_nace_pendiente: [409, 'conflicto'],
      rol_sistema: [409, 'conflicto'],
      membresia_ultimo_dueno: [409, 'conflicto'],
      rol_dueno_activo: [409, 'conflicto'],
      sesion_ajena: [401, 'no_autenticado'],
      auditoria_sin_clinica: [409, 'conflicto'],
    };
    expect(Object.keys(esperado).sort()).toEqual([...RESTRICCIONES_ACCESO].sort());
    for (const restriccion of RESTRICCIONES_ACCESO) {
      const codigo = ['membresia_ultimo_dueno', 'rol_dueno_activo'].includes(restriccion)
        ? '23514'
        : '42501';
      const t = traducirError(envuelto(errorPg(codigo, { constraint: restriccion })));
      const [estado, codigoApi] = esperado[restriccion]!;
      expect({ restriccion, estado: t.estado, codigo: t.cuerpo.codigo }).toEqual({
        restriccion,
        estado,
        codigo: codigoApi,
      });
      expect(t.cuerpo.mensaje).not.toMatch(SIN_DETALLES_INTERNOS);
      expect(t.registrar).toBeUndefined();
    }
    expect(
      traducirError(errorPg('23514', { constraint: 'membresia_ultimo_dueno' })).cuerpo.mensaje,
    ).toMatch(/Dale el rol Dueño\/a a otra persona/);
    expect(traducirError(errorPg('42501', { constraint: 'acceso_propio' })).cuerpo.mensaje).toMatch(
      /No podés cambiar tu propio acceso/,
    );
  });

  it('un nombre de restricción que no es nuestro no se toma de Object.prototype', () => {
    const t = traducirError(errorPg('23505', { constraint: 'constructor' }));
    expect(t).toMatchObject({ estado: 409, cuerpo: { codigo: 'conflicto' } });
  });

  it('membresía que cambió dentro de la transacción → sin_membresia', () => {
    for (const motivo of ['sin_membresia', 'membresia_inactiva', 'clinica_inactiva'] as const) {
      expect(traducirError(new ErrorDeMembresia(motivo))).toMatchObject({
        estado: 403,
        cuerpo: { codigo: 'sin_membresia' },
      });
    }
  });

  it('checks y formatos → datos_invalidos; serialización → conflicto', () => {
    expect(traducirError(errorPg('23514')).cuerpo.codigo).toBe('datos_invalidos');
    expect(traducirError(errorPg('22P02')).cuerpo.codigo).toBe('datos_invalidos');
    expect(traducirError(errorPg('40001')).cuerpo.codigo).toBe('conflicto');
    expect(traducirError(new ErrorDeContexto('x')).cuerpo.codigo).toBe('datos_invalidos');
  });

  it('base caída, sin conexiones o cortando → 503 servicio_no_disponible', () => {
    const casos: unknown[] = [
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
      new Error('timeout exceeded when trying to connect'),
      new Error('Connection terminated unexpectedly'),
      errorPg('57P01'),
      errorPg('53300'),
      errorPg('08006'),
      envuelto(errorPg('57014')),
    ];
    for (const error of casos) {
      const t = traducirError(error);
      expect(t.estado).toBe(503);
      expect(errorApiSchema.parse(t.cuerpo).codigo).toBe('servicio_no_disponible');
      expect(JSON.stringify(t.cuerpo)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|Secreto/);
    }
  });

  it('lo inesperado → error_interno, sin SQL, parámetros ni mensaje en la respuesta ni en el registro', () => {
    for (const error of [
      envuelto(errorPg('XX000')),
      envuelto(new Error('fallo raro con Dato privado')),
      new TypeError('Dato privado'),
      'una cadena',
    ]) {
      const t = traducirError(error);
      expect(t.estado).toBe(500);
      expect(errorApiSchema.parse(t.cuerpo).codigo).toBe('error_interno');
      const todo = JSON.stringify(t);
      expect(todo).not.toContain('Dato privado');
      expect(todo).not.toContain('Secreto');
      expect(todo).not.toContain('insert into');
      expect(t.registrar).toBeDefined();
    }
  });
});

/**
 * Con errores reales de la base: un id de otra clínica no deja distinguir «ya existe» de «no
 * existe». Se usa `usuario_sede`: en la clínica B hay una asignación (membresía mB, sede sB); desde
 * A, con un actor con permiso, se intenta asignar exactamente eso (ids de B que existen y que en B
 * ya están asignados) y también ids que no existen en ningún lado. La respuesta es la misma.
 */
describe('restricciones con ids de otra clínica (errores reales de la base)', () => {
  let prueba: Prueba;
  let api: pg.Pool;

  beforeAll(async () => {
    prueba = await crearPrueba();
    api = new pg.Pool({ connectionString: inject('conectaDb').urlApi, max: 2 });
    api.on('error', () => undefined);
  });

  afterAll(async () => {
    await api.end();
    await prueba.cerrar();
  });

  async function errorAlAsignar(
    clinicaId: string,
    actorId: string,
    membresiaId: string,
    sedeId: string,
  ): Promise<unknown> {
    try {
      await conContextoCliente(api, { clinicaId, usuarioId: actorId }, (c) =>
        c.query(
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [clinicaId, membresiaId, sedeId],
        ),
      );
    } catch (error) {
      return error;
    }
    throw new Error('La base aceptó la asignación.');
  }

  it('único y FK contra ids de otra clínica dan la misma respuesta', async () => {
    const a = await crearClinica(prueba, { sedes: 1 });
    const b = await crearClinica(prueba, { sedes: 1 });
    const [sB] = b.sedes;
    const enB = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion', sedes: [sB!.sedeId] });
    const enA = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [a.sedes[0]!.sedeId],
    });

    // Ids de B que existen (y ya están asignados en B).
    const existentes = await errorAlAsignar(a.clinicaId, a.duenoId, enB.membresiaId, sB!.sedeId);
    // Ids que no existen en ninguna clínica.
    const inexistentes = await errorAlAsignar(a.clinicaId, a.duenoId, randomUUID(), randomUUID());
    // Membresía de A con una sede de B.
    const mezcla = await errorAlAsignar(a.clinicaId, a.duenoId, enA.membresiaId, sB!.sedeId);
    // Duplicado real dentro de A (único).
    const duplicado = await errorAlAsignar(
      a.clinicaId,
      a.duenoId,
      enA.membresiaId,
      a.sedes[0]!.sedeId,
    );

    const respuestas = [existentes, inexistentes, mezcla, duplicado].map((e) => traducirError(e));
    for (const r of respuestas) {
      expect(r).toEqual(respuestas[0]);
      expect(r.estado).toBe(409);
      expect(JSON.stringify(r.cuerpo)).not.toMatch(SIN_DETALLES_INTERNOS);
    }
    // Y B no cambió.
    const { rows } = await comoSistema<{ n: string }>(
      prueba.admin,
      b.clinicaId,
      'select count(*) as n from app.usuario_sede where membresia_id = $1',
      [enB.membresiaId],
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('una regla de acceso real llega con su respuesta (acceso_propio)', async () => {
    const a = await crearClinica(prueba, { sedes: 1 });
    const error = await errorAlAsignar(
      a.clinicaId,
      a.duenoId,
      a.membresiaDuenoId,
      a.sedes[0]!.sedeId,
    );
    expect(traducirError(error)).toMatchObject({ estado: 403, cuerpo: { codigo: 'sin_permiso' } });
    expect(traducirError(error).cuerpo.mensaje).toMatch(/tu propio acceso/);
  });
});
