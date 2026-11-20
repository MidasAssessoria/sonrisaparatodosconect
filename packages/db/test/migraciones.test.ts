/** Ejecutor de migraciones: orden, idempotencia, checksum, transacciones y concurrencia. */
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
      expect(rows[0]?.tablas).toBe(11);
    } finally {
      await cliente.end();
    }
  });
});
