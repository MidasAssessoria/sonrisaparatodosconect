/** Auditoría: trigger app.auditar(), auditoría de fila no falsificable y audit_log de solo inserción. */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearUsuarioDePrueba } from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';
import { poblarClinica, type DatosClinica } from './escenario.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let a: DatosClinica;
let b: DatosClinica;
const IP = '203.0.113.7';

beforeAll(async () => {
  [a, b] = await Promise.all([poblarClinica(admin), poblarClinica(admin)]);
});

interface FilaAudit {
  clinica_id: string | null;
  usuario_id: string | null;
  entidad: string;
  entidad_id: string | null;
  accion: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  ip: string | null;
}

async function auditoriaDe(c: pg.ClientBase, entidadId: string): Promise<FilaAudit[]> {
  const { rows } = await c.query<FilaAudit>(
    `select clinica_id, usuario_id, entidad, entidad_id, accion, antes, despues, host(ip) as ip
     from app.audit_log where entidad_id = $1 order by fecha, id`,
    [entidadId],
  );
  return rows;
}

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>, usuario?: string): Promise<T> =>
  enTransaccion(api, { clinica: a.clinicaId, usuario: usuario ?? a.duenoId, ip: IP }, fn);

describe('trigger app.auditar()', () => {
  it('alta, edición y baja lógica dejan crear/editar/anular con antes, después, usuario, clínica e IP', async () => {
    await comoA(async (c) => {
      const sedeId = await valor<string>(
        c,
        "insert into app.sede (clinica_id, nombre) values ($1, 'Luque') returning id",
        [a.clinicaId],
      );
      await c.query("update app.sede set nombre = 'Luque Centro' where id = $1", [sedeId]);
      await c.query("update app.sede set deleted_at = now(), motivo_baja = 'Cerró' where id = $1", [
        sedeId,
      ]);

      const filas = await auditoriaDe(c, sedeId);
      expect(filas.map((f) => f.accion)).toEqual(['crear', 'editar', 'anular']);
      for (const fila of filas) {
        expect(fila).toMatchObject({
          clinica_id: a.clinicaId,
          usuario_id: a.duenoId,
          entidad: 'sede',
          entidad_id: sedeId,
          ip: IP,
        });
      }
      const [alta, edicion, baja] = filas;
      expect(alta?.antes).toBeNull();
      expect(alta?.despues).toMatchObject({ nombre: 'Luque', clinica_id: a.clinicaId });
      expect(edicion?.antes).toMatchObject({ nombre: 'Luque' });
      expect(edicion?.despues).toMatchObject({ nombre: 'Luque Centro' });
      expect(baja?.antes).toMatchObject({ deleted_at: null });
      expect(baja?.despues).toMatchObject({ motivo_baja: 'Cerró', deleted_by: a.duenoId });
    });
  });

  it('activo = false en un catálogo es anular; volver a activarlo es editar', async () => {
    await comoA(async (c) => {
      await c.query('update app.sillon set activo = false where id = $1', [a.sillonId]);
      await c.query('update app.sillon set activo = true where id = $1', [a.sillonId]);
      const filas = await auditoriaDe(c, a.sillonId);
      expect(filas.slice(-2).map((f) => f.accion)).toEqual(['anular', 'editar']);
    });
  });

  it('una edición que no cambia nada no deja fila', async () => {
    await comoA(async (c) => {
      const antes = (await auditoriaDe(c, a.sedeId)).length;
      await c.query('update app.sede set nombre = nombre, telefono = telefono where id = $1', [
        a.sedeId,
      ]);
      expect((await auditoriaDe(c, a.sedeId)).length).toBe(antes);
    });
  });

  it('usuario: ultimo_acceso no se audita; el nombre sí, con la clínica del contexto', async () => {
    await comoA(async (c) => {
      const antes = (await auditoriaDe(c, a.duenoId)).length;
      await c.query('update app.usuario set ultimo_acceso = now() where id = $1', [a.duenoId]);
      expect((await auditoriaDe(c, a.duenoId)).length).toBe(antes);
      await c.query("update app.usuario set nombre = 'Dra. Marta Acosta' where id = $1", [
        a.duenoId,
      ]);
      const ultima = (await auditoriaDe(c, a.duenoId)).at(-1);
      expect(ultima).toMatchObject({
        accion: 'editar',
        entidad: 'usuario',
        clinica_id: a.clinicaId,
      });
    });
  });

  it('una IP inválida en el contexto no rompe la escritura: queda NULL', async () => {
    await enTransaccion(
      api,
      { clinica: a.clinicaId, usuario: a.duenoId, ip: 'no-es-ip' },
      async (c) => {
        const id = await valor<string>(
          c,
          "insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, 'Sillón IP') returning id",
          [a.clinicaId, a.sedeId],
        );
        expect((await auditoriaDe(c, id))[0]?.ip).toBeNull();
      },
    );
  });

  it('también audita lo que hace la administración (dueño de las tablas) con contexto', async () => {
    await enTransaccion(admin, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
      await c.query("update app.sede set telefono = '021 000 000' where id = $1", [a.sedeId]);
      expect((await auditoriaDe(c, a.sedeId)).at(-1)).toMatchObject({
        accion: 'editar',
        usuario_id: a.duenoId,
      });
    });
  });
});

