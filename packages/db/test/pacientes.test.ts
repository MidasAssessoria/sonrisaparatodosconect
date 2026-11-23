/**
 * Pacientes (0019–0022), como app_api: normalización y formatos, CI repetida, baja y reactivación,
 * permisos en la base, alertas manuales, nota interna y auditoría.
 */
import { randomUUID } from 'node:crypto';
import { normalizarBusqueda, normalizarCi, normalizarTelefono } from '@conecta/shared';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  conContexto,
  crearAlerta,
  crearPaciente,
  desactivarPaciente,
  editarPaciente,
  guardarNotaInterna,
  leerNotaInterna,
  obtenerPaciente,
  pacientesConCi,
  reactivarPaciente,
  registrarEvento,
} from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearPacienteDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, errorDe, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let clinica: ClinicaDePrueba;
/** Usuarios con cada rol de sistema en `clinica`. */
const usuarios: Record<'recepcion' | 'odontologo' | 'asistente', string> = {
  recepcion: '',
  odontologo: '',
  asistente: '',
};

beforeAll(async () => {
  clinica = await crearClinicaDePrueba(admin);
  for (const rol of ['recepcion', 'odontologo', 'asistente'] as const) {
    usuarios[rol] = (
      await crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId, rol })
    ).usuarioId;
  }
});

type Quien = 'dueno' | keyof typeof usuarios;
const idDe = (quien: Quien): string => (quien === 'dueno' ? clinica.duenoId : usuarios[quien]);

/** Transacción cruda como app_api (se revierte). */
function como<T>(quien: Quien, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return enTransaccion(api, { clinica: clinica.clinicaId, usuario: idDe(quien) }, fn);
}

/** Transacción de Drizzle como app_api (se confirma). */
function conApi<T>(quien: Quien, fn: Parameters<typeof conContexto<T>>[2]): Promise<T> {
  return conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: idDe(quien) }, fn);
}

