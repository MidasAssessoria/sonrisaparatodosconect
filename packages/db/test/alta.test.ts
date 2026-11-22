/** app.alta_clinica() y la semilla de desarrollo. */
import { randomUUID } from 'node:crypto';
import { ACCIONES, MODULOS, ROLES_SISTEMA } from '@conecta/shared';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { DEMO, migrar, sembrarDemo } from '../src/index.js';
import { crearBaseVacia, crearClinicaDePrueba } from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);

async function permisos(clinicaId: string): Promise<Map<string, Set<string>>> {
  return enTransaccion(admin, { clinica: clinicaId }, async (c) => {
    const { rows } = await c.query<{ codigo: string; permiso: string }>(
      `select r.codigo, p.modulo || ':' || p.accion as permiso
       from app.rol_permiso p join app.rol r on r.id = p.rol_id
       where p.activo and r.clinica_id = $1`,
      [clinicaId],
    );
    const mapa = new Map<string, Set<string>>();
    for (const fila of rows) {
      if (!mapa.has(fila.codigo)) mapa.set(fila.codigo, new Set());
      mapa.get(fila.codigo)!.add(fila.permiso);
    }
    return mapa;
  });
}

describe('app.alta_clinica()', () => {
  it('crea la clínica con los 5 roles de sistema, la matriz de permisos y el dueño activo', async () => {
    const clinica = await crearClinicaDePrueba(admin, { nombre: 'Clínica Nueva' });
    await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => {
        const { rows } = await c.query(
          `select nombre, zona_horaria, edad_pediatrica, edad_tutor, tope_descuento_pct, activo
         from app.clinica where id = $1`,
          [clinica.clinicaId],
        );
        expect(rows[0]).toEqual({
          nombre: 'Clínica Nueva',
          zona_horaria: 'America/Asuncion',
          edad_pediatrica: 12,
          edad_tutor: 18,
          tope_descuento_pct: 50,
          activo: true,
        });
        const roles = await c.query<{
          codigo: string;
          es_sistema: boolean;
          todas_las_sedes: boolean;
          exige_mfa: boolean;
          inactividad_min: number;
        }>(
          `select codigo, es_sistema, todas_las_sedes, exige_mfa, inactividad_min
           from app.rol where clinica_id = $1 order by codigo`,
          [clinica.clinicaId],
        );
        expect(roles.rows.map((r) => r.codigo)).toEqual([...ROLES_SISTEMA].sort());
        expect(roles.rows.every((r) => r.es_sistema)).toBe(true);
        // Dueño y administración ven todas las sedes y exigen doble factor; recepción vence a los 15.
        expect(
          Object.fromEntries(
            roles.rows.map((r) => [
              r.codigo,
              [r.todas_las_sedes, r.exige_mfa, r.inactividad_min] as const,
            ]),
          ),
        ).toEqual({
          administracion: [true, true, 30],
          asistente: [false, false, 30],
          dueno: [true, true, 30],
          odontologo: [false, false, 30],
          recepcion: [false, false, 15],
        });
        const membresia = await c.query(
          `select m.estado, r.codigo from app.membresia m join app.rol r on r.id = m.rol_id
         where m.clinica_id = $1`,
          [clinica.clinicaId],
        );
        expect(membresia.rows).toEqual([{ estado: 'activo', codigo: 'dueno' }]);
      },
    );

    const matriz = await permisos(clinica.clinicaId);
    const todo = MODULOS.flatMap((m) => ACCIONES.map((a) => `${m}:${a}`));
    expect([...(matriz.get('dueno') ?? [])].sort()).toEqual(todo.sort());
    for (const codigo of ['administracion', 'odontologo', 'asistente', 'recepcion']) {
      const propios = matriz.get(codigo) ?? new Set();
      expect(propios.size, codigo).toBeGreaterThan(0);
      expect(propios.size, codigo).toBeLessThan(todo.length);
      expect(propios.has('inicio:ver'), codigo).toBe(true);
    }
    // Datos clínicos: solo roles clínicos (doc 00).
    expect(matriz.get('administracion')?.has('ficha_clinica:ver')).toBe(false);
    expect(matriz.get('recepcion')?.has('ficha_clinica:ver')).toBe(false);
    expect(matriz.get('asistente')?.has('ficha_clinica:ver')).toBe(true);
    expect(matriz.get('asistente')?.has('ficha_clinica:editar')).toBe(false);
    expect(matriz.get('odontologo')?.has('ficha_clinica:editar')).toBe(true);
    expect(matriz.get('recepcion')?.has('caja:crear')).toBe(true);
    expect(matriz.get('administracion')?.has('personal:crear')).toBe(true);
    expect(matriz.get('administracion')?.has('sedes:crear')).toBe(true);
    // 0015: Administración carga profesionales y el catálogo (configuracion:crear).
    expect(matriz.get('administracion')?.has('configuracion:crear')).toBe(true);
  });

  it('reutiliza la identidad si el dueño ya existe (una persona con dos clínicas)', async () => {
    const primera = await crearClinicaDePrueba(admin);
    const segunda = randomUUID();
    await enTransaccion(
      admin,
      {},
      async (c) => {
        await c.query("select app.alta_clinica('Segunda', $1, null, null, p_clinica_id => $2)", [
          primera.duenoId,
          segunda,
        ]);
      },
      { confirmar: true },
    );
    const clinicas = await enTransaccion(admin, { usuario: primera.duenoId }, (c) =>
      valor<string[]>(c, 'select array_agg(id order by id) from app.clinica'),
    );
    expect(clinicas).toEqual([primera.clinicaId, segunda].sort());
  });

  it('devuelve el contexto de quien la llamó y valida los datos', async () => {
    const previo = { clinica: randomUUID(), usuario: randomUUID() };
    await enTransaccion(admin, previo, async (c) => {
      await c.query("select app.alta_clinica('Con contexto', $1, 'Dueña', $2)", [
        randomUUID(),
        `duena-${Date.now()}@prueba.test`,
      ]);
      expect(await valor(c, "select current_setting('app.clinica_id')")).toBe(previo.clinica);
      expect(await valor(c, "select current_setting('app.usuario_id')")).toBe(previo.usuario);
      expect(
        await intentar(c, "select app.alta_clinica('', $1, 'X', 'x@prueba.test')", [randomUUID()]),
      ).toMatchObject({
        ok: false,
        codigo: '22023',
      });
      expect(
        await intentar(c, "select app.alta_clinica('X', null, 'X', 'x@prueba.test')"),
      ).toMatchObject({
        ok: false,
        codigo: '22023',
      });
      expect(
        await intentar(c, "select app.alta_clinica('X', $1, null, null)", [randomUUID()]),
      ).toMatchObject({
        ok: false,
        codigo: '22023',
      });
    });
  });

  it('no deja dar de alta un dueño con un correo que ya usa otra persona', async () => {
    const existente = await crearClinicaDePrueba(admin);
    const correo = await enTransaccion(admin, { usuario: existente.duenoId }, (c) =>
      valor<string>(c, 'select email from app.usuario where id = $1', [existente.duenoId]),
    );
    await enTransaccion(admin, {}, async (c) => {
      expect(
        await intentar(c, "select app.alta_clinica('X', $1, 'Otra', $2)", [
          randomUUID(),
          correo.toUpperCase(),
        ]),
      ).toMatchObject({ ok: false, codigo: '23505' });
    });
  });
});

