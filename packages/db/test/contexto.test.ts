/** API de TypeScript: crearPool, conContexto, conUsuario y conContextoCliente. */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLog,
  conContexto,
  conContextoCliente,
  conUsuario,
  crearPool,
  ErrorDeContexto,
  numerador,
  sede,
  sedeHorario,
} from '../src/index.js';
import { crearClinicaDePrueba, type ClinicaDePrueba } from '../src/pruebas/index.js';
import { nuevoPool, urls } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
// Una sola conexión: así se ve si algo del contexto queda pegado entre transacciones.
const pool = crearPool(urls().urlApi, { max: 1 });
let A: ClinicaDePrueba;

beforeAll(async () => {
  A = await crearClinicaDePrueba(admin);
});
afterAll(() => pool.end());

const ctx = (): { clinicaId: string; usuarioId: string } => ({
  clinicaId: A.clinicaId,
  usuarioId: A.duenoId,
});

describe('conContexto', () => {
  it('fija clínica, usuario e IP solo dentro de la transacción y confirma al terminar', async () => {
    const dentro = await conContexto(pool, { ...ctx(), ip: '2001:db8::1' }, async (tx) => {
      const [fila] = await tx
        .insert(sede)
        .values({ clinicaId: A.clinicaId, nombre: 'Sede Drizzle' })
        .returning();
      const contexto = await tx.execute<{ clinica: string; usuario: string; ip: string }>(
        sql`select app.clinica_actual() as clinica, app.usuario_actual() as usuario, current_setting('app.ip') as ip`,
      );
      return { fila, contexto: contexto.rows[0] };
    });
    expect(dentro.contexto).toEqual({
      clinica: A.clinicaId,
      usuario: A.duenoId,
      ip: '2001:db8::1',
    });
    expect(dentro.fila).toMatchObject({
      clinicaId: A.clinicaId,
      createdBy: A.duenoId,
      updatedAt: null,
    });

    // Misma conexión, fuera de conContexto: no queda nada del contexto.
    const fuera = await pool.query<{ clinica: string | null; sedes: number }>(
      'select app.clinica_actual() as clinica, (select count(*)::int from app.sede) as sedes',
    );
    expect(fuera.rows[0]).toEqual({ clinica: null, sedes: 0 });

    const auditoria = await conContexto(pool, ctx(), (tx) =>
      tx
        .select({ ip: auditLog.ip, accion: auditLog.accion })
        .from(auditLog)
        .where(eq(auditLog.entidadId, dentro.fila!.id)),
    );
    expect(auditoria).toEqual([{ ip: '2001:db8::1', accion: 'crear' }]);
  });

  it('revierte todo si la función lanza un error', async () => {
    const nombre = `Revertida ${Date.now()}`;
    await expect(
      conContexto(pool, ctx(), async (tx) => {
        await tx.insert(sede).values({ clinicaId: A.clinicaId, nombre });
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    const filas = await conContexto(pool, ctx(), (tx) =>
      tx.select().from(sede).where(eq(sede.nombre, nombre)),
    );
    expect(filas).toEqual([]);
  });

  it('una transacción anidada usa savepoint y conserva el contexto', async () => {
    const resultado = await conContexto(pool, ctx(), async (tx) => {
      await tx
        .transaction(async (anidada) => {
          await anidada.insert(sede).values({ clinicaId: A.clinicaId, nombre: 'Anidada' });
          anidada.rollback();
        })
        .catch(() => undefined);
      const visibles = await tx
        .select({ nombre: sede.nombre })
        .from(sede)
        .where(eq(sede.nombre, 'Anidada'));
      const clinica = await tx.execute<{ c: string }>(sql`select app.clinica_actual() as c`);
      return { visibles, clinica: clinica.rows[0]?.c };
    });
    expect(resultado).toEqual({ visibles: [], clinica: A.clinicaId });
  });

  it('rechaza ids que no son UUID e IPs inválidas antes de tocar la base', async () => {
    const casos = [
      { clinicaId: "' or 1=1 --", usuarioId: A.duenoId },
      { clinicaId: A.clinicaId, usuarioId: '' },
      { clinicaId: `${A.clinicaId} `, usuarioId: A.duenoId },
      { clinicaId: A.clinicaId, usuarioId: A.duenoId, ip: '999.1.1.1' },
    ];
    for (const caso of casos) {
      await expect(conContexto(pool, caso, () => Promise.resolve(1))).rejects.toBeInstanceOf(
        ErrorDeContexto,
      );
    }
  });

  it('los tipos de Drizzle salen bien de la base (time como texto, bigint como número)', async () => {
    const leido = await conContexto(pool, ctx(), async (tx) => {
      const [nueva] = await tx
        .insert(sede)
        .values({ clinicaId: A.clinicaId, nombre: 'Con horario' })
        .returning();
      const [horario] = await tx
        .insert(sedeHorario)
        .values({
          clinicaId: A.clinicaId,
          sedeId: nueva!.id,
          diaSemana: 6,
          horaInicio: '08:00',
          horaFin: '12:30',
        })
        .returning();
      await tx.execute(sql`select app.siguiente_numero('recibo')`);
      const [contador] = await tx.select().from(numerador).where(eq(numerador.tipo, 'recibo'));
      return { horario, contador };
    });
    expect(leido.horario).toMatchObject({
      diaSemana: 6,
      horaInicio: '08:00:00',
      horaFin: '12:30:00',
      intervaloMin: 30,
    });
    expect(leido.contador?.ultimo).toBe(1);
  });
});

describe('conUsuario', () => {
  it('fija el usuario y deja la clínica vacía, aunque la conexión venga con otra', async () => {
    const cliente = await pool.connect();
    await cliente.query("select set_config('app.clinica_id', $1, false)", [A.clinicaId]);
    cliente.release();
    const visto = await conUsuario(pool, A.duenoId, async (tx) => {
      const r = await tx.execute<{ clinica: string | null; usuario: string; sedes: number }>(
        sql`select app.clinica_actual() as clinica, app.usuario_actual() as usuario,
                   (select count(*)::int from app.sede) as sedes`,
      );
      return r.rows[0];
    });
    expect(visto).toEqual({ clinica: null, usuario: A.duenoId, sedes: 0 });
    await pool.query("select set_config('app.clinica_id', '', false)");
  });
});

describe('conContextoCliente', () => {
  it('confirma con éxito y revierte con error', async () => {
    const id = await conContextoCliente(pool, ctx(), async (cliente) => {
      const r = await cliente.query<{ id: string }>(
        "insert into app.sede (clinica_id, nombre) values ($1, 'Cliente crudo') returning id",
        [A.clinicaId],
      );
      return r.rows[0]!.id;
    });
    await expect(
      conContextoCliente(pool, ctx(), async (cliente) => {
        await cliente.query("update app.sede set nombre = 'No queda' where id = $1", [id]);
        throw new Error('falla');
      }),
    ).rejects.toThrow('falla');
    const nombre = await conContextoCliente(pool, ctx(), async (cliente) => {
      const r = await cliente.query<{ nombre: string }>(
        'select nombre from app.sede where id = $1',
        [id],
      );
      return r.rows[0]?.nombre;
    });
    expect(nombre).toBe('Cliente crudo');
  });
});
