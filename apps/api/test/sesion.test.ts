import { randomUUID } from 'node:crypto';
import { sesionSchema, type Sesion } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  comoUsuarioAdmin,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  ingresosDeSesion,
  leerSesion,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

describe('GET /sesion', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 3 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  async function sesion(token: string): Promise<Sesion> {
    return segun(sesionSchema, (await prueba.pedir('get', '/sesion', { token }).expect(200)).body);
  }

  it('dueño: clínica, rol que exige doble factor, todos los permisos y todas las sedes', async () => {
    const s = await sesion(await a.dueno.token());
    expect(s.usuario).toMatchObject({ id: a.duenoId, mfaActivo: true });
    expect(s.nivelAutenticacion).toBe('aal2');
    expect(s.clinica.id).toBe(a.clinicaId);
    expect(s.clinica.zonaHoraria).toBe('America/Asuncion');
    expect(s.clinicas).toEqual([{ id: a.clinicaId, nombre: a.nombre }]);
    expect(s.rol).toMatchObject({ codigo: 'dueno', exigeMfa: true });
    expect(s.permisos).toHaveLength(14 * 5);
    expect(s.sedes.map((x) => x.id).sort()).toEqual(a.sedes.map((x) => x.sedeId).sort());
    expect(s.puedeVerTodasLasSedes).toBe(true);
    expect(s.inactividadMin).toBe(30);
  });

  it('recepción: solo sus sedes (asignadas + por defecto), 15 minutos, sin doble factor obligatorio', async () => {
    const [s1, s2] = a.sedes;
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [s1!.sedeId],
      sedeDefectoId: s2!.sedeId,
    });
    const s = await sesion(await persona.token());
    expect(s.rol).toMatchObject({ codigo: 'recepcion', exigeMfa: false });
    expect(s.nivelAutenticacion).toBe('aal1');
    expect(s.inactividadMin).toBe(15);
    expect(s.sedes.map((x) => x.id).sort()).toEqual([s1!.sedeId, s2!.sedeId].sort());
    expect(s.sedeDefectoId).toBe(s2!.sedeId);
    expect(s.puedeVerTodasLasSedes).toBe(true);
    expect(s.permisos.some((p) => p.modulo === 'sedes')).toBe(false);
  });

  it('los atributos del rol salen de la base, no del código del rol', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
    await comoSistema(
      prueba.admin,
      a.clinicaId,
      'update app.rol set todas_las_sedes = true, inactividad_min = 45 where id = $1',
      [a.roles.asistente],
    );
    try {
      const s = await sesion(await persona.token());
      expect(s.inactividadMin).toBe(45);
      expect(s.sedes).toHaveLength(3);
      await comoSistema(
        prueba.admin,
        a.clinicaId,
        'update app.rol set exige_mfa = true where id = $1',
        [a.roles.asistente],
      );
      await esperarError(
        prueba.pedir('get', '/sesion', { token: await persona.token('aal1') }),
        403,
        'mfa_requerido',
      );
      expect((await sesion(await persona.token('aal2'))).rol.exigeMfa).toBe(true);
    } finally {
      await comoSistema(
        prueba.admin,
        a.clinicaId,
        'update app.rol set todas_las_sedes = false, exige_mfa = false, inactividad_min = 30 where id = $1',
        [a.roles.asistente],
      );
    }
  });

  it('una sola sede visible: no ofrece «Todas las sedes»', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'odontologo',
      sedes: [a.sedes[0]!.sedeId],
    });
    const s = await sesion(await persona.token());
    expect(s.sedes).toHaveLength(1);
    expect(s.puedeVerTodasLasSedes).toBe(false);
    expect(s.sedeDefectoId).toBeNull();
  });

  it('actualiza ultimo_acceso sin dejar registro de auditoría de edición', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
    await sesion(await persona.token());
    const { rows } = await comoSistema<{ ultimo_acceso: Date | null }>(
      prueba.admin,
      a.clinicaId,
      'select ultimo_acceso from app.usuario where id = $1',
      [persona.usuarioId],
    );
    expect(rows[0]?.ultimo_acceso).toBeInstanceOf(Date);
    const auditoria = await comoSistema<{ n: string }>(
      prueba.admin,
      a.clinicaId,
      `select count(*) as n from app.audit_log where entidad = 'usuario' and entidad_id = $1 and accion = 'editar'`,
      [persona.usuarioId],
    );
    expect(Number(auditoria.rows[0]?.n)).toBe(0);
  });

  it('un correo que la base acepta pero no es un correo «válido» para Zod no rompe el ingreso', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      email: `persona-${randomUUID().slice(0, 8)}@localhost`,
    });
    const s = await sesion(await persona.token());
    expect(s.usuario.email).toBe(persona.email);
    expect(s.usuario.email).toMatch(/@localhost$/);
  });
});

