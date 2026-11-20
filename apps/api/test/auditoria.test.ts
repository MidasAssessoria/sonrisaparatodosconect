import {
  paginaAuditoriaSchema,
  sedeSchema,
  sillonSchema,
  type EventoAuditoria,
  type PaginaAuditoria,
  type Sede,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
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

  it('filtros: entidad, entidadId, usuarioId, accion, desde y hasta', async () => {
    const otra = await crearClinica(prueba, { sedes: 0 });
    const t = await otra.dueno.token();
    const persona = await crearPersona(prueba, otra.clinicaId, { rol: 'administracion' });
    const tp = await persona.token();
    const s1 = await crearSede('Uno', t);
    const s2 = await crearSede('Dos', tp);
    await prueba
      .pedir('patch', `/sedes/${s1.id}`, { token: t, cuerpo: { estado: 'cerrada' } })
      .expect(200);
    const medio = new Date().toISOString();
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
