import { describe, expect, it } from 'vitest';
import { ACCIONES, MODULOS } from './index.js';
import { respuestaSaludSchema } from './salud.js';

describe('constantes de permisos', () => {
  it('define las cinco acciones', () => {
    expect(ACCIONES).toEqual(['ver', 'crear', 'editar', 'anular', 'exportar']);
  });

  it('define catorce módulos sin repetidos', () => {
    expect(MODULOS).toHaveLength(14);
    expect(new Set(MODULOS).size).toBe(MODULOS.length);
  });

  it('valida la respuesta de salud', () => {
    expect(respuestaSaludSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(respuestaSaludSchema.safeParse({ ok: false }).success).toBe(false);
  });
});
