/**
 * Meta-prueba de «negar por defecto»: toda ruta registrada declara su acceso, y una ruta sin
 * declaración responde 403 aunque el token sea válido.
 */
import { Controller, Get, Module, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESO, type Acceso } from '../src/contexto/acceso.js';
import { crearClinica, crearPrueba, esperarError, type Clinica, type Prueba } from './ayudas.js';

@Controller('sin-declarar')
class RutaSinDeclarar {
  @Get()
  obtener(): { secreto: string } {
    return { secreto: 'no debería verse' };
  }
}

@Module({ controllers: [RutaSinDeclarar] })
class ModuloSinDeclarar {}

interface Ruta {
  metodo: string;
  ruta: string;
  acceso: Acceso | undefined;
}

function rutasRegistradas(prueba: Prueba): Ruta[] {
  const rutas: Ruta[] = [];
  for (const modulo of prueba.app.get(ModulesContainer).values()) {
    for (const envoltorio of modulo.controllers.values()) {
      const clase = envoltorio.metatype as (new (...args: never[]) => unknown) | null;
      if (!clase) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, clase) ?? '');
      const accesoClase = Reflect.getMetadata(ACCESO, clase) as Acceso | undefined;
      const prototipo = clase.prototype as Record<string, unknown>;
      for (const nombre of Object.getOwnPropertyNames(prototipo)) {
        const handler = prototipo[nombre];
        if (nombre === 'constructor' || typeof handler !== 'function') continue;
        const camino = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (camino === undefined) continue;
        const metodo = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        rutas.push({
          metodo: metodo ?? '?',
          ruta: `/${[base, camino].filter((p) => p && p !== '/').join('/')}`,
          acceso: (Reflect.getMetadata(ACCESO, handler) as Acceso | undefined) ?? accesoClase,
        });
      }
    }
  }
  return rutas.sort((x, y) => `${x.ruta} ${x.metodo}`.localeCompare(`${y.ruta} ${y.metodo}`));
}

describe('rutas: negar por defecto', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba({ modulosExtra: [ModuloSinDeclarar] });
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('toda ruta de la app declara su acceso, y la tabla coincide con el contrato', () => {
    const rutas = rutasRegistradas(prueba).filter((r) => r.ruta !== '/sin-declarar');
    const sinDeclarar = rutas.filter((r) => r.acceso === undefined);
    expect(sinDeclarar, 'rutas sin @Permiso/@Publica/@SoloMiembro/@AccesoSesion').toEqual([]);

    const tabla = rutas.map((r) => {
      const acceso = r.acceso;
      const descripcion =
        acceso?.tipo === 'permiso' ? `${acceso.modulo}:${acceso.accion}` : (acceso?.tipo ?? '?');
      return `${r.metodo} ${r.ruta} ${descripcion}`;
    });
    expect([...tabla].sort()).toEqual(
      [
        'GET /auditoria auditoria:ver',
        'GET /salud publica',
        'GET /sedes sedes:ver',
        'POST /sedes sedes:crear',
        'DELETE /sedes/:id sedes:anular',
        'GET /sedes/:id sedes:ver',
        'PATCH /sedes/:id sedes:editar',
        'PUT /sedes/:id/horarios sedes:editar',
        'POST /sedes/:id/sillones sedes:crear',
        'DELETE /sesion/mfa miembro',
        'GET /sesion sesion',
        'PATCH /sillones/:id sedes:editar',
      ].sort(),
    );
  });

  it('la meta-prueba detecta una ruta sin declaración', () => {
    const sinDeclarar = rutasRegistradas(prueba).filter((r) => r.acceso === undefined);
    expect(sinDeclarar.map((r) => `${r.metodo} ${r.ruta}`)).toEqual(['GET /sin-declarar']);
  });

  it('una ruta sin declaración responde 403 con o sin token, sin ejecutar el handler', async () => {
    await esperarError(prueba.pedir('get', '/sin-declarar'), 403, 'sin_permiso');
    const respuesta = await esperarError(
      prueba.pedir('get', '/sin-declarar', { token: await a.dueno.token('aal2') }),
      403,
      'sin_permiso',
    );
    expect(JSON.stringify(respuesta.body)).not.toContain('secreto');
  });
});
