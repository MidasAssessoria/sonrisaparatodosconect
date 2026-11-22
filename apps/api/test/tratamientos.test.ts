import { randomUUID } from 'node:crypto';
import { tratamientoSchema, type RolSistema, type Tratamiento } from '@conecta/shared';
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
  type Prueba,
} from './ayudas.js';
import { auditoriaDe } from './profesionales-ayudas.js';

type Detalles = { mensaje: string; detalles?: { campo: string; mensaje: string }[] };

describe('tratamientos', () => {
  let prueba: Prueba;
  let a: Clinica;
  let b: Clinica;
  let token: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    b = await crearClinica(prueba, { sedes: 1 });
    token = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const crear = async (cuerpo: object, t = token): Promise<Tratamiento> =>
    segun(
      tratamientoSchema,
      (await prueba.pedir('post', '/tratamientos', { token: t, cuerpo }).expect(201)).body,
    );

  it('crea con valores por defecto (IVA 10, 30 minutos) y con todos los datos', async () => {
    const simple = await crear({ nombre: '  Limpieza   simple ', precio: 150_000 });
    expect(simple).toMatchObject({
      nombre: 'Limpieza   simple',
      categoria: null,
      precio: 150_000,
      iva: 10,
      duracionMin: 30,
      activo: true,
    });
    const completo = await crear({
      nombre: 'Implante',
      categoria: 'Cirugía',
      precio: 999_999_999,
      iva: 5,
      duracionMin: 480,
    });
    expect(completo).toMatchObject({
      categoria: 'Cirugía',
      precio: 999_999_999,
      iva: 5,
      duracionMin: 480,
    });
    const exento = await crear({ nombre: 'Consulta exenta', precio: 0, iva: 0, categoria: '' });
    expect(exento).toMatchObject({ precio: 0, iva: 0, categoria: null });

    // El precio se guarda como bigint y vuelve exacto.
    const { rows } = await comoSistema<{ precio: string; tipo: string }>(
      prueba.admin,
      a.clinicaId,
      'select precio::text as precio, pg_typeof(precio)::text as tipo from app.tratamiento where id = $1',
      [completo.id],
    );
    expect(rows[0]).toEqual({ precio: '999999999', tipo: 'bigint' });
  });

  it('nombre duplicado entre los activos (mayúsculas, tildes o espacios distintos) → conflicto', async () => {
    await crear({ nombre: 'Extracción de muela', precio: 200_000 });
    for (const nombre of ['EXTRACCIÓN DE MUELA', 'extraccion de muela', 'Extracción  de   muela']) {
      const respuesta = await esperarError(
        prueba.pedir('post', '/tratamientos', { token, cuerpo: { nombre, precio: 1 } }),
        409,
        'conflicto',
      );
      expect((respuesta.body as Detalles).mensaje).toMatch(
        /Ya hay un tratamiento activo con ese nombre/,
      );
    }
    // La ñ es otra letra: «Año» y «Ano» no chocan.
    await crear({ nombre: 'Control del año', precio: 1 });
    await crear({ nombre: 'Control del ano', precio: 1 });
    // Otra clínica puede usar el mismo nombre.
    await crear({ nombre: 'Extracción de muela', precio: 1 }, await b.dueno.token());
  });

  it('precio con decimales, negativo o demasiado grande; IVA o duración inválidos → datos_invalidos', async () => {
    const casos: [object, string, string | RegExp][] = [
      [{ precio: 1500.5 }, 'precio', 'Los guaraníes no llevan decimales.'],
      [{ precio: -1 }, 'precio', 'Tiene que ser como mínimo 0.'],
      [{ precio: 1_000_000_000 }, 'precio', /como máximo/],
      [{ precio: '150000' }, 'precio', /tipo/],
      [{ precio: 1, iva: 7 }, 'iva', /./],
      [{ precio: 1, duracionMin: 7 }, 'duracionMin', 'La duración va en pasos de 5 minutos.'],
      [{ precio: 1, duracionMin: 0 }, 'duracionMin', /mínimo/],
    ];
    for (const [cuerpo, campo, mensaje] of casos) {
      const respuesta = await esperarError(
        prueba.pedir('post', '/tratamientos', { token, cuerpo: { nombre: 'Malo', ...cuerpo } }),
        400,
        'datos_invalidos',
      );
      const detalle = (respuesta.body as Detalles).detalles?.find((d) => d.campo === campo);
      expect(detalle?.mensaje, JSON.stringify(cuerpo)).toMatch(mensaje);
    }
    const sinNombre = await esperarError(
      prueba.pedir('post', '/tratamientos', { token, cuerpo: { nombre: ' ', precio: 1 } }),
      400,
      'datos_invalidos',
    );
    expect((sinNombre.body as Detalles).detalles?.[0]?.mensaje).toBe(
      'Poné el nombre del tratamiento.',
    );
  });

  it('edita, borra la categoría, desactiva y reactiva', async () => {
    const t = await crear({ nombre: 'Blanqueamiento', categoria: 'Estética', precio: 800_000 });
    const editado = segun(
      tratamientoSchema,
      (
        await prueba
          .pedir('patch', `/tratamientos/${t.id}`, {
            token,
            cuerpo: { precio: 850_000, categoria: '', iva: 5, duracionMin: 60 },
          })
          .expect(200)
      ).body,
    );
    expect(editado).toMatchObject({ precio: 850_000, categoria: null, iva: 5, duracionMin: 60 });
    await esperarError(
      prueba.pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: { precio: 1.5 } }),
      400,
      'datos_invalidos',
    );

    const inactivo = segun(
      tratamientoSchema,
      (
        await prueba
          .pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: { activo: false } })
          .expect(200)
      ).body,
    );
    expect(inactivo.activo).toBe(false);
    // Desactivado, el nombre queda libre; reactivarlo con otro activo del mismo nombre choca.
    const nuevo = await crear({ nombre: 'blanqueamiento', precio: 900_000 });
    await esperarError(
      prueba.pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: { activo: true } }),
      409,
      'conflicto',
    );
    await prueba
      .pedir('patch', `/tratamientos/${nuevo.id}`, { token, cuerpo: { activo: false } })
      .expect(200);
    const reactivado = segun(
      tratamientoSchema,
      (
        await prueba
          .pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: { activo: true } })
          .expect(200)
      ).body,
    );
    expect(reactivado.activo).toBe(true);

    const igual = segun(
      tratamientoSchema,
      (await prueba.pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: {} }).expect(200))
        .body,
    );
    expect(igual).toEqual(reactivado);
  });

  it('lista activos primero, después por categoría (sin categoría al final) y nombre', async () => {
    const otra = await crearClinica(prueba, { sedes: 1 });
    const t = await otra.dueno.token();
    const sinCat = await crear({ nombre: 'Aaa sin categoría', precio: 1 }, t);
    const ortoB = await crear({ nombre: 'Brackets', categoria: 'Ortodoncia', precio: 1 }, t);
    const ortoA = await crear({ nombre: 'Alineadores', categoria: 'Ortodoncia', precio: 1 }, t);
    const ciru = await crear({ nombre: 'Zeta', categoria: 'Cirugía', precio: 1 }, t);
    const viejo = await crear({ nombre: 'Viejo', categoria: 'Cirugía', precio: 1 }, t);
    await prueba
      .pedir('patch', `/tratamientos/${viejo.id}`, { token: t, cuerpo: { activo: false } })
      .expect(200);
    const lista = segun(
      z.array(tratamientoSchema),
      (await prueba.pedir('get', '/tratamientos', { token: t }).expect(200)).body,
    );
    expect(lista.map((x) => x.id)).toEqual([ciru.id, ortoA.id, ortoB.id, sinCat.id, viejo.id]);
  });

  it('auditoría con el módulo configuracion y el autor', async () => {
    const t = await crear({ nombre: 'Auditado', precio: 10 });
    await prueba
      .pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: { precio: 20 } })
      .expect(200);
    await prueba
      .pedir('patch', `/tratamientos/${t.id}`, { token, cuerpo: { activo: false } })
      .expect(200);
    expect(await auditoriaDe(prueba, a.clinicaId, 'tratamiento', t.id)).toEqual(
      ['crear', 'editar', 'anular'].map((accion) => ({
        accion,
        modulo: 'configuracion',
        usuario_id: a.duenoId,
        sede_id: null,
      })),
    );
  });

  it('aislamiento: tratamiento de otra clínica → no_encontrado; clinica_id del cuerpo se ignora', async () => {
    const deB = await crear({ nombre: 'Solo de B', precio: 5 }, await b.dueno.token());
    await esperarError(
      prueba.pedir('patch', `/tratamientos/${deB.id}`, { token, cuerpo: { precio: 1 } }),
      404,
      'no_encontrado',
    );
    await esperarError(
      prueba.pedir('patch', `/tratamientos/${randomUUID()}`, { token, cuerpo: { precio: 1 } }),
      404,
      'no_encontrado',
    );
    await esperarError(
      prueba.pedir('patch', '/tratamientos/abc', { token, cuerpo: {} }),
      404,
      'no_encontrado',
    );
    const lista = segun(
      z.array(tratamientoSchema),
      (await prueba.pedir('get', '/tratamientos', { token }).expect(200)).body,
    );
    expect(lista.some((x) => x.id === deB.id)).toBe(false);

    const propio = await crear({
      nombre: 'Con clínica ajena',
      precio: 5,
      clinicaId: b.clinicaId,
      clinica_id: b.clinicaId,
    });
    const { rows } = await comoSistema<{ clinica_id: string; precio: string }>(
      prueba.admin,
      a.clinicaId,
      'select clinica_id, precio::text as precio from app.tratamiento where id = $1 or id = $2 order by precio',
      [propio.id, deB.id],
    );
    expect(rows).toEqual([{ clinica_id: a.clinicaId, precio: '5' }]);
  });
});

