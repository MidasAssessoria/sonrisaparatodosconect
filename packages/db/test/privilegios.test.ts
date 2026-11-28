/** Lo que app_api NO puede hacer, aunque tenga una sesión SQL completa. */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';
import { poblarClinica, type DatosClinica } from './escenario.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let a: DatosClinica;
let duenoDeTablas: string;

beforeAll(async () => {
  a = await poblarClinica(admin);
  duenoDeTablas = await enTransaccion(admin, {}, (c) =>
    valor<string>(
      c,
      "select pg_get_userbyid(relowner) from pg_class where oid = 'app.sede'::regclass",
    ),
  );
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: a.clinicaId, usuario: a.duenoId }, fn);

async function rechazada(texto: string, codigos = ['42501']): Promise<void> {
  await comoA(async (c) => {
    const r = await intentar(c, texto);
    expect({ texto, ok: r.ok }).toEqual({ texto, ok: false });
    if (!r.ok) expect(codigos, `${texto} -> ${r.codigo} ${r.mensaje}`).toContain(r.codigo);
  });
}

describe('app_api no puede cambiar el esquema ni las políticas', () => {
  it.each([
    'alter table app.sede disable row level security',
    'alter table app.sede no force row level security',
    'alter table app.sede add column x int',
    'alter table app.sede drop constraint sede_clinica_id_id_key',
    'alter table app.sede owner to app_api',
    'alter table app.sede disable trigger sede_sin_borrado',
    'alter table app.audit_log disable trigger all',
    'drop table app.audit_log',
    'drop policy sede_aislamiento on app.sede',
    'alter policy sede_aislamiento on app.sede using (true)',
    'create policy abierta on app.sede using (true)',
    'create table app.robada (id int)',
    'create table public.robada (id int)',
    'create schema propio',
    'create view app.v as select * from app.sede',
    'create function app.f() returns int language sql return 1',
    'create or replace function app.clinica_actual() returns uuid language sql return null',
    'alter function app.clinica_actual() owner to app_api',
    'drop function app.clinica_actual()',
    'create trigger t before insert on app.sede for each row execute function app.fijar_auditoria_fila()',
    'create temp table hija () inherits (app.sede)',
    'create temp table referencia (x uuid references app.sede (id))',
    'truncate app.sede',
    'comment on table app.sede is null',
  ])('rechaza: %s', async (texto) => {
    // Una tabla temporal no puede referenciar una permanente (42P16); y app_api no tiene REFERENCES
    // (lo verifica la meta-prueba) ni dónde crear una tabla permanente.
    await rechazada(texto, texto.includes('references') ? ['42501', '42P16'] : ['42501']);
  });
});

describe('app_api no puede escalar privilegios', () => {
  it('SET ROLE y SET SESSION AUTHORIZATION a un rol privilegiado', async () => {
    for (const rol of [duenoDeTablas, 'postgres']) {
      await rechazada(`set role ${rol}`, ['42501', '22023']);
      await rechazada(`set session authorization ${rol}`, ['42501', '22023']);
      await rechazada(`set local role ${rol}`, ['42501', '22023']);
    }
  });

  it.each([
    'alter role app_api bypassrls',
    'alter role app_api superuser',
    'alter role app_api createrole',
    'create role otro_rol',
    'grant pg_read_all_data to app_api',
    'grant pg_signal_backend to app_api',
    'create extension dblink',
    // btree_gist (0011) y pg_trgm (0019) ya están instaladas (crearlas de nuevo da 42710): se prueba con otras «trusted».
    'create extension btree_gin',
    'create extension unaccent',
  ])('rechaza: %s', async (texto) => {
    await rechazada(texto);
  });

  it('GRANT sobre tablas ajenas no concede nada', async () => {
    await comoA(async (c) => {
      // Postgres responde con un aviso, no con un error: lo importante es que no concede nada.
      await intentar(c, 'grant select on app.sede to public');
      await intentar(c, 'grant all on app.audit_log to app_api');
      expect(await valor(c, "select has_table_privilege('public', 'app.sede', 'SELECT')")).toBe(
        false,
      );
      expect(
        await valor(c, "select has_table_privilege('app_api', 'app.audit_log', 'INSERT')"),
      ).toBe(false);
    });
  });

  it('no puede leer archivos ni ejecutar programas del servidor', async () => {
    for (const texto of [
      "select pg_read_file('postgresql.conf')",
      "select pg_ls_dir('.')",
      "copy app.sede to program 'echo x'",
      "copy app.sede from '/etc/passwd'",
      "select lo_import('postgresql.conf')",
    ]) {
      await rechazada(texto);
    }
  });
});

