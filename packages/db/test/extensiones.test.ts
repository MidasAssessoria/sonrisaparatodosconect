/**
 * Comprobación (sin usarlas todavía en las migraciones): btree_gist (agenda, Sprint 5), pg_trgm y
 * unaccent (búsqueda de pacientes, Sprint 3). Se crean en una base temporal con el rol de
 * migraciones, que no es superusuario: las tres son «trusted» desde Postgres 13.
 */
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearBaseVacia, type BaseVacia } from '../src/pruebas/index.js';
import { urls } from './ayudas.js';

let base: BaseVacia | undefined;
afterAll(async () => {
  await base?.eliminar();
});

describe('extensiones necesarias en sprints futuros', () => {
  it('btree_gist, pg_trgm y unaccent se instalan sin superusuario y funcionan', async () => {
    base = await crearBaseVacia(urls());
    const cliente = new pg.Client({ connectionString: base.urlAdmin });
    await cliente.connect();
    try {
      const disponibles = await cliente.query<{ name: string; trusted: boolean }>(
        `select e.name, coalesce(v.trusted, false) as trusted
         from pg_available_extensions e
         left join pg_available_extension_versions v on v.name = e.name and v.version = e.default_version
         where e.name in ('btree_gist', 'pg_trgm', 'unaccent') order by 1`,
      );
      expect(disponibles.rows).toEqual([
        { name: 'btree_gist', trusted: true },
        { name: 'pg_trgm', trusted: true },
        { name: 'unaccent', trusted: true },
      ]);
      for (const extension of ['btree_gist', 'pg_trgm', 'unaccent']) {
        await cliente.query(`create extension ${extension}`);
      }
      const { rows } = await cliente.query<{ sin_tildes: string; parecido: boolean }>(
        "select unaccent('Asunción · Giménez · Ñemby') as sin_tildes, similarity('gimenez', 'giménez') > 0.3 as parecido",
      );
      expect(rows[0]).toEqual({ sin_tildes: 'Asuncion · Gimenez · Nemby', parecido: true });
      // Restricción de exclusión como la de la agenda: mismo profesional, rangos que se pisan.
      await cliente.query(`create table turno_prueba (
        profesional_id uuid not null, rango tstzrange not null,
        exclude using gist (profesional_id with =, rango with &&))`);
      await cliente.query(
        `insert into turno_prueba values ('00000000-0000-4000-8000-000000000001', '[2026-01-01 10:00, 2026-01-01 10:30)')`,
      );
      await expect(
        cliente.query(
          `insert into turno_prueba values ('00000000-0000-4000-8000-000000000001', '[2026-01-01 10:15, 2026-01-01 10:45)')`,
        ),
      ).rejects.toMatchObject({ code: '23P01' });
    } finally {
      await cliente.end();
    }
  });
});
