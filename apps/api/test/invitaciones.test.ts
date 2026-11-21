/**
 * Invitaciones de punta a punta: alta (el enlace sale una vez), consulta pública, aceptación sin
 * cuenta (la API crea la cuenta con la Admin API, acá en memoria) y con cuenta (JWT), tokens que no
 * sirven, compensación, sin clave secreta, reenvío, anulación, permisos y aislamiento.
 */
import { randomUUID } from 'node:crypto';
import { hashTokenInvitacion } from '@conecta/db';
import { crearInvitacionDePrueba } from '@conecta/db/pruebas';
import {
  errorApiSchema,
  invitacionAceptadaSchema,
  invitacionPublicaSchema,
  personaSchema,
  sesionSchema,
} from '@conecta/shared';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  esperarError,
  otorgarPermiso,
  segun,
  type Clinica,
  type Persona,
} from './ayudas.js';
import { crearPruebaPersonal, invitar, type PruebaPersonal } from './ayudas-personal.js';

const CLAVE = 'una-clave-larga-123';

describe('invitaciones', () => {
  let prueba: PruebaPersonal;
  let a: Clinica;
  let b: Clinica;
  let duenoA: string;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal();
    a = await crearClinica(prueba, { sedes: 2, nombre: `Clínica A ${randomUUID().slice(0, 6)}` });
    b = await crearClinica(prueba, { sedes: 1 });
    duenoA = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const consultar = (token: string): request.Test =>
    prueba.pedir('post', '/invitaciones/consultar', { cuerpo: { token } });
  const aceptar = (cuerpo: object, jwt?: string): request.Test =>
    prueba.pedir('post', '/invitaciones/aceptar', { cuerpo, ...(jwt ? { token: jwt } : {}) });

  async function estadoMembresia(
    clinicaId: string,
    membresiaId: string,
  ): Promise<{ estado: string; usuario_id: string | null }> {
    const { rows } = await comoSistema<{ estado: string; usuario_id: string | null }>(
      prueba.admin,
      clinicaId,
      'select estado, usuario_id from app.membresia where id = $1',
      [membresiaId],
    );
    const fila = rows[0];
    if (!fila) throw new Error('No existe la membresía.');
    return fila;
  }

  describe('de punta a punta', () => {
    it('crear → consultar → aceptar sin cuenta → la persona entra y ve solo sus sedes y módulos', async () => {
      const [s1, s2] = a.sedes;
      const inv = await invitar(prueba, duenoA, {
        nombre: 'María López',
        email: 'Maria.Lopez@Prueba.TEST',
        rolId: a.roles.recepcion,
        sedeIds: [s1!.sedeId],
        sedeDefectoId: s1!.sedeId,
      });
      expect(inv.enlace).toMatch(/^\/invitacion\?token=[A-Za-z0-9_-]{43}$/);
      expect(inv.persona).toMatchObject({
        usuarioId: null,
        nombre: 'María López',
        email: 'maria.lopez@prueba.test',
        estado: 'pendiente',
        rol: { id: a.roles.recepcion, codigo: 'recepcion' },
        sedeIds: [s1!.sedeId],
        sedeDefectoId: s1!.sedeId,
        invitacionVenceEn: inv.venceEn,
      });
      const dias = (Date.parse(inv.venceEn) - Date.now()) / 86_400_000;
      expect(dias).toBeGreaterThan(6.9);
      expect(dias).toBeLessThanOrEqual(7);

      // La base guarda solo el hash; el token no aparece en ningún listado.
      const { rows } = await comoSistema<{ token_hash: string }>(
        prueba.admin,
        a.clinicaId,
        'select token_hash from app.invitacion where membresia_id = $1',
        [inv.persona.membresiaId],
      );
      expect(rows).toEqual([{ token_hash: hashTokenInvitacion(inv.token) }]);
      const lista = await prueba.pedir('get', '/personal', { token: duenoA }).expect(200);
      expect(JSON.stringify(lista.body)).not.toContain(inv.token);

      const publica = segun(invitacionPublicaSchema, (await consultar(inv.token).expect(200)).body);
      expect(publica).toEqual({
        clinica: a.nombre,
        rol: 'Recepción y caja',
        nombre: 'María López',
        emailEnmascarado: 'ma***@prueba.test',
        requiereIngreso: false,
        venceEn: inv.venceEn,
      });

      // Sin clave no se puede crear la cuenta.
      const sinClave = await esperarError(aceptar({ token: inv.token }), 400, 'datos_invalidos');
      expect((sinClave.body as { detalles: { campo: string }[] }).detalles[0]?.campo).toBe('clave');
      await esperarError(aceptar({ token: inv.token, clave: 'corta' }), 400, 'datos_invalidos');
      expect(prueba.adminAuth.creadas).toHaveLength(0);

      const aceptada = segun(
        invitacionAceptadaSchema,
        (await aceptar({ token: inv.token, clave: CLAVE }).expect(200)).body,
      );
      expect(aceptada).toEqual({ email: 'maria.lopez@prueba.test', clinicaId: a.clinicaId });
      expect(prueba.adminAuth.creadas).toHaveLength(1);
      const cuentaId = prueba.adminAuth.creadas[0]!;
      expect(prueba.adminAuth.cuentas.get(cuentaId)?.email).toBe('maria.lopez@prueba.test');
      expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
        estado: 'activo',
        usuario_id: cuentaId,
      });

      // La persona entra con su token: solo su clínica, su sede y los módulos de recepción.
      const jwt = await prueba.token({ sub: cuentaId, email: 'maria.lopez@prueba.test' });
      const sesion = segun(
        sesionSchema,
        (await prueba.pedir('get', '/sesion', { token: jwt }).expect(200)).body,
      );
      expect(sesion.clinica.id).toBe(a.clinicaId);
      expect(sesion.clinicas.map((c) => c.id)).toEqual([a.clinicaId]);
      expect(sesion.usuario).toMatchObject({ id: cuentaId, nombre: 'María López' });
      expect(sesion.sedes.map((s) => s.id)).toEqual([s1!.sedeId]);
      expect(sesion.sedes.map((s) => s.id)).not.toContain(s2!.sedeId);
      expect(sesion.rol.codigo).toBe('recepcion');
      expect(sesion.permisos.some((p) => p.modulo === 'personal')).toBe(false);
      await esperarError(prueba.pedir('get', '/personal', { token: jwt }), 403, 'sin_permiso');

      // El enlace sirve una sola vez.
      await esperarError(aceptar({ token: inv.token, clave: CLAVE }), 404, 'no_encontrado');
      await esperarError(consultar(inv.token), 404, 'no_encontrado');
      expect(prueba.adminAuth.creadas).toHaveLength(1);

      // En la lista ya figura activa, con sus datos de usuario.
      const despues = segun(
        z.array(personaSchema),
        (await prueba.pedir('get', '/personal', { token: duenoA }).expect(200)).body,
      );
      expect(despues.find((p) => p.membresiaId === inv.persona.membresiaId)).toMatchObject({
        usuarioId: cuentaId,
        estado: 'activo',
        invitacionVenceEn: null,
      });
    });

    describe('con cuenta previa', () => {
      let enB: Persona;
      let inv: Awaited<ReturnType<typeof invitar>>;

      beforeAll(async () => {
        // Trabaja en la clínica B: ya tiene cuenta (en la base y en Auth).
        enB = await crearPersona(prueba, b.clinicaId, {
          rol: 'recepcion',
          email: `con-cuenta-${randomUUID().slice(0, 6)}@prueba.test`,
        });
        prueba.adminAuth.agregar(enB.email, enB.usuarioId);
        inv = await invitar(prueba, duenoA, {
          email: enB.email,
          rolId: a.roles.asistente,
          sedeIds: [a.sedes[1]!.sedeId],
        });
      });

      it('consultar avisa que hay que ingresar', async () => {
        const publica = segun(
          invitacionPublicaSchema,
          (await consultar(inv.token).expect(200)).body,
        );
        expect(publica.requiereIngreso).toBe(true);
      });

      it('sin JWT → rechazo, aunque mande clave, y no crea ninguna cuenta', async () => {
        const antes = prueba.adminAuth.creadas.length;
        await esperarError(aceptar({ token: inv.token, clave: CLAVE }), 401, 'no_autenticado');
        await esperarError(aceptar({ token: inv.token }), 401, 'no_autenticado');
        expect(prueba.adminAuth.creadas.length).toBe(antes);
        expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
          'pendiente',
        );
      });

      it('JWT de otro correo → rechazo; JWT inválido o vencido → 401; la invitación sigue sirviendo', async () => {
        const otra = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
        const respuesta = await esperarError(
          aceptar({ token: inv.token }, await otra.token()),
          403,
          'sin_permiso',
        );
        expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/otro correo/);
        // Mismo sub, pero el correo del token no es el de la invitación.
        await esperarError(
          aceptar({ token: inv.token }, await enB.token('aal1', { email: 'otro@prueba.test' })),
          403,
          'sin_permiso',
        );
        await esperarError(
          aceptar({ token: inv.token }, await enB.token('aal1', { venceEn: -60 })),
          401,
          'no_autenticado',
        );
        await esperarError(
          prueba
            .pedir('post', '/invitaciones/aceptar', { cuerpo: { token: inv.token } })
            .set('Authorization', 'Bearer no-es-un-jwt'),
          401,
          'no_autenticado',
        );
        await consultar(inv.token).expect(200);
        expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
          'pendiente',
        );
      });

      it('JWT del mismo correo → acepta con el sub del token y la persona entra a la clínica A', async () => {
        const jwt = await enB.token();
        const aceptada = segun(
          invitacionAceptadaSchema,
          (await aceptar({ token: inv.token }, jwt).expect(200)).body,
        );
        expect(aceptada).toEqual({ email: enB.email, clinicaId: a.clinicaId });
        expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
          estado: 'activo',
          usuario_id: enB.usuarioId,
        });
        const sesion = segun(
          sesionSchema,
          (await prueba.pedir('get', '/sesion', { token: jwt, clinica: a.clinicaId }).expect(200))
            .body,
        );
        expect(sesion.clinica.id).toBe(a.clinicaId);
        expect(sesion.clinicas.map((c) => c.id).sort()).toEqual([a.clinicaId, b.clinicaId].sort());
        expect(sesion.sedes.map((s) => s.id)).toEqual([a.sedes[1]!.sedeId]);
        await esperarError(aceptar({ token: inv.token }, jwt), 404, 'no_encontrado');
      });

      it('cuenta que existe solo en Auth (sin usuario en la base): hay que ingresar; con el JWT acepta', async () => {
        const email = `solo-auth-${randomUUID().slice(0, 6)}@prueba.test`;
        const cuenta = prueba.adminAuth.agregar(email);
        const otra = await invitar(prueba, duenoA, { email, rolId: a.roles.recepcion });
        const publica = segun(
          invitacionPublicaSchema,
          (await consultar(otra.token).expect(200)).body,
        );
        expect(publica.requiereIngreso).toBe(true);
        await esperarError(aceptar({ token: otra.token, clave: CLAVE }), 401, 'no_autenticado');
        const jwt = await prueba.token({ sub: cuenta.id, email });
        await aceptar({ token: otra.token }, jwt).expect(200);
        expect(await estadoMembresia(a.clinicaId, otra.persona.membresiaId)).toEqual({
          estado: 'activo',
          usuario_id: cuenta.id,
        });
      });
    });
  });

  describe('tokens que no sirven', () => {
    it('usado, vencido, anulado, reenviado (el viejo) e inventado → misma respuesta en consultar y aceptar', async () => {
      const usada = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      await aceptar({ token: usada.token, clave: CLAVE }).expect(200);

      // Vencida: vence_en en el pasado, puesto como administración (la API no puede hacerlo).
      const vencida = await crearInvitacionDePrueba(prueba.admin, {
        clinicaId: a.clinicaId,
        venceEn: new Date(Date.now() - 60_000),
      });

      const anulada = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      await prueba
        .pedir('delete', `/invitaciones/${anulada.persona.membresiaId}`, {
          token: duenoA,
          cuerpo: { motivo: 'Se equivocó de correo' },
        })
        .expect(204);

      const reenviada = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      await prueba
        .pedir('post', `/invitaciones/${reenviada.persona.membresiaId}/reenviar`, { token: duenoA })
        .expect(200);

      const inventado = 'x'.repeat(10) + randomUUID().replaceAll('-', '');

      const tokens = [usada.token, vencida.token, anulada.token, reenviada.token, inventado];
      const jwtAjeno = await (await crearPersona(prueba, b.clinicaId)).token();
      const cuentasAntes = prueba.adminAuth.creadas.length;
      const respuestas: { estado: number; cuerpo: unknown }[] = [];
      for (const token of tokens) {
        for (const pedido of [
          consultar(token),
          aceptar({ token, clave: CLAVE }),
          aceptar({ token }, jwtAjeno),
        ]) {
          const r = await pedido;
          respuestas.push({ estado: r.status, cuerpo: r.body as unknown });
        }
      }
      for (const r of respuestas) {
        expect(r).toEqual(respuestas[0]);
      }
      expect(respuestas[0]?.estado).toBe(404);
      expect(errorApiSchema.parse(respuestas[0]?.cuerpo).codigo).toBe('no_encontrado');
      // Ninguna de esas aceptaciones llegó a crear una cuenta.
      expect(prueba.adminAuth.creadas.length).toBe(cuentasAntes);
    });

    it('un token mal formado (muy corto) → datos_invalidos, sin llegar a la base', async () => {
      await esperarError(consultar('corto'), 400, 'datos_invalidos');
      await esperarError(aceptar({ token: 'corto', clave: CLAVE }), 400, 'datos_invalidos');
    });
  });

  describe('frontera de confianza', () => {
    it('sin cuenta: usuarioId y email del cuerpo no tienen ningún efecto', async () => {
      const otra = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      const aceptada = segun(
        invitacionAceptadaSchema,
        (
          await aceptar({
            token: inv.token,
            clave: CLAVE,
            usuarioId: otra.usuarioId,
            email: otra.email,
          }).expect(200)
        ).body,
      );
      expect(aceptada.email).toBe(inv.persona.email);
      const creada = prueba.adminAuth.creadas.at(-1)!;
      expect(creada).not.toBe(otra.usuarioId);
      expect(prueba.adminAuth.cuentas.get(creada)?.email).toBe(inv.persona.email);
      expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
        estado: 'activo',
        usuario_id: creada,
      });
      // La otra persona no ganó acceso a A.
      await esperarError(
        prueba.pedir('get', '/sesion', { token: await otra.token(), clinica: a.clinicaId }),
        403,
        'sin_membresia',
      );
    });

    it('con cuenta: el usuario sale del JWT, no del cuerpo', async () => {
      const yo = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
      const otra = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
      const inv = await invitar(prueba, duenoA, { email: yo.email, rolId: a.roles.recepcion });
      await aceptar(
        { token: inv.token, usuarioId: otra.usuarioId, email: otra.email },
        await yo.token(),
      ).expect(200);
      expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
        estado: 'activo',
        usuario_id: yo.usuarioId,
      });
    });

    it('compensación: si la aceptación falla después de crear la cuenta, la cuenta se borra', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      // Justo después de crear la cuenta, la clínica anula la invitación (como administración).
      prueba.adminAuth.alCrear = async () => {
        await comoSistema(
          prueba.admin,
          a.clinicaId,
          `update app.invitacion set anulada_en = now(), motivo_anulacion = 'Anulada en el medio'
           where membresia_id = $1 and usada_en is null and anulada_en is null`,
          [inv.persona.membresiaId],
        );
      };
      try {
        await esperarError(aceptar({ token: inv.token, clave: CLAVE }), 404, 'no_encontrado');
      } finally {
        prueba.adminAuth.alCrear = null;
      }
      const creada = prueba.adminAuth.creadas.at(-1)!;
      expect(prueba.adminAuth.borradas).toContain(creada);
      expect(prueba.adminAuth.cuentas.has(creada)).toBe(false);
      expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
        'pendiente',
      );
    });

    it('compensación: si además falla el borrado, responde el error original', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      prueba.adminAuth.alCrear = async () => {
        prueba.adminAuth.fallas.add('borrar');
        await comoSistema(
          prueba.admin,
          a.clinicaId,
          `update app.invitacion set anulada_en = now(), motivo_anulacion = 'Anulada en el medio'
           where membresia_id = $1 and usada_en is null and anulada_en is null`,
          [inv.persona.membresiaId],
        );
      };
      try {
        await esperarError(aceptar({ token: inv.token, clave: CLAVE }), 404, 'no_encontrado');
      } finally {
        prueba.adminAuth.alCrear = null;
        prueba.adminAuth.fallas.clear();
      }
    });

    it('si Supabase Auth no responde al crear la cuenta → 503 y la invitación sigue sirviendo', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      prueba.adminAuth.fallas.add('crear');
      try {
        await esperarError(
          aceptar({ token: inv.token, clave: CLAVE }),
          503,
          'servicio_no_disponible',
        );
      } finally {
        prueba.adminAuth.fallas.clear();
      }
      await consultar(inv.token).expect(200);
      await aceptar({ token: inv.token, clave: CLAVE }).expect(200);
    });
  });

  describe('reenviar y anular', () => {
    it('reenviar: token nuevo, el viejo deja de servir, queda registrado «enviar»', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      const respuesta = await prueba
        .pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, { token: duenoA })
        .expect(200);
      const nueva = segun(
        z.object({ persona: personaSchema, enlace: z.string(), venceEn: z.string() }),
        respuesta.body,
      );
      const tokenNuevo = new URL(nueva.enlace, 'http://web.test').searchParams.get('token')!;
      expect(tokenNuevo).not.toBe(inv.token);
      expect(nueva.persona.membresiaId).toBe(inv.persona.membresiaId);
      await esperarError(consultar(inv.token), 404, 'no_encontrado');
      await consultar(tokenNuevo).expect(200);

      const { rows } = await comoSistema<{ n: string }>(
        prueba.admin,
        a.clinicaId,
        `select count(*) as n from app.audit_log l join app.invitacion i on i.id = l.entidad_id
         where l.clinica_id = $1 and l.entidad = 'invitacion' and l.accion = 'enviar'
           and i.membresia_id = $2 and l.usuario_id = $3`,
        [a.clinicaId, inv.persona.membresiaId, a.duenoId],
      );
      expect(rows[0]?.n).toBe('1');

      await aceptar({ token: tokenNuevo, clave: CLAVE }).expect(200);
      // Ya aceptada: no se reenvía.
      await esperarError(
        prueba.pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, {
          token: duenoA,
        }),
        409,
        'conflicto',
      );
    });

    it('anular: con motivo, la membresía queda inactiva y el enlace no sirve', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      const ruta = `/invitaciones/${inv.persona.membresiaId}`;
      await esperarError(prueba.pedir('delete', ruta, { token: duenoA }), 400, 'datos_invalidos');
      await prueba
        .pedir('delete', ruta, { token: duenoA, cuerpo: { motivo: 'Ya no viene' } })
        .expect(204);
      expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
        estado: 'inactivo',
        usuario_id: null,
      });
      await esperarError(consultar(inv.token), 404, 'no_encontrado');
      await esperarError(
        prueba.pedir('delete', ruta, { token: duenoA, cuerpo: { motivo: 'Otra vez' } }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('post', `${ruta}/reenviar`, { token: duenoA }),
        409,
        'conflicto',
      );
    });

    it('una invitación abierta para el mismo correo → conflicto con mensaje que dice qué hacer', async () => {
      const email = `doble-${randomUUID().slice(0, 6)}@prueba.test`;
      await invitar(prueba, duenoA, { email, rolId: a.roles.recepcion });
      const respuesta = await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: duenoA,
          cuerpo: { nombre: 'Otra vez', email, rolId: a.roles.recepcion },
        }),
        409,
        'conflicto',
      );
      expect((respuesta.body as { mensaje: string }).mensaje).toBe(
        'Ya hay una invitación abierta para ese correo. Reenviala o anulala antes de crear otra.',
      );
    });

    it('invitar a quien ya es del equipo → conflicto', async () => {
      const miembro = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const respuesta = await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: duenoA,
          cuerpo: { nombre: 'Ya está', email: miembro.email, rolId: a.roles.recepcion },
        }),
        409,
        'conflicto',
      );
      expect((respuesta.body as { mensaje: string }).mensaje).toMatch(
        /ya es o fue parte del equipo/,
      );
    });

    it('datos inválidos: sede por defecto fuera de las sedes, correo roto', async () => {
      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: duenoA,
          cuerpo: {
            nombre: 'X Y',
            email: 'xy@prueba.test',
            rolId: a.roles.recepcion,
            sedeIds: [a.sedes[0]!.sedeId],
            sedeDefectoId: a.sedes[1]!.sedeId,
          },
        }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: duenoA,
          cuerpo: { nombre: 'X Y', email: 'no-es-correo', rolId: a.roles.recepcion },
        }),
        400,
        'datos_invalidos',
      );
    });
  });

  describe('permisos', () => {
    it('administración puede invitar, reenviar y anular; recepción no', async () => {
      const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
      const recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const tAdm = await administracion.token();
      const tRec = await recepcion.token();

      const inv = await invitar(prueba, tAdm, { rolId: a.roles.asistente });
      await prueba
        .pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, { token: tAdm })
        .expect(200);

      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: tRec,
          cuerpo: { nombre: 'Nadie', email: 'nadie@prueba.test', rolId: a.roles.recepcion },
        }),
        403,
        'sin_permiso',
      );
      await esperarError(
        prueba.pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, { token: tRec }),
        403,
        'sin_permiso',
      );
      await esperarError(
        prueba.pedir('delete', `/invitaciones/${inv.persona.membresiaId}`, {
          token: tRec,
          cuerpo: { motivo: 'No corresponde' },
        }),
        403,
        'sin_permiso',
      );
      await prueba
        .pedir('delete', `/invitaciones/${inv.persona.membresiaId}`, {
          token: tAdm,
          cuerpo: { motivo: 'No corresponde' },
        })
        .expect(204);

      // Solo un dueño invita como dueño.
      const respuesta = await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: tAdm,
          cuerpo: { nombre: 'Otro Dueño', email: 'otro-dueno@prueba.test', rolId: a.roles.dueno },
        }),
        403,
        'sin_permiso',
      );
      expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/Solo un dueño/);
    });

    it('dimensión sede: quien no ve todas las sedes solo asigna las suyas', async () => {
      const c = await crearClinica(prueba, { sedes: 2 });
      const [s1, s2] = c.sedes;
      await otorgarPermiso(prueba, c.clinicaId, c.roles.odontologo, 'personal', 'crear');
      const odontologa = await crearPersona(prueba, c.clinicaId, {
        rol: 'odontologo',
        sedes: [s1!.sedeId],
      });
      const t = await odontologa.token();
      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: t,
          cuerpo: {
            nombre: 'Asistente Nueva',
            email: `asis-${randomUUID().slice(0, 6)}@prueba.test`,
            rolId: c.roles.asistente,
            sedeIds: [s1!.sedeId, s2!.sedeId],
          },
        }),
        403,
        'sede_no_permitida',
      );
      const inv = await invitar(prueba, t, { rolId: c.roles.asistente, sedeIds: [s1!.sedeId] });
      expect(inv.persona.sedeIds).toEqual([s1!.sedeId]);
    });
  });

  describe('aislamiento', () => {
    it('otra clínica no reenvía, no anula ni usa roles o sedes de A', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      const duenoB = await b.dueno.token();
      await esperarError(
        prueba.pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, {
          token: duenoB,
        }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('delete', `/invitaciones/${inv.persona.membresiaId}`, {
          token: duenoB,
          cuerpo: { motivo: 'Intento ajeno' },
        }),
        404,
        'no_encontrado',
      );
      // Rol de A desde B: la base lo rechaza por el FK compuesto (sin decir si existe).
      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: duenoB,
          cuerpo: { nombre: 'Cruzada', email: 'cruzada@prueba.test', rolId: a.roles.recepcion },
        }),
        409,
        'conflicto',
      );
      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: duenoB,
          cuerpo: {
            nombre: 'Cruzada',
            email: 'cruzada@prueba.test',
            rolId: b.roles.recepcion,
            sedeIds: [a.sedes[0]!.sedeId],
          },
        }),
        400,
        'datos_invalidos',
      );
      // A no cambió.
      await consultar(inv.token).expect(200);
      expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
        estado: 'pendiente',
        usuario_id: null,
      });
    });
  });
});