describe('auditoría de fila (created_*/updated_*/deleted_*) no falsificable', () => {
  const otro = randomUUID();
  const viejo = '2000-01-01T00:00:00Z';

  it('al insertar, created_* salen del contexto y updated_* quedan vacíos', async () => {
    await comoA(async (c) => {
      const ahora = await valor<Date>(c, 'select now()');
      const { rows } = await c.query(
        `insert into app.sede (clinica_id, nombre, created_at, created_by, updated_at, updated_by)
         values ($1, 'Sede falsa', $2, $3, $2, $3)
         returning created_at, created_by, updated_at, updated_by`,
        [a.clinicaId, viejo, otro],
      );
      expect(rows[0]).toEqual({
        created_at: ahora,
        created_by: a.duenoId,
        updated_at: null,
        updated_by: null,
      });
    });
  });

  it('al actualizar, created_* no cambian y updated_* salen del contexto', async () => {
    const original = await comoA(async (c) => {
      const { rows } = await c.query<{ created_at: Date; created_by: string | null }>(
        'select created_at, created_by from app.sillon where id = $1',
        [a.sillonId],
      );
      return rows[0];
    });
    await comoA(async (c) => {
      const ahora = await valor<Date>(c, 'select now()');
      const { rows } = await c.query(
        `update app.sillon set nombre = 'Sillón A', created_at = $2, created_by = $3,
                updated_at = $2, updated_by = $3
         where id = $1 returning created_at, created_by, updated_at, updated_by`,
        [a.sillonId, viejo, otro],
      );
      expect(rows[0]).toEqual({ ...original, updated_at: ahora, updated_by: a.duenoId });
    });
  });

  it('deleted_at y deleted_by los fija la base al dar de baja', async () => {
    await comoA(async (c) => {
      const ahora = await valor<Date>(c, 'select now()');
      const { rows } = await c.query(
        `update app.sede set deleted_at = $2, deleted_by = $3, motivo_baja = 'Prueba'
         where id = $1 returning deleted_at, deleted_by`,
        [a.sedeId, viejo, otro],
      );
      expect(rows[0]).toEqual({ deleted_at: ahora, deleted_by: a.duenoId });
      // Ya dada de baja, no se puede reescribir quién ni cuándo.
      const segunda = await c.query(
        'update app.sede set deleted_at = $2, deleted_by = $3 where id = $1 returning deleted_at, deleted_by',
        [a.sedeId, viejo, otro],
      );
      expect(segunda.rows[0]).toEqual({ deleted_at: ahora, deleted_by: a.duenoId });
    });
  });

  it('un created_by de un usuario inexistente en el contexto no se puede usar para escribir', async () => {
    await enTransaccion(api, { clinica: a.clinicaId, usuario: randomUUID() }, async (c) => {
      const r = await intentar(c, "insert into app.sede (clinica_id, nombre) values ($1, 'X')", [
        a.clinicaId,
      ]);
      expect(r).toMatchObject({ ok: false, codigo: '23503' });
    });
  });

  it('columnas inmutables: id, clínica, código de rol, permiso de un rol, usuario de una membresía', async () => {
    await comoA(async (c) => {
      const intentos: [string, unknown[]][] = [
        ['update app.sede set id = $1 where id = $2', [randomUUID(), a.sedeId]],
        ["update app.rol set codigo = 'dueno2' where id = $1", [a.rolId]],
        ['update app.rol set es_sistema = false where id = $1', [a.rolId]],
        ["update app.rol_permiso set accion = 'exportar' where id = $1", [a.rolPermisoId]],
        ['update app.rol_permiso set rol_id = $1 where id = $2', [a.roles.dueno, a.rolPermisoId]],
        ['update app.membresia set usuario_id = $1 where id = $2', [a.duenoId, a.membresiaId]],
        ['update app.sillon set sede_id = sede_id::text::uuid where id = $1', [a.sillonId]],
        ['update app.usuario_sede set sede_id = $1 where id = $2', [a.sedeId, a.usuarioSedeId]],
      ];
      for (const [texto, parametros] of intentos) {
        const r = await intentar(c, texto, parametros);
        // Asignar el mismo valor está permitido; cambiarlo no.
        if (texto.includes('sede_id::text::uuid') || texto.includes('usuario_sede set sede_id')) {
          expect(r).toMatchObject({ ok: true });
        } else {
          expect({ texto, r }).toMatchObject({ texto, r: { ok: false, codigo: '42501' } });
        }
      }
    });
  });
});

