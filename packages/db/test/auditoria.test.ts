/**
 * Auditoría: trigger app.auditar() (con módulo, sede y autor congelado), cambios de usuario en cada
 * clínica, auditoría de fila no falsificable, audit_log de solo inserción y app.registrar_evento().
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { crearClinicaDePrueba, crearUsuarioDePrueba } from '../src/pruebas/index.js';
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
  usuario_nombre: string | null;
  entidad: string;
  entidad_id: string | null;
  accion: string;
  modulo: string | null;
  sede_id: string | null;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  ip: string | null;
}

const COLUMNAS = `clinica_id, usuario_id, usuario_nombre, entidad, entidad_id, accion, modulo, sede_id,
                  antes, despues, host(ip) as ip`;

async function auditoriaDe(c: pg.ClientBase, entidadId: string): Promise<FilaAudit[]> {
  const { rows } = await c.query<FilaAudit>(
    `select ${COLUMNAS} from app.audit_log where entidad_id = $1 order by fecha, id`,
    [entidadId],
  );
  return rows;
}

async function filaAudit(c: pg.ClientBase, id: string): Promise<FilaAudit | undefined> {
  const { rows } = await c.query<FilaAudit>(`select ${COLUMNAS} from app.audit_log where id = $1`, [
    id,
  ]);
  return rows[0];
}

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>, usuario?: string): Promise<T> =>
  enTransaccion(api, { clinica: a.clinicaId, usuario: usuario ?? a.duenoId, ip: IP }, fn);

async function nombreDe(d: DatosClinica, usuarioId: string): Promise<string> {
  return enTransaccion(admin, { clinica: d.clinicaId, usuario: usuarioId }, (c) =>
    valor<string>(c, 'select nombre from app.usuario where id = $1', [usuarioId]),
  );
}

describe('trigger app.auditar()', () => {
  it('alta, edición y baja lógica dejan crear/editar/anular con antes, después, autor, módulo, sede, clínica e IP', async () => {
    const nombreDueno = await nombreDe(a, a.duenoId);
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
          usuario_nombre: nombreDueno,
          entidad: 'sede',
          entidad_id: sedeId,
          modulo: 'sedes',
          // Para una sede, su propio id.
          sede_id: sedeId,
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

  it('módulo y sede de cada tabla: sillón y horario llevan su sede; rol, membresía y clínica no', async () => {
    await comoA(async (c) => {
      await c.query("update app.sillon set nombre = 'Sillón módulo' where id = $1", [a.sillonId]);
      await c.query('update app.sede_horario set intervalo_min = 20 where id = $1', [a.horarioId]);
      await c.query("update app.rol set nombre = 'Recepción (módulo)' where id = $1", [a.rolId]);
      await c.query('update app.rol_permiso set activo = false where id = $1', [a.rolPermisoId]);
      await c.query("update app.membresia set estado = 'inactivo' where id = $1", [a.membresiaId]);
      await c.query('update app.usuario_sede set activo = false where id = $1', [a.usuarioSedeId]);
      await c.query('update app.clinica set tope_descuento_pct = 30 where id = $1', [a.clinicaId]);
      const ultima = async (id: string): Promise<Pick<FilaAudit, 'modulo' | 'sede_id'>> => {
        const fila = (await auditoriaDe(c, id)).at(-1);
        return { modulo: fila?.modulo ?? null, sede_id: fila?.sede_id ?? null };
      };
      expect(await ultima(a.sillonId)).toEqual({ modulo: 'sedes', sede_id: a.sedeId });
      expect(await ultima(a.horarioId)).toEqual({ modulo: 'sedes', sede_id: a.sedeId });
      expect(await ultima(a.rolId)).toEqual({ modulo: 'configuracion', sede_id: null });
      expect(await ultima(a.rolPermisoId)).toEqual({ modulo: 'configuracion', sede_id: null });
      expect(await ultima(a.membresiaId)).toEqual({ modulo: 'personal', sede_id: null });
      expect(await ultima(a.usuarioSedeId)).toEqual({ modulo: 'personal', sede_id: a.sedeId });
      expect(await ultima(a.clinicaId)).toEqual({ modulo: 'configuracion', sede_id: null });
    });
  });

  it('el autor queda congelado: un cambio de nombre posterior no reescribe la autoría del pasado', async () => {
    const d = await poblarClinica(admin);
    const viejo = await nombreDe(d, d.duenoId);
    const como = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
      enTransaccion(api, { clinica: d.clinicaId, usuario: d.duenoId }, fn, { confirmar: true });
    const antes = await como((c) =>
      valor<string>(c, "select app.registrar_evento('ver', 'sede', $1)", [d.sedeId]),
    );
    await como((c) =>
      c.query("update app.usuario set nombre = 'Dra. Nombre Nuevo' where id = $1", [d.duenoId]),
    );
    const despues = await como((c) =>
      valor<string>(c, "select app.registrar_evento('ver', 'sede', $1)", [d.sedeId]),
    );
    await enTransaccion(api, { clinica: d.clinicaId, usuario: d.duenoId }, async (c) => {
      expect((await filaAudit(c, antes))?.usuario_nombre).toBe(viejo);
      expect((await filaAudit(c, despues))?.usuario_nombre).toBe('Dra. Nombre Nuevo');
      // La edición del nombre misma lleva el nombre nuevo (se registra después del cambio).
      expect((await auditoriaDe(c, d.duenoId)).at(-1)).toMatchObject({
        accion: 'editar',
        usuario_nombre: 'Dra. Nombre Nuevo',
        modulo: 'personal',
      });
    });
  });

  it('un cambio del sistema (sin usuario) queda sin autor', async () => {
    await enTransaccion(admin, { clinica: a.clinicaId, usuario: '' }, async (c) => {
      await c.query("update app.sede set telefono = '021 999 999' where id = $1", [a.sedeId]);
      expect((await auditoriaDe(c, a.sedeId)).at(-1)).toMatchObject({
        usuario_id: null,
        usuario_nombre: null,
        modulo: 'sedes',
      });
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

describe('cambios de usuario (identidad global): una fila por clínica', () => {
  /** X: activo en P y Q, inactivo en R, pendiente en S. */
  let P: DatosClinica;
  let Q: DatosClinica;
  let R: DatosClinica;
  let S: DatosClinica;
  let x: string;

  beforeAll(async () => {
    [P, Q, R, S] = await Promise.all([
      poblarClinica(admin),
      poblarClinica(admin),
      poblarClinica(admin),
      poblarClinica(admin),
    ]);
    x = (await crearUsuarioDePrueba(admin, { clinicaId: P.clinicaId })).usuarioId;
    await crearUsuarioDePrueba(admin, { clinicaId: Q.clinicaId, usuarioId: x });
    await crearUsuarioDePrueba(admin, { clinicaId: R.clinicaId, usuarioId: x, estado: 'inactivo' });
    await crearUsuarioDePrueba(admin, {
      clinicaId: S.clinicaId,
      usuarioId: x,
      estado: 'pendiente',
    });
  });

  async function cambiosDeX(d: DatosClinica, desde: Date): Promise<FilaAudit[]> {
    return enTransaccion(admin, { clinica: d.clinicaId, usuario: d.duenoId }, async (c) => {
      const { rows } = await c.query<FilaAudit>(
        `select ${COLUMNAS} from app.audit_log
         where entidad = 'usuario' and entidad_id = $1 and fecha >= $2 order by fecha`,
        [x, desde],
      );
      return rows;
    });
  }

  it('un cambio hecho con la clínica P queda en P y en Q (activas), no en R (inactiva) ni en S (pendiente)', async () => {
    const desde = new Date();
    await enTransaccion(
      api,
      { clinica: P.clinicaId, usuario: x, ip: IP },
      (c) => c.query("update app.usuario set telefono = '0981 111 111' where id = $1", [x]),
      { confirmar: true },
    );
    for (const d of [P, Q]) {
      const filas = await cambiosDeX(d, desde);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        clinica_id: d.clinicaId,
        usuario_id: x,
        accion: 'editar',
        modulo: 'personal',
        sede_id: null,
        ip: IP,
      });
      expect(filas[0]?.despues).toMatchObject({ telefono: '0981 111 111' });
    }
    expect(await cambiosDeX(R, desde)).toEqual([]);
    expect(await cambiosDeX(S, desde)).toEqual([]);
  });

  it('sin clínica en el contexto (paso del login) también queda en cada clínica activa: nunca una fila sin clínica', async () => {
    const desde = new Date();
    await enTransaccion(
      api,
      { usuario: x },
      (c) => c.query("update app.usuario set nombre = 'X sin clínica' where id = $1", [x]),
      { confirmar: true },
    );
    for (const d of [P, Q]) {
      const filas = await cambiosDeX(d, desde);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        clinica_id: d.clinicaId,
        usuario_nombre: 'X sin clínica',
        modulo: 'personal',
      });
    }
    expect(await cambiosDeX(R, desde)).toEqual([]);
  });

  it('un cambio que no quedaría en ninguna clínica se rechaza', async () => {
    // Solo pendiente en una clínica y sin clínica en el contexto: nadie lo vería.
    const clinica = await crearClinicaDePrueba(admin);
    const solo = await crearUsuarioDePrueba(admin, {
      clinicaId: clinica.clinicaId,
      estado: 'pendiente',
    });
    await enTransaccion(api, { usuario: solo.usuarioId }, async (c) => {
      const r = await intentar(c, "update app.usuario set nombre = 'Invisible' where id = $1", [
        solo.usuarioId,
      ]);
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
      if (!r.ok) expect(r.mensaje).toContain('ninguna clínica');
    });
  });

  it('audit_log ya no acepta filas sin clínica (CHECK)', async () => {
    const definicion = await enTransaccion(admin, {}, (c) =>
      valor<string>(
        c,
        `select pg_get_constraintdef(oid) from pg_constraint
         where conname = 'audit_log_clinica_check' and conrelid = 'app.audit_log'::regclass`,
      ),
    );
    expect(definicion).toBe('CHECK ((clinica_id IS NOT NULL)) NOT VALID');
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
        ["update app.audit_log set modulo = 'inicio' where clinica_id = $1", [a.clinicaId]],
        [
          "update app.audit_log set usuario_nombre = 'Otra persona' where clinica_id = $1",
          [a.clinicaId],
        ],
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

  it('el trigger rechaza UPDATE, DELETE y TRUNCATE también al dueño de la tabla (sigue activo después de 0007)', async () => {
    await enTransaccion(admin, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
      expect(
        await valor(
          c,
          `select tgenabled::text from pg_trigger
           where tgrelid = 'app.audit_log'::regclass and tgname = 'audit_log_solo_insercion'`,
        ),
      ).toBe('O');
      expect(
        await valor(
          c,
          "select relforcerowsecurity from pg_class where oid = 'app.audit_log'::regclass",
        ),
      ).toBe(true);
      for (const texto of [
        "update app.audit_log set accion = 'ver' where id = $1",
        "update app.audit_log set modulo = 'inicio', sede_id = null where id = $1",
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
  it('registra ver/exportar/enviar con clínica, usuario, nombre, IP, módulo y sede salidos de la base', async () => {
    const nombre = await nombreDe(a, a.duenoId);
    await comoA(async (c) => {
      const id = await valor<string>(
        c,
        "select app.registrar_evento('exportar', 'sillon', $1, $2)",
        [a.sillonId, { formato: 'csv', filas: 12 }],
      );
      expect(await filaAudit(c, id)).toEqual({
        clinica_id: a.clinicaId,
        usuario_id: a.duenoId,
        usuario_nombre: nombre,
        entidad: 'sillon',
        entidad_id: a.sillonId,
        accion: 'exportar',
        modulo: 'sedes',
        sede_id: a.sedeId,
        antes: null,
        despues: { formato: 'csv', filas: 12 },
        ip: IP,
      });
      const verRol = await valor<string>(c, "select app.registrar_evento('ver', 'rol', $1)", [
        a.rolId,
      ]);
      expect(await filaAudit(c, verRol)).toMatchObject({ modulo: 'configuracion', sede_id: null });
      const verPersona = await valor<string>(
        c,
        "select app.registrar_evento('ver', 'usuario', $1)",
        [a.usuarioId],
      );
      expect(await filaAudit(c, verPersona)).toMatchObject({ modulo: 'personal', sede_id: null });
    });
  });

  it('un evento sobre un conjunto puede llevar sede (de la clínica); uno sobre un registro, solo la suya', async () => {
    await comoA(async (c) => {
      const conjunto = await valor<string>(
        c,
        "select app.registrar_evento('exportar', 'sillon', null, null, $1)",
        [a.sedeId],
      );
      expect(await filaAudit(c, conjunto)).toMatchObject({
        entidad_id: null,
        sede_id: a.sedeId,
        modulo: 'sedes',
      });
      const mismaSede = await intentar(
        c,
        "select app.registrar_evento('ver', 'sillon', $1, null, $2)",
        [a.sillonId, a.sedeId],
      );
      expect(mismaSede).toMatchObject({ ok: true });
      const otraSede = await valor<string>(
        c,
        "insert into app.sede (clinica_id, nombre) values ($1, 'Otra sede evento') returning id",
        [a.clinicaId],
      );
      for (const [texto, parametros] of [
        // Sede que no es la del registro.
        ["select app.registrar_evento('ver', 'sillon', $1, null, $2)", [a.sillonId, otraSede]],
        // Registro sin sede con una sede.
        ["select app.registrar_evento('ver', 'rol', $1, null, $2)", [a.rolId, a.sedeId]],
        // Sede de otra clínica.
        ["select app.registrar_evento('exportar', 'sillon', null, null, $1)", [b.sedeId]],
      ] as const) {
        expect(await intentar(c, texto, [...parametros])).toMatchObject({
          ok: false,
          codigo: '22023',
        });
      }
    });
  });

  it('no acepta crear/editar/anular, entidades que no son tablas auditadas ni registros inexistentes o de otra clínica', async () => {
    await comoA(async (c) => {
      for (const accion of ['crear', 'editar', 'anular', 'borrar', '', 'INGRESAR']) {
        const r = await intentar(c, "select app.registrar_evento($1, 'sede')", [accion]);
        expect({ accion, r }).toMatchObject({ accion, r: { ok: false, codigo: '22023' } });
      }
      for (const entidad of [
        'Sede; drop table x',
        // Hoy cualquiera de estos pasaba: «exportar paciente» falso con cualquier texto.
        'paciente',
        'cualquier_cosa',
        // Tablas que no se auditan fila por fila.
        'numerador',
        'audit_log',
        'migracion',
      ]) {
        const r = await intentar(c, "select app.registrar_evento('exportar', $1)", [entidad]);
        expect({ entidad, r }).toMatchObject({ entidad, r: { ok: false, codigo: '22023' } });
      }
      for (const [entidad, id] of [
        ['sede', randomUUID()],
        ['sede', b.sedeId],
        ['sillon', b.sillonId],
        ['usuario', b.duenoId],
        ['rol', b.rolId],
      ] as const) {
        const r = await intentar(c, "select app.registrar_evento('ver', $1, $2)", [entidad, id]);
        expect({ entidad, id, r }).toMatchObject({
          entidad,
          id,
          r: { ok: false, codigo: '22023' },
        });
      }
      // Ver a una persona con invitación pendiente: no es visible, no se registra.
      const pendiente = await crearUsuarioDePrueba(admin, {
        clinicaId: a.clinicaId,
        estado: 'pendiente',
      });
      expect(
        await intentar(c, "select app.registrar_evento('ver', 'usuario', $1)", [
          pendiente.usuarioId,
        ]),
      ).toMatchObject({ ok: false, codigo: '22023' });
    });
  });

  it('limita el detalle a un objeto JSON de hasta 4096 bytes', async () => {
    await comoA(async (c) => {
      const grande = { texto: 'x'.repeat(4100) };
      for (const detalle of [grande, [1, 2, 3], 'texto', 42, null]) {
        const r = await intentar(c, "select app.registrar_evento('ver', 'sede', $1, $2::jsonb)", [
          a.sedeId,
          JSON.stringify(detalle),
        ]);
        expect({ detalle: typeof detalle, r }).toMatchObject({ r: { ok: false, codigo: '22023' } });
      }
      const justo = { texto: 'x'.repeat(4000) };
      expect(
        await intentar(c, "select app.registrar_evento('ver', 'sede', $1, $2)", [a.sedeId, justo]),
      ).toMatchObject({ ok: true });
    });
  });

  it('exige que el usuario del contexto sea miembro activo de la clínica del contexto', async () => {
    const inactivo = await crearUsuarioDePrueba(admin, {
      clinicaId: a.clinicaId,
      estado: 'inactivo',
    });
    const pendiente = await crearUsuarioDePrueba(admin, {
      clinicaId: a.clinicaId,
      estado: 'pendiente',
    });
    const casos: [string, { clinica: string; usuario: string }][] = [
      ['usuario de B con clínica A', { clinica: a.clinicaId, usuario: b.duenoId }],
      ['usuario inexistente', { clinica: a.clinicaId, usuario: randomUUID() }],
      ['membresía inactiva', { clinica: a.clinicaId, usuario: inactivo.usuarioId }],
      ['membresía pendiente', { clinica: a.clinicaId, usuario: pendiente.usuarioId }],
    ];
    for (const [nombre, contexto] of casos) {
      await enTransaccion(api, contexto, async (c) => {
        const r = await intentar(c, "select app.registrar_evento('ver', 'sede', $1)", [a.sedeId]);
        expect({ nombre, r }).toMatchObject({ nombre, r: { ok: false, codigo: '42501' } });
      });
    }
  });

  it('rechaza si la clínica del contexto está dada de baja', async () => {
    const baja = await poblarClinica(admin);
    await enTransaccion(
      admin,
      { clinica: baja.clinicaId, usuario: baja.duenoId },
      (c) => c.query('update app.clinica set activo = false where id = $1', [baja.clinicaId]),
      { confirmar: true },
    );
    await enTransaccion(api, { clinica: baja.clinicaId, usuario: baja.duenoId }, async (c) => {
      const r = await intentar(c, "select app.registrar_evento('ver', 'sede', $1)", [baja.sedeId]);
      expect(r).toMatchObject({ ok: false, codigo: '42501' });
      if (!r.ok) expect(r.mensaje).toContain('no está activa');
    });
  });
});

describe("registrar_evento('ingresar', 'sesion', …)", () => {
  it('registra el ingreso de una sesión abierta propia, una sola vez por clínica, en el módulo personal', async () => {
    const sesionId = randomUUID();
    await comoA(async (c) => {
      expect(await valor(c, 'select app.tocar_sesion($1, 30)', [sesionId])).toBe('nueva');
      const id = await valor<string>(c, "select app.registrar_evento('ingresar', 'sesion', $1)", [
        sesionId,
      ]);
      expect(await filaAudit(c, id)).toMatchObject({
        clinica_id: a.clinicaId,
        usuario_id: a.duenoId,
        entidad: 'sesion',
        entidad_id: sesionId,
        accion: 'ingresar',
        modulo: 'personal',
        sede_id: null,
        ip: IP,
      });
      // Un reintento no duplica: devuelve la misma fila.
      expect(
        await valor(c, "select app.registrar_evento('ingresar', 'sesion', $1)", [sesionId]),
      ).toBe(id);
    });
  });

  it('no registra ingresos falsos: sin sesión, sesión ajena, cerrada, con sede, o ingresar sobre otra cosa', async () => {
    const ajena = randomUUID();
    await enTransaccion(
      api,
      { clinica: b.clinicaId, usuario: b.duenoId },
      (c) => c.query('select app.tocar_sesion($1, 30)', [ajena]),
      { confirmar: true },
    );
    const cerrada = randomUUID();
    await comoA(async (c) => {
      await c.query('select app.cerrar_sesion($1)', [cerrada]);
      const abierta = randomUUID();
      await c.query('select app.tocar_sesion($1, 30)', [abierta]);
      const intentos: [string, unknown[]][] = [
        ["select app.registrar_evento('ingresar', 'sesion')", []],
        ["select app.registrar_evento('ingresar', 'sesion', $1)", [randomUUID()]],
        ["select app.registrar_evento('ingresar', 'sesion', $1)", [ajena]],
        ["select app.registrar_evento('ingresar', 'sesion', $1)", [cerrada]],
        ["select app.registrar_evento('ingresar', 'sesion', $1, null, $2)", [abierta, a.sedeId]],
        ["select app.registrar_evento('ingresar', 'sede', $1)", [a.sedeId]],
        ["select app.registrar_evento('ver', 'sesion', $1)", [abierta]],
      ];
      for (const [texto, parametros] of intentos) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: { ok: false, codigo: '22023' },
        });
      }
    });
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
        usuario_nombre: null,
        modulo: 'configuracion',
      });
      const dueno = await auditoriaDe(c, a.duenoId);
      expect(dueno[0]).toMatchObject({
        accion: 'crear',
        entidad: 'usuario',
        clinica_id: a.clinicaId,
        usuario_id: a.duenoId,
        modulo: 'personal',
      });
      expect(dueno[0]?.usuario_nombre).toBeTruthy();
      const roles = await valor<number>(
        c,
        "select count(*)::int from app.audit_log where clinica_id = $1 and entidad = 'rol' and accion = 'crear'",
        [a.clinicaId],
      );
      expect(roles).toBe(5);
    });
  });
});