describe('invitaciones sin clave secreta de Supabase', () => {
  let prueba: PruebaPersonal;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal({ conAdminAuth: false });
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('consultar sigue funcionando; aceptar sin cuenta → 503 que lo explica; con cuenta sí acepta', async () => {
    const duenoA = await a.dueno.token();
    const nueva = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
    const publica = segun(
      invitacionPublicaSchema,
      (
        await prueba
          .pedir('post', '/invitaciones/consultar', { cuerpo: { token: nueva.token } })
          .expect(200)
      ).body,
    );
    expect(publica.requiereIngreso).toBe(false);

    const respuesta = await esperarError(
      prueba.pedir('post', '/invitaciones/aceptar', {
        cuerpo: { token: nueva.token, clave: CLAVE },
      }),
      503,
      'servicio_no_disponible',
    );
    expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/crear cuentas nuevas/);
    await prueba
      .pedir('post', '/invitaciones/consultar', { cuerpo: { token: nueva.token } })
      .expect(200);

    // Con cuenta previa (usuario en la base) no hace falta la Admin API.
    const otra = await crearClinica(prueba, { sedes: 1 });
    const conCuenta = await crearPersona(prueba, otra.clinicaId, { rol: 'recepcion' });
    const inv = await invitar(prueba, duenoA, { email: conCuenta.email, rolId: a.roles.recepcion });
    const consultada = segun(
      invitacionPublicaSchema,
      (
        await prueba
          .pedir('post', '/invitaciones/consultar', { cuerpo: { token: inv.token } })
          .expect(200)
      ).body,
    );
    expect(consultada.requiereIngreso).toBe(true);
    await prueba
      .pedir('post', '/invitaciones/aceptar', {
        cuerpo: { token: inv.token },
        token: await conCuenta.token(),
      })
      .expect(200);
  });
});