describe('audit_log es de solo inserción', () => {
  it('app_api no puede insertar, actualizar, borrar ni truncar', async () => {
    await comoA(async (c) => {
      const intentos = [
        [
          `insert into app.audit_log (clinica_id, usuario_id, entidad, accion) values ($1, $2, 'sede', 'crear')`,
          [a.clinicaId, a.duenoId],
        ],
        [
          `insert into app.audit_log (clinica_id, usuario_id, entidad, accion) values ($1, $2, 'sede', 'crear')`,
          [b.clinicaId, b.duenoId],
        ],
        ["update app.audit_log set accion = 'ver' where clinica_id = $1", [a.clinicaId]],
        ['delete from app.audit_log where clinica_id = $1', [a.clinicaId]],
        ['truncate app.audit_log', []],
      ] as const;
      for (const [texto, parametros] of intentos) {
        expect(await intentar(c, texto, [...parametros])).toMatchObject({
          ok: false,
          codigo: '42501',
        });
      }
    });
  });

  it('el trigger rechaza UPDATE, DELETE y TRUNCATE también al dueño de la tabla', async () => {
    await enTransaccion(admin, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
      for (const texto of [
        "update app.audit_log set accion = 'ver' where id = $1",
        'delete from app.audit_log where id = $1',
        'truncate app.audit_log',
        // Aunque no toque ninguna fila: el trigger es por sentencia.
        "update app.audit_log set accion = 'ver' where false and id = $1",
      ]) {
        const r = await intentar(c, texto, texto.includes('$1') ? [a.auditId] : []);
        expect({ texto, r }).toMatchObject({ texto, r: { ok: false, codigo: '42501' } });
        if (!r.ok) expect(r.mensaje).toContain('solo inserción');
      }
    });
  });
});

describe('app.registrar_evento()', () => {
  it('registra ver/exportar/enviar con clínica, usuario e IP del contexto', async () => {
    const pacienteId = randomUUID();
    await comoA(async (c) => {
      const id = await valor<string>(
        c,
        "select app.registrar_evento('exportar', 'paciente', $1, $2)",
        [pacienteId, { formato: 'csv', filas: 12 }],
      );
      const { rows } = await c.query<FilaAudit>(
        'select clinica_id, usuario_id, entidad, entidad_id, accion, antes, despues, host(ip) as ip from app.audit_log where id = $1',
        [id],
      );
      expect(rows[0]).toEqual({
        clinica_id: a.clinicaId,
        usuario_id: a.duenoId,
        entidad: 'paciente',
        entidad_id: pacienteId,
        accion: 'exportar',
        antes: null,
        despues: { formato: 'csv', filas: 12 },
        ip: IP,
      });
    });
  });

  it('no acepta crear/editar/anular ni entidades raras', async () => {
    await comoA(async (c) => {
      for (const accion of ['crear', 'editar', 'anular', 'borrar', '']) {
        const r = await intentar(c, "select app.registrar_evento($1, 'sede')", [accion]);
        expect({ accion, r }).toMatchObject({ accion, r: { ok: false, codigo: '22023' } });
      }
      const r = await intentar(c, "select app.registrar_evento('ver', 'Sede; drop table x')");
      expect(r).toMatchObject({ ok: false, codigo: '22023' });
    });
  });

  it('exige que el usuario del contexto sea miembro activo de la clínica del contexto', async () => {
    const inactivo = await crearUsuarioDePrueba(admin, {
      clinicaId: a.clinicaId,
      estado: 'inactivo',
    });
    const casos: [string, { clinica: string; usuario: string }][] = [
      ['usuario de B con clínica A', { clinica: a.clinicaId, usuario: b.duenoId }],
      ['usuario inexistente', { clinica: a.clinicaId, usuario: randomUUID() }],
      ['membresía inactiva', { clinica: a.clinicaId, usuario: inactivo.usuarioId }],
    ];
    for (const [nombre, contexto] of casos) {
      await enTransaccion(api, contexto, async (c) => {
        const r = await intentar(c, "select app.registrar_evento('ver', 'paciente')");
        expect({ nombre, r }).toMatchObject({ nombre, r: { ok: false, codigo: '42501' } });
      });
    }
  });
});

describe('alta de la clínica', () => {
  it('la deja auditada: la clínica y sus roles como alta del sistema, el dueño creado por sí mismo', async () => {
    await enTransaccion(admin, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
      const clinica = await auditoriaDe(c, a.clinicaId);
      expect(clinica[0]).toMatchObject({
        accion: 'crear',
        entidad: 'clinica',
        clinica_id: a.clinicaId,
        usuario_id: null,
      });
      const dueno = await auditoriaDe(c, a.duenoId);
      expect(dueno[0]).toMatchObject({
        accion: 'crear',
        entidad: 'usuario',
        clinica_id: a.clinicaId,
        usuario_id: a.duenoId,
      });
      const roles = await valor<number>(
        c,
        "select count(*)::int from app.audit_log where clinica_id = $1 and entidad = 'rol' and accion = 'crear'",
        [a.clinicaId],
      );
      expect(roles).toBe(5);
    });
  });
});
