/**
 * Dar de baja una sede (0016): en la misma transacción se desactivan sus usuario_sede, tramos de
 * disponibilidad y sillones y se vacía la sede por defecto que la apunta, con quien la da de baja
 * como autor (aunque no tenga permisos de personal ni alcance sobre esas personas). Después nada se
 * activa en esa sede, y las personas que la tenían se pueden volver a editar. Como app_api.
 */
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { conContexto, crearPool, listarPersonal } from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearProfesionalDePrueba,
  crearRolDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin, 4);
const api = nuevoPool(urls().urlApi, 4);
const poolApi = crearPool(urls().urlApi, { max: 2 });

interface Escenario extends ClinicaDePrueba {
  centro: { sedeId: string; sillonId: string };
  norte: { sedeId: string; sillonId: string };
  /** Recepción en Centro y Norte, con Norte por defecto. */
  persona: UsuarioDePrueba;
  /** Solo sedes (ver, editar, anular), sin nada de personal; también trabaja en Norte. */
  sedista: UsuarioDePrueba;
  profesionalId: string;
  tramoNorte: string;
  tramoCentro: string;
}

let E: Escenario;

beforeAll(async () => {
  const clinica = await crearClinicaDePrueba(admin);
  const id = clinica.clinicaId;
  const [centro, norte, { rolId: soloSedes }] = await Promise.all([
    crearSedeDePrueba(admin, id),
    crearSedeDePrueba(admin, id),
    crearRolDePrueba(admin, {
      clinicaId: id,
      nombre: 'Solo sedes',
      permisos: ['sedes:ver', 'sedes:editar', 'sedes:anular'],
      todasLasSedes: true,
    }),
  ]);
  const [persona, sedista] = await Promise.all([
    crearUsuarioDePrueba(admin, {
      clinicaId: id,
      sedeIds: [centro.sedeId, norte.sedeId],
      sedeDefectoId: norte.sedeId,
    }),
    crearUsuarioDePrueba(admin, {
      clinicaId: id,
      rolId: soloSedes,
      sedeIds: [norte.sedeId],
      sedeDefectoId: norte.sedeId,
    }),
  ]);
  const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: id });
  const tramos = await enTransaccion(
    admin,
    { clinica: id, usuario: '' },
    async (c) => {
      // El dueño también entra por defecto en Norte.
      await c.query('update app.membresia set sede_defecto_id = $1 where id = $2', [
        norte.sedeId,
        clinica.membresiaDuenoId,
      ]);
      const insertar = (sede: string, sillon: string, dia: number) =>
        valor<string>(
          c,
          `insert into app.profesional_disponibilidad
             (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin, sillon_id)
           values ($1, $2, $3, $4, '08:00', '12:00', $5) returning id`,
          [id, profesionalId, sede, dia, sillon],
        );
      return {
        norte: await insertar(norte.sedeId, norte.sillonId, 1),
        centro: await insertar(centro.sedeId, centro.sillonId, 2),
      };
    },
    { confirmar: true },
  );
  E = {
    ...clinica,
    centro,
    norte,
    persona,
    sedista,
    profesionalId,
    tramoNorte: tramos.norte,
    tramoCentro: tramos.centro,
  };
  return () => poolApi.end();
});

const como = <T>(usuario: string, fn: (c: pg.PoolClient) => Promise<T>, confirmar = false) =>
  enTransaccion(api, { clinica: E.clinicaId, usuario }, fn, { confirmar });

