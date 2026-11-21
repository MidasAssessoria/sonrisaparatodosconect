/**
 * Tipo de acceso `archivo`: negar por defecto aunque el permiso lo decida el handler. Un handler
 * que no exige el permiso no puede responder, y `@Ctx()` no existe en esas rutas.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Permiso, PermisoDeArchivo } from '../src/contexto/acceso.js';
import { AccesoArchivo, type AccesoPorCategoria } from '../src/contexto/acceso-archivo.js';
import { Ctx, type ContextoPedido } from '../src/contexto/contexto-pedido.js';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';

@Controller('prueba-archivo')
class RutasDePrueba {
  @Get('sin-exigir')
  @PermisoDeArchivo()
  sinExigir(@AccesoArchivo() acceso: AccesoPorCategoria): { secreto: string } {
    return { secreto: `no debería verse ${acceso.contextoBd.clinicaId}` };
  }

  @Get('con-ctx')
  @PermisoDeArchivo()
  conCtx(@Ctx() ctx: ContextoPedido): { secreto: string } {
    return { secreto: `no debería verse ${ctx.clinicaId}` };
  }

  @Get('exige')
  @PermisoDeArchivo()
  exige(@AccesoArchivo() acceso: AccesoPorCategoria): { clinica: string } {
    const ctx = acceso.exigir('logo_clinica', 'ver');
    return { clinica: ctx.clinicaId };
  }

  @Get('acceso-en-otra-ruta')
  @Permiso('sedes', 'ver')
  otra(@AccesoArchivo() acceso: AccesoPorCategoria): { secreto: string } {
    return { secreto: `no debería verse ${String(acceso.verificado)}` };
  }
}

@Module({ controllers: [RutasDePrueba] })
class ModuloDePrueba {}

let prueba: Prueba;
let A: Clinica;
let recepcion: Persona;

beforeAll(async () => {
  prueba = await crearPrueba({ modulosExtra: [ModuloDePrueba] });
  A = await crearClinica(prueba, { sedes: 1 });
  recepcion = await crearPersona(prueba, A.clinicaId, { rol: 'recepcion' });
});

afterAll(async () => {
  await prueba.cerrar();
});

describe('acceso archivo', () => {
  it('pide sesión y membresía como cualquier ruta', async () => {
    await esperarError(prueba.pedir('get', '/prueba-archivo/exige'), 401, 'no_autenticado');
  });

  it('un handler que no exige el permiso no puede responder (500, sin el cuerpo)', async () => {
    const r = await esperarError(
      prueba.pedir('get', '/prueba-archivo/sin-exigir', { token: await A.dueno.token() }),
      500,
      'error_interno',
    );
    expect(JSON.stringify(r.body)).not.toContain('secreto');
  });

  it('@Ctx() no existe en una ruta archivo, y @AccesoArchivo() no existe en las demás', async () => {
    for (const ruta of ['/prueba-archivo/con-ctx', '/prueba-archivo/acceso-en-otra-ruta']) {
      const r = await esperarError(
        prueba.pedir('get', ruta, { token: await A.dueno.token() }),
        500,
        'error_interno',
      );
      expect(JSON.stringify(r.body)).not.toContain('secreto');
    }
  });

  it('exigir() decide: con el permiso responde, sin él 403', async () => {
    const r = await prueba.pedir('get', '/prueba-archivo/exige', { token: await A.dueno.token() });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ clinica: A.clinicaId });
    await esperarError(
      prueba.pedir('get', '/prueba-archivo/exige', { token: await recepcion.token() }),
      403,
      'sin_permiso',
    );
  });
});
