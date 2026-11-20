/**
 * Doble factor: app.activar_mfa() y app.desactivar_mfa() sobre el usuario del contexto, auditados en
 * cada clínica con membresía activa, y sus envoltorios. mfa_activo y mfa_desactivado_en no son
 * escribibles por app_api.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activarMfa, conContexto, conUsuario, crearPool, desactivarMfa } from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);
const poolApi = crearPool(urls().urlApi, { max: 2 });

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;
let C: ClinicaDePrueba;

beforeAll(async () => {
  [A, B, C] = await Promise.all([
    crearClinicaDePrueba(admin),
    crearClinicaDePrueba(admin),
    crearClinicaDePrueba(admin),
  ]);
});
afterAll(() => poolApi.end());

/** Persona activa en A y B, inactiva en C. */
async function persona(): Promise<string> {
  const { usuarioId } = await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId });
  await crearUsuarioDePrueba(admin, { clinicaId: B.clinicaId, usuarioId });
  await crearUsuarioDePrueba(admin, { clinicaId: C.clinicaId, usuarioId, estado: 'inactivo' });
  return usuarioId;
}

async function estadoMfa(
  usuario: string,
): Promise<{ mfa_activo: boolean; mfa_desactivado_en: Date | null }> {
  return enTransaccion(admin, { usuario }, async (c) => {
    const { rows } = await c.query<{ mfa_activo: boolean; mfa_desactivado_en: Date | null }>(
      'select mfa_activo, mfa_desactivado_en from app.usuario where id = $1',
      [usuario],
    );
    return rows[0]!;
  });
}

async function cambiosMfa(clinica: ClinicaDePrueba, usuario: string): Promise<unknown[]> {
  return enTransaccion(
    admin,
    { clinica: clinica.clinicaId, usuario: clinica.duenoId },
    async (c) => {
      const { rows } = await c.query<{
        antes: { mfa_activo: boolean };
        despues: { mfa_activo: boolean };
      }>(
        `select antes, despues from app.audit_log
       where entidad = 'usuario' and entidad_id = $1 and accion = 'editar' order by fecha`,
        [usuario],
      );
      return rows.map((f) => [f.antes.mfa_activo, f.despues.mfa_activo]);
    },
  );
}

const comoUsuario = <T>(
  usuario: string,
  fn: (c: pg.PoolClient) => Promise<T>,
  clinica?: string,
): Promise<T> =>
  enTransaccion(api, { usuario, ...(clinica ? { clinica } : {}) }, fn, { confirmar: true });

describe('app.activar_mfa() y app.desactivar_mfa()', () => {
  it('activan y desactivan el doble factor del usuario del contexto, auditado en cada clínica activa', async () => {
    const x = await persona();
    const emitido = new Date();
    expect(
      await comoUsuario(x, (c) => valor(c, 'select app.activar_mfa($1)', [emitido]), A.clinicaId),
    ).toBe(true);
    expect(await estadoMfa(x)).toMatchObject({ mfa_activo: true, mfa_desactivado_en: null });
    // Activar de nuevo no cambia nada (ni deja otra fila).
    expect(await comoUsuario(x, (c) => valor(c, 'select app.activar_mfa($1)', [emitido]))).toBe(
      true,
    );

    const baja = await comoUsuario(x, (c) => valor<Date>(c, 'select app.desactivar_mfa()'));
    expect(baja).toBeInstanceOf(Date);
    expect(await estadoMfa(x)).toEqual({ mfa_activo: false, mfa_desactivado_en: baja });

    for (const clinica of [A, B]) {
      expect(await cambiosMfa(clinica, x)).toEqual([
        [false, true],
        [true, false],
      ]);
    }
    // En C la membresía está inactiva: no se entera.
    expect(await cambiosMfa(C, x)).toEqual([]);
  });

  it('un token aal2 emitido antes (o en el mismo momento) de la baja no vuelve a activarlo', async () => {
    const x = await persona();
    const viejo = new Date(Date.now() - 60_000);
    await comoUsuario(x, (c) => c.query('select app.activar_mfa($1)', [viejo]));
    const baja = await comoUsuario(x, (c) => valor<Date>(c, 'select app.desactivar_mfa()'));
    for (const emitido of [viejo, baja]) {
      expect(await comoUsuario(x, (c) => valor(c, 'select app.activar_mfa($1)', [emitido]))).toBe(
        false,
      );
    }
    expect((await estadoMfa(x)).mfa_activo).toBe(false);
    // Uno emitido después (volvió a enrolar un factor) sí.
    const nuevo = new Date(baja.getTime() + 1000);
    expect(await comoUsuario(x, (c) => valor(c, 'select app.activar_mfa($1)', [nuevo]))).toBe(true);
    expect((await estadoMfa(x)).mfa_activo).toBe(true);
  });

  it('validan la fecha del token y exigen usuario en el contexto', async () => {
    const x = await persona();
    await enTransaccion(api, { usuario: x }, async (c) => {
      expect(await intentar(c, 'select app.activar_mfa(null)')).toMatchObject(rechazo('22023'));
      expect(await intentar(c, "select app.activar_mfa(now() + interval '1 hour')")).toMatchObject(
        rechazo('22023'),
      );
    });
    await enTransaccion(api, { clinica: A.clinicaId }, async (c) => {
      expect(await intentar(c, 'select app.activar_mfa(now())')).toMatchObject(rechazo('42501'));
      expect(await intentar(c, 'select app.desactivar_mfa()')).toMatchObject(rechazo('42501'));
    });
  });

  it('no hay forma de activar ni desactivar el doble factor de otra persona (pasada adversarial)', async () => {
    const x = await persona();
    const y = await persona();
    await comoUsuario(y, (c) => c.query('select app.activar_mfa(now())'));
    await enTransaccion(api, { clinica: A.clinicaId, usuario: x }, async (c) => {
      // Las funciones no reciben usuario; el UPDATE directo no tiene privilegio.
      for (const texto of [
        'update app.usuario set mfa_activo = false where id = $1',
        'update app.usuario set mfa_activo = true where id = $1',
        'update app.usuario set mfa_desactivado_en = null where id = $1',
      ]) {
        for (const quien of [x, y]) {
          expect(await intentar(c, texto, [quien])).toMatchObject(rechazo('42501'));
        }
      }
      await c.query('select app.desactivar_mfa()');
    });
    expect((await estadoMfa(y)).mfa_activo).toBe(true);
  });
});

describe('envoltorios activarMfa y desactivarMfa', () => {
  it('funcionan dentro de conContexto y conUsuario', async () => {
    const x = await persona();
    expect(
      await conContexto(poolApi, { clinicaId: A.clinicaId, usuarioId: x }, (tx) =>
        activarMfa(tx, new Date()),
      ),
    ).toBe(true);
    const baja = await conUsuario(poolApi, x, (tx) => desactivarMfa(tx));
    expect(baja).toBeInstanceOf(Date);
    expect(
      await conUsuario(poolApi, x, (tx) => activarMfa(tx, new Date(baja.getTime() - 1000))),
    ).toBe(false);
  });
});