const insertar = (c: pg.PoolClient, columnas: Record<string, unknown>) => {
  const nombres = Object.keys(columnas);
  return intentar(
    c,
    `insert into app.paciente (clinica_id, ${nombres.join(', ')})
     values ($1, ${nombres.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
    [clinica.clinicaId, ...Object.values(columnas)],
  );
};

describe('normalización igual a @conecta/shared', () => {
  it('app.normalizar_busqueda coincide con normalizarBusqueda en tildes, diéresis, ñ, guaraní y espacios', async () => {
    const textos = [
      'González',
      'GONZÁLEZ  Peña',
      'Ñandutí Ñemby',
      'Müller Pérez-Ruiz',
      "O'Higgins",
      'Mbaracayú ỹg̃ãẽĩõũ',
      '  Asunción   Centro ',
      'ÀÈÌÒÙ àèìòù âêîôû',
    ];
    await como('recepcion', async (c) => {
      for (const texto of textos) {
        expect({
          texto,
          base: await valor(c, 'select app.normalizar_busqueda($1)', [texto]),
        }).toEqual({ texto, base: normalizarBusqueda(texto) });
      }
    });
  });

  it('CI, teléfono, RUC, correo y textos se guardan normalizados como en documentos.ts', async () => {
    await como('recepcion', async (c) => {
      const r = await insertar(c, {
        nombres: '  Ana   María ',
        apellidos: '  Giménez ',
        ci: ' 4.123.456 ',
        telefono: '0981 123 456',
        ruc: ' 80.099.999-1 ',
        email: '  Ana.Gimenez@Example.COM ',
        ciudad: '   ',
        direccion: '',
      });
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(r.filas[0]).toMatchObject({
        nombres: 'Ana María',
        apellidos: 'Giménez',
        ci: normalizarCi('4.123.456'),
        telefono: normalizarTelefono('0981 123 456'),
        ruc: '80099999-1',
        email: 'ana.gimenez@example.com',
        ciudad: null,
        direccion: null,
        idioma: 'es',
        origen: 'recepcion',
        acepta_whatsapp: false,
        activo: true,
      });
      for (const telefono of ['981123456', '+595 981 123456', '595981123456', '(0981) 123-456']) {
        const t = await insertar(c, { nombres: 'Tel', telefono });
        expect({ telefono, guardado: t.ok ? t.filas[0]?.['telefono'] : t }).toEqual({
          telefono,
          guardado: normalizarTelefono(telefono),
        });
      }
      const extranjero = await insertar(c, { nombres: 'Tel', telefono: '+54 9 11 5555-1234' });
      expect(extranjero.ok && extranjero.filas[0]?.['telefono']).toBe('+5491155551234');
    });
  });

  it('formatos inválidos se rechazan con el nombre del CHECK', async () => {
    await como('recepcion', async (c) => {
      const casos: [Record<string, unknown>, string][] = [
        [{ nombres: 'A' }, 'paciente_nombres_check'],
        [{ nombres: '   ' }, 'paciente_nombres_check'],
        [{ nombres: 'x'.repeat(81) }, 'paciente_nombres_check'],
        [{ nombres: 'Ana', apellidos: 'x'.repeat(81) }, 'paciente_apellidos_check'],
        [{ nombres: 'Ana', ci: '1234' }, 'paciente_ci_check'],
        [{ nombres: 'Ana', ci: '1234567890' }, 'paciente_ci_check'],
        [{ nombres: 'Ana', ci: '4123A56' }, 'paciente_ci_check'],
        [{ nombres: 'Ana', ci: '00001234' }, 'paciente_ci_check'],
        [{ nombres: 'Ana', ruc: '80099999' }, 'paciente_ruc_check'],
        [{ nombres: 'Ana', ruc: '80099999-12' }, 'paciente_ruc_check'],
        [{ nombres: 'Ana', telefono: '12345' }, 'paciente_telefono_check'],
        [{ nombres: 'Ana', telefono: '0981 123 4567 89' }, 'paciente_telefono_check'],
        [{ nombres: 'Ana', telefono: 'sin número' }, 'paciente_telefono_check'],
        [{ nombres: 'Ana', email: 'sin-arroba' }, 'paciente_email_check'],
        [{ nombres: 'Ana', sexo: 'X' }, 'paciente_sexo_check'],
        [{ nombres: 'Ana', idioma: 'en' }, 'paciente_idioma_check'],
        [{ nombres: 'Ana', origen: 'whatsapp' }, 'paciente_origen_check'],
        [{ nombres: 'Ana', fecha_nac: '1899-12-31' }, 'paciente_fecha_nac_check'],
        [{ nombres: 'Ana', direccion: 'x'.repeat(201) }, 'paciente_direccion_check'],
      ];
      for (const [columnas, restriccion] of casos) {
        expect({ columnas, r: await insertar(c, columnas) }).toMatchObject({
          columnas,
          r: rechazo('23514', restriccion),
        });
      }
      // Fecha de nacimiento futura (en la zona de la clínica).
      expect(
        await intentar(
          c,
          `insert into app.paciente (clinica_id, nombres, fecha_nac)
           values ($1, 'Ana', app.hoy_clinica() + 1)`,
          [clinica.clinicaId],
        ),
      ).toMatchObject(rechazo('23514', 'paciente_fecha_nac_futura'));
      expect(
        await intentar(
          c,
          `insert into app.paciente (clinica_id, nombres, fecha_nac) values ($1, 'Ana', app.hoy_clinica())`,
          [clinica.clinicaId],
        ),
      ).toMatchObject({ ok: true });
    });
  });

  it('las columnas de orden son generadas: no se escriben y ordenan la ñ entre la n y la o', async () => {
    await como('recepcion', async (c) => {
      expect(await insertar(c, { nombres: 'Ana', orden_apellidos: 'trucho' })).toMatchObject({
        ok: false,
        codigo: '428C9',
      });
      for (const apellidos of ['Peña', 'Penz', 'Peo', 'Pena', 'Pérez']) {
        await insertar(c, { nombres: 'Orden', apellidos });
      }
      const { rows } = await c.query<{ apellidos: string }>(
        `select apellidos from app.paciente where nombres = 'Orden'
         order by orden_apellidos, orden_nombres, id`,
      );
      expect(rows.map((f) => f.apellidos)).toEqual(['Pena', 'Penz', 'Peña', 'Peo', 'Pérez']);
    });
  });
});

describe('CI repetida (P6: avisa, no bloquea)', () => {
  it('dos pacientes con la misma CI se guardan, y pacientes_con_ci los encuentra con cualquier formato', async () => {
    await como('recepcion', async (c) => {
      const ci = String(5_000_000 + Math.floor(Math.random() * 4_000_000));
      const conPuntos = ci.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      expect(await insertar(c, { nombres: 'Primera', ci })).toMatchObject({ ok: true });
      expect(await insertar(c, { nombres: 'Segunda', ci: conPuntos })).toMatchObject({ ok: true });
      const { rows } = await c.query<{ nombres: string }>(
        'select nombres from app.pacientes_con_ci($1)',
        [conPuntos],
      );
      expect(rows.map((f) => f.nombres).sort()).toEqual(['Primera', 'Segunda']);
      // Los niños pueden no tener CI.
      expect(await insertar(c, { nombres: 'Sin CI', ci: null })).toMatchObject({ ok: true });
      expect(await valor(c, "select count(*)::int from app.pacientes_con_ci('')")).toBe(0);
      // El índice por (clinica_id, ci) existe y es parcial.
      expect(
        await valor(
          c,
          "select indexdef from pg_indexes where schemaname = 'app' and indexname = 'paciente_ci_idx'",
        ),
      ).toMatch(/\(clinica_id, ci\) WHERE \(ci IS NOT NULL\)/);
    });
  });

  it('pacientesConCi excluye al propio paciente al editar', async () => {
    const ci = String(5_000_000 + Math.floor(Math.random() * 4_000_000));
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId, ci });
    await conApi('recepcion', async (tx) => {
      expect((await pacientesConCi(tx, ci)).map((p) => p.id)).toEqual([pacienteId]);
      expect(await pacientesConCi(tx, ci, pacienteId)).toEqual([]);
    });
  });
});

describe('permisos en la base', () => {
  it('alta: pacientes:crear (recepción sí, asistente no); el alta nace activa', async () => {
    await como('asistente', async (c) => {
      expect(await insertar(c, { nombres: 'Ana' })).toMatchObject(
        rechazo('42501', 'pacientes_sin_permiso'),
      );
    });
    await como('recepcion', async (c) => {
      expect(await insertar(c, { nombres: 'Ana' })).toMatchObject({ ok: true });
      expect(await insertar(c, { nombres: 'Ana', activo: false, motivo_baja: 'x' })).toMatchObject(
        rechazo('22023', 'paciente_nace_activo'),
      );
    });
  });

  it('edición: pacientes:editar; sin usuario en el contexto o sin membresía activa, nada', async () => {
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId });
    const editar = "update app.paciente set ciudad = 'Luque' where id = $1";
    await como('asistente', async (c) => {
      expect(await intentar(c, editar, [pacienteId])).toMatchObject(
        rechazo('42501', 'pacientes_sin_permiso'),
      );
    });
    await como('recepcion', async (c) => {
      expect(await intentar(c, editar, [pacienteId])).toMatchObject({ ok: true, cantidad: 1 });
    });
    await enTransaccion(api, { clinica: clinica.clinicaId }, async (c) => {
      // Sin usuario: RLS deja ver (clínica), la defensa no.
      expect(await intentar(c, editar, [pacienteId])).toMatchObject(
        rechazo('42501', 'pacientes_sin_permiso'),
      );
    });
    const inactiva = await crearUsuarioDePrueba(admin, {
      clinicaId: clinica.clinicaId,
      rol: 'dueno',
      estado: 'inactivo',
    });
    await enTransaccion(
      api,
      { clinica: clinica.clinicaId, usuario: inactiva.usuarioId },
      async (c) => {
        expect(await intentar(c, editar, [pacienteId])).toMatchObject(
          rechazo('42501', 'pacientes_sin_permiso'),
        );
      },
    );
  });

  it('desactivar y reactivar: pacientes:anular y motivo (baja_sin_motivo); se reactiva sin motivo', async () => {
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId });
    await como('recepcion', async (c) => {
      expect(
        await intentar(c, "select app.desactivar_paciente($1, 'Se mudó')", [pacienteId]),
      ).toMatchObject(rechazo('42501', 'pacientes_sin_permiso'));
      // Por UPDATE directo, igual.
      expect(
        await intentar(
          c,
          "update app.paciente set activo = false, motivo_baja = 'x' where id = $1",
          [pacienteId],
        ),
      ).toMatchObject(rechazo('42501', 'pacientes_sin_permiso'));
    });
    await como('dueno', async (c) => {
      for (const motivo of [null, '', '   ']) {
        expect(
          await intentar(c, 'select app.desactivar_paciente($1, $2)', [pacienteId, motivo]),
        ).toMatchObject(rechazo('23514', 'baja_sin_motivo'));
      }
      expect(
        await intentar(c, 'update app.paciente set activo = false where id = $1', [pacienteId]),
      ).toMatchObject(rechazo('23514', 'baja_sin_motivo'));
      expect(
        await intentar(c, 'select app.desactivar_paciente($1, $2)', [pacienteId, 'x'.repeat(501)]),
      ).toMatchObject(rechazo('23514', 'paciente_motivo_baja_check'));
      expect(
        await intentar(c, 'select app.desactivar_paciente(gen_random_uuid(), $1)', ['Se mudó']),
      ).toMatchObject(rechazo('P0002', 'paciente_no_encontrado'));
    });
    await conApi('dueno', async (tx) => {
      expect(await desactivarPaciente(tx, pacienteId, '  Se mudó a Encarnación  ')).toBe(true);
      expect(await desactivarPaciente(tx, pacienteId, 'otra vez')).toBe(false);
      const ficha = await obtenerPaciente(tx, pacienteId);
      expect(ficha).toMatchObject({ activo: false, motivoBaja: 'Se mudó a Encarnación' });
      expect(await reactivarPaciente(tx, pacienteId)).toBe(true);
      expect(await reactivarPaciente(tx, pacienteId)).toBe(false);
      expect(await obtenerPaciente(tx, pacienteId)).toMatchObject({
        activo: true,
        motivoBaja: null,
      });
    });
    await como('recepcion', async (c) => {
      expect(await intentar(c, 'select app.reactivar_paciente($1)', [pacienteId])).toMatchObject({
        ok: true,
      });
    });
    // Auditoría: crear, anular (con el motivo), editar (reactivar).
    await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => {
        const { rows } = await c.query<{ accion: string; modulo: string; motivo: string | null }>(
          `select accion, modulo, despues ->> 'motivo_baja' as motivo from app.audit_log
         where entidad = 'paciente' and entidad_id = $1 order by fecha, id`,
          [pacienteId],
        );
        expect(rows).toEqual([
          { accion: 'crear', modulo: 'pacientes', motivo: null },
          { accion: 'anular', modulo: 'pacientes', motivo: 'Se mudó a Encarnación' },
          { accion: 'editar', modulo: 'pacientes', motivo: null },
        ]);
      },
    );
  });

  it('origen no cambia después del alta', async () => {
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId });
    await como('recepcion', async (c) => {
      expect(
        await intentar(c, "update app.paciente set origen = 'online' where id = $1", [pacienteId]),
      ).toMatchObject({ ok: false, codigo: '42501' });
    });
  });
});

describe('alertas manuales', () => {
  it('sin ficha_clinica:editar no se cargan ni se cambian; con él sí, y se desactivan sin borrarse', async () => {
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId });
    for (const quien of ['recepcion', 'asistente'] as const) {
      await como(quien, async (c) => {
        expect(
          await intentar(c, "select app.crear_alerta($1, 'alergia', 'Alergia al látex')", [
            pacienteId,
          ]),
        ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
        expect(
          await intentar(
            c,
            `insert into app.paciente_alerta (clinica_id, paciente_id, tipo, texto) values ($1, $2, 'condicion', 'Embarazo')`,
            [clinica.clinicaId, pacienteId],
          ),
        ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
      });
    }
    const alerta = await conApi('odontologo', (tx) =>
      crearAlerta(tx, pacienteId, { tipo: 'alergia', texto: '  Alergia a la penicilina  ' }),
    );
    expect(alerta).toMatchObject({
      texto: 'Alergia a la penicilina',
      activa: true,
      creadaPor: expect.any(String) as string,
    });
    await como('recepcion', async (c) => {
      // Recepción la ve (la necesita en el mostrador) pero no la cambia.
      expect(
        await valor(c, 'select count(*)::int from app.paciente_alerta where id = $1', [alerta.id]),
      ).toBe(1);
      expect(await intentar(c, 'select app.cambiar_alerta($1, false)', [alerta.id])).toMatchObject(
        rechazo('42501', 'ficha_clinica_sin_permiso'),
      );
    });
    // Se confirma: la desactivación tiene que quedar en la auditoría.
    await enTransaccion(
      api,
      { clinica: clinica.clinicaId, usuario: usuarios.odontologo },
      async (c) => {
        expect(await valor(c, 'select app.cambiar_alerta($1, false)', [alerta.id])).toBe(true);
        expect(await valor(c, 'select app.cambiar_alerta($1, false)', [alerta.id])).toBe(false);
        // El texto, el paciente y la autora no cambian; tampoco se borra.
        for (const set of [
          "texto = 'otra'",
          'paciente_id = gen_random_uuid()',
          'creada_por = null',
        ]) {
          expect(
            await intentar(c, `update app.paciente_alerta set ${set} where id = $1`, [alerta.id]),
          ).toMatchObject({ ok: false, codigo: '42501' });
        }
        expect(
          await intentar(c, 'delete from app.paciente_alerta where id = $1', [alerta.id]),
        ).toMatchObject({ ok: false, codigo: '42501' });
        for (const texto of ['ab', '   ', 'x'.repeat(201)]) {
          expect(
            await intentar(c, "select app.crear_alerta($1, 'alergia', $2)", [pacienteId, texto]),
          ).toMatchObject(rechazo('23514', 'paciente_alerta_texto_check'));
        }
        expect(
          await intentar(c, 'select app.cambiar_alerta(gen_random_uuid(), true)'),
        ).toMatchObject(rechazo('P0002', 'alerta_no_encontrada'));
        // creada_por sale del contexto aunque el cliente mande otro.
        const otra = await valor<string>(
          c,
          `insert into app.paciente_alerta (clinica_id, paciente_id, tipo, texto, creada_por)
         values ($1, $2, 'condicion', 'Diabetes', $3) returning creada_por`,
          [clinica.clinicaId, pacienteId, clinica.duenoId],
        );
        expect(otra).toBe(usuarios.odontologo);
      },
      { confirmar: true },
    );
    // Auditoría con módulo ficha_clinica; desactivar es «anular».
    await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => {
        const { rows } = await c.query(
          `select accion, modulo from app.audit_log where entidad = 'paciente_alerta' and entidad_id = $1
         order by fecha, id`,
          [alerta.id],
        );
        expect(rows).toEqual([
          { accion: 'crear', modulo: 'ficha_clinica' },
          { accion: 'anular', modulo: 'ficha_clinica' },
        ]);
      },
    );
  });
});

describe('nota interna', () => {
  it('sin ficha_clinica:ver la nota no existe para app_api (SELECT, joins, funciones); con él, sí', async () => {
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId });
    await conApi('odontologo', (tx) =>
      guardarNotaInterna(tx, pacienteId, 'Paciente ansioso; prefiere turnos temprano.'),
    );
    const notaId = await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      (c) =>
        valor<string>(c, 'select id from app.paciente_nota where paciente_id = $1', [pacienteId]),
    );
    await como('recepcion', async (c) => {
      expect(await valor(c, 'select count(*)::int from app.paciente_nota')).toBe(0);
      expect(
        await valor(
          c,
          `select n.texto from app.paciente p
           left join app.paciente_nota n on n.clinica_id = p.clinica_id and n.paciente_id = p.id
           where p.id = $1`,
          [pacienteId],
        ),
      ).toBeNull();
      expect(
        await valor(c, "select count(*)::int from app.paciente_nota where texto like '%ansioso%'"),
      ).toBe(0);
      // Tampoco por la auditoría: la nota no viaja en los eventos del paciente.
      expect(
        await valor(
          c,
          `select count(*)::int from app.audit_log
           where modulo = 'pacientes' and (antes::text like '%ansioso%' or despues::text like '%ansioso%')`,
        ),
      ).toBe(0);
      // Ni registrar haberla visto (no existe para quien no la puede ver).
      expect(
        await intentar(c, "select app.registrar_evento('ver', 'paciente_nota', $1)", [notaId]),
      ).toMatchObject({ ok: false, codigo: '22023' });
    });
    await conApi('recepcion', async (tx) => {
      expect(await leerNotaInterna(tx, pacienteId)).toBeNull();
      expect(await obtenerPaciente(tx, pacienteId)).toMatchObject({ notaInterna: null });
    });
    for (const quien of ['asistente', 'odontologo', 'dueno'] as const) {
      await conApi(quien, async (tx) => {
        expect({ quien, nota: await leerNotaInterna(tx, pacienteId) }).toEqual({
          quien,
          nota: 'Paciente ansioso; prefiere turnos temprano.',
        });
      });
    }
  });

  it('escribirla exige ficha_clinica:editar; null la borra y el historial queda con módulo ficha_clinica', async () => {
    const { pacienteId } = await crearPacienteDePrueba(admin, { clinicaId: clinica.clinicaId });
    for (const quien of ['recepcion', 'asistente'] as const) {
      await como(quien, async (c) => {
        expect(
          await intentar(c, "select app.guardar_nota_interna($1, 'Nota')", [pacienteId]),
        ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
      });
    }
    // Recepción tampoco la escribe editando el paciente.
    expect(
      await errorDe(
        conApi('recepcion', (tx) => editarPaciente(tx, pacienteId, { notaInterna: 'Nota' })),
      ),
    ).toMatchObject({ codigo: '42501', restriccion: 'ficha_clinica_sin_permiso' });
    await conApi('odontologo', async (tx) => {
      await guardarNotaInterna(tx, pacienteId, 'Primera');
      await guardarNotaInterna(tx, pacienteId, '  Segunda  ');
      expect(await leerNotaInterna(tx, pacienteId)).toBe('Segunda');
      await guardarNotaInterna(tx, pacienteId, null);
      expect(await leerNotaInterna(tx, pacienteId)).toBeNull();
      expect(
        await editarPaciente(tx, pacienteId, { notaInterna: 'Tercera', ciudad: 'Luque' }),
      ).toBe(true);
      expect(await obtenerPaciente(tx, pacienteId)).toMatchObject({
        notaInterna: 'Tercera',
        ciudad: 'Luque',
      });
    });
    await como('odontologo', async (c) => {
      expect(
        await intentar(c, 'select app.guardar_nota_interna($1, $2)', [
          pacienteId,
          'x'.repeat(2001),
        ]),
      ).toMatchObject(rechazo('23514', 'paciente_nota_texto_check'));
      // Una sola nota por paciente; nada se borra.
      expect(
        await intentar(
          c,
          "insert into app.paciente_nota (clinica_id, paciente_id, texto) values ($1, $2, 'Otra')",
          [clinica.clinicaId, pacienteId],
        ),
      ).toMatchObject(rechazo('23505', 'paciente_nota_paciente_key'));
      expect(await intentar(c, 'delete from app.paciente_nota')).toMatchObject({
        ok: false,
        codigo: '42501',
      });
    });
    await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => {
        const { rows } = await c.query<{ accion: string; modulo: string; texto: string | null }>(
          `select a.accion, a.modulo, a.despues ->> 'texto' as texto from app.audit_log a
         join app.paciente_nota n on n.id = a.entidad_id
         where a.entidad = 'paciente_nota' and n.paciente_id = $1 order by a.fecha, a.id`,
          [pacienteId],
        );
        expect(rows).toEqual([
          { accion: 'crear', modulo: 'ficha_clinica', texto: 'Primera' },
          { accion: 'editar', modulo: 'ficha_clinica', texto: 'Segunda' },
          { accion: 'editar', modulo: 'ficha_clinica', texto: null },
          { accion: 'editar', modulo: 'ficha_clinica', texto: 'Tercera' },
        ]);
      },
    );
  });
});

describe('auditoría de pacientes', () => {
  it('alta y edición quedan con módulo pacientes y sin las columnas generadas; «ver paciente» registra el módulo', async () => {
    const id = await conApi('recepcion', (tx) =>
      crearPaciente(tx, { nombres: 'Lucía', apellidos: 'Benítez', ci: '3.456.789' }),
    );
    await conApi('recepcion', async (tx) => {
      expect(await editarPaciente(tx, id, { telefono: '0971 234 567', apellidos: null })).toBe(
        true,
      );
      await registrarEvento(tx, { accion: 'ver', entidad: 'paciente', entidadId: id });
    });
    await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      async (c) => {
        const { rows } = await c.query<{
          accion: string;
          modulo: string;
          usuario_id: string;
          despues: Record<string, unknown> | null;
        }>(
          `select accion, modulo, usuario_id, despues from app.audit_log
         where entidad = 'paciente' and entidad_id = $1 order by fecha, id`,
          [id],
        );
        expect(rows.map((f) => [f.accion, f.modulo, f.usuario_id])).toEqual([
          ['crear', 'pacientes', usuarios.recepcion],
          ['editar', 'pacientes', usuarios.recepcion],
          ['ver', 'pacientes', usuarios.recepcion],
        ]);
        expect(rows[0]?.despues).toMatchObject({ ci: '3456789', apellidos: 'Benítez' });
        expect(rows[0]?.despues).not.toHaveProperty('orden_apellidos');
        expect(rows[1]?.despues).toMatchObject({ telefono: '+595971234567', apellidos: null });
        expect(
          await valor(c, "select app.modulo_de_entidad(e) from unnest(array['paciente']) e"),
        ).toBe('pacientes');
      },
    );
  });

  it('un paciente no se borra (ni por DELETE ni por TRUNCATE)', async () => {
    await como('dueno', async (c) => {
      for (const tabla of ['paciente', 'paciente_relacion', 'paciente_alerta', 'paciente_nota']) {
        expect({ tabla, r: await intentar(c, `delete from app.${tabla}`) }).toMatchObject({
          tabla,
          r: { ok: false, codigo: '42501' },
        });
      }
    });
  });
});

describe('obtenerPaciente', () => {
  it('devuelve la ficha con la forma del contrato', async () => {
    const id = await conApi('odontologo', async (tx) => {
      const nuevo = await crearPaciente(tx, {
        nombres: 'Carlos',
        apellidos: 'Ayala',
        ci: '2345678',
        fechaNac: '1975-02-03',
        sexo: 'M',
        telefono: '0961 345 678',
        idioma: 'gn',
        aceptaWhatsapp: true,
      });
      await crearAlerta(tx, nuevo, { tipo: 'condicion', texto: 'Hipertensión' });
      return nuevo;
    });
    const ficha = await conApi('recepcion', (tx) =>
      obtenerPaciente(tx, id, { ahora: new Date('2026-11-22T12:00:00Z') }),
    );
    expect(ficha).toMatchObject({
      id,
      nombres: 'Carlos',
      apellidos: 'Ayala',
      ci: '2345678',
      telefono: '+595961345678',
      fechaNac: '1975-02-03',
      edad: 51,
      pediatrico: false,
      conAlerta: true,
      activo: true,
      sexo: 'M',
      idioma: 'gn',
      aceptaWhatsapp: true,
      origen: 'recepcion',
      notaInterna: null,
      relaciones: [],
      motivoBaja: null,
    });
    expect(ficha?.alertas.map((a) => a.texto)).toEqual(['Hipertensión']);
    expect(ficha?.creadoEn).toMatch(/Z$/);
    expect(await conApi('recepcion', (tx) => obtenerPaciente(tx, randomUUID()))).toBeNull();
  });
});
