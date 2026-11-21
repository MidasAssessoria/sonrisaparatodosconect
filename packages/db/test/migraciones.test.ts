/**
 * Ejecutor de migraciones: orden, idempotencia, checksum, transacciones y concurrencia. Y el paso de
 * una base con datos en 0005 (como el entorno real) a la versión actual.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  calcularChecksum,
  DIRECTORIO_MIGRACIONES,
  ErrorDeMigracion,
  leerMigraciones,
  migrar,
} from '../src/migrar.js';
import { crearBaseVacia, type BaseVacia } from '../src/pruebas/index.js';
import { urls } from './ayudas.js';

const bases: BaseVacia[] = [];
const directorios: string[] = [];

/** Primeros 16 hex del SHA-256 de las migraciones aplicadas en el entorno real. No se tocan. */
const CHECKSUMS_APLICADOS: Record<string, string> = {
  '0001_base.sql': 'b7a32d0d27f61e59',
  '0002_auditoria.sql': '2f0428b7f3e13058',
  '0003_organizacion.sql': '1351f221cca67845',
  '0004_numerador.sql': '7016d63570f7ba54',
  '0005_alta_clinica.sql': '3ab2bd4205aae9f1',
};

afterAll(async () => {
  await Promise.all(bases.map((b) => b.eliminar()));
  await Promise.all(directorios.map((d) => rm(d, { recursive: true, force: true })));
});

async function baseNueva(): Promise<BaseVacia> {
  const base = await crearBaseVacia(urls());
  bases.push(base);
  return base;
}

/** Copia de las migraciones reales en un directorio temporal, para modificarlas. */
async function copiaDeMigraciones(): Promise<string> {
  const destino = await mkdtemp(path.join(tmpdir(), 'conecta-migraciones-'));
  directorios.push(destino);
  await cp(DIRECTORIO_MIGRACIONES, destino, { recursive: true });
  return destino;
}

async function consultar<T>(url: string, texto: string): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return (await cliente.query(texto)).rows as T[];
  } finally {
    await cliente.end();
  }
}

describe('migraciones del repositorio', () => {
  it('tienen nombres NNNN_nombre.sql, números consecutivos desde 0001 y no usan BEGIN/COMMIT ni metacomandos', async () => {
    const migraciones = await leerMigraciones();
    expect(migraciones.map((m) => m.version)).toEqual(migraciones.map((_, i) => i + 1));
    for (const m of migraciones) {
      expect(m.sql, m.nombre).not.toMatch(/^\s*\\/m);
      expect(m.sql, m.nombre).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;/im);
      expect(m.sql.trimEnd().endsWith('CALL app.asegurar_permisos();'), m.nombre).toBe(true);
    }
  });

  it('el checksum no depende de los saltos de línea ni del BOM', () => {
    const conBom = `${String.fromCharCode(0xfeff)}select 1;\r\nselect 2;\r\n`;
    expect(calcularChecksum(conBom)).toBe(calcularChecksum('select 1;\nselect 2;\n'));
    expect(calcularChecksum('select 1;\n')).not.toBe(calcularChecksum('select 2;\n'));
  });
});