describe('sesiones del lado del servidor', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('ingresar se registra una sola vez por sesión, con módulo personal y la IP', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    for (let i = 0; i < 3; i++) {
      await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200);
    }
    // Un pedido sin permiso también es actividad de la misma sesión.
    await esperarError(
      prueba.pedir('get', '/sedes', { token: await persona.token() }),
      403,
      'sin_permiso',
    );
    expect(await ingresosDeSesion(prueba, a.clinicaId, persona.sesionId)).toBe(1);

    const { rows } = await comoSistema<{
      usuario_id: string;
      usuario_nombre: string;
      modulo: string;
      sede_id: string | null;
      ip: string | null;
    }>(
      prueba.admin,
      a.clinicaId,
      `select usuario_id, usuario_nombre, modulo, sede_id, host(ip) as ip from app.audit_log
       where entidad = 'sesion' and entidad_id = $1 and accion = 'ingresar'`,
      [persona.sesionId],
    );
    expect(rows[0]).toMatchObject({
      usuario_id: persona.usuarioId,
      modulo: 'personal',
      sede_id: null,
    });
    expect(rows[0]?.usuario_nombre).toMatch(/^Usuario /);
    expect(rows[0]?.ip).toMatch(/127\.0\.0\.1|::1/);

    // Otra sesión de la misma persona es otro ingreso.
    const otra = randomUUID();
    await prueba
      .pedir('get', '/sesion', { token: await persona.token('aal1', { sesion: otra }) })
      .expect(200);
    expect(await ingresosDeSesion(prueba, a.clinicaId, otra)).toBe(1);
    expect(await ingresosDeSesion(prueba, a.clinicaId, persona.sesionId)).toBe(1);
  });

  it('inactividad vencida → no_autenticado, y la sesión queda cerrada en la base', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    // La última actividad fue hace 16 minutos; recepción tiene 15 de inactividad.
    await comoUsuarioAdmin(
      prueba.admin,
      a.clinicaId,
      persona.usuarioId,
      `insert into app.sesion (id, usuario_id, iniciada_en, ultima_actividad)
       values ($1, $2, now() - interval '20 minutes', now() - interval '16 minutes')`,
      [persona.sesionId, persona.usuarioId],
    );
    const respuesta = await esperarError(
      prueba.pedir('get', '/sesion', { token: await persona.token() }),
      401,
      'no_autenticado',
    );
    expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/15 minutos sin actividad/);

    const fila = await leerSesion(prueba, a.clinicaId, persona.usuarioId, persona.sesionId);
    expect(fila?.motivo_cierre).toBe('inactividad');
    expect(fila?.cerrada_en).toBeInstanceOf(Date);

    // Ya cerrada: sigue sin servir, con cualquier endpoint, y no se registra ningún ingreso.
    await esperarError(
      prueba.pedir('get', '/sesion', { token: await persona.token() }),
      401,
      'no_autenticado',
    );
    expect(await ingresosDeSesion(prueba, a.clinicaId, persona.sesionId)).toBe(0);
  });

  it('dentro del límite de inactividad la sesión sigue activa', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    await comoUsuarioAdmin(
      prueba.admin,
      a.clinicaId,
      persona.usuarioId,
      `insert into app.sesion (id, usuario_id, iniciada_en, ultima_actividad)
       values ($1, $2, now() - interval '20 minutes', now() - interval '14 minutes')`,
      [persona.sesionId, persona.usuarioId],
    );
    await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200);
    const fila = await leerSesion(prueba, a.clinicaId, persona.usuarioId, persona.sesionId);
    expect(fila?.cerrada_en).toBeNull();
    // Se renovó la última actividad.
    expect(Date.now() - (fila?.ultima_actividad.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it('POST /sesion/cerrar → 204; después el mismo token → no_autenticado', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const token = await persona.token();
    await prueba.pedir('get', '/sesion', { token }).expect(200);
    const respuesta = await prueba.pedir('post', '/sesion/cerrar', { token }).expect(204);
    expect(respuesta.text).toBe('');
    expect(
      await leerSesion(prueba, a.clinicaId, persona.usuarioId, persona.sesionId),
    ).toMatchObject({ motivo_cierre: 'salida' });

    const despues = await esperarError(
      prueba.pedir('get', '/sesion', { token }),
      401,
      'no_autenticado',
    );
    expect((despues.body as { mensaje: string }).mensaje).toMatch(/cerrada/);
    await esperarError(prueba.pedir('get', '/auditoria', { token }), 401, 'no_autenticado');
    // Otro token de la misma sesión (p. ej. refrescado) tampoco sirve.
    await esperarError(
      prueba.pedir('get', '/sesion', { token: await persona.token() }),
      401,
      'no_autenticado',
    );
    // Cerrar dos veces no es un error.
    await prueba.pedir('post', '/sesion/cerrar', { token }).expect(204);
  });

  it('cerrar una sesión que nunca se usó la deja cerrada', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const token = await persona.token();
    await prueba.pedir('post', '/sesion/cerrar', { token }).expect(204);
    await esperarError(prueba.pedir('get', '/sesion', { token }), 401, 'no_autenticado');
    expect(await ingresosDeSesion(prueba, a.clinicaId, persona.sesionId)).toBe(0);
  });

  it('POST /sesion/cerrar no necesita clínica ni membresía activa', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const token = await persona.token();
    await prueba.pedir('get', '/sesion', { token }).expect(200);
    await comoSistema(
      prueba.admin,
      a.clinicaId,
      "update app.membresia set estado = 'inactivo' where id = $1",
      [persona.membresiaId],
    );
    await esperarError(prueba.pedir('get', '/sesion', { token }), 403, 'sin_membresia');
    await prueba
      .pedir('post', '/sesion/cerrar', { token })
      .set('X-Clinica-Id', 'no-es-un-uuid')
      .expect(204);
    expect(
      await leerSesion(prueba, a.clinicaId, persona.usuarioId, persona.sesionId),
    ).toMatchObject({ motivo_cierre: 'salida' });
    // Un usuario sin fila en la base: nada que cerrar.
    await prueba
      .pedir('post', '/sesion/cerrar', { token: await prueba.token({ sub: randomUUID() }) })
      .expect(204);
  });

  it('un session_id de otro usuario → no_autenticado, sin tocar esa sesión', async () => {
    const duena = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const intruso = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    await prueba.pedir('get', '/sesion', { token: await duena.token() }).expect(200);
    const antes = await leerSesion(prueba, a.clinicaId, duena.usuarioId, duena.sesionId);

    const robado = await intruso.token('aal1', { sesion: duena.sesionId });
    await esperarError(prueba.pedir('get', '/sesion', { token: robado }), 401, 'no_autenticado');
    await esperarError(
      prueba.pedir('post', '/sesion/cerrar', { token: robado }),
      401,
      'no_autenticado',
    );

    expect(await leerSesion(prueba, a.clinicaId, duena.usuarioId, duena.sesionId)).toEqual(antes);
    await prueba.pedir('get', '/sesion', { token: await duena.token() }).expect(200);
  });

  it('token sin session_id, o con uno que no es UUID → no_autenticado', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    for (const sesion of [null, '', 'no-es-uuid', 12345, "' or 1=1 --"]) {
      const token = await persona.token('aal1', { sesion });
      for (const [metodo, ruta] of [
        ['get', '/sesion'],
        ['get', '/auditoria'],
        ['post', '/sesion/cerrar'],
      ] as const) {
        await esperarError(prueba.pedir(metodo, ruta, { token }), 401, 'no_autenticado');
      }
    }
  });
});
