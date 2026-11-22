/**
 * Equipo: listado, edición de rol y sedes (con la dimensión sede de quien edita), desactivar y
 * reactivar de punta a punta, autoescalada, permisos y aislamiento.
 */
import { personaSchema, type Persona as PersonaApi } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { crearRolDePrueba, crearUsuarioDePrueba } from '@conecta/db/pruebas';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  esperarError,
  otorgarPermiso,
  segun,
  type Clinica,
} from './ayudas.js';
import { crearPruebaPersonal, invitar, type PruebaPersonal } from './ayudas-personal.js';

describe('personal', () => {
  let prueba: PruebaPersonal;
  let a: Clinica;
  let b: Clinica;
  let duenoA: string;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal();
    a = await crearClinica(prueba, { sedes: 3 });
    b = await crearClinica(prueba, { sedes: 1 });
    duenoA = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const listar = async (token: string): Promise<PersonaApi[]> =>
    segun(
      z.array(personaSchema),
      (await prueba.pedir('get', '/personal', { token }).expect(200)).body,
    );
  const editar = async (token: string, id: string, cuerpo: object): Promise<PersonaApi> =>
    segun(
      personaSchema,
      (await prueba.pedir('patch', `/personal/${id}`, { token, cuerpo }).expect(200)).body,
    );

  describe('listado', () => {
    it('lista activos, pendientes e inactivos con la forma del contrato', async () => {
      const activa = await crearPersona(prueba, a.clinicaId, {
        rol: 'odontologo',
        sedes: [a.sedes[0]!.sedeId],
        sedeDefectoId: a.sedes[0]!.sedeId,
      });
      const inactiva = await crearPersona(prueba, a.clinicaId, { estado: 'inactivo' });
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.asistente });

      const lista = await listar(duenoA);
      const por = (id: string) => lista.find((p) => p.membresiaId === id);
      expect(por(a.membresiaDuenoId)).toMatchObject({
        usuarioId: a.duenoId,
        estado: 'activo',
        rol: { id: a.roles.dueno, codigo: 'dueno', nombre: 'Dueño/a' },
      });
      expect(por(activa.membresiaId)).toMatchObject({
        usuarioId: activa.usuarioId,
        email: activa.email,
        estado: 'activo',
        sedeIds: [a.sedes[0]!.sedeId],
        sedeDefectoId: a.sedes[0]!.sedeId,
        invitacionVenceEn: null,
      });
      expect(por(inactiva.membresiaId)?.estado).toBe('inactivo');
      expect(por(inv.persona.membresiaId)).toMatchObject({
        usuarioId: null,
        estado: 'pendiente',
        invitacionVenceEn: inv.venceEn,
      });
    });

    it('sin personal:ver → 403; otra clínica no ve a nadie de A', async () => {
      const recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      await esperarError(
        prueba.pedir('get', '/personal', { token: await recepcion.token() }),
        403,
        'sin_permiso',
      );
      const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
      await listar(await administracion.token());

      const deB = await listar(await b.dueno.token());
      expect(deB.map((p) => p.membresiaId)).toEqual([b.membresiaDuenoId]);
    });
  });

  describe('edición', () => {
    it('cambia rol, sedes y sede por defecto; quitar la sede por defecto la vacía', async () => {
      const [s1, s2, s3] = a.sedes;
      const persona = await crearPersona(prueba, a.clinicaId, {
        rol: 'recepcion',
        sedes: [s1!.sedeId],
        sedeDefectoId: s1!.sedeId,
      });
      const editada = await editar(duenoA, persona.membresiaId, {
        rolId: a.roles.asistente,
        sedeIds: [s2!.sedeId, s3!.sedeId, s2!.sedeId],
        sedeDefectoId: s3!.sedeId,
      });
      expect(editada).toMatchObject({
        rol: { id: a.roles.asistente, codigo: 'asistente' },
        sedeIds: [s2!.sedeId, s3!.sedeId].sort(),
        sedeDefectoId: s3!.sedeId,
      });

      // Se le quita la sede por defecto: también daba acceso, así que se vacía.
      const sinDefecto = await editar(duenoA, persona.membresiaId, { sedeIds: [s2!.sedeId] });
      expect(sinDefecto).toMatchObject({ sedeIds: [s2!.sedeId], sedeDefectoId: null });

      // Volver a asignar una sede quitada la reactiva (nada se borra).
      const devuelta = await editar(duenoA, persona.membresiaId, {
        sedeIds: [s1!.sedeId, s2!.sedeId],
      });
      expect(devuelta.sedeIds).toEqual([s1!.sedeId, s2!.sedeId].sort());
      // Cuerpo vacío: no cambia nada.
      expect(await editar(duenoA, persona.membresiaId, {})).toEqual(devuelta);
      const { rows } = await comoSistema<{ sede_id: string; activo: boolean }>(
        prueba.admin,
        a.clinicaId,
        'select sede_id, activo from app.usuario_sede where membresia_id = $1 order by sede_id',
        [persona.membresiaId],
      );
      expect(rows).toHaveLength(3);
      expect(rows.filter((f) => f.activo).map((f) => f.sede_id)).toEqual(
        [s1!.sedeId, s2!.sedeId].sort(),
      );

      // La persona ve exactamente esas sedes en su próximo pedido.
      const sesion = await prueba
        .pedir('get', '/sesion', { token: await persona.token() })
        .expect(200);
      expect((sesion.body as { sedes: { id: string }[] }).sedes.map((s) => s.id).sort()).toEqual(
        [s1!.sedeId, s2!.sedeId].sort(),
      );
    });

    it('sede por defecto fuera de sus sedes, sede inexistente o de otra clínica → datos_invalidos', async () => {
      const persona = await crearPersona(prueba, a.clinicaId, {
        rol: 'recepcion',
        sedes: [a.sedes[0]!.sedeId],
      });
      const ruta = `/personal/${persona.membresiaId}`;
      await esperarError(
        prueba.pedir('patch', ruta, {
          token: duenoA,
          cuerpo: { sedeDefectoId: a.sedes[1]!.sedeId },
        }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('patch', ruta, { token: duenoA, cuerpo: { sedeIds: [b.sedes[0]!.sedeId] } }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('patch', ruta, {
          token: duenoA,
          cuerpo: { sedeIds: ['00000000-0000-4000-8000-000000000000'] },
        }),
        400,
        'datos_invalidos',
      );
      // Rol de otra clínica: la base lo rechaza por el FK compuesto.
      await esperarError(
        prueba.pedir('patch', ruta, { token: duenoA, cuerpo: { rolId: b.roles.asistente } }),
        409,
        'conflicto',
      );
    });

    it('dimensión sede: quien edita solo asigna sus sedes; alguien de otra sede no existe para él', async () => {
      const c = await crearClinica(prueba, { sedes: 2 });
      const [s1, s2] = c.sedes;
      await otorgarPermiso(prueba, c.clinicaId, c.roles.odontologo, 'personal', 'editar');
      await otorgarPermiso(prueba, c.clinicaId, c.roles.odontologo, 'personal', 'ver');
      const editora = await crearPersona(prueba, c.clinicaId, {
        rol: 'odontologo',
        sedes: [s1!.sedeId],
      });
      const t = await editora.token();
      const deSuSede = await crearPersona(prueba, c.clinicaId, {
        rol: 'asistente',
        sedes: [s1!.sedeId],
      });
      const deOtraSede = await crearPersona(prueba, c.clinicaId, {
        rol: 'asistente',
        sedes: [s2!.sedeId],
      });

      // Fuera de su alcance: no la lista y no la puede tocar (404, como si no existiera).
      const ids = (await listar(t)).map((p) => p.membresiaId);
      expect(ids).toContain(deSuSede.membresiaId);
      expect(ids).not.toContain(deOtraSede.membresiaId);
      await esperarError(
        prueba.pedir('patch', `/personal/${deOtraSede.membresiaId}`, {
          token: t,
          cuerpo: { sedeIds: [s1!.sedeId] },
        }),
        404,
        'no_encontrado',
      );

      // Dentro de su alcance: no le puede dar una sede que no ve.
      await esperarError(
        prueba.pedir('patch', `/personal/${deSuSede.membresiaId}`, {
          token: t,
          cuerpo: { sedeIds: [s1!.sedeId, s2!.sedeId] },
        }),
        403,
        'sede_no_permitida',
      );
      await esperarError(
        prueba.pedir('patch', `/personal/${deSuSede.membresiaId}`, {
          token: t,
          cuerpo: { sedeDefectoId: s2!.sedeId },
        }),
        403,
        'sede_no_permitida',
      );
      const editada = await editar(t, deSuSede.membresiaId, { sedeDefectoId: s1!.sedeId });
      expect(editada).toMatchObject({ sedeIds: [s1!.sedeId], sedeDefectoId: s1!.sedeId });
    });

    it('autoescalada: editarse a sí mismo, darse el rol dueño o dárselo a otro sin ser dueño → rechazado', async () => {
      const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
      const t = await administracion.token();
      const propio = await esperarError(
        prueba.pedir('patch', `/personal/${administracion.membresiaId}`, {
          token: t,
          cuerpo: { rolId: a.roles.dueno },
        }),
        403,
        'sin_permiso',
      );
      expect((propio.body as { mensaje: string }).mensaje).toMatch(
        /No podés cambiar tu propio acceso/,
      );
      await esperarError(
        prueba.pedir('patch', `/personal/${administracion.membresiaId}`, {
          token: t,
          cuerpo: { sedeIds: [a.sedes[0]!.sedeId] },
        }),
        403,
        'sin_permiso',
      );

      const otra = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const dueno = await esperarError(
        prueba.pedir('patch', `/personal/${otra.membresiaId}`, {
          token: t,
          cuerpo: { rolId: a.roles.dueno },
        }),
        403,
        'sin_permiso',
      );
      expect((dueno.body as { mensaje: string }).mensaje).toMatch(/Solo un dueño/);
      // Tampoco toca a un dueño.
      await esperarError(
        prueba.pedir('patch', `/personal/${a.membresiaDuenoId}`, {
          token: t,
          cuerpo: { rolId: a.roles.recepcion },
        }),
        403,
        'sin_permiso',
      );
      // El dueño tampoco se edita a sí mismo.
      await esperarError(
        prueba.pedir('patch', `/personal/${a.membresiaDuenoId}`, {
          token: duenoA,
          cuerpo: { rolId: a.roles.recepcion },
        }),
        403,
        'sin_permiso',
      );

      const { rows } = await comoSistema<{ rol_id: string }>(
        prueba.admin,
        a.clinicaId,
        'select rol_id from app.membresia where id = any($1::uuid[])',
        [[administracion.membresiaId, otra.membresiaId, a.membresiaDuenoId]],
      );
      expect(rows.map((r) => r.rol_id).sort()).toEqual(
        [a.roles.administracion, a.roles.recepcion, a.roles.dueno].sort(),
      );
    });

    it('rol desactivado → conflicto con mensaje', async () => {
      const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const { rows } = await comoSistema<{ id: string }>(
        prueba.admin,
        a.clinicaId,
        `insert into app.rol (clinica_id, nombre, activo) values ($1, 'Rol apagado', false)
         returning id`,
        [a.clinicaId],
      );
      const respuesta = await esperarError(
        prueba.pedir('patch', `/personal/${persona.membresiaId}`, {
          token: duenoA,
          cuerpo: { rolId: rows[0]!.id },
        }),
        409,
        'conflicto',
      );
      expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/rol está desactivado/);
    });

    it('permisos: recepción no edita; id inexistente o de otra clínica → 404', async () => {
      const persona = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
      const recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      await esperarError(
        prueba.pedir('patch', `/personal/${persona.membresiaId}`, {
          token: await recepcion.token(),
          cuerpo: { rolId: a.roles.recepcion },
        }),
        403,
        'sin_permiso',
      );
      const duenoB = await b.dueno.token();
      await esperarError(
        prueba.pedir('patch', `/personal/${persona.membresiaId}`, {
          token: duenoB,
          cuerpo: { rolId: b.roles.recepcion },
        }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('patch', '/personal/no-es-uuid', { token: duenoA, cuerpo: {} }),
        404,
        'no_encontrado',
      );
    });
  });

  describe('desactivar y reactivar', () => {
    it('desactivar corta el acceso en el pedido siguiente; reactivar lo devuelve', async () => {
      const persona = await crearPersona(prueba, a.clinicaId, {
        rol: 'recepcion',
        sedes: [a.sedes[0]!.sedeId],
      });
      const t = await persona.token();
      await prueba.pedir('get', '/sesion', { token: t }).expect(200);

      const ruta = `/personal/${persona.membresiaId}`;
      await esperarError(
        prueba.pedir('post', `${ruta}/desactivar`, { token: duenoA }),
        400,
        'datos_invalidos',
      );
      const inactiva = segun(
        personaSchema,
        (
          await prueba
            .pedir('post', `${ruta}/desactivar`, {
              token: duenoA,
              cuerpo: { motivo: 'Dejó de trabajar en la clínica' },
            })
            .expect(200)
        ).body,
      );
      expect(inactiva.estado).toBe('inactivo');
      // El motivo queda en la membresía y en la auditoría (la base registra la fila con autor).
      const { rows: baja } = await comoSistema<{ motivo_baja: string | null }>(
        prueba.admin,
        a.clinicaId,
        'select motivo_baja from app.membresia where id = $1',
        [persona.membresiaId],
      );
      expect(baja).toEqual([{ motivo_baja: 'Dejó de trabajar en la clínica' }]);
      const { rows: auditoria } = await comoSistema<{ usuario_id: string; motivo: string }>(
        prueba.admin,
        a.clinicaId,
        `select usuario_id, despues ->> 'motivo_baja' as motivo from app.audit_log
         where entidad = 'membresia' and entidad_id = $1 and accion = 'anular'`,
        [persona.membresiaId],
      );
      expect(auditoria).toEqual([
        { usuario_id: a.duenoId, motivo: 'Dejó de trabajar en la clínica' },
      ]);

      // Mismo token, siguiente pedido: sin membresía.
      await esperarError(prueba.pedir('get', '/sesion', { token: t }), 403, 'sin_membresia');
      await esperarError(prueba.pedir('get', '/sedes', { token: t }), 403, 'sin_membresia');
      await esperarError(
        prueba.pedir('post', `${ruta}/desactivar`, {
          token: duenoA,
          cuerpo: { motivo: 'Otra vez' },
        }),
        409,
        'conflicto',
      );

      const activa = segun(
        personaSchema,
        (await prueba.pedir('post', `${ruta}/reactivar`, { token: duenoA }).expect(200)).body,
      );
      expect(activa).toMatchObject({ estado: 'activo', sedeIds: [a.sedes[0]!.sedeId] });
      const { rows: reactivada } = await comoSistema<{ motivo_baja: string | null }>(
        prueba.admin,
        a.clinicaId,
        'select motivo_baja from app.membresia where id = $1',
        [persona.membresiaId],
      );
      expect(reactivada).toEqual([{ motivo_baja: null }]);
      await prueba.pedir('get', '/sesion', { token: t }).expect(200);
      await esperarError(
        prueba.pedir('post', `${ruta}/reactivar`, { token: duenoA }),
        409,
        'conflicto',
      );
    });

    it('una invitación pendiente no se desactiva ni se reactiva: se anula', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      const ruta = `/personal/${inv.persona.membresiaId}`;
      const r = await esperarError(
        prueba.pedir('post', `${ruta}/desactivar`, {
          token: duenoA,
          cuerpo: { motivo: 'No vino' },
        }),
        409,
        'conflicto',
      );
      expect((r.body as { mensaje: string }).mensaje).toMatch(/Anulá la invitación/);
      await esperarError(
        prueba.pedir('post', `${ruta}/reactivar`, { token: duenoA }),
        409,
        'conflicto',
      );
      await prueba
        .pedir('delete', `/invitaciones/${inv.persona.membresiaId}`, {
          token: duenoA,
          cuerpo: { motivo: 'No vino' },
        })
        .expect(204);
      // Anulada antes de aceptar: no hay a quién reactivar.
      const anulada = await esperarError(
        prueba.pedir('post', `${ruta}/reactivar`, { token: duenoA }),
        409,
        'conflicto',
      );
      expect((anulada.body as { mensaje: string }).mensaje).toMatch(/Invitala de nuevo/);
    });

    it('permisos y autoescalada: recepción no; administración sí; nadie se desactiva a sí mismo ni a un dueño sin serlo', async () => {
      // Un rol con menos permisos que Administración: Administración lo puede volver a asignar.
      const { rolId } = await crearRolDePrueba(prueba.admin, {
        clinicaId: a.clinicaId,
        permisos: ['inicio:ver', 'agenda:ver'],
      });
      const objetivo = await crearUsuarioDePrueba(prueba.admin, { clinicaId: a.clinicaId, rolId });
      const recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
      const tRec = await recepcion.token();
      const tAdm = await administracion.token();
      const baja = { motivo: 'Prueba de permisos' };

      await esperarError(
        prueba.pedir('post', `/personal/${objetivo.membresiaId}/desactivar`, {
          token: tRec,
          cuerpo: baja,
        }),
        403,
        'sin_permiso',
      );
      await prueba
        .pedir('post', `/personal/${objetivo.membresiaId}/desactivar`, {
          token: tAdm,
          cuerpo: baja,
        })
        .expect(200);
      await esperarError(
        prueba.pedir('post', `/personal/${objetivo.membresiaId}/reactivar`, { token: tRec }),
        403,
        'sin_permiso',
      );
      await prueba
        .pedir('post', `/personal/${objetivo.membresiaId}/reactivar`, { token: tAdm })
        .expect(200);

      // Reactivar es volver a dar el rol: Administración no reactiva a alguien con un rol que da
      // más que el suyo (Asistente tiene agenda:crear, ficha_clinica:ver…).
      const asistente = await crearPersona(prueba, a.clinicaId, {
        rol: 'asistente',
        estado: 'inactivo',
      });
      const superior = await esperarError(
        prueba.pedir('post', `/personal/${asistente.membresiaId}/reactivar`, { token: tAdm }),
        403,
        'sin_permiso',
      );
      expect((superior.body as { mensaje: string }).mensaje).toBe(
        'Ese rol da permisos que tu rol no tiene: agenda:crear, agenda:editar, ficha_clinica:ver, inventario:crear, inventario:editar. Pedile al dueño que lo asigne.',
      );

      await esperarError(
        prueba.pedir('post', `/personal/${administracion.membresiaId}/desactivar`, {
          token: tAdm,
          cuerpo: baja,
        }),
        403,
        'sin_permiso',
      );
      await esperarError(
        prueba.pedir('post', `/personal/${a.membresiaDuenoId}/desactivar`, {
          token: tAdm,
          cuerpo: baja,
        }),
        403,
        'sin_permiso',
      );
      await esperarError(
        prueba.pedir('post', `/personal/${a.membresiaDuenoId}/desactivar`, {
          token: duenoA,
          cuerpo: baja,
        }),
        403,
        'sin_permiso',
      );
    });

    it('aislamiento: otra clínica no desactiva ni reactiva a nadie de A', async () => {
      const persona = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
      const duenoB = await b.dueno.token();
      await esperarError(
        prueba.pedir('post', `/personal/${persona.membresiaId}/desactivar`, {
          token: duenoB,
          cuerpo: { motivo: 'Intento ajeno' },
        }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('post', `/personal/${persona.membresiaId}/reactivar`, { token: duenoB }),
        404,
        'no_encontrado',
      );
      await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200);
    });
  });
});