describe('semilla de desarrollo', () => {
  it('crea la clínica de demostración con dos sedes y sillones, y es idempotente', async () => {
    const primera = await sembrarDemo(admin);
    expect(primera).toEqual({
      clinicaId: DEMO.clinicaId,
      duenoId: DEMO.duenoId,
      creada: true,
      agregados: { profesionales: 3, tramos: 15, tratamientos: 12 },
    });
    const segunda = await sembrarDemo(admin);
    expect(segunda).toEqual({
      clinicaId: DEMO.clinicaId,
      duenoId: DEMO.duenoId,
      creada: false,
      agregados: { profesionales: 0, tramos: 0, tratamientos: 0 },
    });

    await enTransaccion(admin, { clinica: DEMO.clinicaId, usuario: DEMO.duenoId }, async (c) => {
      const sedes = await c.query<{ nombre: string; sillones: number; dias: number }>(
        `select s.nombre,
                (select count(*)::int from app.sillon x where x.sede_id = s.id) as sillones,
                (select count(*)::int from app.sede_horario h where h.sede_id = s.id) as dias
         from app.sede s order by s.nombre`,
      );
      expect(sedes.rows).toEqual([
        { nombre: 'Asunción · Centro', sillones: 2, dias: 6 },
        { nombre: 'San Lorenzo', sillones: 2, dias: 5 },
      ]);
      const duena = await c.query(
        `select u.nombre, m.estado, m.sede_defecto_id,
                (select count(*)::int from app.usuario_sede us where us.membresia_id = m.id and us.activo) as sedes
         from app.membresia m join app.usuario u on u.id = m.usuario_id`,
      );
      expect(duena.rows).toEqual([
        {
          nombre: DEMO.duenoNombre,
          estado: 'activo',
          sede_defecto_id: DEMO.sedes.centro,
          sedes: 2,
        },
      ]);
      await esperarDemoCompleta(c);
    });
  });

  it('completa una clínica de demostración creada por la versión anterior, sin duplicar nada', async () => {
    // Base aparte: la clínica de demostración tiene id fijo y la de la base compartida ya existe.
    const base = await crearBaseVacia(urls());
    const pool = new pg.Pool({ connectionString: base.urlAdmin, max: 2 });
    try {
      await migrar(base.urlAdmin);
      // Lo que hacía sembrarDemo antes de 0010: clínica, sedes, horarios, sillones y la dueña.
      await enTransaccion(
        pool,
        { clinica: DEMO.clinicaId, usuario: DEMO.duenoId },
        async (c) => {
          await c.query(
            `select app.alta_clinica(p_nombre => 'Sonrisa Para Todos (demostración)', p_dueno_id => $1,
               p_dueno_nombre => $2, p_dueno_email => $3, p_clinica_id => $4)`,
            [DEMO.duenoId, DEMO.duenoNombre, DEMO.duenoEmail, DEMO.clinicaId],
          );
          for (const [id, nombre] of [
            [DEMO.sedes.centro, 'Asunción · Centro'],
            [DEMO.sedes.sanLorenzo, 'San Lorenzo'],
          ] as const) {
            await c.query('insert into app.sede (id, clinica_id, nombre) values ($1, $2, $3)', [
              id,
              DEMO.clinicaId,
              nombre,
            ]);
            await c.query(
              "insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, 'Sillón 1')",
              [DEMO.clinicaId, id],
            );
          }
          // Alguien ya cargó a mano un tratamiento con uno de los nombres (con otra grafía).
          await c.query(
            "insert into app.tratamiento (clinica_id, nombre, precio) values ($1, 'consulta Y DIAGNOSTICO', 100000)",
            [DEMO.clinicaId],
          );
        },
        { confirmar: true },
      );

      const completada = await sembrarDemo(pool);
      expect(completada).toEqual({
        clinicaId: DEMO.clinicaId,
        duenoId: DEMO.duenoId,
        creada: false,
        agregados: { profesionales: 3, tramos: 15, tratamientos: 11 },
      });
      expect((await sembrarDemo(pool)).agregados).toEqual({
        profesionales: 0,
        tramos: 0,
        tratamientos: 0,
      });
      await enTransaccion(pool, { clinica: DEMO.clinicaId, usuario: DEMO.duenoId }, async (c) => {
        await esperarDemoCompleta(c);
        // Lo anterior quedó como estaba: dos sedes, un sillón cada una, su tratamiento.
        expect(await valor(c, 'select count(*)::int from app.sede')).toBe(2);
        expect(await valor(c, 'select count(*)::int from app.sillon')).toBe(2);
        expect(
          await valor(
            c,
            "select precio::int from app.tratamiento where nombre = 'consulta Y DIAGNOSTICO'",
          ),
        ).toBe(100000);
      });
    } finally {
      await pool.end();
      await base.eliminar();
    }
  });
});

