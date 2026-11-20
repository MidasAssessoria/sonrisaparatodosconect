import { sesionSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
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

  it('dueño: clínica, rol, todos los permisos, todas las sedes y debe activar MFA', async () => {
    const respuesta = await prueba
      .pedir('get', '/sesion', { token: await a.dueno.token() })
      .expect(200);
    const sesion = segun(sesionSchema, respuesta.body);
    expect(sesion.usuario).toMatchObject({ id: a.duenoId, mfaActivo: false });
    expect(sesion.nivelAutenticacion).toBe('aal1');
    expect(sesion.debeActivarMfa).toBe(true);
    expect(sesion.clinica.id).toBe(a.clinicaId);
    expect(sesion.clinica.zonaHoraria).toBe('America/Asuncion');
    expect(sesion.clinicas).toEqual([{ id: a.clinicaId, nombre: a.nombre }]);
    expect(sesion.rol.codigo).toBe('dueno');
    expect(sesion.permisos).toHaveLength(14 * 5);
    expect(sesion.sedes.map((s) => s.id).sort()).toEqual(a.sedes.map((s) => s.sedeId).sort());
    expect(sesion.puedeVerTodasLasSedes).toBe(true);
    expect(sesion.inactividadMin).toBe(30);
  });

  it('recepción: solo sus sedes (asignadas + por defecto), 15 minutos, sin MFA obligatorio', async () => {
    const [s1, s2] = a.sedes;
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [s1!.sedeId],
      sedeDefectoId: s2!.sedeId,
    });
    const respuesta = await prueba
      .pedir('get', '/sesion', { token: await persona.token() })
      .expect(200);
    const sesion = segun(sesionSchema, respuesta.body);
    expect(sesion.rol.codigo).toBe('recepcion');
    expect(sesion.debeActivarMfa).toBe(false);
    expect(sesion.inactividadMin).toBe(15);
    expect(sesion.sedes.map((s) => s.id).sort()).toEqual([s1!.sedeId, s2!.sedeId].sort());
    expect(sesion.sedeDefectoId).toBe(s2!.sedeId);
    expect(sesion.puedeVerTodasLasSedes).toBe(true);
    expect(sesion.permisos.some((p) => p.modulo === 'sedes')).toBe(false);
  });

  it('una sola sede visible: no ofrece «Todas las sedes»', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'odontologo',
      sedes: [a.sedes[0]!.sedeId],
    });
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200)).body,
    );
    expect(sesion.sedes).toHaveLength(1);
    expect(sesion.puedeVerTodasLasSedes).toBe(false);
    expect(sesion.sedeDefectoId).toBeNull();
  });

  it('actualiza ultimo_acceso sin dejar registro de auditoría', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
    await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200);
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
});