describe('app_api no puede apagar RLS ni saltarse el contexto', () => {
  it('row_security = off hace fallar la consulta en vez de mostrar todo', async () => {
    await comoA(async (c) => {
      await c.query('set local row_security = off');
      expect(await intentar(c, 'select count(*) from app.sede')).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
  });

  it('no ejecuta alta_clinica ni las funciones internas', async () => {
    const id = randomUUID();
    for (const texto of [
      `select app.alta_clinica('Pirata', '${id}', 'Pirata', 'pirata@prueba.test')`,
      'select app.auditar()',
      'select app.fijar_auditoria_fila()',
      'select app.rechazar_borrado()',
      'select app.ip_actual()',
      'select app.proteger_acceso()',
      'select app.proteger_ultimo_dueno()',
      "select app.modulo_de_entidad('sede')",
      'call app.asegurar_permisos()',
    ]) {
      await rechazada(texto);
    }
  });

  it('las funciones SECURITY DEFINER no sirven para escribir sin contexto', async () => {
    await enTransaccion(api, {}, async (c) => {
      expect(await intentar(c, "select app.siguiente_numero('recibo')")).toMatchObject({
        ok: false,
        codigo: '42501',
      });
      expect(await intentar(c, "select app.registrar_evento('ver', 'paciente')")).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
    // Con solo el usuario (paso del login), tampoco.
    await enTransaccion(api, { usuario: a.duenoId }, async (c) => {
      expect(await intentar(c, "select app.siguiente_numero('recibo')")).toMatchObject({
        ok: false,
        codigo: '42501',
      });
      expect(await intentar(c, "select app.registrar_evento('ver', 'paciente')")).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
  });

  it('no puede borrar físicamente en ninguna tabla (DELETE sin privilegio)', async () => {
    await comoA(async (c) => {
      for (const tabla of [
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
        'invitacion',
        'profesional',
        'profesional_disponibilidad',
        'profesional_bloqueo',
        'tratamiento',
        'agenda_config',
        'archivo',
      ]) {
        expect({ tabla, r: await intentar(c, `delete from app.${tabla}`) }).toMatchObject({
          tabla,
          r: { ok: false, codigo: '42501' },
        });
      }
    });
  });

  it('el trigger rechaza el DELETE físico aunque lo intente el dueño de las tablas', async () => {
    await enTransaccion(admin, { clinica: a.clinicaId, usuario: a.duenoId }, async (c) => {
      for (const tabla of [
        'sede',
        'sillon',
        'membresia',
        'rol_permiso',
        'usuario',
        'clinica',
        'numerador',
        'sesion',
        'invitacion',
        'profesional_disponibilidad',
        'tratamiento',
        'archivo',
      ]) {
        const r = await intentar(c, `delete from app.${tabla} where false`);
        expect({ tabla, r }).toMatchObject({ tabla, r: { ok: false, codigo: '42501' } });
        if (!r.ok) expect(r.mensaje).toContain('no se borra nada');
      }
      // Una tabla sin FK que la referencien: con una (p. ej. sillon, desde 0011) Postgres rechaza el
      // TRUNCATE antes del trigger (0A000).
      expect(await intentar(c, 'truncate app.tratamiento')).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
  });
});
