/** app.siguiente_numero(): correlativos sin huecos ni repetidos, por clínica, tipo y sede. */
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearSedeDePrueba } from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';
import { poblarClinica, type DatosClinica } from './escenario.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 40);

let a: DatosClinica;
let b: DatosClinica;

beforeAll(async () => {
  [a, b] = await Promise.all([poblarClinica(admin), poblarClinica(admin)]);
});

function numero(d: DatosClinica, tipo: string, sedeId: string | null = null): Promise<number> {
  return enTransaccion(
    api,
    { clinica: d.clinicaId, usuario: d.duenoId },
    async (c) =>
      Number(await valor<string>(c, 'select app.siguiente_numero($1, $2)', [tipo, sedeId])),
    { confirmar: true },
  );
}

describe('app.siguiente_numero()', () => {
  it('30 transacciones concurrentes reciben 30 números consecutivos, sin repetidos ni huecos', async () => {
    const pedir = (): Promise<number> =>
      enTransaccion(
        api,
        { clinica: a.clinicaId, usuario: a.duenoId },
        async (c) => {
          const n = Number(await valor<string>(c, "select app.siguiente_numero('presupuesto')"));
          // Mantener la transacción abierta un rato para que las demás tengan que esperar el bloqueo.
          await c.query('select pg_sleep($1)', [Math.random() * 0.02]);
          return n;
        },
        { confirmar: true },
      );
    const numeros = await Promise.all(Array.from({ length: 30 }, pedir));
    expect([...numeros].sort((x, y) => x - y)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const ultimo = await enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, (c) =>
      valor<string>(
        c,
        "select ultimo from app.numerador where tipo = 'presupuesto' and sede_id is null",
      ),
    );
    expect(Number(ultimo)).toBe(30);
  });

  it('una transacción revertida devuelve su número: no quedan huecos', async () => {
    const primero = await numero(a, 'certificado');
    const revertido = await enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, (c) =>
      valor<string>(c, "select app.siguiente_numero('certificado')"),
    );
    expect(Number(revertido)).toBe(primero + 1);
    expect(await numero(a, 'certificado')).toBe(primero + 1);
  });

  it('mientras una transacción tiene el número, la siguiente espera (bloqueo de fila)', async () => {
    await numero(a, 'indicaciones');
    const primera = await api.connect();
    try {
      await primera.query('BEGIN');
      await primera.query(
        "select set_config('app.clinica_id', $1, true), set_config('app.usuario_id', $2, true)",
        [a.clinicaId, a.duenoId],
      );
      const n = Number(await valor<string>(primera, "select app.siguiente_numero('indicaciones')"));
      await enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
        await c.query("set local lock_timeout = '300ms'");
        const r = await intentar(c, "select app.siguiente_numero('indicaciones')");
        expect(r).toMatchObject({ ok: false, codigo: '55P03' });
      });
      await primera.query('COMMIT');
      expect(await numero(a, 'indicaciones')).toBe(n + 1);
    } finally {
      await primera.query('ROLLBACK').catch(() => undefined);
      primera.release();
    }
  });

  it('es independiente por clínica, por tipo y por sede', async () => {
    const { sedeId } = await crearSedeDePrueba(admin, a.clinicaId);
    expect(await numero(a, 'receta')).toBe(1);
    expect(await numero(a, 'receta')).toBe(2);
    expect(await numero(b, 'receta')).toBe(1);
    expect(await numero(a, 'consentimiento')).toBe(1);
    expect(await numero(a, 'receta', sedeId)).toBe(1);
    expect(await numero(a, 'receta', sedeId)).toBe(2);
    expect(await numero(a, 'receta')).toBe(3);
    expect(await numero(b, 'receta')).toBe(2);
  });

  it('rechaza una sede de otra clínica y un tipo desconocido', async () => {
    await enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
      expect(
        await intentar(c, "select app.siguiente_numero('recibo', $1)", [b.sedeId]),
      ).toMatchObject({
        ok: false,
        codigo: '23503',
      });
      expect(await intentar(c, "select app.siguiente_numero('factura')")).toMatchObject({
        ok: false,
        codigo: '23514',
      });
    });
  });

  it('app_api no puede tocar los contadores directamente', async () => {
    await enTransaccion(
      api,
      { clinica: a.clinicaId, usuario: a.duenoId },
      async (c: pg.PoolClient) => {
        expect(await intentar(c, 'update app.numerador set ultimo = 0')).toMatchObject({
          ok: false,
          codigo: '42501',
        });
        expect(
          await intentar(
            c,
            "insert into app.numerador (clinica_id, tipo, ultimo) values ($1, 'receta', 0)",
            [a.clinicaId],
          ),
        ).toMatchObject({ ok: false, codigo: '42501' });
        expect(await intentar(c, 'delete from app.numerador')).toMatchObject({
          ok: false,
          codigo: '42501',
        });
      },
    );
  });
});
