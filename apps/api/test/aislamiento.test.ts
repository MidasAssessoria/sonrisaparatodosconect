/**
 * Aislamiento entre clínicas de punta a punta (HTTP → guard → RLS): con la sesión de A no se lee,
 * edita ni da de baja nada de B, aunque el usuario mande ids de B o `clinica_id` en el cuerpo o en
 * la consulta, e incluso si el usuario también es miembro de B pero trabaja con la cabecera de A.
 */
import {
  paginaAuditoriaSchema,
  sedeSchema,
  type EventoAuditoria,
  type PaginaAuditoria,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';

type Metodo = 'get' | 'post' | 'patch' | 'put' | 'delete';

describe('aislamiento entre clínicas', () => {
  let prueba: Prueba;
  let a: Clinica;
  let b: Clinica;
  let tokenA: string;
  /** Administración en A y en B (membresía legítima en las dos). */
  let doble: Persona;
  let fotoB: string;

  async function fotografiarB(): Promise<string> {
    const { rows } = await comoSistema(
      prueba.admin,
      b.clinicaId,
      `select json_build_object(
         'sedes', (select json_agg(s order by s.id) from app.sede s),
         'sillones', (select json_agg(x order by x.id) from app.sillon x),
         'horarios', (select json_agg(h order by h.id) from app.sede_horario h)) as foto`,
    );
    return JSON.stringify(rows[0]);
  }

  async function auditoriaCompleta(token: string, clinica?: string): Promise<EventoAuditoria[]> {
    const items: EventoAuditoria[] = [];
    let cursor: string | null = null;
    do {
      const consulta: string = cursor ? `?limite=100&cursor=${cursor}` : '?limite=100';
      const pagina: PaginaAuditoria = segun(
        paginaAuditoriaSchema,
        (
          await prueba
            .pedir('get', `/auditoria${consulta}`, { token, ...(clinica ? { clinica } : {}) })
            .expect(200)
        ).body,
      );
      items.push(...pagina.items);
      cursor = pagina.siguienteCursor;
    } while (cursor);
    return items;
  }

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { nombre: 'Clínica A', sedes: 2 });
    b = await crearClinica(prueba, { nombre: 'Clínica B', sedes: 2 });
    tokenA = await a.dueno.token();
    doble = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    await crearPersona(prueba, b.clinicaId, { rol: 'administracion', usuarioId: doble.usuarioId });

    // Actividad en B: deja registros de auditoría con ids de B.
    const tokenB = await b.dueno.token();
    const sede = segun(
      sedeSchema,
      (
        await prueba
          .pedir('post', '/sedes', { token: tokenB, cuerpo: { nombre: 'Secreta de B' } })
          .expect(201)
      ).body,
    );
    await prueba
      .pedir('put', `/sedes/${sede.id}/horarios`, {
        token: tokenB,
        cuerpo: { horarios: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '12:00' }] },
      })
      .expect(200);
    fotoB = await fotografiarB();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  function ataquesPorId(sede: string, sillon: string): [Metodo, string, object | undefined][] {
    return [
      ['get', `/sedes/${sede}`, undefined],
      ['patch', `/sedes/${sede}`, { nombre: 'Hackeada' }],
      ['delete', `/sedes/${sede}`, { motivo: 'Baja ajena' }],
      ['put', `/sedes/${sede}/horarios`, { horarios: [] }],
      ['post', `/sedes/${sede}/sillones`, { nombre: 'Intruso' }],
      ['patch', `/sillones/${sillon}`, { activo: false }],
    ];
  }

  it('con la sesión de A, cada id de B responde no_encontrado (404) y B no cambia', async () => {
    for (const { sedeId, sillonId } of b.sedes) {
      for (const [metodo, ruta, cuerpo] of ataquesPorId(sedeId, sillonId)) {
        await esperarError(
          prueba.pedir(metodo, ruta, { token: tokenA, ...(cuerpo ? { cuerpo } : {}) }),
          404,
          'no_encontrado',
        );
      }
    }
    expect(await fotografiarB()).toBe(fotoB);
  });

  it('miembro de A y de B, trabajando con la cabecera de A: los ids de B no existen', async () => {
    const token = await doble.token();
    const [sedeB] = b.sedes;
    for (const [metodo, ruta, cuerpo] of ataquesPorId(sedeB!.sedeId, sedeB!.sillonId)) {
      await esperarError(
        prueba.pedir(metodo, ruta, { token, clinica: a.clinicaId, ...(cuerpo ? { cuerpo } : {}) }),
        404,
        'no_encontrado',
      );
    }
    // Con la cabecera de B (donde sí es miembro) la misma sede existe.
    await prueba
      .pedir('get', `/sedes/${sedeB!.sedeId}`, { token, clinica: b.clinicaId })
      .expect(200);
    expect(await fotografiarB()).toBe(fotoB);
  });

  it('GET /sedes de A no lista sedes de B, aunque la consulta pida B', async () => {
    for (const consulta of ['', `?clinica_id=${b.clinicaId}`, `?clinicaId=${b.clinicaId}`]) {
      const sedes = segun(
        z.array(sedeSchema),
        (await prueba.pedir('get', `/sedes${consulta}`, { token: tokenA }).expect(200)).body,
      );
      expect(sedes.length).toBeGreaterThan(0);
      for (const s of sedes) expect(b.sedes.map((x) => x.sedeId)).not.toContain(s.id);
    }
  });

  it('clinica_id en el cuerpo se ignora: la sede nace en A', async () => {
    const sede = segun(
      sedeSchema,
      (
        await prueba
          .pedir('post', '/sedes', {
            token: tokenA,
            cuerpo: { nombre: 'Intento cruzado', clinica_id: b.clinicaId, clinicaId: b.clinicaId },
          })
          .expect(201)
      ).body,
    );
    await prueba
      .pedir('patch', `/sedes/${sede.id}`, {
        token: tokenA,
        cuerpo: { clinica_id: b.clinicaId, clinicaId: b.clinicaId, telefono: '1' },
      })
      .expect(200);
    await prueba
      .pedir('post', `/sedes/${sede.id}/sillones`, {
        token: tokenA,
        cuerpo: { nombre: 'S', clinica_id: b.clinicaId, sedeId: b.sedes[0]!.sedeId },
      })
      .expect(201);
    const { rows } = await comoSistema<{ clinica_id: string }>(
      prueba.admin,
      a.clinicaId,
      `select clinica_id from app.sede where id = $1
       union all select clinica_id from app.sillon where sede_id = $1`,
      [sede.id],
    );
    expect(rows.map((r) => r.clinica_id)).toEqual([a.clinicaId, a.clinicaId]);
    expect(await fotografiarB()).toBe(fotoB);
  });

  it('la auditoría de A no muestra nada de B, ni filtrando por ids o usuarios de B', async () => {
    const idsDeB = new Set<string>([
      b.clinicaId,
      b.duenoId,
      ...b.sedes.flatMap((s) => [s.sedeId, s.sillonId]),
      ...Object.values(b.roles),
    ]);
    const { rows } = await comoSistema<{ id: string }>(
      prueba.admin,
      b.clinicaId,
      'select id from app.audit_log where clinica_id = $1',
      [b.clinicaId],
    );
    const registrosDeB = new Set(rows.map((r) => r.id));
    expect(registrosDeB.size).toBeGreaterThan(0);

    const items = await auditoriaCompleta(tokenA);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(registrosDeB.has(item.id)).toBe(false);
      if (item.entidadId) expect(idsDeB.has(item.entidadId)).toBe(false);
    }

    for (const consulta of [
      `?entidadId=${b.sedes[0]!.sedeId}`,
      `?usuarioId=${b.duenoId}`,
      `?entidad=clinica&entidadId=${b.clinicaId}`,
      `?clinica_id=${b.clinicaId}&entidad=sede`,
    ]) {
      const pagina = segun(
        paginaAuditoriaSchema,
        (await prueba.pedir('get', `/auditoria${consulta}`, { token: tokenA }).expect(200)).body,
      );
      for (const item of pagina.items) expect(registrosDeB.has(item.id)).toBe(false);
      if (!consulta.includes('entidad=sede')) expect(pagina.items).toEqual([]);
    }

    // El miembro doble ve la de B solo con la cabecera de B.
    const deB = await auditoriaCompleta(await doble.token(), b.clinicaId);
    expect(deB.every((i) => registrosDeB.has(i.id))).toBe(true);
    const deA = await auditoriaCompleta(await doble.token(), a.clinicaId);
    expect(deA.some((i) => registrosDeB.has(i.id))).toBe(false);
  });

  it('un cursor armado con un registro de B no filtra datos de B', async () => {
    const { rows } = await comoSistema<{ fecha: string; id: string }>(
      prueba.admin,
      b.clinicaId,
      `select to_char(fecha at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as fecha, id
       from app.audit_log where clinica_id = $1 order by fecha desc limit 1`,
      [b.clinicaId],
    );
    const fila = rows[0]!;
    const cursor = Buffer.from(JSON.stringify([fila.fecha, fila.id])).toString('base64url');
    const pagina = segun(
      paginaAuditoriaSchema,
      (await prueba.pedir('get', `/auditoria?cursor=${cursor}`, { token: tokenA }).expect(200))
        .body,
    );
    const idsDeB = await comoSistema<{ id: string }>(
      prueba.admin,
      b.clinicaId,
      'select id from app.audit_log where clinica_id = $1',
      [b.clinicaId],
    );
    const deB = new Set(idsDeB.rows.map((r) => r.id));
    expect(pagina.items.some((i) => deB.has(i.id))).toBe(false);
  });
});
