/**
 * Revisión del Sprint 3 (0023–0027), como app_api: ficha_clinica sin ver (auditoría, alertas
 * inactivas, nota interna), patrón de búsqueda, normalización igual a @conecta/shared, cursor con
 * renombres, orden sin apellido, espejos que siguen al sexo, marcas desde los dos lados (con
 * concurrencia), tipo de alerta, resumen en un solo lugar y RUC.
 */
import { normalizarBusqueda } from '@conecta/shared';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buscarPacientes,
  conContexto,
  crearAlerta,
  crearRelacion,
  editarRelacion,
  guardarNotaInterna,
  listarAlertas,
  listarPacientes,
  listarRelaciones,
  obtenerAlerta,
  obtenerPaciente,
  pacientesConCi,
  registrarEvento,
} from '../src/index.js';
import {
  crearAlertaDePrueba,
  crearClinicaDePrueba,
  crearPacienteDePrueba,
  crearRolDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, errorDe, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi, 8);

let clinica: ClinicaDePrueba;
let otra: ClinicaDePrueba;
const u = {
  recepcion: '',
  odontologo: '',
  asistente: '',
  /** Rol a medida: pacientes:ver/editar y ficha_clinica:editar SIN ficha_clinica:ver. */
  editarSinVer: '',
  /** Rol a medida: solo pacientes:ver (para la auditoría genérica por módulo). */
  soloPacientes: '',
  /** Rol a medida: solo personal:ver. */
  soloPersonal: '',
};
type Quien = keyof typeof u | 'dueno';
const idDe = (q: Quien): string => (q === 'dueno' ? clinica.duenoId : u[q]);

beforeAll(async () => {
  [clinica, otra] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
  for (const rol of ['recepcion', 'odontologo', 'asistente'] as const) {
    u[rol] = (await crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId, rol })).usuarioId;
  }
  const aMedida: [keyof typeof u, string[]][] = [
    ['editarSinVer', ['pacientes:ver', 'pacientes:editar', 'ficha_clinica:editar']],
    ['soloPacientes', ['pacientes:ver']],
    ['soloPersonal', ['personal:ver']],
  ];
  for (const [clave, permisos] of aMedida) {
    const { rolId } = await crearRolDePrueba(admin, { clinicaId: clinica.clinicaId, permisos });
    u[clave] = (
      await crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId, rolId })
    ).usuarioId;
  }
});

/** Transacción cruda como app_api (se revierte salvo `confirmar`). */
function como<T>(
  quien: Quien,
  fn: (c: pg.PoolClient) => Promise<T>,
  confirmar = false,
): Promise<T> {
  return enTransaccion(api, { clinica: clinica.clinicaId, usuario: idDe(quien) }, fn, {
    confirmar,
  });
}

/** Transacción de Drizzle como app_api (se confirma). */
function conApi<T>(quien: Quien, fn: Parameters<typeof conContexto<T>>[2]): Promise<T> {
  return conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: idDe(quien) }, fn);
}

const paciente = async (
  datos: Omit<Parameters<typeof crearPacienteDePrueba>[1], 'clinicaId'> = {},
): Promise<string> =>
  (await crearPacienteDePrueba(admin, { ...datos, clinicaId: clinica.clinicaId })).pacienteId;