describe('migrar()', () => {
  it('aplica todo en orden en una base vacía, sin superusuario, y registra el checksum', async () => {
    const base = await baseNueva();
    const [rol] = await consultar<{ rolsuper: boolean }>(
      base.urlAdmin,
      'select rolsuper from pg_roles where rolname = current_user',
    );
    expect(rol?.rolsuper).toBe(false);
    const resultado = await migrar(base.urlAdmin);
    const enDisco = await leerMigraciones();
    expect(resultado).toEqual({ aplicadas: enDisco.map((m) => m.nombre), yaAplicadas: 0 });
    const registradas = await consultar<{ version: number; nombre: string; checksum: string }>(
      base.urlAdmin,
      'select version, nombre, checksum from app.migracion order by version',
    );
    expect(registradas).toEqual(
      enDisco.map(({ version, nombre, checksum }) => ({ version, nombre, checksum })),
    );
  });

  it('es idempotente: la segunda corrida no hace nada', async () => {
    const base = await baseNueva();
    await migrar(base.urlAdmin);
    const antes = await consultar(
      base.urlAdmin,
      'select version, aplicada_en from app.migracion order by 1',
    );
    const segunda = await migrar(base.urlAdmin);
    expect(segunda.aplicadas).toEqual([]);
    expect(segunda.yaAplicadas).toBe(antes.length);
    expect(
      await consultar(base.urlAdmin, 'select version, aplicada_en from app.migracion order by 1'),
    ).toEqual(antes);
  });

  it('dos corridas a la vez aplican cada migración una sola vez', async () => {
    const base = await baseNueva();
    const [uno, dos] = await Promise.all([migrar(base.urlAdmin), migrar(base.urlAdmin)]);
    const total = (await leerMigraciones()).length;
    expect(uno.aplicadas.length + dos.aplicadas.length).toBe(total);
    expect(Math.min(uno.aplicadas.length, dos.aplicadas.length)).toBe(0);
  });

  it('detecta una migración aplicada que cambió y no aplica nada', async () => {
    const base = await baseNueva();
    await migrar(base.urlAdmin);
    const directorio = await copiaDeMigraciones();
    const archivo = path.join(directorio, '0003_organizacion.sql');
    await writeFile(archivo, `${await readFile(archivo, 'utf8')}\n-- cambio posterior\n`);
    await writeFile(
      path.join(directorio, '0099_nueva.sql'),
      'create table app.no_deberia (id int);',
    );
    const error = await migrar(base.urlAdmin, { directorio }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeMigracion);
    expect((error as Error).message).toContain('0003_organizacion.sql cambió');
    expect(await consultar(base.urlAdmin, "select to_regclass('app.no_deberia') as t")).toEqual([
      { t: null },
    ]);
  });

  it('detecta una migración aplicada que desapareció o se renombró', async () => {
    const base = await baseNueva();
    await migrar(base.urlAdmin);
    const sinUna = await copiaDeMigraciones();
    await rm(path.join(sinUna, '0005_alta_clinica.sql'));
    await expect(migrar(base.urlAdmin, { directorio: sinUna })).rejects.toThrow(
      'ya no está en el directorio',
    );
    const renombrada = await copiaDeMigraciones();
    await cp(
      path.join(renombrada, '0005_alta_clinica.sql'),
      path.join(renombrada, '0005_otro_nombre.sql'),
    );
    await rm(path.join(renombrada, '0005_alta_clinica.sql'));
    await expect(migrar(base.urlAdmin, { directorio: renombrada })).rejects.toThrow(
      'ahora se llama',
    );
  });

  it('rechaza una migración nueva con número anterior a la última aplicada', async () => {
    const base = await baseNueva();
    await migrar(base.urlAdmin);
    const directorio = await copiaDeMigraciones();
    await writeFile(path.join(directorio, '0000_tarde.sql'), 'select 1;');
    await expect(migrar(base.urlAdmin, { directorio })).rejects.toThrow(
      'anterior a la última aplicada',
    );
  });

  it('aplica una migración nueva y, si una falla, la revierte entera y no la registra', async () => {
    const base = await baseNueva();
    await migrar(base.urlAdmin);
    const directorio = await copiaDeMigraciones();
    await writeFile(
      path.join(directorio, '0101_nueva.sql'),
      'create table app.nueva (id uuid primary key);\nCALL app.asegurar_permisos();\n',
    );
    await writeFile(
      path.join(directorio, '0102_falla.sql'),
      'create table app.parcial (id int);\nselect 1 / 0;\n',
    );
    const error = await migrar(base.urlAdmin, { directorio }).catch((e: unknown) => e);
    expect((error as Error).message).toContain('0102_falla.sql falló');
    const estado = await consultar(
      base.urlAdmin,
      `select to_regclass('app.nueva')::text as nueva, to_regclass('app.parcial')::text as parcial,
              (select max(version) from app.migracion) as ultima`,
    );
    expect(estado).toEqual([{ nueva: 'app.nueva', parcial: null, ultima: 101 }]);
  });

  it('rechaza archivos mal nombrados y números repetidos', async () => {
    const mal = await copiaDeMigraciones();
    await writeFile(path.join(mal, '6_sin_ceros.sql'), 'select 1;');
    await expect(leerMigraciones(mal)).rejects.toThrow('no sigue el formato');
    const repetida = await copiaDeMigraciones();
    await writeFile(path.join(repetida, '0002_otra.sql'), 'select 1;');
    await expect(leerMigraciones(repetida)).rejects.toThrow('mismo número');
  });

  it('las migraciones ya aplicadas en un entorno real (0001–0005) no cambian', async () => {
    // Checksums con los que están aplicadas: si alguien edita una, esta prueba lo frena antes que el
    // ejecutor en producción.
    const aplicadas: Record<string, string> = Object.fromEntries(
      (await leerMigraciones())
        .filter((m) => m.version <= 5)
        .map((m) => [m.nombre, m.checksum.slice(0, 16)]),
    );
    expect(Object.keys(aplicadas)).toEqual([
      '0001_base.sql',
      '0002_auditoria.sql',
      '0003_organizacion.sql',
      '0004_numerador.sql',
      '0005_alta_clinica.sql',
    ]);
    expect(aplicadas).toEqual(CHECKSUMS_APLICADOS);
  });

  it('cada migración se aplica sola como texto SQL plano, sin el ejecutor (como una herramienta externa)', async () => {
    const base = await baseNueva();
    const cliente = new pg.Client({ connectionString: base.urlAdmin });
    await cliente.connect();
    try {
      for (const migracion of await leerMigraciones()) {
        // Protocolo simple: todo el archivo en un solo envío, como lo haría psql -f o la API de Supabase.
        await cliente.query(migracion.sql);
      }
      const { rows } = await cliente.query<{ tablas: number }>(
        `select count(*)::int as tablas from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app' and c.relkind = 'r'`,
      );
      expect(rows[0]?.tablas).toBe(19);
    } finally {
      await cliente.end();
    }
  });
});

