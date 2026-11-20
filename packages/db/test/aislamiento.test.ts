/**
 * Aislamiento entre clínicas, tabla por tabla, conectando como app_api con el contexto de A.
 * Ninguna consulta filtra por clínica: el filtro lo pone la base.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';
import { CASOS, poblarClinica, type DatosClinica } from './escenario.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let a: DatosClinica;
let b: DatosClinica;

beforeAll(async () => {
  [a, b] = await Promise.all([poblarClinica(admin), poblarClinica(admin)]);
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, fn);

/** Fila tal como la ve la administración con el contexto de su propia clínica. */
async function filaComoAdmin(tabla: string, d: DatosClinica, id: string): Promise<unknown> {
  return enTransaccion(admin, { clinica: d.clinicaId, usuario: d.duenoId }, async (c) => {
    const { rows } = await c.query(`select to_jsonb(t) as fila from app.${tabla} t where id = $1`, [
      id,
    ]);
    return (rows[0] as { fila: unknown } | undefined)?.fila;
  });
}

describe.each(CASOS)('aislamiento en app.$tabla', (caso) => {
  it('con contexto de A no se ve ninguna fila de B, aunque la consulta no filtre', async () => {
    await comoA(async (c) => {
      expect(
        await valor(c, `select count(*)::int from app.${caso.tabla} where id = $1`, [caso.id(b)]),
      ).toBe(0);
      expect(
        await valor(
          c,
          `select count(*)::int from app.${caso.tabla} where clinica_id is distinct from $1`,
          [a.clinicaId],
        ),
      ).toBe(0);
      expect(
        await valor(c, `select count(*)::int from app.${caso.tabla} where id = $1`, [caso.id(a)]),
      ).toBe(1);
    });
  });

  it('no se puede editar, dar de baja ni borrar una fila de B', async () => {
    const antes = await filaComoAdmin(caso.tabla, b, caso.id(b));
    await comoA(async (c) => {
      for (const set of [caso.editar, caso.baja]) {
        if (!set) continue;
        const r = await intentar(c, `update app.${caso.tabla} set ${set} where id = $1`, [
          caso.id(b),
        ]);
        // Sin privilegio de UPDATE: error. Con privilegio: 0 filas (RLS la oculta).
        if (r.ok) expect(r.cantidad).toBe(0);
        else expect(r.codigo).toBe('42501');
      }
      // UPDATE sin WHERE: solo toca filas de A.
      if (caso.editar) {
        const r = await intentar(
          c,
          `update app.${caso.tabla} set ${caso.editar} returning clinica_id`,
        );
        if (r.ok) expect(r.filas.every((f) => f['clinica_id'] === a.clinicaId)).toBe(true);
        else expect(r.codigo).toBe('42501');
      }
      const borrar = await intentar(c, `delete from app.${caso.tabla} where id = $1`, [caso.id(b)]);
      expect(borrar).toMatchObject({ ok: false, codigo: '42501' });
    });
    expect(await filaComoAdmin(caso.tabla, b, caso.id(b))).toEqual(antes);
  });

  it('no se puede insertar con clinica_id de B', async () => {
    await comoA(async (c) => {
      if (caso.insertar) {
        // Control: la misma inserción para A funciona (si no, la prueba no probaría nada).
        const [sqlA, paramsA] = caso.insertar(a);
        const propia = await intentar(c, sqlA, paramsA);
        if (caso.tabla !== 'membresia') expect(propia).toMatchObject({ ok: true });
        const [sqlB, paramsB] = caso.insertar(b);
        expect(await intentar(c, sqlB, paramsB)).toMatchObject({ ok: false, codigo: '42501' });
      } else {
        const r = await intentar(
          c,
          `insert into app.${caso.tabla} select * from app.${caso.tabla} where false`,
        );
        // app_api no tiene INSERT en esta tabla.
        if (!r.ok) expect(r.codigo).toBe('42501');
        const directo = await intentar(
          c,
          `insert into app.${caso.tabla} (clinica_id) values ($1)`,
          [b.clinicaId],
        );
        expect(directo).toMatchObject({ ok: false, codigo: '42501' });
      }
    });
  });

  it('no se puede mover una fila de A a B con UPDATE', async () => {
    await comoA(async (c) => {
      const r = await intentar(c, `update app.${caso.tabla} set clinica_id = $1 where id = $2`, [
        b.clinicaId,
        caso.id(a),
      ]);
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
    });
  });

  it.runIf(caso.referenciarAjena !== null)(
    'no se puede referenciar por FK una fila de B',
    async () => {
      await comoA(async (c) => {
        const [texto, parametros] = caso.referenciarAjena!(a, b);
        // FK compuesta (clinica_id, x_id): (A, id de B) no existe.
        expect(await intentar(c, texto, parametros)).toMatchObject({ ok: false, codigo: '23503' });
      });
    },
  );
});