interface Caso {
  nombre: string;
  metodo: 'get' | 'post' | 'patch';
  preparar: (id: string) => { ruta: string; cuerpo?: object };
  estadoOk: number;
  esquema: z.ZodType;
  puede: RolSistema;
  noPuede: RolSistema;
}

const CASOS: Caso[] = [
  {
    nombre: 'GET /tratamientos',
    metodo: 'get',
    preparar: () => ({ ruta: '/tratamientos' }),
    estadoOk: 200,
    esquema: z.array(tratamientoSchema),
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    // configuracion:crear lo tienen el dueño y, desde la migración 0015, administración.
    nombre: 'POST /tratamientos',
    metodo: 'post',
    preparar: () => ({
      ruta: '/tratamientos',
      cuerpo: { nombre: `T ${randomUUID()}`, precio: 1000 },
    }),
    estadoOk: 201,
    esquema: tratamientoSchema,
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    nombre: 'PATCH /tratamientos/:id',
    metodo: 'patch',
    preparar: (id) => ({ ruta: `/tratamientos/${id}`, cuerpo: { precio: 2000 } }),
    estadoOk: 200,
    esquema: tratamientoSchema,
    puede: 'administracion',
    noPuede: 'odontologo',
  },
];

describe('tratamientos: matriz de permisos', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  for (const caso of CASOS) {
    it(`${caso.nombre}: ${caso.puede} puede, ${caso.noPuede} → sin_permiso`, async () => {
      const permitido = await crearPersona(prueba, a.clinicaId, { rol: caso.puede });
      const negado = await crearPersona(prueba, a.clinicaId, { rol: caso.noPuede });
      const base = segun(
        tratamientoSchema,
        (
          await prueba
            .pedir('post', '/tratamientos', {
              token: await a.dueno.token(),
              cuerpo: { nombre: `Base ${randomUUID()}`, precio: 1 },
            })
            .expect(201)
        ).body,
      );
      const pedido = caso.preparar(base.id);
      await esperarError(
        prueba.pedir(caso.metodo, pedido.ruta, {
          token: await negado.token(),
          ...(pedido.cuerpo ? { cuerpo: pedido.cuerpo } : {}),
        }),
        403,
        'sin_permiso',
      );
      const otro = caso.preparar(base.id);
      const respuesta = await prueba
        .pedir(caso.metodo, otro.ruta, {
          token: await permitido.token(),
          ...(otro.cuerpo ? { cuerpo: otro.cuerpo } : {}),
        })
        .expect(caso.estadoOk);
      segun(caso.esquema, respuesta.body);
    });
  }
});
