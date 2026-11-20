import { ErrorDeContexto } from '@conecta/db';
import { errorApiSchema } from '@conecta/shared';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { traducirError } from '../src/errores/traducir.js';

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

describe('traducción de errores', () => {
  it('único → conflicto con mensaje útil según la restricción', () => {
    const t = traducirError(envuelto(errorPg('23505', { constraint: 'sede_nombre_unico' })));
    expect(t.estado).toBe(409);
    expect(t.cuerpo).toEqual({
      codigo: 'conflicto',
      mensaje: 'Ya hay una sede con ese nombre. Elegí otro nombre.',
    });
    const generico = traducirError(envuelto(errorPg('23505', { constraint: 'otra_cosa' })));
    expect(generico.cuerpo.codigo).toBe('conflicto');
  });

  it('fila bloqueada por RLS → no_encontrado', () => {
    const rls = errorPg('42501');
    rls.message = 'new row violates row-level security policy for table "sede"';
    expect(traducirError(envuelto(rls))).toMatchObject({
      estado: 404,
      cuerpo: { codigo: 'no_encontrado' },
    });
  });

  it('checks y formatos → datos_invalidos; serialización → conflicto', () => {
    expect(traducirError(errorPg('23514')).cuerpo.codigo).toBe('datos_invalidos');
    expect(traducirError(errorPg('22P02')).cuerpo.codigo).toBe('datos_invalidos');
    expect(traducirError(errorPg('40001')).cuerpo.codigo).toBe('conflicto');
    expect(traducirError(new ErrorDeContexto('x')).cuerpo.codigo).toBe('datos_invalidos');
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