describe('aislamiento en app.clinica', () => {
  it('con contexto de A no se ve, ni se edita, ni se crea otra clínica', async () => {
    await comoA(async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.clinica where id = $1', [b.clinicaId]),
      ).toBe(0);
      expect(await valor(c, 'select array_agg(id) from app.clinica')).toEqual([a.clinicaId]);
      const editar = await intentar(c, "update app.clinica set nombre = 'tomada' where id = $1", [
        b.clinicaId,
      ]);
      expect(editar).toMatchObject({ ok: true, cantidad: 0 });
      const baja = await intentar(c, 'update app.clinica set activo = false where id = $1', [
        b.clinicaId,
      ]);
      expect(baja).toMatchObject({ ok: true, cantidad: 0 });
      expect(
        await intentar(c, 'delete from app.clinica where id = $1', [b.clinicaId]),
      ).toMatchObject({
        ok: false,
        codigo: '42501',
      });
      // Ni siquiera con el contexto apuntando a la clínica nueva: no hay privilegio de INSERT.
      const nueva = randomUUID();
      await c.query("select set_config('app.clinica_id', $1, true)", [nueva]);
      expect(
        await intentar(c, "insert into app.clinica (id, nombre) values ($1, 'Clínica pirata')", [
          nueva,
        ]),
      ).toMatchObject({ ok: false, codigo: '42501' });
    });
  });

  it('no se puede cambiar el id de la clínica propia', async () => {
    await comoA(async (c) => {
      const r = await intentar(c, 'update app.clinica set id = $1 where id = $2', [
        randomUUID(),
        a.clinicaId,
      ]);
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
    });
  });
});

describe('aislamiento en app.usuario', () => {
  it('con contexto de A no se ve ni se edita un usuario que solo está en B', async () => {
    await comoA(async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.usuario where id = $1', [b.usuarioId]),
      ).toBe(0);
      expect(
        await valor(c, 'select count(*)::int from app.usuario where id = $1', [b.duenoId]),
      ).toBe(0);
      const r = await intentar(c, "update app.usuario set nombre = 'tomado' where id = $1", [
        b.usuarioId,
      ]);
      expect(r).toMatchObject({ ok: true, cantidad: 0 });
      expect(
        await intentar(
          c,
          "insert into app.usuario (id, nombre, email) values ($1, 'x', 'x@prueba.test')",
          [randomUUID()],
        ),
      ).toMatchObject({ ok: false, codigo: '42501' });
    });
  });
});

describe('sin contexto o con contexto inválido', () => {
  const contextos: [string, { clinica?: string | null; usuario?: string | null }][] = [
    ['sin contexto', {}],
    ['cadena vacía', { clinica: '', usuario: '' }],
    ['texto que no es UUID', { clinica: 'no-es-un-uuid', usuario: 'tampoco' }],
    ['inyección', { clinica: "' or 1=1 --", usuario: "' or 1=1 --" }],
    ['UUID de una clínica que no existe', { clinica: randomUUID(), usuario: randomUUID() }],
    ['UUID con espacios', { clinica: ` ${'0'.repeat(8)}-0000-4000-8000-000000000000 ` }],
  ];
  const tablas = [
    'clinica',
    'sede',
    'sede_horario',
    'sillon',
    'usuario',
    'membresia',
    'usuario_sede',
    'rol',
    'rol_permiso',
    'numerador',
    'audit_log',
    'sesion',
  ];

  it.each(contextos)('%s: cero filas en todas las tablas', async (_nombre, contexto) => {
    await enTransaccion(api, contexto, async (c) => {
      for (const tabla of tablas) {
        expect({ tabla, filas: await valor(c, `select count(*)::int from app.${tabla}`) }).toEqual({
          tabla,
          filas: 0,
        });
      }
    });
  });

  it.each(contextos)('%s: escrituras rechazadas', async (_nombre, contexto) => {
    await enTransaccion(api, contexto, async (c) => {
      const intentos: [string, unknown[]][] = [
        ['insert into app.sede (clinica_id, nombre) values ($1, $2)', [a.clinicaId, 'X']],
        [
          'insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, $3)',
          [a.clinicaId, a.sedeId, 'X'],
        ],
        [
          'insert into app.rol (clinica_id, nombre, codigo) values ($1, $2, $3)',
          [a.clinicaId, 'X', 'rol_sin_ctx'],
        ],
        [
          'insert into app.membresia (clinica_id, usuario_id, rol_id) values ($1, $2, $3)',
          [a.clinicaId, b.usuarioId, a.rolId],
        ],
      ];
      for (const [texto, parametros] of intentos) {
        expect(await intentar(c, texto, parametros)).toMatchObject({ ok: false, codigo: '42501' });
      }
      for (const tabla of ['sede', 'sillon', 'rol', 'membresia', 'clinica', 'usuario']) {
        // En usuario, app_api solo puede escribir nombre, telefono y ultimo_acceso.
        const columna = tabla === 'usuario' ? 'nombre' : 'created_at';
        const r = await intentar(c, `update app.${tabla} set ${columna} = ${columna}`);
        expect(r).toMatchObject({ ok: true, cantidad: 0 });
      }
      // 42501 sin clínica en el contexto; 23503 (FK a clinica) si el contexto apunta a una que no existe.
      const numero = await intentar(c, "select app.siguiente_numero('recibo')");
      expect(numero.ok).toBe(false);
      if (!numero.ok) expect(['42501', '23503']).toContain(numero.codigo);
      expect(await intentar(c, "select app.registrar_evento('ver', 'paciente')")).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
  });
});
