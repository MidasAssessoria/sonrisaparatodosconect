/**
 * Catálogo de tratamientos y configuración de agenda (0012), como app_api: nombre único entre los
 * activos sin distinguir mayúsculas, tildes ni espacios; dinero en guaraníes enteros; IVA y duración
 * válidos; una configuración por sede.
 */
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  crearClinicaDePrueba,
  crearSedeDePrueba,
  crearTratamientoDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let A: ClinicaDePrueba;
let B: ClinicaDePrueba;

beforeAll(async () => {
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
});

const como = <T>(d: ClinicaDePrueba, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> =>
  enTransaccion(api, { clinica: d.clinicaId, usuario: d.duenoId }, fn);

const SQL_ALTA = `insert into app.tratamiento (clinica_id, nombre, precio, iva, duracion_min)
                  values ($1, $2, $3, $4, $5) returning id`;

describe('tratamiento', () => {
  it('nombre único entre los activos: sin distinguir mayúsculas, tildes ni espacios de más', async () => {
    await crearTratamientoDePrueba(admin, {
      clinicaId: A.clinicaId,
      nombre: 'Extracción de tercer molar',
    });
    await como(A, async (c) => {
      for (const nombre of [
        'Extracción de tercer molar',
        'EXTRACCION DE TERCER MOLAR',
        '  extraccíón   de tercer  molar ',
        'Extraccion de Tercer Molar',
      ]) {
        expect({
          nombre,
          r: await intentar(c, SQL_ALTA, [A.clinicaId, nombre, 600000, 10, 60]),
        }).toMatchObject({
          nombre,
          r: rechazo('23505', 'tratamiento_nombre_unico'),
        });
      }
      // La ñ es otra letra: «Año» y «Ano» son nombres distintos.
      expect(
        await intentar(c, SQL_ALTA, [A.clinicaId, 'Control del año', 1, 10, 30]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, SQL_ALTA, [A.clinicaId, 'Control del ano', 1, 10, 30]),
      ).toMatchObject({ ok: true });
    });
    // En otra clínica, el mismo nombre sí.
    await como(B, async (c) => {
      expect(
        await intentar(c, SQL_ALTA, [B.clinicaId, 'Extracción de tercer molar', 650000, 10, 60]),
      ).toMatchObject({ ok: true });
    });
  });

  it('desactivado deja libre el nombre; reactivarlo con un homónimo activo, no', async () => {
    const { tratamientoId } = await crearTratamientoDePrueba(admin, {
      clinicaId: A.clinicaId,
      nombre: 'Blanqueamiento',
    });
    await como(A, async (c) => {
      await c.query('update app.tratamiento set activo = false where id = $1', [tratamientoId]);
      expect(
        await intentar(c, SQL_ALTA, [A.clinicaId, 'blanqueamiento', 1100000, 10, 60]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, 'update app.tratamiento set activo = true where id = $1', [
          tratamientoId,
        ]),
      ).toMatchObject(rechazo('23505', 'tratamiento_nombre_unico'));
      expect(
        await valor(
          c,
          "select accion from app.audit_log where entidad = 'tratamiento' and entidad_id = $1 order by fecha desc limit 1",
          [tratamientoId],
        ),
      ).toBe('anular');
    });
  });

  it('precio en guaraníes enteros y no negativos; IVA 10, 5 o 0; duración múltiplo de 5 entre 5 y 480', async () => {
    await como(A, async (c) => {
      const casos: [string, unknown, unknown, unknown, string, string | null][] = [
        ['precio negativo', -1, 10, 30, '23514', 'tratamiento_precio_check'],
        ['precio con decimales', '150000.5', 10, 30, '22P02', null],
        ['precio con coma', '150.000,50', 10, 30, '22P02', null],
        ['precio fuera de bigint', '9223372036854775808', 10, 30, '22003', null],
        ['IVA 7', 1000, 7, 30, '23514', 'tratamiento_iva_check'],
        ['IVA 21', 1000, 21, 30, '23514', 'tratamiento_iva_check'],
        ['duración 0', 1000, 10, 0, '23514', 'tratamiento_duracion_check'],
        ['duración 7', 1000, 10, 7, '23514', 'tratamiento_duracion_check'],
        ['duración 485', 1000, 10, 485, '23514', 'tratamiento_duracion_check'],
        ['duración con decimales', 1000, 10, '30.5', '22P02', null],
      ];
      for (const [nombre, precio, iva, duracion, codigo, restriccion] of casos) {
        const r = await intentar(c, SQL_ALTA, [
          A.clinicaId,
          `Caso ${nombre}`,
          precio,
          iva,
          duracion,
        ]);
        expect({ nombre, r }).toMatchObject({
          nombre,
          r: restriccion ? rechazo(codigo, restriccion) : rechazo(codigo),
        });
      }
      for (const [precio, iva, duracion] of [
        [0, 0, 5],
        [999_999_999, 5, 480],
        ['45000', 10, 45],
      ] as const) {
        expect(
          await intentar(c, SQL_ALTA, [
            A.clinicaId,
            `Válido ${precio}-${iva}-${duracion}`,
            precio,
            iva,
            duracion,
          ]),
        ).toMatchObject({ ok: true });
      }
      // Lo guardado es un entero exacto.
      expect(
        await valor(
          c,
          "select pg_typeof(precio)::text from app.tratamiento where nombre = 'Válido 999999999-5-480'",
        ),
      ).toBe('bigint');
    });
  });

  it('cambiar un precio queda en la auditoría con antes y después (módulo configuracion)', async () => {
    const { tratamientoId } = await crearTratamientoDePrueba(admin, {
      clinicaId: A.clinicaId,
      precio: 250000,
    });
    await como(A, async (c) => {
      await c.query('update app.tratamiento set precio = 280000 where id = $1', [tratamientoId]);
      const { rows } = await c.query(
        `select modulo, antes ->> 'precio' as antes, despues ->> 'precio' as despues
         from app.audit_log where entidad_id = $1 and accion = 'editar'`,
        [tratamientoId],
      );
      expect(rows).toEqual([{ modulo: 'configuracion', antes: '250000', despues: '280000' }]);
    });
  });
});

describe('agenda_config', () => {
  it('una fila por sede, rangos válidos, sede de la clínica; se reemplaza con upsert', async () => {
    const { sedeId } = await crearSedeDePrueba(admin, A.clinicaId);
    const otra = await crearSedeDePrueba(admin, B.clinicaId);
    await como(A, async (c) => {
      const id = await valor<string>(
        c,
        'insert into app.agenda_config (clinica_id, sede_id) values ($1, $2) returning id',
        [A.clinicaId, sedeId],
      );
      expect(
        (
          await c.query(
            'select anticipacion_min, dias_adelante, reserva_online_activa from app.agenda_config where id = $1',
            [id],
          )
        ).rows,
      ).toEqual([{ anticipacion_min: 120, dias_adelante: 14, reserva_online_activa: false }]);
      expect(
        await intentar(c, 'insert into app.agenda_config (clinica_id, sede_id) values ($1, $2)', [
          A.clinicaId,
          sedeId,
        ]),
      ).toMatchObject(rechazo('23505', 'agenda_config_sede_key'));
      const upsert = `insert into app.agenda_config (clinica_id, sede_id, anticipacion_min, dias_adelante, reserva_online_activa)
                      values ($1, $2, $3, $4, true)
                      on conflict (clinica_id, sede_id) do update set
                        anticipacion_min = excluded.anticipacion_min, dias_adelante = excluded.dias_adelante,
                        reserva_online_activa = excluded.reserva_online_activa
                      returning id`;
      expect(await valor(c, upsert, [A.clinicaId, sedeId, 60, 30])).toBe(id);
      for (const [anticipacion, dias, restriccion] of [
        [-1, 14, 'agenda_config_anticipacion_check'],
        [2881, 14, 'agenda_config_anticipacion_check'],
        [120, 0, 'agenda_config_dias_adelante_check'],
        [120, 91, 'agenda_config_dias_adelante_check'],
      ] as const) {
        expect(await intentar(c, upsert, [A.clinicaId, sedeId, anticipacion, dias])).toMatchObject(
          rechazo('23514', restriccion),
        );
      }
      expect(await intentar(c, upsert, [A.clinicaId, otra.sedeId, 60, 30])).toMatchObject(
        rechazo('23503', 'agenda_config_sede_fkey'),
      );
      expect(
        await intentar(c, 'update app.agenda_config set sede_id = $1 where id = $2', [
          otra.sedeId,
          id,
        ]),
      ).toMatchObject(rechazo('42501'));
      const { rows } = await c.query(
        `select accion, modulo, sede_id from app.audit_log where entidad = 'agenda_config' and entidad_id = $1
         order by fecha, accion`,
        [id],
      );
      expect(rows).toEqual([
        { accion: 'crear', modulo: 'sedes', sede_id: sedeId },
        { accion: 'editar', modulo: 'sedes', sede_id: sedeId },
      ]);
    });
  });
});