describe('de 0005 (con datos) a la versión actual', () => {
  interface FilaVieja {
    id: string;
    entidad: string;
    accion: string;
    modulo: string | null;
    sede_id: string | null;
    usuario_nombre: string | null;
    usuario_id: string | null;
  }

  it('rellena módulo, sede y autor de las filas viejas, copia los cambios sin clínica y deja la regla de solo inserción en pie', async () => {
    const base = await baseNueva();
    const hasta0005 = await copiaDeMigraciones();
    for (const m of await leerMigraciones()) {
      if (m.version > 5) await rm(path.join(hasta0005, m.nombre));
    }
    expect((await migrar(base.urlAdmin, { directorio: hasta0005 })).aplicadas).toHaveLength(5);

    const c1 = randomUUID();
    const c2 = randomUUID();
    const u = randomUUID();
    const cliente = new pg.Client({ connectionString: base.urlAdmin });
    await cliente.connect();
    // Cliente propio (sin pool): el contexto de sesión no se filtra a nadie más.
    const contexto = async (clinica: string | null, usuario: string | null): Promise<void> => {
      await cliente.query(
        "select set_config('app.clinica_id', $1, false), set_config('app.usuario_id', $2, false)",
        [clinica ?? '', usuario ?? ''],
      );
    };
    const uno = async <T>(texto: string, parametros: unknown[] = []): Promise<T> =>
      (await cliente.query(texto, parametros)).rows[0] as T;
    try {
      // --- Datos con el esquema de 0005 ---
      await cliente.query(
        "select app.alta_clinica('Clínica 1', $1, 'Nombre 1', $2, p_clinica_id => $3)",
        [u, `u-${u.slice(0, 8)}@prueba.test`, c1],
      );
      await cliente.query(
        "select app.alta_clinica('Clínica 2', $1, null, null, p_clinica_id => $2)",
        [u, c2],
      );
      await contexto(c1, u);
      const { id: sedeId } = await uno<{ id: string }>(
        "insert into app.sede (clinica_id, nombre) values ($1, 'Centro') returning id",
        [c1],
      );
      const { id: sillonId } = await uno<{ id: string }>(
        "insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, 'Sillón 1') returning id",
        [c1, sedeId],
      );
      await cliente.query("update app.usuario set nombre = 'Nombre 2' where id = $1", [u]);
      const { id: verSillon } = await uno<{ id: string }>(
        "select app.registrar_evento('ver', 'sillon', $1) as id",
        [sillonId],
      );
      const { id: exportarPaciente } = await uno<{ id: string }>(
        "select app.registrar_evento('exportar', 'paciente', $1, '{\"filas\": 3}') as id",
        [randomUUID()],
      );
      // Cambio de usuario sin clínica en el contexto: en 0005 queda con clinica_id NULL (invisible).
      await contexto(null, u);
      await cliente.query("update app.usuario set telefono = '0981 123 456' where id = $1", [u]);

      // --- Migraciones nuevas ---
      const resultado = await migrar(base.urlAdmin);
      expect(resultado.aplicadas).toEqual(
        (await leerMigraciones()).filter((m) => m.version > 5).map((m) => m.nombre),
      );

      await contexto(c1, u);
      const { rows } = await cliente.query<FilaVieja>(
        `select id, entidad, accion, modulo, sede_id, usuario_nombre, usuario_id
         from app.audit_log where clinica_id = $1 order by fecha, id`,
        [c1],
      );
      const de = (filtro: (f: FilaVieja) => boolean): FilaVieja[] => rows.filter(filtro);
      // Altas del sistema (clínica, roles, permisos, membresía): sin autor.
      expect(de((f) => f.entidad === 'clinica')[0]).toMatchObject({
        accion: 'crear',
        modulo: 'configuracion',
        usuario_id: null,
        usuario_nombre: null,
      });
      expect(de((f) => f.entidad === 'membresia')[0]).toMatchObject({ modulo: 'personal' });
      expect(
        de((f) => f.entidad === 'rol_permiso').every((f) => f.modulo === 'configuracion'),
      ).toBe(true);
      // El autor con el nombre que tenía en ese momento (historial de su fila de usuario).
      const usuarioFilas = de((f) => f.entidad === 'usuario');
      expect(usuarioFilas.map((f) => [f.accion, f.usuario_nombre, f.modulo])).toEqual([
        ['crear', 'Nombre 1', 'personal'],
        ['editar', 'Nombre 2', 'personal'],
        // La copia del cambio que había quedado sin clínica (al final: misma fecha, id nuevo).
        ['editar', 'Nombre 2', 'personal'],
      ]);
      expect(de((f) => f.entidad === 'sede')[0]).toMatchObject({
        modulo: 'sedes',
        sede_id: sedeId,
        usuario_nombre: 'Nombre 1',
      });
      expect(de((f) => f.entidad === 'sillon' && f.accion === 'crear')[0]).toMatchObject({
        modulo: 'sedes',
        sede_id: sedeId,
        usuario_nombre: 'Nombre 1',
      });
      // Un evento sobre un sillón toma la sede del alta del sillón, no del detalle.
      expect(rows.find((f) => f.id === verSillon)).toMatchObject({
        modulo: 'sedes',
        sede_id: sedeId,
        usuario_nombre: 'Nombre 2',
      });
      // Una entidad que no es tabla: sin módulo (nadie lo inventa).
      expect(rows.find((f) => f.id === exportarPaciente)).toMatchObject({
        modulo: null,
        sede_id: null,
        usuario_nombre: 'Nombre 2',
      });
      expect(rows.filter((f) => f.modulo === null).map((f) => f.id)).toEqual([exportarPaciente]);
      // 0008 dejó constancia de los roles que configuró (como el sistema).
      expect(
        de((f) => f.entidad === 'rol' && f.accion === 'editar').map((f) => [
          f.modulo,
          f.usuario_id,
        ]),
      ).toEqual([
        ['configuracion', null],
        ['configuracion', null],
        ['configuracion', null],
      ]);

      // La copia del cambio sin clínica está también en la clínica 2.
      await contexto(c2, u);
      const enC2 = await cliente.query<{ telefono: string; modulo: string }>(
        `select despues ->> 'telefono' as telefono, modulo from app.audit_log
         where clinica_id = $1 and entidad = 'usuario' and accion = 'editar'`,
        [c2],
      );
      expect(enC2.rows).toEqual([{ telefono: '0981 123 456', modulo: 'personal' }]);

      // Roles de sistema con sus datos nuevos.
      const roles = await cliente.query<{ codigo: string; datos: string }>(
        `select codigo, concat_ws('/', todas_las_sedes::text, exige_mfa::text, inactividad_min) as datos
         from app.rol where clinica_id = $1 order by codigo`,
        [c2],
      );
      expect(Object.fromEntries(roles.rows.map((r) => [r.codigo, r.datos]))).toEqual({
        administracion: 'true/true/30',
        asistente: 'false/false/30',
        dueno: 'true/true/30',
        odontologo: 'false/false/30',
        recepcion: 'false/false/15',
      });

      // La regla de solo inserción y el RLS forzado quedaron como estaban.
      const estado = await uno<{ trigger: string; forzadas: string[] }>(
        `select (select tgenabled::text from pg_trigger
                 where tgrelid = 'app.audit_log'::regclass and tgname = 'audit_log_solo_insercion') as trigger,
                array(select relname::text from pg_class
                      where relnamespace = 'app'::regnamespace and relkind = 'r'
                        and relname <> 'migracion' and not relforcerowsecurity) as forzadas`,
      );
      expect(estado).toEqual({ trigger: 'O', forzadas: [] });
      await expect(
        cliente.query("update app.audit_log set modulo = 'inicio' where id = $1", [verSillon]),
      ).rejects.toThrow('solo inserción');
    } finally {
      await cliente.end();
    }
  });
});

