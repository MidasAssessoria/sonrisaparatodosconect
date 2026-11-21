/**
 * Tipo de acceso `archivo`: negar por defecto aunque el permiso lo decida el handler. Un handler
 * que no exige el permiso no puede responder, y `@Ctx()` no existe en esas rutas.
 */
import { Controller, Get, Module } from '@nestjs/common';
import { registrarEvento } from '@conecta/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicioBd } from '../src/base/servicio-bd.js';
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
  constructor(private readonly bd: ServicioBd) {}

  /** Intenta auditar con el contexto de antes de exigir: la transacción es de solo lectura. */
  @Get('escribe-antes')
  @PermisoDeArchivo()
  async escribeAntes(@AccesoArchivo() acceso: AccesoPorCategoria): Promise<{ codigo: string }> {
    const codigo = await this.bd
      .enLectura(acceso.contextoLectura, async (tx) => {
        await registrarEvento(tx, { accion: 'exportar', entidad: 'clinica' });
        return 'escribio';
      })
      .catch((error: unknown) => {
        const causa = (error as { cause?: { code?: string } }).cause;
        return (error as { code?: string }).code ?? causa?.code ?? 'otro';
      });
    acceso.exigir('logo_clinica', 'ver');
    return { codigo };
  }

  /** Leer sí puede, y solo ve su clínica. */
  @Get('lee-antes')
  @PermisoDeArchivo()
  async leeAntes(@AccesoArchivo() acceso: AccesoPorCategoria): Promise<{ sedes: string[] }> {
    const lectura = acceso.contextoLectura;
    const sedes = await this.bd.enLectura(lectura, async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`select id from app.sede`);
      return rows.map((f) => f.id);
    });
    acceso.exigir('logo_clinica', 'ver');
    return { sedes };
  }

  @Get('sin-exigir')
  @PermisoDeArchivo()
  sinExigir(@AccesoArchivo() acceso: AccesoPorCategoria): { secreto: string } {
    return { secreto: `no debería verse ${acceso.contextoLectura.clinicaId}` };
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

  it('antes de exigir() solo se lee: la transacción de contextoLectura no puede escribir', async () => {
    const r = await prueba.pedir('get', '/prueba-archivo/escribe-antes', {
      token: await A.dueno.token(),
    });
    expect(r.status).toBe(200);
    // 25006: read_only_sql_transaction.
    expect(r.body).toEqual({ codigo: '25006' });
    const l = await prueba.pedir('get', '/prueba-archivo/lee-antes', {
      token: await A.dueno.token(),
    });
    expect(l.status).toBe(200);
    expect(l.body).toEqual({ sedes: A.sedes.map((s) => s.sedeId) });
  });

  it('contextoLectura no sirve para enContexto (no es un ContextoBd)', () => {
    const bd = prueba.app.get(ServicioBd);
    const comprobarTipos = (acceso: AccesoPorCategoria) =>
      // @ts-expect-error: ContextoLectura no expone usuario ni IP; enContexto no lo acepta.
      bd.enContexto(acceso.contextoLectura, () => Promise.resolve(null));
    expect(typeof comprobarTipos).toBe('function');
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
