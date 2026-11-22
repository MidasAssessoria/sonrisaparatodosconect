import { randomUUID } from 'node:crypto';
import { crearSedeDePrueba } from '@conecta/db/pruebas';
import { agendaConfigSchema } from '@conecta/shared';
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
  type Prueba,
} from './ayudas.js';
import { auditoriaDe } from './profesionales-ayudas.js';

describe('configuración de agenda por sede', () => {
  let prueba: Prueba;
  let a: Clinica;
  let b: Clinica;
  let token: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 3 });
    b = await crearClinica(prueba, { sedes: 1 });
    token = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const sedeA = (i: number) => a.sedes[i]?.sedeId ?? '';
  const leer = async (sedeId: string, t = token) =>
    segun(
      agendaConfigSchema,
      (await prueba.pedir('get', `/sedes/${sedeId}/agenda`, { token: t }).expect(200)).body,
    );
  const guardar = (sedeId: string, cuerpo: object, t = token) =>
    prueba.pedir('put', `/sedes/${sedeId}/agenda`, { token: t, cuerpo });

  it('sin fila devuelve los valores por defecto', async () => {
    expect(await leer(sedeA(0))).toEqual({
      sedeId: sedeA(0),
      anticipacionMin: 120,
      diasAdelante: 14,
      reservaOnlineActiva: false,
    });
  });

  it('PUT reemplaza la configuración (una sola fila por sede) y queda auditado en sedes', async () => {
    const sedeId = sedeA(1);
    const primero = segun(
      agendaConfigSchema,
      (
        await guardar(sedeId, {
          anticipacionMin: 60,
          diasAdelante: 30,
          reservaOnlineActiva: true,
        }).expect(200)
      ).body,
    );
    expect(primero).toEqual({
      sedeId,
      anticipacionMin: 60,
      diasAdelante: 30,
      reservaOnlineActiva: true,
    });
    expect(await leer(sedeId)).toEqual(primero);

    const segundo = segun(
      agendaConfigSchema,
      (
        await guardar(sedeId, {
          anticipacionMin: 0,
          diasAdelante: 1,
          reservaOnlineActiva: false,
        }).expect(200)
      ).body,
    );
    expect(await leer(sedeId)).toEqual(segundo);
    // Guardar lo mismo no agrega nada a la auditoría.
    await guardar(sedeId, {
      anticipacionMin: 0,
      diasAdelante: 1,
      reservaOnlineActiva: false,
    }).expect(200);

    const { rows } = await comoSistema<{ id: string }>(
      prueba.admin,
      a.clinicaId,
      'select id from app.agenda_config where sede_id = $1',
      [sedeId],
    );
    expect(rows).toHaveLength(1);
    expect(await auditoriaDe(prueba, a.clinicaId, 'agenda_config', rows[0]?.id ?? '')).toEqual(
      ['crear', 'editar'].map((accion) => ({
        accion,
        modulo: 'sedes',
        usuario_id: a.duenoId,
        sede_id: sedeId,
      })),
    );
    // Las otras sedes siguen con los valores por defecto.
    expect((await leer(sedeA(2))).anticipacionMin).toBe(120);
  });

  it('valores fuera de rango o faltantes → datos_invalidos; sedeId en el cuerpo se ignora', async () => {
    for (const cuerpo of [
      { anticipacionMin: -1, diasAdelante: 14, reservaOnlineActiva: false },
      { anticipacionMin: 2881, diasAdelante: 14, reservaOnlineActiva: false },
      { anticipacionMin: 120, diasAdelante: 0, reservaOnlineActiva: false },
      { anticipacionMin: 120, diasAdelante: 91, reservaOnlineActiva: false },
      { anticipacionMin: 120.5, diasAdelante: 14, reservaOnlineActiva: false },
      { anticipacionMin: 120, diasAdelante: 14 },
    ]) {
      await esperarError(guardar(sedeA(2), cuerpo), 400, 'datos_invalidos');
    }
    const r = segun(
      agendaConfigSchema,
      (
        await guardar(sedeA(2), {
          anticipacionMin: 2880,
          diasAdelante: 90,
          reservaOnlineActiva: true,
          sedeId: sedeA(0),
          clinicaId: b.clinicaId,
        }).expect(200)
      ).body,
    );
    expect(r.sedeId).toBe(sedeA(2));
    expect((await leer(sedeA(0))).anticipacionMin).toBe(120);
  });

  it('sede de otra clínica, inexistente o dada de baja → no_encontrado', async () => {
    const ajena = b.sedes[0]?.sedeId ?? '';
    const cuerpo = { anticipacionMin: 10, diasAdelante: 10, reservaOnlineActiva: true };
    for (const id of [ajena, randomUUID()]) {
      await esperarError(
        prueba.pedir('get', `/sedes/${id}/agenda`, { token }),
        404,
        'no_encontrado',
      );
      await esperarError(guardar(id, cuerpo), 404, 'no_encontrado');
    }
    await esperarError(prueba.pedir('get', '/sedes/abc/agenda', { token }), 404, 'no_encontrado');
    const { rows } = await comoSistema(
      prueba.admin,
      b.clinicaId,
      'select 1 from app.agenda_config where sede_id = $1',
      [ajena],
    );
    expect(rows).toHaveLength(0);

    const sede = await crearSedeDePrueba(prueba.admin, a.clinicaId, { nombre: 'Se cierra' });
    await prueba
      .pedir('delete', `/sedes/${sede.sedeId}`, { token, cuerpo: { motivo: 'Cerró el local' } })
      .expect(204);
    await esperarError(
      prueba.pedir('get', `/sedes/${sede.sedeId}/agenda`, { token }),
      404,
      'no_encontrado',
    );
    await esperarError(guardar(sede.sedeId, cuerpo), 404, 'no_encontrado');
  });

  it('matriz: sedes:ver para leer, sedes:editar para guardar', async () => {
    const cuerpo = { anticipacionMin: 30, diasAdelante: 7, reservaOnlineActiva: false };
    const admin = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
    const odontologo = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    const asistente = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
    await esperarError(
      prueba.pedir('get', `/sedes/${sedeA(0)}/agenda`, { token: await odontologo.token() }),
      403,
      'sin_permiso',
    );
    await esperarError(guardar(sedeA(0), cuerpo, await asistente.token()), 403, 'sin_permiso');
    await leer(sedeA(0), await admin.token());
    segun(
      agendaConfigSchema,
      (await guardar(sedeA(0), cuerpo, await admin.token()).expect(200)).body,
    );

    // Con sedes:ver pero sin sedes:editar.
    const soloVer = await crearClinica(prueba, { sedes: 1 });
    await otorgarPermiso(prueba, soloVer.clinicaId, soloVer.roles.recepcion, 'sedes', 'ver');
    const recepcion = await crearPersona(prueba, soloVer.clinicaId, {
      rol: 'recepcion',
      sedes: [soloVer.sedes[0]?.sedeId ?? ''],
    });
    const t = await recepcion.token();
    await leer(soloVer.sedes[0]?.sedeId ?? '', t);
    await esperarError(guardar(soloVer.sedes[0]?.sedeId ?? '', cuerpo, t), 403, 'sin_permiso');
  });

  it('dimensión sede: sede no permitida → sede_no_permitida', async () => {
    for (const accion of ['ver', 'editar'] as const) {
      await otorgarPermiso(prueba, a.clinicaId, a.roles.recepcion, 'sedes', accion);
    }
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [sedeA(0)],
    });
    const t = await persona.token();
    const cuerpo = { anticipacionMin: 45, diasAdelante: 5, reservaOnlineActiva: true };
    await leer(sedeA(0), t);
    await guardar(sedeA(0), cuerpo, t).expect(200);
    await esperarError(
      prueba.pedir('get', `/sedes/${sedeA(2)}/agenda`, { token: t }),
      403,
      'sede_no_permitida',
    );
    await esperarError(guardar(sedeA(2), cuerpo, t), 403, 'sede_no_permitida');
    expect((await leer(sedeA(2))).anticipacionMin).not.toBe(45);
  });
});
