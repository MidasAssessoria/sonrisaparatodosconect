/**
 * Alcance de `GET /auditoria`: tener `auditoria:ver` no alcanza para ver cualquier cosa. Matriz rol ×
 * módulo × sede: cada quien ve solo eventos de módulos donde su rol tiene `ver` y de sedes que puede
 * ver (o sin sede); los eventos sin módulo, solo con `configuracion:ver`. Ningún filtro ni cursor
 * armado a mano lo esquiva, y el filtro va antes de paginar (no quedan páginas vacías).
 */
import { randomUUID } from 'node:crypto';
import {
  paginaAuditoriaSchema,
  sillonSchema,
  type EventoAuditoria,
  type Modulo,
  type PaginaAuditoria,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  otorgarPermiso,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';

/** Un evento sembrado a mano (como administración) con módulo y sede conocidos. */
interface Sembrado {
  id: string;
  entidad: string;
  entidadId: string;
  modulo: Modulo | null;
  sede: 'S1' | 'S2' | null;
}

describe('auditoría: alcance por módulo y por sede', () => {
  let prueba: Prueba;
  let a: Clinica;
  let s1: string;
  let s2: string;
  /** Recepción con auditoria:ver y sedes:ver, limitada a la sede 1. */
  let recepcion: Persona;
  let administracion: Persona;
  let sembrados: Sembrado[];

  async function todo(
    token: string,
    filtros = '',
    limite = 100,
  ): Promise<{ items: EventoAuditoria[]; paginas: PaginaAuditoria[] }> {
    const items: EventoAuditoria[] = [];
    const paginas: PaginaAuditoria[] = [];
    let cursor: string | null = null;
    do {
      const consulta: string = `?limite=${String(limite)}${filtros}${cursor ? `&cursor=${cursor}` : ''}`;
      const p: PaginaAuditoria = segun(
        paginaAuditoriaSchema,
        (await prueba.pedir('get', `/auditoria${consulta}`, { token }).expect(200)).body,
      );
      paginas.push(p);
      items.push(...p.items);
      cursor = p.siguienteCursor;
    } while (cursor);
    return { items, paginas };
  }

  function sedeDe(e: EventoAuditoria): 'S1' | 'S2' | 'otra' | null {
    if (e.sedeId === null) return null;
    return e.sedeId === s1 ? 'S1' : e.sedeId === s2 ? 'S2' : 'otra';
  }

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 2 });
    [s1, s2] = a.sedes.map((s) => s.sedeId) as [string, string];
    for (const accion of ['ver', 'crear'] as const) {
      await otorgarPermiso(prueba, a.clinicaId, a.roles.recepcion, 'sedes', accion);
    }
    await otorgarPermiso(prueba, a.clinicaId, a.roles.recepcion, 'auditoria', 'ver');
    recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion', sedes: [s1] });
    administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });

    // Actividad real por la API en las dos sedes (módulo sedes).
    const tokenDueno = await a.dueno.token();
    for (const sede of [s1, s2]) {
      segun(
        sillonSchema,
        (
          await prueba
            .pedir('post', `/sedes/${sede}/sillones`, {
              token: tokenDueno,
              cuerpo: { nombre: `Sillón ${randomUUID().slice(0, 4)}` },
            })
            .expect(201)
        ).body,
      );
      await prueba
        .pedir('patch', `/sedes/${sede}`, { token: tokenDueno, cuerpo: { telefono: '021 000' } })
        .expect(200);
    }

    // Eventos de otros módulos (como los que dejarán agenda, caja o la ficha clínica).
    const plan: Omit<Sembrado, 'id' | 'entidadId'>[] = [
      { entidad: 'turno', modulo: 'agenda', sede: 'S1' },
      { entidad: 'turno', modulo: 'agenda', sede: 'S2' },
      { entidad: 'cobro', modulo: 'caja', sede: null },
      { entidad: 'evolucion', modulo: 'ficha_clinica', sede: 'S1' },
      { entidad: 'evolucion', modulo: 'ficha_clinica', sede: null },
      { entidad: 'empleado', modulo: 'personal', sede: null },
      { entidad: 'importacion', modulo: null, sede: null },
      { entidad: 'importacion', modulo: null, sede: 'S1' },
    ];
    sembrados = [];
    for (const p of plan) {
      const entidadId = randomUUID();
      const { rows } = await comoSistema<{ id: string }>(
        prueba.admin,
        a.clinicaId,
        `insert into app.audit_log (clinica_id, usuario_id, usuario_nombre, entidad, entidad_id,
                                    accion, modulo, sede_id, despues)
         values ($1, null, null, $2, $3, 'ver', $4, $5, $6) returning id`,
        [
          a.clinicaId,
          p.entidad,
          entidadId,
          p.modulo,
          p.sede === 'S1' ? s1 : p.sede === 'S2' ? s2 : null,
          { secreto: `dato de ${p.entidad}` },
        ],
      );
      sembrados.push({ ...p, entidadId, id: rows[0]!.id });
    }
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('recepción con auditoria:ver y la sede 1: solo sus módulos con ver y la sede 1 (o sin sede)', async () => {
    const { items } = await todo(await recepcion.token());
    expect(items.length).toBeGreaterThan(0);
    const permitidos = new Set<Modulo>([
      'inicio',
      'agenda',
      'pacientes',
      'presupuestos',
      'caja',
      'mensajeria',
      'sedes',
      'auditoria',
    ]);
    for (const e of items) {
      expect(e.modulo !== null && permitidos.has(e.modulo), `módulo ${String(e.modulo)}`).toBe(
        true,
      );
      expect([null, 'S1']).toContain(sedeDe(e));
    }
    const ids = new Set(items.map((e) => e.id));
    const visto = (entidad: string, modulo: Modulo | null, sede: 'S1' | 'S2' | null) =>
      ids.has(
        sembrados.find((s) => s.entidad === entidad && s.modulo === modulo && s.sede === sede)!.id,
      );
    expect(visto('turno', 'agenda', 'S1')).toBe(true);
    expect(visto('cobro', 'caja', null)).toBe(true);
    expect(visto('turno', 'agenda', 'S2')).toBe(false);
    expect(visto('evolucion', 'ficha_clinica', 'S1')).toBe(false);
    expect(visto('evolucion', 'ficha_clinica', null)).toBe(false);
    expect(visto('empleado', 'personal', null)).toBe(false);
    expect(visto('importacion', null, null)).toBe(false);
    expect(visto('importacion', null, 'S1')).toBe(false);

    // De la actividad real: ve la sede 1 y su sillón, nada de la sede 2, nada de personal ni de
    // configuración (altas de usuarios con su correo, permisos de roles), ni ingresos de otros.
    expect(items.some((e) => e.entidad === 'sillon' && e.sedeId === s1)).toBe(true);
    expect(items.some((e) => e.entidad === 'sede' && e.entidadId === s1)).toBe(true);
    expect(items.some((e) => e.sedeId === s2)).toBe(false);
    expect(
      items.some((e) => ['usuario', 'membresia', 'rol_permiso', 'sesion'].includes(e.entidad)),
    ).toBe(false);
  });

  it('recepción: ningún filtro lo esquiva (entidad, entidadId, usuarioId, accion, fechas)', async () => {
    const token = await recepcion.token();
    const ficha = sembrados.find((s) => s.modulo === 'ficha_clinica' && s.sede === 'S1')!;
    const agendaS2 = sembrados.find((s) => s.modulo === 'agenda' && s.sede === 'S2')!;
    for (const filtros of [
      '&entidad=evolucion',
      `&entidadId=${ficha.entidadId}`,
      `&entidad=turno&entidadId=${agendaS2.entidadId}`,
      `&entidadId=${s2}`,
      '&entidad=sede&accion=editar&desde=2000-01-01T00:00:00Z',
      '&entidad=usuario',
      '&entidad=membresia',
      '&entidad=importacion',
      `&usuarioId=${administracion.usuarioId}`,
      `&usuarioId=${a.duenoId}&entidad=sede`,
    ]) {
      const { items } = await todo(token, filtros);
      for (const e of items) {
        expect(e.modulo === 'sedes' || e.modulo === 'agenda' || e.modulo === 'caja').toBe(true);
        expect([null, 'S1']).toContain(sedeDe(e));
      }
    }
    expect((await todo(token, '&entidad=usuario')).items).toEqual([]);
    expect((await todo(token, '&entidad=membresia')).items).toEqual([]);
    expect((await todo(token, `&entidadId=${ficha.entidadId}`)).items).toEqual([]);
    expect((await todo(token, '&entidad=evolucion')).items).toEqual([]);
    expect((await todo(token, `&entidadId=${s2}`)).items).toEqual([]);
    expect((await todo(token, `&entidadId=${agendaS2.entidadId}`)).items).toEqual([]);
    expect((await todo(token, '&entidad=importacion')).items).toEqual([]);
    const delDueno = (await todo(token, `&usuarioId=${a.duenoId}`)).items;
    expect(delDueno.length).toBeGreaterThan(0);
    expect(delDueno.every((e) => e.sedeId === s1 || e.sedeId === null)).toBe(true);
  });

  it('recepción: un cursor armado a mano solo mueve la posición dentro de su alcance', async () => {
    const token = await recepcion.token();
    const b64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString('base64url');
    // Apuntando al futuro, y justo arriba de un evento que no puede ver.
    const ficha = sembrados.find((s) => s.modulo === 'ficha_clinica' && s.sede === 'S1')!;
    const { rows } = await comoSistema<{ fecha: string }>(
      prueba.admin,
      a.clinicaId,
      `select to_char(fecha at time zone 'UTC' + interval '1 microsecond',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as fecha
       from app.audit_log where id = $1`,
      [ficha.id],
    );
    for (const cursor of [
      b64(['2999-01-01T00:00:00.000000Z', 'ffffffff-ffff-4fff-bfff-ffffffffffff']),
      b64([rows[0]!.fecha, ficha.id]),
      b64([rows[0]!.fecha, 'ffffffff-ffff-4fff-bfff-ffffffffffff']),
    ]) {
      const p = segun(
        paginaAuditoriaSchema,
        (await prueba.pedir('get', `/auditoria?limite=100&cursor=${cursor}`, { token }).expect(200))
          .body,
      );
      for (const e of p.items) {
        expect(e.modulo === 'sedes' || e.modulo === 'agenda' || e.modulo === 'caja').toBe(true);
        expect([null, 'S1']).toContain(sedeDe(e));
      }
      expect(p.items.some((e) => e.id === ficha.id)).toBe(false);
    }
  });

  it('el alcance se filtra antes de paginar: páginas llenas hasta la última', async () => {
    const { items, paginas } = await todo(await recepcion.token(), '', 1);
    expect(items.length).toBeGreaterThan(3);
    for (const p of paginas) expect(p.items).toHaveLength(1);
    expect(new Set(items.map((e) => e.id)).size).toBe(items.length);
  });

  it('administración ve todas las sedes y los eventos sin módulo, pero no los de un módulo que no tiene', async () => {
    const { items } = await todo(await administracion.token());
    const ids = new Set(items.map((e) => e.id));
    for (const s of sembrados) {
      // administración no tiene ficha_clinica (ni ver ni nada).
      expect({ entidad: s.entidad, visto: ids.has(s.id) }).toEqual({
        entidad: s.entidad,
        visto: s.modulo !== 'ficha_clinica',
      });
    }
    expect(items.some((e) => e.modulo === 'ficha_clinica')).toBe(false);
    expect(items.some((e) => e.sedeId === s2)).toBe(true);
    // Filtrando por la entidad o el id de la ficha, tampoco.
    expect((await todo(await administracion.token(), '&entidad=evolucion')).items).toEqual([]);
  });

  it('dueño ve todo, incluida la ficha clínica y los eventos sin módulo', async () => {
    const { items } = await todo(await a.dueno.token());
    const ids = new Set(items.map((e) => e.id));
    for (const s of sembrados) expect(ids.has(s.id)).toBe(true);
  });

  it('quitar el permiso ver de un módulo oculta sus eventos en el siguiente pedido', async () => {
    const token = await recepcion.token();
    const agendaS1 = sembrados.find((s) => s.modulo === 'agenda' && s.sede === 'S1')!;
    expect((await todo(token, '&entidad=turno')).items.map((e) => e.id)).toEqual([agendaS1.id]);
    await comoSistema(
      prueba.admin,
      a.clinicaId,
      "update app.rol_permiso set activo = false where rol_id = $1 and modulo = 'agenda' and accion = 'ver'",
      [a.roles.recepcion],
    );
    try {
      expect((await todo(token, '&entidad=turno')).items).toEqual([]);
    } finally {
      await otorgarPermiso(prueba, a.clinicaId, a.roles.recepcion, 'agenda', 'ver');
    }
  });

  it('sin auditoria:ver no hay auditoría, aunque tenga ver en otros módulos', async () => {
    const odontologo = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    await esperarError(
      prueba.pedir('get', '/auditoria', { token: await odontologo.token() }),
      403,
      'sin_permiso',
    );
  });
});
