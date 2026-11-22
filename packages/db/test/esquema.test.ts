/** El esquema Drizzle (escrito a mano) coincide con la base que dejan las migraciones. */
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { esquema } from '../src/esquema.js';
import { enTransaccion, nuevoPool, urls } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);

interface ColumnaBase {
  tabla: string;
  columna: string;
  tipo: string;
  no_nulo: boolean;
  /** Default propiamente dicho (una columna generada no cuenta). */
  con_default: boolean;
  /** GENERATED ALWAYS AS (…) STORED. */
  generada: boolean;
}

const EQUIVALENCIAS: Record<string, string> = {
  time: 'time without time zone',
  timestamp: 'timestamp without time zone',
};

function columnasDrizzle(): ColumnaBase[] {
  return Object.values(esquema).flatMap((tabla: PgTable) => {
    const config = getTableConfig(tabla);
    expect(config.schema).toBe('app');
    return config.columns.map((columna) => {
      const tipo = columna.getSQLType();
      return {
        tabla: config.name,
        columna: columna.name,
        tipo: EQUIVALENCIAS[tipo] ?? tipo,
        no_nulo: columna.notNull,
        con_default: columna.hasDefault,
        generada: columna.generated !== undefined,
      };
    });
  });
}

async function columnasBase(): Promise<ColumnaBase[]> {
  return enTransaccion(admin, {}, async (c) => {
    const { rows } = await c.query<ColumnaBase>(
      `select cl.relname as tabla, a.attname as columna, format_type(a.atttypid, a.atttypmod) as tipo,
              a.attnotnull as no_nulo, (a.atthasdef and a.attgenerated = '') as con_default,
              a.attgenerated <> '' as generada
       from pg_attribute a join pg_class cl on cl.oid = a.attrelid
       join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = 'app' and cl.relkind in ('r', 'p') and cl.relname <> 'migracion'
         and a.attnum > 0 and not a.attisdropped`,
    );
    return rows;
  });
}

const clave = (c: ColumnaBase): string => `${c.tabla}.${c.columna}`;

describe('esquema Drizzle vs. base', () => {
  it('toda tabla y columna de Drizzle existe en la base con el mismo tipo, nulabilidad y default', async () => {
    const enBase = new Map((await columnasBase()).map((c) => [clave(c), c]));
    for (const columna of columnasDrizzle()) {
      expect(enBase.get(clave(columna)), clave(columna)).toEqual(columna);
    }
  });

  it('la base no tiene tablas ni columnas que falten en Drizzle', async () => {
    const enDrizzle = new Set(columnasDrizzle().map(clave));
    const faltan = (await columnasBase()).map(clave).filter((c) => !enDrizzle.has(c));
    expect(faltan).toEqual([]);
  });
});