/** Profesionales (la dueña asociada a su membresía), tramos sin superposición y catálogo. */
async function esperarDemoCompleta(c: pg.ClientBase): Promise<void> {
  const profesionales = await c.query<{
    nombre: string;
    especialidad: string;
    es_la_duena: boolean;
    tramos: number;
    sedes: number;
  }>(
    `select p.nombre, p.especialidad, (u.id is not null) as es_la_duena,
            (select count(*)::int from app.profesional_disponibilidad d
             where d.profesional_id = p.id and d.activo) as tramos,
            (select count(distinct d.sede_id)::int from app.profesional_disponibilidad d
             where d.profesional_id = p.id and d.activo) as sedes
     from app.profesional p
     left join app.membresia m on m.id = p.membresia_id
     left join app.usuario u on u.id = m.usuario_id`,
  );
  // Orden en JS: el de la base depende de la collation del servidor.
  const ordenados = [...profesionales.rows].sort((x, y) => (x.nombre < y.nombre ? -1 : 1));
  expect(ordenados).toEqual([
    {
      nombre: 'Dr. Esteban Rojas',
      especialidad: 'Implantes',
      es_la_duena: false,
      tramos: 5,
      sedes: 2,
    },
    {
      nombre: 'Dra. Marta Acosta',
      especialidad: 'Endodoncia y cirugía',
      es_la_duena: true,
      tramos: 5,
      sedes: 2,
    },
    {
      nombre: 'Dra. Rosa Duarte',
      especialidad: 'Ortodoncia',
      es_la_duena: false,
      tramos: 5,
      sedes: 2,
    },
  ]);
  expect(await valor(c, 'select count(*)::int from app.tratamiento where activo')).toBe(12);
  expect(await valor(c, 'select count(distinct iva)::int from app.tratamiento where activo')).toBe(
    3,
  );
}