describe('dar de baja una sede', () => {
  it('limpia en cascada lo que la apunta, con quien la dio de baja como autor (sin permisos de personal)', async () => {
    await como(
      E.sedista.usuarioId,
      async (c) => {
        await c.query(
          "update app.sede set deleted_at = now(), motivo_baja = 'Cerró la sede' where id = $1",
          [E.norte.sedeId],
        );
      },
      true,
    );
    await enTransaccion(admin, { clinica: E.clinicaId }, async (c) => {
      const sedes = await c.query<{ membresia_id: string; sede_id: string; activo: boolean }>(
        'select membresia_id, sede_id, activo from app.usuario_sede where membresia_id = any($1)',
        [[E.persona.membresiaId, E.sedista.membresiaId]],
      );
      expect(
        sedes.rows
          .map(
            (f) =>
              `${f.membresia_id === E.persona.membresiaId ? 'persona' : 'sedista'}:${f.sede_id === E.norte.sedeId ? 'norte' : 'centro'}:${String(f.activo)}`,
          )
          .sort(),
      ).toEqual(['persona:centro:true', 'persona:norte:false', 'sedista:norte:false']);
      const defecto = await c.query<{ id: string; sede_defecto_id: string | null }>(
        'select id, sede_defecto_id from app.membresia where id = any($1)',
        [[E.persona.membresiaId, E.sedista.membresiaId, E.membresiaDuenoId]],
      );
      expect(defecto.rows.every((f) => f.sede_defecto_id === null)).toBe(true);
      expect(defecto.rows).toHaveLength(3);
      const tramos = await c.query<{ id: string; activo: boolean }>(
        'select id, activo from app.profesional_disponibilidad where id = any($1)',
        [[E.tramoNorte, E.tramoCentro]],
      );
      expect(Object.fromEntries(tramos.rows.map((f) => [f.id, f.activo]))).toEqual({
        [E.tramoNorte]: false,
        [E.tramoCentro]: true,
      });
      const sillones = await c.query<{ id: string; activo: boolean }>(
        'select id, activo from app.sillon where id = any($1)',
        [[E.norte.sillonId, E.centro.sillonId]],
      );
      expect(Object.fromEntries(sillones.rows.map((f) => [f.id, f.activo]))).toEqual({
        [E.norte.sillonId]: false,
        [E.centro.sillonId]: true,
      });
      // Todo auditado con quien dio de baja la sede como autor.
      const autores = await c.query<{ entidad: string; accion: string }>(
        `select entidad, accion from app.audit_log
         where clinica_id = $1 and usuario_id = $2 and accion in ('editar', 'anular')
         order by entidad, accion`,
        [E.clinicaId, E.sedista.usuarioId],
      );
      expect([...new Set(autores.rows.map((f) => `${f.entidad}:${f.accion}`))]).toEqual([
        'membresia:editar',
        'profesional_disponibilidad:anular',
        'sede:anular',
        'sillon:anular',
        'usuario_sede:anular',
      ]);
    });

    // El listado no muestra la sede dada de baja.
    const [persona] = await conContexto(
      poolApi,
      { clinicaId: E.clinicaId, usuarioId: E.duenoId },
      (tx) => listarPersonal(tx, { membresiaId: E.persona.membresiaId }),
    );
    expect(persona).toMatchObject({ sedeIds: [E.centro.sedeId], sedeDefectoId: null });

    // La persona se puede volver a editar.
    await como(E.duenoId, async (c) => {
      expect(
        await intentar(c, 'update app.membresia set sede_defecto_id = $1 where id = $2', [
          E.centro.sedeId,
          E.persona.membresiaId,
        ]),
      ).toMatchObject({ ok: true, cantidad: 1 });
    });
  });

  it('en una sede dada de baja no se activa nada: sedes de personas, sede por defecto, tramos ni sillones', async () => {
    const { sedeId, sillonId } = await crearSedeDePrueba(admin, E.clinicaId);
    const { profesionalId } = await crearProfesionalDePrueba(admin, { clinicaId: E.clinicaId });
    const tramo = await enTransaccion(
      admin,
      { clinica: E.clinicaId, usuario: '' },
      async (c) => {
        const id = await valor<string>(
          c,
          `insert into app.profesional_disponibilidad
             (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin)
           values ($1, $2, $3, 3, '08:00', '12:00') returning id`,
          [E.clinicaId, profesionalId, sedeId],
        );
        await c.query(
          "update app.sede set deleted_at = now(), motivo_baja = 'Cerró' where id = $1",
          [sedeId],
        );
        return id;
      },
      { confirmar: true },
    );
    await como(E.duenoId, async (c) => {
      const intentos: [string, unknown[]][] = [
        [
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [E.clinicaId, E.persona.membresiaId, sedeId],
        ],
        [
          'update app.membresia set sede_defecto_id = $1 where id = $2',
          [sedeId, E.persona.membresiaId],
        ],
        ['update app.profesional_disponibilidad set activo = true where id = $1', [tramo]],
        ['update app.sillon set activo = true where id = $1', [sillonId]],
        [
          "insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, 'Sillón nuevo')",
          [E.clinicaId, sedeId],
        ],
        [
          `insert into app.profesional_disponibilidad
             (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin)
           values ($1, $2, $3, 4, '08:00', '12:00')`,
          [E.clinicaId, profesionalId, sedeId],
        ],
      ];
      for (const [texto, parametros] of intentos) {
        expect({ texto, r: await intentar(c, texto, parametros) }).toMatchObject({
          texto,
          r: rechazo('22023', 'sede_dada_de_baja'),
        });
      }
    });
    // Tampoco el rol de migraciones: es una regla de datos.
    await enTransaccion(admin, { clinica: E.clinicaId, usuario: '' }, async (c) => {
      expect(
        await intentar(c, 'update app.sillon set activo = true where id = $1', [sillonId]),
      ).toMatchObject(rechazo('22023', 'sede_dada_de_baja'));
    });
  });

  it('la limpieza no sirve para tocar otra cosa: desactivar una sede vigente o cambiar algo más sigue con las reglas', async () => {
    const recepcion = await crearUsuarioDePrueba(admin, {
      clinicaId: E.clinicaId,
      sedeIds: [E.centro.sedeId],
      sedeDefectoId: E.centro.sedeId,
    });
    // Quien no tiene permisos de personal no puede quitar una sede vigente ni vaciar la sede por
    // defecto (que apunta a una sede vigente).
    await como(E.sedista.usuarioId, async (c) => {
      for (const [texto, parametros] of [
        [
          'update app.usuario_sede set activo = false where membresia_id = $1',
          [recepcion.membresiaId],
        ],
        ['update app.membresia set sede_defecto_id = null where id = $1', [recepcion.membresiaId]],
      ] as const) {
        expect({ texto, r: await intentar(c, texto, [...parametros]) }).toMatchObject({
          texto,
          r: rechazo('42501', 'acceso_sin_permiso'),
        });
      }
    });
  });
});