// ---------------------------------------------------------------------------------------------
// 1. ficha_clinica sin ver
// ---------------------------------------------------------------------------------------------
describe('ficha_clinica sin ver: la nota y las alertas inactivas no existen (0023)', () => {
  let pacienteId: string;
  let notaId: string;
  let activa: string;
  let inactiva: string;
  const SECRETO = 'Secreto clínico: toma anticoagulantes';

  beforeAll(async () => {
    pacienteId = await paciente({ nombres: 'Rosa', apellidos: 'Auditada' });
    await conApi('odontologo', async (tx) => {
      await guardarNotaInterna(tx, pacienteId, SECRETO);
      await guardarNotaInterna(tx, pacienteId, `${SECRETO} (editada)`);
      activa = (await crearAlerta(tx, pacienteId, { tipo: 'alergia', texto: 'Alergia al látex' }))
        .id;
      inactiva = (
        await crearAlerta(tx, pacienteId, { tipo: 'condicion', texto: 'Embarazo (ya no)' })
      ).id;
    });
    await como(
      'odontologo',
      (c) => c.query('select app.cambiar_alerta($1, false)', [inactiva]),
      true,
    );
    notaId = await enTransaccion(
      admin,
      { clinica: clinica.clinicaId, usuario: clinica.duenoId },
      (c) =>
        valor<string>(c, 'select id from app.paciente_nota where paciente_id = $1', [pacienteId]),
    );
  });

  const contarAuditoria = (c: pg.PoolClient, filtro: string, parametros: unknown[] = []) =>
    valor<number>(c, `select count(*)::int from app.audit_log where ${filtro}`, parametros);

  it('recepción y un rol con editar sin ver no leen la auditoría de ficha_clinica (ni el texto de la nota)', async () => {
    for (const quien of ['recepcion', 'editarSinVer', 'soloPacientes'] as const) {
      await como(quien, async (c) => {
        expect({ quien, n: await contarAuditoria(c, "modulo = 'ficha_clinica'") }).toEqual({
          quien,
          n: 0,
        });
        expect({
          quien,
          n: await contarAuditoria(
            c,
            "antes::text like '%Secreto%' or despues::text like '%Secreto%'",
          ),
        }).toEqual({ quien, n: 0 });
        expect(await contarAuditoria(c, 'entidad_id = any($1)', [[notaId, activa, inactiva]])).toBe(
          0,
        );
        // Lo de pacientes sí lo ven (tienen pacientes:ver).
        expect(await contarAuditoria(c, "modulo = 'pacientes'")).toBeGreaterThan(0);
      });
    }
    for (const quien of ['odontologo', 'asistente', 'dueno'] as const) {
      await como(quien, async (c) => {
        expect({
          quien,
          n: await contarAuditoria(c, "entidad = 'paciente_nota' and entidad_id = $1", [notaId]),
        }).toEqual({ quien, n: 2 });
      });
    }
  });

  it('la auditoría es genérica por módulo: sin <modulo>:ver no se lee ese módulo', async () => {
    await como('soloPersonal', async (c) => {
      expect(await contarAuditoria(c, "modulo = 'personal'")).toBeGreaterThan(0);
      expect(await contarAuditoria(c, "modulo <> 'personal'")).toBe(0);
    });
    await como('soloPacientes', async (c) => {
      expect(await contarAuditoria(c, "modulo = 'personal'")).toBe(0);
      expect(await contarAuditoria(c, "modulo not in ('pacientes')")).toBe(0);
    });
    // Sin usuario en el contexto (app_api), nada.
    await enTransaccion(api, { clinica: clinica.clinicaId }, async (c) => {
      expect(await contarAuditoria(c, 'true')).toBe(0);
    });
  });

  it('un evento propio (ver, ingresar) se registra y se lee aunque falte el ver del módulo', async () => {
    // soloPersonal no tiene pacientes:ver: la API no lo dejaría ver un paciente, pero la base no
    // tiene que fallar al registrar (registrar_evento hace INSERT … RETURNING).
    const id = await conApi('soloPersonal', (tx) =>
      registrarEvento(tx, { accion: 'ver', entidad: 'paciente', entidadId: pacienteId }),
    );
    await como('soloPersonal', async (c) => {
      expect(await contarAuditoria(c, 'id = $1', [id])).toBe(1);
    });
    // Para otro usuario ese evento es ajeno: lo ve solo si tiene pacientes:ver.
    await como('editarSinVer', async (c) => {
      expect(await contarAuditoria(c, 'id = $1', [id])).toBe(1);
    });
  });

  it('una alerta inactiva no existe sin ficha_clinica:ver (SELECT, funciones); la activa sí', async () => {
    for (const quien of ['recepcion', 'editarSinVer'] as const) {
      await como(quien, async (c) => {
        expect(
          await valor(c, 'select count(*)::int from app.paciente_alerta where paciente_id = $1', [
            pacienteId,
          ]),
        ).toBe(1);
        expect(
          await valor(c, 'select count(*)::int from app.paciente_alerta where not activa'),
        ).toBe(0);
        // Ni registrar haberla visto: registrar_evento (SECURITY DEFINER) no la encuentra.
        expect(
          await intentar(c, "select app.registrar_evento('ver', 'paciente_alerta', $1)", [
            inactiva,
          ]),
        ).toMatchObject({ ok: false, codigo: '22023' });
      });
      await conApi(quien, async (tx) => {
        expect(
          (await listarAlertas(tx, pacienteId, { incluirInactivas: true })).map((a) => a.id),
        ).toEqual([activa]);
        expect(await obtenerAlerta(tx, inactiva)).toBeNull();
      });
    }
    await conApi('asistente', async (tx) => {
      expect(
        (await listarAlertas(tx, pacienteId, { incluirInactivas: true })).map((a) => a.id).sort(),
      ).toEqual([activa, inactiva].sort());
    });
  });

  it('editar sin ver: no reactiva, no desactiva ni carga inactivas, y un UPDATE masivo no toca las inactivas', async () => {
    await como('editarSinVer', async (c) => {
      expect(await intentar(c, 'select app.cambiar_alerta($1, true)', [inactiva])).toMatchObject(
        rechazo('P0002', 'alerta_no_encontrada'),
      );
      expect(await intentar(c, 'select app.cambiar_alerta($1, false)', [activa])).toMatchObject(
        rechazo('42501', 'ficha_clinica_sin_permiso'),
      );
      expect(
        await intentar(
          c,
          `insert into app.paciente_alerta (clinica_id, paciente_id, tipo, texto, activa)
           values ($1, $2, 'alergia', 'Oculta desde el alta', false)`,
          [clinica.clinicaId, pacienteId],
        ),
      ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
      // Puede cargar una activa (la ve).
      expect(
        await intentar(c, "select app.crear_alerta($1, 'condicion', 'Diabetes')", [pacienteId]),
      ).toMatchObject({ ok: true });
      expect(
        await intentar(c, 'update app.paciente_alerta set activa = true where paciente_id = $1', [
          pacienteId,
        ]),
      ).toMatchObject({ ok: true });
    });
    await como('odontologo', async (c) => {
      expect(
        await valor(c, 'select activa from app.paciente_alerta where id = $1', [inactiva]),
      ).toBe(false);
    });
  });

  it('la nota: editar sin ver no la lee, no la escribe y un UPDATE sin WHERE no pisa ninguna', async () => {
    const otroPaciente = await paciente();
    await como('editarSinVer', async (c) => {
      expect(await valor(c, 'select count(*)::int from app.paciente_nota')).toBe(0);
      expect(
        await intentar(c, "update app.paciente_nota set texto = 'Pisada a ciegas'"),
      ).toMatchObject({ ok: true, cantidad: 0 });
      expect(
        await intentar(c, "select app.guardar_nota_interna($1, 'Nueva')", [pacienteId]),
      ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
      expect(
        await intentar(c, "select app.guardar_nota_interna($1, 'Nueva')", [otroPaciente]),
      ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
      expect(
        await intentar(
          c,
          "insert into app.paciente_nota (clinica_id, paciente_id, texto) values ($1, $2, 'x')",
          [clinica.clinicaId, otroPaciente],
        ),
      ).toMatchObject(rechazo('42501', 'ficha_clinica_sin_permiso'));
    });
    await conApi('odontologo', async (tx) => {
      expect((await obtenerPaciente(tx, pacienteId))?.notaInterna).toBe(`${SECRETO} (editada)`);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 2 y 3. Patrón y normalización
// ---------------------------------------------------------------------------------------------
describe('búsqueda normalizada como @conecta/shared (0024)', () => {
  it('app.normalizar_busqueda coincide con normalizarBusqueda (puntuación, apóstrofos, ñ pegada, números)', async () => {
    const textos = [
      'Giménez, Ana',
      "O'Higgins",
      'D’Andrea',
      'Peña',
      'PEÑA',
      'Peña',
      'Ñandutí',
      '04.123.456',
      '0981 123 456',
      '(0981) 123-456',
      '+595 981 123456',
      'Ana 34',
      'mix 0 00 000 0a a0 01b ñ01',
      '1.2.3 y 1 - 2 y 1 2',
      '¿Qué? ¡Sí! «Comillas» “dobles” — raya – media',
      'María-José Pérez_Ruiz',
      "Ka'aguy Mbo`y Ita´",
      '  tabulado\ty\nsalto  ',
      'İstanbul Straße Øre',
      'ª º ² ½',
      'emoji 😀 fin',
      'ń̃ Ñ́',
      'Mbaracayú ỹg̃ãẽĩõũ',
      '',
      '   ',
      '0',
      '007',
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

  it('términos: un número sin letras se une y pierde los ceros; las palabras quedan', async () => {
    await como('recepcion', async (c) => {
      const casos: [string, string[]][] = [
        ['gimenez, ana', ['gimenez', 'ana']],
        ["o'higgins", ['ohiggins']],
        ['04123456', ['4123456']],
        ['(0981) 123-456', ['981123456']],
        ['+595 981 123456', ['595981123456']],
        ['ana 0981', ['ana', '981']],
        ['.,;', []],
        ['😀 ²', []],
      ];
      for (const [texto, terminos] of casos) {
        expect({
          texto,
          t: await valor(c, 'select app.terminos_busqueda($1)', [texto]),
        }).toEqual({ texto, t: terminos });
      }
    });
  });

  it("casos que antes fallaban: «gimenez, ana», «ohiggins», «d'andrea», ñ pegada, «04123456»", async () => {
    const c1 = await crearClinicaDePrueba(admin);
    const alta = (datos: Omit<Parameters<typeof crearPacienteDePrueba>[1], 'clinicaId'>) =>
      crearPacienteDePrueba(admin, { ...datos, clinicaId: c1.clinicaId }).then((p) => p.pacienteId);
    const ana = await alta({ nombres: 'Ana', apellidos: 'Giménez', ci: '4123456' });
    const higgins = await alta({ nombres: 'Bernardo', apellidos: "O'Higgins" });
    const dandrea = await alta({ nombres: 'Lucía', apellidos: 'D’Andrea' });
    const penia = await alta({ nombres: 'Rosa', apellidos: 'Peña' });
    const pena = await alta({ nombres: 'Rosa', apellidos: 'Pena' });
    const pegada = await alta({ nombres: 'Rosa', apellidos: 'Peña Pegada' });
    const buscar = (q: string) =>
      conContexto(api, { clinicaId: c1.clinicaId, usuarioId: c1.duenoId }, (tx) =>
        buscarPacientes(tx, q),
      ).then((r) => r.map((p) => p.id));
    expect(await buscar('gimenez, ana')).toEqual([ana]);
    expect(await buscar('Giménez,Ana')).toEqual([ana]);
    expect(await buscar('ohiggins')).toEqual([higgins]);
    expect(await buscar("o'higgins")).toEqual([higgins]);
    expect(await buscar("d'andrea")).toEqual([dandrea]);
    expect(await buscar('dandrea')).toEqual([dandrea]);
    expect(await buscar('04123456')).toEqual([ana]);
    expect(await buscar('04.123.456')).toEqual([ana]);
    // La ñ pegada (n + U+0303) es una ñ, al guardar y al buscar; no es «pena».
    expect((await buscar('peña')).sort()).toEqual([penia, pegada].sort());
    expect((await buscar('Peña')).sort()).toEqual([penia, pegada].sort());
    expect(await buscar('pena')).toEqual([pena]);
    // La lista ordena «D’Andrea» como «dandrea».
    const lista = await conContexto(api, { clinicaId: c1.clinicaId, usuarioId: c1.duenoId }, (tx) =>
      listarPacientes(tx, {}),
    );
    expect(lista.items.map((p) => p.id)).toEqual([dandrea, ana, higgins, pena, penia, pegada]);
  });

  it('el patrón malformado no es un oráculo entre clínicas: la coincidencia solo está en la otra', async () => {
    await crearPacienteDePrueba(admin, { clinicaId: otra.clinicaId, apellidos: 'Xilofonista' });
    await como('recepcion', async (c) => {
      for (const patron of ['%xilofonista\\', '%xilofonista', 'xilofonista%', '%xilo_onista%']) {
        await c.query("select set_config('app.busqueda_patron', $1, true)", [patron]);
        expect({
          patron,
          r: await intentar(c, 'select count(*)::int as n from app.paciente_busqueda'),
        }).toMatchObject({ patron, r: { ok: true, filas: [{ n: 0 }] } });
      }
      expect(await valor(c, 'select app.patron_busqueda() is null')).toBe(true);
      await c.query("select set_config('app.busqueda_patron', '', true)");
      expect(await valor(c, 'select app.patron_busqueda()')).toBe('%');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 4 y 5. Cursor y orden
// ---------------------------------------------------------------------------------------------
describe('lista: cursor con renombres y orden sin apellido (0024, 0025)', () => {
  it('sin apellido ordena por el nombre, entre los apellidos', async () => {
    const c1 = await crearClinicaDePrueba(admin);
    const alta = (nombres: string, apellidos: string | null) =>
      crearPacienteDePrueba(admin, { clinicaId: c1.clinicaId, nombres, apellidos }).then(
        (p) => p.pacienteId,
      );
    const acosta = await alta('Ana', 'Acosta');
    const mateo = await alta('Mateo', null);
    const zarate = await alta('Bruno', 'Zárate');
    const nina = await alta('Ñandú', null);
    const lista = await conContexto(api, { clinicaId: c1.clinicaId, usuarioId: c1.duenoId }, (tx) =>
      listarPacientes(tx, {}),
    );
    expect(lista.items.map((p) => p.id)).toEqual([acosta, mateo, nina, zarate]);
  });

  it('si el último de la página se renombra antes de pedir la siguiente, no se saltea a nadie', async () => {
    const c1 = await crearClinicaDePrueba(admin);
    const ids: Record<string, string> = {};
    for (const apellido of ['Benítez', 'Cabrera', 'Duarte', 'Espínola', 'Franco', 'Galeano']) {
      ids[apellido] = (
        await crearPacienteDePrueba(admin, {
          clinicaId: c1.clinicaId,
          nombres: 'Ana',
          apellidos: apellido,
        })
      ).pacienteId;
    }
    const pagina = (cursor: string | null) =>
      conContexto(api, { clinicaId: c1.clinicaId, usuarioId: c1.duenoId }, (tx) =>
        listarPacientes(tx, { cursor, limite: 2 }),
      );
    const renombrar = (id: string, apellidos: string) =>
      enTransaccion(
        api,
        { clinica: c1.clinicaId, usuario: c1.duenoId },
        (c) => c.query('update app.paciente set apellidos = $2 where id = $1', [id, apellidos]),
        { confirmar: true },
      );
    const primera = await pagina(null);
    expect(primera.items.map((p) => p.id)).toEqual([ids['Benítez'], ids['Cabrera']]);
    // Cabrera pasa al final y Franco al principio: la página siguiente sigue desde donde estaba
    // Cabrera cuando se vio (antes, desde su posición nueva: se salteaban Duarte…Galeano).
    await renombrar(ids['Cabrera']!, 'Zubizarreta');
    await renombrar(ids['Franco']!, 'Aguilera');
    const vistos = [...primera.items.map((p) => p.id)];
    let cursor = primera.siguienteCursor;
    for (let vuelta = 0; cursor && vuelta < 10; vuelta++) {
      const p = await pagina(cursor);
      vistos.push(...p.items.map((x) => x.id));
      cursor = p.siguienteCursor;
    }
    for (const apellido of ['Duarte', 'Espínola', 'Galeano']) {
      expect({ apellido, visto: vistos.includes(ids[apellido]!) }).toEqual({
        apellido,
        visto: true,
      });
    }
    // Franco pasó para atrás del cursor: no aparece (se movió a una página ya vista).
    expect(vistos.includes(ids['Franco']!)).toBe(false);
  });

  it('cursores rotos o adulterados: cursor_invalido, nunca otro error', async () => {
    const valido = (
      await conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: clinica.duenoId }, (tx) =>
        listarPacientes(tx, { limite: 1 }),
      )
    ).siguienteCursor!;
    const casos = [
      'x',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      'A'.repeat(24),
      valido.slice(0, 20),
      `${valido.slice(0, -2)}%%`,
      `B${valido.slice(1)}`,
      'a'.repeat(3000),
    ];
    await como('recepcion', async (c) => {
      for (const cursor of casos) {
        expect({
          cursor: cursor.slice(0, 30),
          r: await intentar(c, 'select count(*) from app.listar_pacientes(p_cursor => $1)', [
            cursor,
          ]),
        }).toMatchObject({ cursor: cursor.slice(0, 30), r: rechazo('22023', 'cursor_invalido') });
      }
      expect(
        await intentar(c, 'select count(*) from app.listar_pacientes(p_cursor => $1)', [valido]),
      ).toMatchObject({ ok: true });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 6. Espejo y sexo
// ---------------------------------------------------------------------------------------------
describe('el espejo sigue al sexo; un tipo explícito que ya no corresponde se rechaza (0026)', () => {
  const tiposDelPar = (c: pg.PoolClient, a: string, b: string) =>
    c
      .query<{ desde: string; tipo: string; espejo: boolean }>(
        `select case when paciente_id = $1 then 'a' else 'b' end as desde, tipo, espejo
         from app.paciente_relacion
         where deleted_at is null
           and (paciente_id, familiar_id) in (($1::uuid, $2::uuid), ($2::uuid, $1::uuid))
         order by 1`,
        [a, b],
      )
      .then((r) => r.rows);
  const sexo = (c: pg.PoolClient, id: string, valorSexo: string | null) =>
    intentar(c, 'update app.paciente set sexo = $2 where id = $1', [id, valorSexo]);

  it('Ana sin sexo: su vínculo inverso es «otro» y pasa a madre / padre / otro cuando se carga', async () => {
    const ana = await paciente({ nombres: 'Ana', sexo: null });
    const mateo = await paciente({ nombres: 'Mateo', sexo: 'M' });
    await como('recepcion', async (c) => {
      await c.query("select app.crear_relacion($1, $2, 'hijo')", [ana, mateo]);
      expect(await tiposDelPar(c, ana, mateo)).toEqual([
        { desde: 'a', tipo: 'hijo', espejo: false },
        { desde: 'b', tipo: 'otro', espejo: true },
      ]);
      for (const [nuevo, inverso] of [
        ['F', 'madre'],
        ['M', 'padre'],
        [null, 'otro'],
        ['F', 'madre'],
      ] as const) {
        expect(await sexo(c, ana, nuevo)).toMatchObject({ ok: true });
        expect({ nuevo, filas: await tiposDelPar(c, ana, mateo) }).toEqual({
          nuevo,
          filas: [
            { desde: 'a', tipo: 'hijo', espejo: false },
            { desde: 'b', tipo: inverso, espejo: true },
          ],
        });
      }
      // Queda en la auditoría (editar del espejo, módulo pacientes).
      expect(
        await valor(
          c,
          `select count(*)::int from app.audit_log a join app.paciente_relacion r on r.id = a.entidad_id
           where r.paciente_id = $1 and r.familiar_id = $2 and a.accion = 'editar' and a.modulo = 'pacientes'`,
          [mateo, ana],
        ),
      ).toBe(4);
    });
  });

  it('una «madre» cargada a mano que pasa a M se rechaza con relacion_tipo_sexo; sin sexo, se acepta', async () => {
    const ana = await paciente({ nombres: 'Ana', sexo: 'F' });
    const mateo = await paciente({ nombres: 'Mateo', sexo: 'M' });
    await como('recepcion', async (c) => {
      // Desde la ficha de Mateo: Ana es su madre (tipo explícito).
      await c.query("select app.crear_relacion($1, $2, 'madre')", [mateo, ana]);
      expect(await tiposDelPar(c, mateo, ana)).toEqual([
        { desde: 'a', tipo: 'madre', espejo: false },
        { desde: 'b', tipo: 'hijo', espejo: true },
      ]);
      expect(await sexo(c, ana, 'M')).toMatchObject(rechazo('23514', 'relacion_tipo_sexo'));
      expect(await sexo(c, ana, null)).toMatchObject({ ok: true });
      expect((await tiposDelPar(c, mateo, ana))[0]).toMatchObject({ tipo: 'madre' });
      // Y con el vínculo dado de baja, el sexo cambia libre.
      await c.query(
        'select app.baja_relacion(id) from app.paciente_relacion where paciente_id = $1 and familiar_id = $2',
        [mateo, ana],
      );
      expect(await sexo(c, ana, 'M')).toMatchObject({ ok: true });
    });
  });

  it('el tipo no se edita a mano, ni en un espejo; el espejo no se inventa ni se desmarca', async () => {
    const ana = await paciente({ nombres: 'Ana', sexo: 'F' });
    const mateo = await paciente({ nombres: 'Mateo', sexo: 'M' });
    const sola = await paciente({ nombres: 'Sola' });
    await como('dueno', async (c) => {
      await c.query("select app.crear_relacion($1, $2, 'hijo')", [ana, mateo]);
      for (const [p, f, tipo] of [
        [ana, mateo, 'nieto'],
        [mateo, ana, 'padre'],
        [mateo, ana, 'otro'],
      ] as const) {
        expect(
          await intentar(
            c,
            'update app.paciente_relacion set tipo = $3 where paciente_id = $1 and familiar_id = $2',
            [p, f, tipo],
          ),
        ).toMatchObject({ ok: false, codigo: '42501' });
      }
      expect(
        await intentar(
          c,
          'update app.paciente_relacion set espejo = not espejo where paciente_id = $1',
          [mateo],
        ),
      ).toMatchObject({ ok: false, codigo: '42501' });
      expect(
        await intentar(
          c,
          `insert into app.paciente_relacion (clinica_id, paciente_id, familiar_id, tipo, espejo)
           values ($1, $2, $3, 'hermano', true)`,
          [clinica.clinicaId, sola, ana],
        ),
      ).toMatchObject(rechazo('23514', 'relacion_espejo_inconsistente'));
    });
  });

  it('recalcular el espejo exige pacientes:editar como cualquier cambio del paciente', async () => {
    const ana = await paciente({ nombres: 'Ana', sexo: null });
    const mateo = await paciente({ nombres: 'Mateo' });
    await como(
      'recepcion',
      (c) => c.query("select app.crear_relacion($1, $2, 'hijo')", [ana, mateo]),
      true,
    );
    await como('asistente', async (c) => {
      expect(await sexo(c, ana, 'F')).toMatchObject(rechazo('42501', 'pacientes_sin_permiso'));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Marcas desde los dos lados
// ---------------------------------------------------------------------------------------------
describe('marcas de tutor y responsable de pago desde los dos lados (0026)', () => {
  it('crear con las marcas del otro lado: Ana tutora y quien paga, cargado desde la ficha de Mateo', async () => {
    const ana = await paciente({ nombres: 'Ana', sexo: 'F' });
    const mateo = await paciente({ nombres: 'Mateo', sexo: 'M' });
    const desdeMateo = await conApi('recepcion', (tx) =>
      crearRelacion(tx, {
        pacienteId: mateo,
        familiarId: ana,
        tipo: 'madre',
        familiarEsTutorLegal: true,
        familiarEsResponsablePago: true,
      }),
    );
    expect(desdeMateo).toMatchObject({
      tipo: 'madre',
      esTutorLegal: false,
      esResponsablePago: false,
      familiarEsTutorLegal: true,
      familiarEsResponsablePago: true,
    });
    const desdeAna = await conApi('recepcion', (tx) => listarRelaciones(tx, ana));
    expect(desdeAna).toMatchObject([
      { tipo: 'hijo', esTutorLegal: true, esResponsablePago: true, familiarEsTutorLegal: false },
    ]);
    // Las dos marcas del mismo tipo a la vez, al crear: rechazado.
    const otro = await paciente();
    expect(
      await errorDe(
        conApi('recepcion', (tx) =>
          crearRelacion(tx, {
            pacienteId: otro,
            familiarId: mateo,
            tipo: 'hermano',
            esTutorLegal: true,
            familiarEsTutorLegal: true,
          }),
        ),
      ),
    ).toMatchObject({ codigo: '23514', restriccion: 'relacion_marca_un_sentido' });
  });

  it('editarRelacion desde cualquiera de los dos ids, con traspaso en un solo pedido', async () => {
    const ana = await paciente({ nombres: 'Ana', sexo: 'F' });
    const mateo = await paciente({ nombres: 'Mateo', sexo: 'M' });
    const desdeAna = await conApi('recepcion', (tx) =>
      crearRelacion(tx, { pacienteId: ana, familiarId: mateo, tipo: 'hijo', esTutorLegal: true }),
    );
    const idMateo = (await conApi('recepcion', (tx) => listarRelaciones(tx, mateo)))[0]!.id;

    // Desde la fila de Mateo: Ana deja de pagar… no pagaba; ahora sí.
    expect(
      await conApi('recepcion', (tx) =>
        editarRelacion(tx, idMateo, { familiarEsResponsablePago: true }),
      ),
    ).toMatchObject({ id: idMateo, familiarEsTutorLegal: true, familiarEsResponsablePago: true });
    // Mateo tutor de Ana mientras Ana es tutora de Mateo: no.
    expect(
      await errorDe(
        conApi('recepcion', (tx) => editarRelacion(tx, idMateo, { esTutorLegal: true })),
      ),
    ).toMatchObject({ codigo: '23514', restriccion: 'relacion_marca_un_sentido' });
    // Traspaso en un pedido (desde la fila de Ana): Ana deja de ser tutora y Mateo pasa a serlo.
    expect(
      await conApi('recepcion', (tx) =>
        editarRelacion(tx, desdeAna.id, { esTutorLegal: false, familiarEsTutorLegal: true }),
      ),
    ).toMatchObject({
      id: desdeAna.id,
      esTutorLegal: false,
      esResponsablePago: true,
      familiarEsTutorLegal: true,
      familiarEsResponsablePago: false,
    });
    // Sin cambios: devuelve igual la relación.
    await como('recepcion', async (c) => {
      expect(await valor(c, 'select app.editar_relacion($1)', [desdeAna.id])).toBe(false);
      expect(
        await valor(c, 'select app.editar_relacion($1, p_es_tutor_legal => false)', [desdeAna.id]),
      ).toBe(false);
    });
  });

  it('errores: id ajeno o inexistente, vínculo dado de baja, sin pacientes:editar', async () => {
    const ana = await paciente();
    const mateo = await paciente();
    const r = await conApi('recepcion', (tx) =>
      crearRelacion(tx, { pacienteId: ana, familiarId: mateo, tipo: 'hermano' }),
    );
    await como('asistente', async (c) => {
      expect(await intentar(c, 'select app.editar_relacion($1, true)', [r.id])).toMatchObject(
        rechazo('42501', 'pacientes_sin_permiso'),
      );
    });
    await enTransaccion(api, { clinica: otra.clinicaId, usuario: otra.duenoId }, async (c) => {
      expect(await intentar(c, 'select app.editar_relacion($1, true)', [r.id])).toMatchObject(
        rechazo('P0002', 'relacion_no_encontrada'),
      );
    });
    await como('recepcion', async (c) => {
      await c.query('select app.baja_relacion($1)', [r.id]);
      expect(await intentar(c, 'select app.editar_relacion($1, true)', [r.id])).toMatchObject(
        rechazo('22023', 'relacion_dada_de_baja'),
      );
    });
  });

  it('concurrencia: A tutor de B y B tutor de A a la vez, desde las dos fichas: solo uno gana', async () => {
    const a = await paciente();
    const b = await paciente();
    const r = await conApi('recepcion', (tx) =>
      crearRelacion(tx, { pacienteId: a, familiarId: b, tipo: 'hermano' }),
    );
    const reverso = (await conApi('recepcion', (tx) => listarRelaciones(tx, b)))[0]!.id;

    for (const via of ['funcion', 'update'] as const) {
      const c1 = await api.connect();
      const c2 = await api.connect();
      try {
        for (const c of [c1, c2]) {
          await c.query('begin');
          await c.query("select set_config('app.clinica_id', $1, true)", [clinica.clinicaId]);
          await c.query("select set_config('app.usuario_id', $1, true)", [u.recepcion]);
        }
        const marcar = (c: pg.PoolClient, id: string) =>
          via === 'funcion'
            ? c.query('select app.editar_relacion($1, true)', [id])
            : c.query('update app.paciente_relacion set es_tutor_legal = true where id = $1', [id]);
        await marcar(c1, r.id);
        // c2 marca el otro sentido: espera a c1.
        const segundo = marcar(c2, reverso).then(
          () => null,
          (e: { code?: string; constraint?: string }) => ({
            codigo: e.code,
            restriccion: e.constraint,
          }),
        );
        await new Promise((listo) => setTimeout(listo, 300));
        await c1.query('commit');
        expect({ via, error: await segundo }).toEqual({
          via,
          error: { codigo: '23514', restriccion: 'relacion_marca_un_sentido' },
        });
        await c2.query('rollback');
      } finally {
        c1.release();
        c2.release();
      }
      // Quedó una sola marca; se limpia para la otra vuelta.
      await como(
        'recepcion',
        async (c) => {
          expect(
            await valor(
              c,
              'select count(*)::int from app.paciente_relacion where id = any($1) and es_tutor_legal',
              [[r.id, reverso]],
            ),
          ).toBe(1);
          await c.query('select app.editar_relacion($1, false, null, false)', [r.id]);
        },
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Tipo de alerta
// ---------------------------------------------------------------------------------------------
describe('alertas con tipo (0027)', () => {
  it('se carga con tipo, se devuelve con tipo y no cambia; un tipo fuera de la lista se rechaza', async () => {
    const p = await paciente();
    const alerta = await conApi('odontologo', (tx) =>
      crearAlerta(tx, p, { tipo: 'condicion', texto: 'Anticoagulado' }),
    );
    expect(alerta).toMatchObject({ tipo: 'condicion', texto: 'Anticoagulado', activa: true });
    await como('odontologo', async (c) => {
      expect(
        await intentar(c, "select app.crear_alerta($1, 'medicamento', 'Algo')", [p]),
      ).toMatchObject(rechazo('23514', 'paciente_alerta_tipo_check'));
      expect(
        await intentar(c, "update app.paciente_alerta set tipo = 'alergia' where id = $1", [
          alerta.id,
        ]),
      ).toMatchObject({ ok: false, codigo: '42501' });
      expect(
        await intentar(
          c,
          "insert into app.paciente_alerta (clinica_id, paciente_id, texto) values ($1, $2, 'Sin tipo')",
          [clinica.clinicaId, p],
        ),
      ).toMatchObject({ ok: false, codigo: '23502' });
    });
    const { alertaId } = await crearAlertaDePrueba(admin, {
      clinicaId: clinica.clinicaId,
      pacienteId: p,
      activa: false,
    });
    await conApi('odontologo', async (tx) => {
      expect(await obtenerAlerta(tx, alertaId)).toMatchObject({ tipo: 'alergia', activa: false });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 9. Resumen en un solo lugar
// ---------------------------------------------------------------------------------------------
describe('edad, pediátrico y con_alerta salen de app.resumen_pacientes (0025)', () => {
  it('buscar, listar, CI repetida, ficha y familiares dicen lo mismo', async () => {
    const c1 = await crearClinicaDePrueba(admin);
    const nino = (
      await crearPacienteDePrueba(admin, {
        clinicaId: c1.clinicaId,
        nombres: 'Tomás',
        apellidos: 'Resumido',
        ci: '7654321',
        fechaNac: '2014-03-15',
      })
    ).pacienteId;
    const madre = (
      await crearPacienteDePrueba(admin, { clinicaId: c1.clinicaId, nombres: 'Ana', sexo: 'F' })
    ).pacienteId;
    await crearAlertaDePrueba(admin, { clinicaId: c1.clinicaId, pacienteId: nino });
    const ahora = new Date('2026-03-15T02:30:00Z'); // 23:30 del 14 en Asunción: 11 años
    const esperado = { id: nino, edad: 11, pediatrico: true, conAlerta: true };
    await conContexto(api, { clinicaId: c1.clinicaId, usuarioId: c1.duenoId }, async (tx) => {
      await crearRelacion(tx, { pacienteId: madre, familiarId: nino, tipo: 'hijo' });
      expect((await buscarPacientes(tx, 'resumido', { ahora }))[0]).toMatchObject(esperado);
      expect(
        (await listarPacientes(tx, { filtro: 'pediatricos', ahora })).items.map((p) => p.id),
      ).toEqual([nino]);
      expect((await listarPacientes(tx, { filtro: 'con_alerta', ahora })).items[0]).toMatchObject(
        esperado,
      );
      expect((await pacientesConCi(tx, '7.654.321'))[0]).toMatchObject({ id: nino });
      expect(await obtenerPaciente(tx, nino, { ahora })).toMatchObject(esperado);
      expect((await listarRelaciones(tx, madre, { ahora }))[0]?.familiar).toMatchObject({
        id: nino,
        edad: 11,
      });
    });
  });

  it('ninguna otra función de app calcula la edad pediátrica ni mira las alertas para el resumen', async () => {
    const filas = await enTransaccion(admin, {}, (c) =>
      c
        .query<{ funcion: string }>(
          `select p.oid::regprocedure::text as funcion from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.prokind = 'f'
             and pg_get_functiondef(p.oid) ~ 'edad_pediatrica|age\\('
           order by 1`,
        )
        .then((r) => r.rows.map((f) => f.funcion)),
    );
    expect(filas).toEqual([
      'app.edad_en(date,date)',
      'app.resumen_pacientes(timestamp with time zone)',
    ]);
  });

  it('Postgres expande app.resumen_pacientes en la lista: usa el índice de orden de paciente', async () => {
    await como('recepcion', async (c) => {
      const { rows } = await c.query<{ 'QUERY PLAN': string }>(
        `explain (costs off)
         select r.id from app.resumen_pacientes(now()) r
         where r.activo order by r.orden_apellidos collate "C", r.orden_nombres collate "C", r.id limit 50`,
      );
      const plan = rows.map((f) => f['QUERY PLAN']).join('\n');
      expect(plan).not.toMatch(/Function Scan/);
      expect(plan).toMatch(/paciente_orden_idx/);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 10. RUC
// ---------------------------------------------------------------------------------------------
describe('RUC como normalizarRuc (0027)', () => {
  it('base solo ceros o de menos de 3 caracteres: paciente_ruc_check', async () => {
    await como('recepcion', async (c) => {
      for (const ruc of ['000-0', '0-0', '00000000-0', '1-1', '12-3', '0012-3']) {
        expect({
          ruc,
          r: await intentar(
            c,
            "insert into app.paciente (clinica_id, nombres, ruc) values ($1, 'Ana', $2)",
            [clinica.clinicaId, ruc],
          ),
        }).toMatchObject({ ruc, r: rechazo('23514', 'paciente_ruc_check') });
      }
      for (const [ruc, guardado] of [
        ['80.099.999-1', '80099999-1'],
        ['00123-4', '123-4'],
        ['1234567a-2', '1234567A-2'],
      ] as const) {
        expect(
          await valor(
            c,
            "insert into app.paciente (clinica_id, nombres, ruc) values ($1, 'Ana', $2) returning ruc",
            [clinica.clinicaId, ruc],
          ),
        ).toBe(guardado);
      }
    });
  });
});