describe('de 0014 (con datos) a la versión actual', () => {
  it('corrige el doble factor de Administración, le da configuracion:crear, limpia lo que apunta a sedes de baja y quita token_hash de la auditoría, con la regla de solo inserción en pie', async () => {
    const base = await baseNueva();
    const hasta0014 = await copiaDeMigraciones();
    for (const m of await leerMigraciones()) {
      if (m.version > 14) await rm(path.join(hasta0014, m.nombre));
    }
    expect((await migrar(base.urlAdmin, { directorio: hasta0014 })).aplicadas).toHaveLength(14);

    const c1 = randomUUID();
    const c2 = randomUUID();
    const duena = randomUUID();
    const persona = randomUUID();
    const cliente = new pg.Client({ connectionString: base.urlAdmin });
    await cliente.connect();
    // Cliente propio (sin pool): el contexto de sesión no se filtra a nadie más.
    const contexto = async (clinica: string | null, usuario: string | null): Promise<void> => {
      await cliente.query(
        "select set_config('app.clinica_id', $1, false), set_config('app.usuario_id', $2, false)",
        [clinica ?? '', usuario ?? ''],
      );
    };
    const uno = async <T>(texto: string, parametros: unknown[] = []): Promise<T> =>
      (await cliente.query(texto, parametros)).rows[0] as T;
    try {
      // --- Datos con el esquema de 0014 ---
      await cliente.query(
        "select app.alta_clinica('Clínica 1', $1, 'Dueña', $2, p_clinica_id => $3)",
        [duena, `d-${duena.slice(0, 8)}@prueba.test`, c1],
      );
      await cliente.query(
        "select app.alta_clinica('Clínica 2', $1, null, null, p_clinica_id => $2)",
        [duena, c2],
      );
      await contexto(c1, null);
      // 1. Alguien con configuracion:editar le apagó el doble factor a Administración.
      await cliente.query(
        "update app.rol set exige_mfa = false where clinica_id = $1 and codigo = 'administracion'",
        [c1],
      );
      // 2. Una sede dada de baja con una persona, un tramo y un sillón que la apuntan.
      const { id: sede } = await uno<{ id: string }>(
        "insert into app.sede (clinica_id, nombre) values ($1, 'Norte') returning id",
        [c1],
      );
      const { id: sillon } = await uno<{ id: string }>(
        "insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, 'Sillón 1') returning id",
        [c1, sede],
      );
      await contexto(c1, persona);
      await cliente.query(
        "insert into app.usuario (id, nombre, email) values ($1, 'Persona', $2)",
        [persona, `p-${persona.slice(0, 8)}@prueba.test`],
      );
      await contexto(c1, null);
      const { id: membresia } = await uno<{ id: string }>(
        `insert into app.membresia (clinica_id, usuario_id, rol_id, estado, sede_defecto_id)
         select $1, $2, r.id, 'activo', $3 from app.rol r where r.clinica_id = $1 and r.codigo = 'recepcion'
         returning id`,
        [c1, persona, sede],
      );
      await cliente.query(
        'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
        [c1, membresia, sede],
      );
      const { id: profesional } = await uno<{ id: string }>(
        "insert into app.profesional (clinica_id, nombre, color) values ($1, 'Dra. X', '#18BFB0') returning id",
        [c1],
      );
      const { id: tramo } = await uno<{ id: string }>(
        `insert into app.profesional_disponibilidad
           (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin, sillon_id)
         values ($1, $2, $3, 1, '08:00', '12:00', $4) returning id`,
        [c1, profesional, sede, sillon],
      );
      await cliente.query(
        "update app.sede set deleted_at = now(), motivo_baja = 'Cerró' where id = $1",
        [sede],
      );
      // 3. Una invitación creada y anulada: en 0014 su auditoría guarda token_hash.
      const hash = randomBytes(32).toString('hex');
      const { id: pendiente } = await uno<{ id: string }>(
        `insert into app.membresia (clinica_id, rol_id)
         select $1, r.id from app.rol r where r.clinica_id = $1 and r.codigo = 'asistente'
         returning id`,
        [c1],
      );
      const { id: invitacion } = await uno<{ id: string }>(
        `insert into app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
         values ($1, $2, 'invitada@prueba.test', 'Invitada', $3, now() + interval '1 day') returning id`,
        [c1, pendiente, hash],
      );
      await cliente.query(
        "update app.invitacion set anulada_en = now(), motivo_anulacion = 'No viene' where id = $1",
        [invitacion],
      );
      expect(
        (
          await uno<{ n: number }>(
            "select count(*)::int as n from app.audit_log where entidad = 'invitacion' and despues ? 'token_hash'",
          )
        ).n,
      ).toBe(2);
      // 4. En la clínica 2, Administración ya tenía configuracion:crear, revocado a propósito.
      await contexto(c2, null);
      await cliente.query(
        `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion, activo)
         select $1, r.id, 'configuracion', 'crear', false from app.rol r
         where r.clinica_id = $1 and r.codigo = 'administracion'`,
        [c2],
      );

      // --- Migraciones nuevas ---
      const resultado = await migrar(base.urlAdmin);
      expect(resultado.aplicadas).toEqual(
        (await leerMigraciones()).filter((m) => m.version > 14).map((m) => m.nombre),
      );

      // 1 y 5. Doble factor y configuracion:crear de Administración.
      const administracion = async (clinica: string) => {
        await contexto(clinica, null);
        return uno<{ exige_mfa: boolean; crear: boolean | null }>(
          `select r.exige_mfa,
                  (select p.activo from app.rol_permiso p where p.rol_id = r.id
                   and p.modulo = 'configuracion' and p.accion = 'crear') as crear
           from app.rol r where r.clinica_id = $1 and r.codigo = 'administracion'`,
          [clinica],
        );
      };
      expect(await administracion(c1)).toEqual({ exige_mfa: true, crear: true });
      // La que la clínica había revocado no se toca.
      expect(await administracion(c2)).toEqual({ exige_mfa: true, crear: false });
      await contexto(c1, null);
      await expect(
        cliente.query(
          "update app.rol set exige_mfa = false where clinica_id = $1 and codigo = 'administracion'",
          [c1],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'rol_mfa_obligatorio' });
      // Los arreglos quedaron auditados como cambios del sistema.
      expect(
        await uno<{ editar_rol: number; crear_permiso: number }>(
          `select count(*) filter (where entidad = 'rol' and accion = 'editar'
                                    and despues ->> 'exige_mfa' = 'true' and usuario_id is null)::int as editar_rol,
                  count(*) filter (where entidad = 'rol_permiso' and accion = 'crear'
                                    and despues ->> 'modulo' = 'configuracion'
                                    and despues ->> 'accion' = 'crear'
                                    and despues ->> 'rol_id' = (
                                      select id::text from app.rol
                                      where clinica_id = $1 and codigo = 'administracion'))::int as crear_permiso
           from app.audit_log where clinica_id = $1`,
          [c1],
        ),
      ).toEqual({ editar_rol: 1, crear_permiso: 1 });

      // 2. Lo que apuntaba a la sede de baja, desactivado o vacío.
      expect(
        await uno(
          `select (select activo from app.usuario_sede where membresia_id = $1 and sede_id = $2) as usuario_sede,
                  (select sede_defecto_id from app.membresia where id = $1) as sede_defecto,
                  (select activo from app.profesional_disponibilidad where id = $3) as tramo,
                  (select activo from app.sillon where id = $4) as sillon`,
          [membresia, sede, tramo, sillon],
        ),
      ).toEqual({ usuario_sede: false, sede_defecto: null, tramo: false, sillon: false });

      // 8. La auditoría de la invitación ya no tiene el hash (ni en antes ni en después).
      expect(
        await uno<{ filas: number; con_hash: number }>(
          `select count(*)::int as filas,
                  count(*) filter (where antes ? 'token_hash' or despues ? 'token_hash'
                                   or coalesce(antes::text, '') || coalesce(despues::text, '') like $2)::int as con_hash
           from app.audit_log where entidad = 'invitacion' and entidad_id = $1`,
          [invitacion, `%${hash}%`],
        ),
      ).toEqual({ filas: 2, con_hash: 0 });

      // La regla de solo inserción y el RLS forzado quedaron como estaban.
      const estado = await uno<{ trigger: string; forzadas: string[] }>(
        `select (select tgenabled::text from pg_trigger
                 where tgrelid = 'app.audit_log'::regclass and tgname = 'audit_log_solo_insercion') as trigger,
                array(select relname::text from pg_class
                      where relnamespace = 'app'::regnamespace and relkind = 'r'
                        and relname <> 'migracion' and not relforcerowsecurity) as forzadas`,
      );
      expect(estado).toEqual({ trigger: 'O', forzadas: [] });
      await expect(
        cliente.query(
          "update app.audit_log set despues = '{}' where entidad = 'invitacion' and entidad_id = $1",
          [invitacion],
        ),
      ).rejects.toThrow('solo inserción');
    } finally {
      await cliente.end();
    }
  });
});
