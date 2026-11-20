/**
 * Reglas de estructura que protegen el límite de confianza, verificadas sobre el código fuente:
 * el pool solo vive en ServicioBd, el paso «sin clínica» solo lo usa el resolvedor del contexto y
 * nadie arma SQL con texto crudo.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function archivos(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = path.join(directorio, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith('.ts') ? [ruta] : [];
  });
}

const fuentes = archivos(RAIZ).map((ruta) => ({
  ruta: path.relative(RAIZ, ruta).replaceAll('\\', '/'),
  texto: readFileSync(ruta, 'utf8'),
}));

function usos(patron: RegExp, permitidos: string[] = []): string[] {
  return fuentes
    .filter((f) => patron.test(f.texto) && !permitidos.includes(f.ruta))
    .map((f) => f.ruta);
}

describe('estructura del código', () => {
  it('encuentra el código fuente', () => {
    expect(fuentes.length).toBeGreaterThan(10);
  });

  it('el pool y las transacciones con contexto solo se crean en ServicioBd', () => {
    expect(
      usos(/\bcrearPool\(|new pg\.Pool|\bconContexto\(|\bconUsuario\(|\bconContextoCliente\(/, [
        'base/servicio-bd.ts',
      ]),
    ).toEqual([]);
    expect(usos(/\.query\(|\.connect\(/)).toEqual([]);
  });

  it('el paso sin clínica (comoUsuario) solo lo usa el resolvedor del contexto', () => {
    expect(usos(/\.comoUsuario\(/, ['contexto/resolvedor-contexto.ts'])).toEqual([]);
  });

  it('nadie fija el contexto a mano ni usa SQL crudo', () => {
    expect(usos(/set_config|sql\.raw\(|\.execute\(\s*['"`]/)).toEqual([]);
  });
});
