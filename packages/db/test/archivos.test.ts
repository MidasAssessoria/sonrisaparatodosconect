/**
 * Archivos (0013), como app_api: módulo generado desde la categoría (el cliente no lo elige),
 * metadatos inmutables salvo la baja, ruta dentro de la carpeta de la clínica, autor fijado por la
 * base, y auditoría (también la de app.registrar_evento) con el módulo de cada archivo.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  crearArchivoDePrueba,
  crearClinicaDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;
let sedeA: string;

beforeAll(async () => {
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
  sedeA = (await crearSedeDePrueba(admin, A.clinicaId)).sedeId;
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: A.clinicaId, usuario: A.duenoId }, fn);

const sha = (): string => randomBytes(32).toString('hex');
const ruta = (clinica: string, resto = `${randomUUID()}.png`): string =>
  `${clinica}/logo_clinica/${resto}`;

const SQL_ALTA = `insert into app.archivo (clinica_id, categoria, sede_id, almacen, bucket, ruta,
                    nombre_original, tipo, bytes, ancho, alto, sha256)
                  values ($1, $2, $3, 'supabase', 'archivos', $4, 'firma.png', 'image/png', 1024, 300, 100, $5)
                  returning id, modulo, subido_por`;

describe('archivo', () => {
  it('el módulo sale de la categoría y el autor del contexto (no los elige el cliente)', async () => {
    type Alta = { id: string; modulo: string; subido_por: string | null };
    await comoA(async (c) => {
      const firma = await c.query<Alta>(SQL_ALTA, [
        A.clinicaId,
        'firma_profesional',
        null,
        ruta(A.clinicaId),
        sha(),
      ]);
      expect(firma.rows[0]).toMatchObject({ modulo: 'personal', subido_por: A.duenoId });
      const logo = await c.query<Alta>(SQL_ALTA, [
        A.clinicaId,
        'logo_clinica',
        sedeA,
        ruta(A.clinicaId),
        sha(),
      ]);
      expect(logo.rows[0]).toMatchObject({ modulo: 'configuracion', subido_por: A.duenoId });
      // modulo es generada: no se escribe ni al crear ni al editar.
      expect(
        await intentar(
          c,
          `insert into app.archivo (clinica_id, categoria, modulo, almacen, bucket, ruta, nombre_original, tipo, bytes, sha256)
           values ($1, 'firma_profesional', 'inicio', 'local', 'b', $2, 'x.png', 'image/png', 1, $3)`,
          [A.clinicaId, ruta(A.clinicaId), sha()],
        ),
      ).toMatchObject(rechazo('428C9'));
      expect(
        await intentar(c, "update app.archivo set modulo = 'inicio' where id = $1", [
          firma.rows[0]?.id,
        ]),
      ).toMatchObject({ ok: false });
      // subido_por falso: lo pisa la base.
      const otro = await crearUsuarioDePrueba(admin, { clinicaId: A.clinicaId });
      const conAutor = await c.query<Alta>(
        `insert into app.archivo (clinica_id, categoria, almacen, bucket, ruta, nombre_original, tipo, bytes, sha256, subido_por)
         values ($1, 'logo_clinica', 'local', 'b', $2, 'x.png', 'image/png', 1, $3, $4) returning subido_por`,
        [A.clinicaId, ruta(A.clinicaId), sha(), otro.usuarioId],
      );
      expect(conAutor.rows[0]?.subido_por).toBe(A.duenoId);
      // Categoría, almacén, tipo, tamaño y hash validados.
      for (const [nombre, sql, parametros, restriccion] of [
        [
          'categoría',
          SQL_ALTA,
          [A.clinicaId, 'radiografia', null, ruta(A.clinicaId), sha()],
          'archivo_categoria_check',
        ],
        [
          'hash',
          SQL_ALTA,
          [A.clinicaId, 'logo_clinica', null, ruta(A.clinicaId), 'ABC'],
          'archivo_sha256_check',
        ],
        [
          'almacén',
          SQL_ALTA.replace("'supabase'", "'s3'"),
          [A.clinicaId, 'logo_clinica', null, ruta(A.clinicaId), sha()],
          'archivo_almacen_check',
        ],
        [
          'bytes',
          SQL_ALTA.replace('1024', '0'),
          [A.clinicaId, 'logo_clinica', null, ruta(A.clinicaId), sha()],
          'archivo_bytes_check',
        ],
      ] as const) {
        expect({ nombre, r: await intentar(c, sql, [...parametros]) }).toMatchObject({
          nombre,
          r: rechazo('23514', restriccion),
        });
      }
    });
  });

  it('la ruta va dentro de la carpeta de la clínica, sin saltos de carpeta, y es única', async () => {
    await comoA(async (c) => {
      const alta = (r: string) =>
        intentar(c, SQL_ALTA, [A.clinicaId, 'logo_clinica', null, r, sha()]);
      for (const mala of [
        ruta(B.clinicaId),
        `${A.clinicaId}/../${B.clinicaId}/logo.png`,
        `${A.clinicaId}/./logo.png`,
        `${A.clinicaId}//logo.png`,
        `${A.clinicaId}/logo con espacio.png`,
        `/${A.clinicaId}/logo.png`,
        `${A.clinicaId}/${'a'.repeat(500)}.png`,
        'logo.png',
      ]) {
        expect({ mala, r: await alta(mala) }).toMatchObject({
          mala,
          r: rechazo('23514', 'archivo_ruta_check'),
        });
      }
      const buena = ruta(A.clinicaId);
      expect(await alta(buena)).toMatchObject({ ok: true });
      expect(await alta(buena)).toMatchObject(rechazo('23505', 'archivo_ruta_key'));
    });
  });

  it('los metadatos son inmutables: solo se da de baja, con motivo', async () => {
    const { archivoId } = await crearArchivoDePrueba(admin, {
      clinicaId: A.clinicaId,
      categoria: 'firma_profesional',
    });
    await comoA(async (c) => {
      for (const set of [
        "categoria = 'logo_clinica'",
        `ruta = '${ruta(A.clinicaId)}'`,
        `sha256 = '${sha()}'`,
        'bytes = 1',
        "tipo = 'image/jpeg'",
        "nombre_original = 'otro.png'",
        `sede_id = '${sedeA}'`,
        "bucket = 'otro'",
        "almacen = 'supabase'",
        'ancho = 1',
        `subido_por = '${A.duenoId}'`,
      ]) {
        const r = await intentar(c, `update app.archivo set ${set} where id = $1`, [archivoId]);
        expect({ set, r }).toMatchObject({ set, r: rechazo('42501') });
      }
      expect(
        await intentar(c, 'update app.archivo set deleted_at = now() where id = $1', [archivoId]),
      ).toMatchObject(rechazo('23514', 'archivo_baja_check'));
      expect(
        await intentar(
          c,
          "update app.archivo set deleted_at = now(), motivo_baja = 'Firma vieja' where id = $1",
          [archivoId],
        ),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
  });

  it('la auditoría de cada archivo lleva el módulo de su categoría (alta, baja y ver)', async () => {
    await comoA(async (c) => {
      const firma = await valor<string>(
        c,
        'insert into app.archivo (clinica_id, categoria, almacen, bucket, ruta, nombre_original, tipo, bytes, sha256) ' +
          "values ($1, 'firma_profesional', 'local', 'b', $2, 'x.png', 'image/png', 1, $3) returning id",
        [A.clinicaId, ruta(A.clinicaId), sha()],
      );
      const logo = await valor<string>(
        c,
        'insert into app.archivo (clinica_id, categoria, sede_id, almacen, bucket, ruta, nombre_original, tipo, bytes, sha256) ' +
          "values ($1, 'logo_clinica', $2, 'local', 'b', $3, 'x.png', 'image/png', 1, $4) returning id",
        [A.clinicaId, sedeA, ruta(A.clinicaId), sha()],
      );
      await c.query(
        "update app.archivo set deleted_at = now(), motivo_baja = 'Reemplazada' where id = $1",
        [firma],
      );
      const verFirma = await valor<string>(c, "select app.registrar_evento('ver', 'archivo', $1)", [
        firma,
      ]);
      const verLogo = await valor<string>(c, "select app.registrar_evento('ver', 'archivo', $1)", [
        logo,
      ]);
      const { rows } = await c.query<{
        id: string;
        entidad_id: string;
        accion: string;
        modulo: string;
        sede_id: string | null;
      }>(
        `select id, entidad_id, accion, modulo, sede_id from app.audit_log
         where entidad = 'archivo' and entidad_id = any($1) order by fecha`,
        [[firma, logo]],
      );
      expect(
        rows.map((f) => [f.entidad_id === firma ? 'firma' : 'logo', f.accion, f.modulo, f.sede_id]),
      ).toEqual([
        ['firma', 'crear', 'personal', null],
        ['logo', 'crear', 'configuracion', sedeA],
        ['firma', 'anular', 'personal', null],
        ['firma', 'ver', 'personal', null],
        ['logo', 'ver', 'configuracion', sedeA],
      ]);
      expect(rows.find((f) => f.id === verFirma)?.modulo).toBe('personal');
      expect(rows.find((f) => f.id === verLogo)?.modulo).toBe('configuracion');
      // Un evento sobre «todos los archivos» no tiene un módulo único: se rechaza.
      expect(await intentar(c, "select app.registrar_evento('exportar', 'archivo')")).toMatchObject(
        rechazo('22023'),
      );
    });
  });

  it('los archivos de otra clínica no se ven, no se dan de baja y no se auditan como vistos', async () => {
    const { archivoId } = await crearArchivoDePrueba(admin, { clinicaId: B.clinicaId });
    await comoA(async (c) => {
      expect(
        await valor(c, 'select count(*)::int from app.archivo where id = $1', [archivoId]),
      ).toBe(0);
      expect(
        await intentar(
          c,
          "update app.archivo set deleted_at = now(), motivo_baja = 'x' where id = $1",
          [archivoId],
        ),
      ).toMatchObject({ ok: true, cantidad: 0 });
      expect(
        await intentar(c, "select app.registrar_evento('ver', 'archivo', $1)", [archivoId]),
      ).toMatchObject(rechazo('22023'));
    });
  });
});
