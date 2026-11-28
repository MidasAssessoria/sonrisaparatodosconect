import { randomUUID } from 'node:crypto';
import { baseDeDatos, conContextoCliente } from '@conecta/db';
import {
  MODULOS,
  consultaAuditoriaSchema,
  paginaAuditoriaSchema,
  sedeSchema,
  sillonSchema,
  type EventoAuditoria,
  type PaginaAuditoria,
  type Sede,
} from '@conecta/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { consultaPagina, type AlcanceAuditoria } from '../src/auditoria/auditoria.service.js';
import {
  comoSistema,
  comoUsuarioAdmin,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  relojDeLaBase,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';

describe('auditoría', () => {
  let prueba: Prueba;
  let a: Clinica;
  let token: string;
  let admin: Persona;
  let tokenAdmin: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    token = await a.dueno.token();
    admin = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    tokenAdmin = await admin.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  async function pagina(consulta: string, t = token): Promise<PaginaAuditoria> {
    return segun(
      paginaAuditoriaSchema,
      (await prueba.pedir('get', `/auditoria${consulta}`, { token: t }).expect(200)).body,
    );
  }

  async function crearSede(nombre: string, t = token): Promise<Sede> {
    return segun(
      sedeSchema,
      (await prueba.pedir('post', '/sedes', { token: t, cuerpo: { nombre } }).expect(201)).body,
    );
  }

  it('alta, edición y baja de una sede quedan con usuario, antes y después', async () => {
    const sede = await crearSede('Auditada', tokenAdmin);
    await prueba
      .pedir('patch', `/sedes/${sede.id}`, { token: tokenAdmin, cuerpo: { telefono: '021 222' } })
      .expect(200);
    await prueba
      .pedir('delete', `/sedes/${sede.id}`, {
        token: tokenAdmin,
        cuerpo: { motivo: 'Cierre definitivo' },
      })
      .expect(204);

    const { items } = await pagina(`?entidad=sede&entidadId=${sede.id}`);
    expect(items.map((i) => i.accion)).toEqual(['anular', 'editar', 'crear']);
    for (const item of items) {
      expect(item.usuario).toEqual({ id: admin.usuarioId, nombre: expect.any(String) as string });
      expect(item.usuario?.nombre).toMatch(/^Usuario /);
      expect(item.entidad).toBe('sede');
      expect(item.entidadId).toBe(sede.id);
      expect(item.ip).toMatch(/127\.0\.0\.1|::1/);
    }
    const [baja, edicion, alta] = items as [EventoAuditoria, EventoAuditoria, EventoAuditoria];
    expect(alta.antes).toBeNull();
    expect(alta.despues).toMatchObject({
      nombre: 'Auditada',
      clinica_id: a.clinicaId,
      telefono: null,
    });
    expect(edicion.antes).toMatchObject({ telefono: null });
    expect(edicion.despues).toMatchObject({ telefono: '021 222' });
    expect(baja.antes).toMatchObject({ deleted_at: null });
    expect(baja.despues).toMatchObject({
      motivo_baja: 'Cierre definitivo',
      deleted_by: admin.usuarioId,
    });
    // Del más nuevo al más viejo.
    expect(baja.fecha >= edicion.fecha && edicion.fecha >= alta.fecha).toBe(true);
  });

  it('horarios y sillones también quedan registrados', async () => {
    const sede = await crearSede('Con todo');
    await prueba
      .pedir('put', `/sedes/${sede.id}/horarios`, {
        token,
        cuerpo: { horarios: [{ diaSemana: 2, horaInicio: '08:00', horaFin: '12:00' }] },
      })
      .expect(200);
    await prueba
      .pedir('put', `/sedes/${sede.id}/horarios`, {
        token,
        cuerpo: { horarios: [{ diaSemana: 3, horaInicio: '08:00', horaFin: '12:00' }] },
      })
      .expect(200);
    const sillon = segun(
      sillonSchema,
      (
        await prueba
          .pedir('post', `/sedes/${sede.id}/sillones`, { token, cuerpo: { nombre: 'S1' } })
          .expect(201)
      ).body,
    );
    await prueba
      .pedir('patch', `/sillones/${sillon.id}`, { token, cuerpo: { nombre: 'S2' } })
      .expect(200);
    await prueba
      .pedir('patch', `/sillones/${sillon.id}`, { token, cuerpo: { activo: false } })
      .expect(200);

    const horarios = (await pagina('?entidad=sede_horario&limite=100')).items.filter(
      (i) => (i.despues ?? i.antes)?.['sede_id'] === sede.id,
    );
    expect(horarios.map((i) => i.accion)).toEqual(['crear', 'anular', 'crear']);
    expect(horarios[1]?.despues).toMatchObject({ dia_semana: 2, activo: false });

    const sillones = (await pagina(`?entidadId=${sillon.id}`)).items;
    expect(sillones.map((i) => i.accion)).toEqual(['anular', 'editar', 'crear']);
    expect(sillones[1]).toMatchObject({ antes: { nombre: 'S1' }, despues: { nombre: 'S2' } });
    expect(sillones.every((i) => i.usuario?.id === a.duenoId)).toBe(true);
  });

  it('activar y quitar el doble factor queda como edición del usuario', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    await prueba.pedir('get', '/sesion', { token: await persona.token('aal2') }).expect(200);
    await prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal2') }).expect(204);
    const { items } = await pagina(`?entidad=usuario&accion=editar&entidadId=${persona.usuarioId}`);
    expect(
      items.map((i) => [i.accion, i.antes?.['mfa_activo'], i.despues?.['mfa_activo']]),
    ).toEqual([
      ['editar', true, false],
      ['editar', false, true],
    ]);
  });

  it('cada evento trae módulo, sede y el nombre del autor en ese momento', async () => {
    const sede = await crearSede('Con módulo', tokenAdmin);
    const { rowCount } = await comoUsuarioAdmin(
      prueba.admin,
      a.clinicaId,
      admin.usuarioId,
      'update app.usuario set nombre = $2 where id = $1',
      [admin.usuarioId, 'Nombre Nuevo'],
    );
    expect(rowCount).toBe(1);
    await prueba
      .pedir('patch', `/sedes/${sede.id}`, { token: tokenAdmin, cuerpo: { telefono: '1' } })
      .expect(200);
    const { items } = await pagina(`?entidad=sede&entidadId=${sede.id}`);
    expect(items.map((i) => [i.accion, i.modulo, i.sedeId, i.usuario?.nombre])).toEqual([
      ['editar', 'sedes', sede.id, 'Nombre Nuevo'],
      ['crear', 'sedes', sede.id, expect.stringMatching(/^Usuario /) as string],
    ]);
  });

  it('filtros: entidad, entidadId, usuarioId, accion, desde (inclusivo) y hasta (exclusivo)', async () => {
    const otra = await crearClinica(prueba, { sedes: 0 });
    const t = await otra.dueno.token();
    const persona = await crearPersona(prueba, otra.clinicaId, { rol: 'administracion' });
    const tp = await persona.token();
    const s1 = await crearSede('Uno', t);
    const s2 = await crearSede('Dos', tp);
    await prueba
      .pedir('patch', `/sedes/${s1.id}`, { token: t, cuerpo: { estado: 'cerrada' } })
      .expect(200);
    // El corte sale del reloj de la base (el mismo que fija `fecha`), no del de este proceso.
    const medio = await relojDeLaBase(prueba);
    await prueba
      .pedir('patch', `/sedes/${s2.id}`, { token: tp, cuerpo: { estado: 'proxima' } })
      .expect(200);

    const porUsuario = (await pagina(`?entidad=sede&usuarioId=${persona.usuarioId}`, t)).items;
    expect(porUsuario.map((i) => [i.entidadId, i.accion])).toEqual([
      [s2.id, 'editar'],
      [s2.id, 'crear'],
    ]);
    const ediciones = (await pagina('?entidad=sede&accion=editar', t)).items;
    expect(ediciones.map((i) => i.entidadId)).toEqual([s2.id, s1.id]);
    const desde = (await pagina(`?entidad=sede&desde=${encodeURIComponent(medio)}`, t)).items;
    expect(desde.map((i) => i.entidadId)).toEqual([s2.id]);
    const hasta = (await pagina(`?entidad=sede&hasta=${encodeURIComponent(medio)}`, t)).items;
    expect(hasta.map((i) => i.entidadId)).toEqual([s1.id, s2.id, s1.id]);
    const ninguna = (await pagina('?entidad=sillon', t)).items;
    expect(ninguna).toEqual([]);

    // Bordes exactos: `desde` incluye la fecha del evento y `hasta` la excluye.
    const ultimo = (await pagina(`?entidad=sede&entidadId=${s2.id}&accion=editar`, t)).items[0]!;
    const exacta = encodeURIComponent(ultimo.fecha);
    const conDesde = (await pagina(`?entidadId=${s2.id}&accion=editar&desde=${exacta}`, t)).items;
    expect(conDesde.map((i) => i.id)).toEqual([ultimo.id]);
    const conHasta = (await pagina(`?entidadId=${s2.id}&accion=editar&hasta=${exacta}`, t)).items;
    expect(conHasta).toEqual([]);
    const mismoInstante = (await pagina(`?entidadId=${s2.id}&desde=${exacta}&hasta=${exacta}`, t))
      .items;
    expect(mismoInstante).toEqual([]);
  });

  it('paginación con muchas filas de la misma fecha exacta: desempata por id sin repetir ni saltear', async () => {
    const otra = await crearClinica(prueba, { sedes: 1 });
    const t = await otra.dueno.token();
    const fecha = '2026-03-01T12:00:00.123456Z';
    // 9 filas con la misma fecha al microsegundo, insertadas como administración.
    const { rows } = await comoSistema<{ id: string }>(
      prueba.admin,
      otra.clinicaId,
      `insert into app.audit_log (clinica_id, fecha, entidad, entidad_id, accion, modulo, sede_id)
       select $1, $2::timestamptz, 'empate', gen_random_uuid(), 'ver', 'sedes', $3
       from generate_series(1, 9) returning id`,
      [otra.clinicaId, fecha, otra.sedes[0]!.sedeId],
    );
    const esperados = rows
      .map((r) => r.id)
      .sort()
      .reverse();

    for (const limite of [1, 2, 4]) {
      const vistos: string[] = [];
      let cursor: string | null = null;
      let paginas = 0;
      do {
        const consulta: string = `?entidad=empate&limite=${String(limite)}${cursor ? `&cursor=${cursor}` : ''}`;
        const p: PaginaAuditoria = await pagina(consulta, t);
        expect(p.items.every((i) => i.fecha === fecha)).toBe(true);
        if (p.siguienteCursor) expect(p.items).toHaveLength(limite);
        vistos.push(...p.items.map((i) => i.id));
        cursor = p.siguienteCursor;
        paginas++;
      } while (cursor);
      expect(vistos).toEqual(esperados);
      expect(paginas).toBe(Math.ceil(9 / limite));
    }

    // Sin filtro (la consulta que recorre el índice de paginación) también.
    const todo: string[] = [];
    let cursor: string | null = null;
    do {
      const consulta: string = `?limite=3&hasta=${encodeURIComponent('2026-03-01T12:00:00.123457Z')}${cursor ? `&cursor=${cursor}` : ''}`;
      const p: PaginaAuditoria = await pagina(consulta, t);
      todo.push(...p.items.map((i) => i.id));
      cursor = p.siguienteCursor;
    } while (cursor);
    expect(todo).toEqual(esperados);
  });

  it('la consulta de una página usa el índice (clinica_id, fecha DESC, id DESC), también con cursor', async () => {
    const otra = await crearClinica(prueba, { sedes: 1 });
    // Volumen suficiente para que el planificador elija el índice por sí solo.
    await comoSistema(
      prueba.admin,
      otra.clinicaId,
      `insert into app.audit_log (clinica_id, fecha, entidad, entidad_id, accion, modulo, sede_id)
       select $1, now() - make_interval(secs => g), 'relleno', gen_random_uuid(), 'ver',
              (array['sedes', 'agenda', 'caja', 'personal'])[1 + g % 4], case when g % 3 = 0 then null else $2::uuid end
       from generate_series(1, 5000) g`,
      [otra.clinicaId, otra.sedes[0]!.sedeId],
    );
    await prueba.admin.query('analyze app.audit_log');

    const api = new pg.Pool({ connectionString: inject('conectaDb').urlApi, max: 1 });
    try {
      const alcances: AlcanceAuditoria[] = [
        // Dueño: todos los módulos, todas las sedes.
        {
          clinicaId: otra.clinicaId,
          permisos: MODULOS.map((modulo) => ({ modulo, accion: 'ver' as const })),
          todasLasSedes: true,
          sedesPermitidas: [],
        },
        // Recepción con auditoría y una sede.
        {
          clinicaId: otra.clinicaId,
          permisos: (['agenda', 'caja', 'auditoria'] as const).map((modulo) => ({
            modulo,
            accion: 'ver' as const,
          })),
          todasLasSedes: false,
          sedesPermitidas: [otra.sedes[0]!.sedeId],
        },
      ];
      const cursor = { fecha: '2026-01-01T00:00:00.000000Z', id: randomUUID() };
      for (const alcance of alcances) {
        for (const posicion of [null, cursor]) {
          const q = consultaPagina(
            baseDeDatos(api),
            alcance,
            consultaAuditoriaSchema.parse({ limite: 50 }),
            posicion,
          ).toSQL();
          const plan = await conContextoCliente(
            api,
            { clinicaId: otra.clinicaId, usuarioId: otra.duenoId },
            (c) => c.query<{ 'QUERY PLAN': unknown }>(`explain (format json) ${q.sql}`, q.params),
          );
          const texto = JSON.stringify(plan.rows[0]?.['QUERY PLAN']);
          // Nunca recorre toda la auditoría: siempre entra por un índice que empieza por la clínica.
          expect(texto).not.toMatch(/"Node Type":"Seq Scan"[^}]*"Relation Name":"audit_log"/);
          expect(texto).toMatch(/"Index Cond":"[^"]*clinica_id = /);
          if (alcance === alcances[0]) {
            // Con todos los módulos (dueño), la página sale del índice por fecha sin ordenar.
            // Con un alcance chico (recepción: tres módulos y una sede) el planificador puede
            // preferir traer las pocas filas de la clínica por otro índice y ordenarlas: también
            // está bien, y depende de las estadísticas (en CI lo eligió tras la política de 0023).
            expect(texto).toContain('audit_log_clinica_fecha_idx');
            expect(texto).not.toContain('"Node Type":"Sort"');
            if (posicion) expect(texto).toMatch(/"Index Cond":"[^"]*fecha <=/);
          }
        }
      }
    } finally {
      await api.end();
    }
  });

  it('paginación por cursor: sin repetidos ni saltos, aunque lleguen registros nuevos en el medio', async () => {
    const otra = await crearClinica(prueba, { sedes: 0 });
    const t = await otra.dueno.token();
    for (let i = 0; i < 12; i++) await crearSede(`Paginada ${String(i)}`, t);

    /** Recorre todas las páginas; `alPasar` corre después de la primera. */
    async function recorrer(
      filtros: string,
      limite: number,
      alPasar?: () => Promise<unknown>,
    ): Promise<EventoAuditoria[]> {
      const vistos: EventoAuditoria[] = [];
      let cursor: string | null = null;
      let vueltas = 0;
      do {
        const consulta: string = `?limite=${String(limite)}${filtros}${cursor ? `&cursor=${cursor}` : ''}`;
        const p: PaginaAuditoria = await pagina(consulta, t);
        expect(p.items.length).toBeLessThanOrEqual(limite);
        vistos.push(...p.items);
        cursor = p.siguienteCursor;
        if (vueltas++ === 0) await alPasar?.();
      } while (cursor);
      return vistos;
    }

    // Todo el registro de la clínica (el alta sola deja más de 100 filas).
    const completa = await recorrer('', 100);
    expect(completa.length).toBeGreaterThan(100);
    // Registros nuevos mientras se pagina: no aparecen ni corren la paginación.
    const deA7 = await recorrer('', 7, () => crearSede('Llegó tarde', t));
    expect(deA7.map((i) => i.id)).toEqual(completa.map((i) => i.id));
    expect(new Set(deA7.map((i) => i.id)).size).toBe(deA7.length);
    // Orden estable (fecha, id) descendente.
    for (let i = 1; i < deA7.length; i++) {
      const anterior = deA7[i - 1]!;
      const actual = deA7[i]!;
      expect(
        anterior.fecha > actual.fecha ||
          (anterior.fecha === actual.fecha && anterior.id > actual.id),
      ).toBe(true);
    }

    // Con filtro: las 13 altas de sede en páginas de 5.
    const altas = await recorrer('&entidad=sede&accion=crear', 5);
    expect(altas).toHaveLength(13);
    expect(altas[0]?.despues?.['nombre']).toBe('Llegó tarde');
  });

  it('la última página exacta no deja un cursor colgado', async () => {
    const otra = await crearClinica(prueba, { sedes: 0 });
    const t = await otra.dueno.token();
    for (const nombre of ['A', 'B', 'C']) await crearSede(`Sede ${nombre}`, t);
    const p = await pagina('?entidad=sede&limite=3', t);
    expect(p.items).toHaveLength(3);
    expect(p.siguienteCursor).toBeNull();
    const p2 = await pagina('?entidad=sede&limite=2', t);
    expect(p2.siguienteCursor).not.toBeNull();
    const resto = await pagina(`?entidad=sede&limite=2&cursor=${p2.siguienteCursor ?? ''}`, t);
    expect(resto.items).toHaveLength(1);
    expect(resto.siguienteCursor).toBeNull();
  });

  it('consultas inválidas → datos_invalidos', async () => {
    for (const consulta of [
      '?limite=0',
      '?limite=101',
      '?limite=diez',
      '?accion=borrar',
      '?desde=ayer',
      '?hasta=2026-13-01T00:00:00Z',
      '?entidadId=123',
      '?usuarioId=nadie',
      `?entidad=${'x'.repeat(61)}`,
      '?accion=crear&accion=editar',
    ]) {
      await esperarError(
        prueba.pedir('get', `/auditoria${consulta}`, { token }),
        400,
        'datos_invalidos',
      );
    }
  });
});
