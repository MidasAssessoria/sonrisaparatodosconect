/**
 * Invitaciones de punta a punta (contrato de personal: solo quien controla el correo invitado puede
 * usarla): alta con correo de Supabase para quien no tiene cuenta confirmada (Admin API en memoria),
 * consulta pública con `siguientePaso`, aceptación SIEMPRE con JWT de correo confirmado según la
 * Admin API, tokens que no sirven, fallas de Supabase, reenvío, anulación, permisos y aislamiento.
 */
import { randomUUID } from 'node:crypto';
import { hashTokenInvitacion } from '@conecta/db';
import {
  crearInvitacionDePrueba,
  crearRolDePrueba,
  crearUsuarioDePrueba,
} from '@conecta/db/pruebas';
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
  segun,
  type Clinica,
  type Persona,
} from './ayudas.js';
import {
  aceptarDesdeCorreo,
  crearPruebaPersonal,
  invitar,
  type PruebaPersonal,
} from './ayudas-personal.js';

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
  const siguientePaso = async (token: string): Promise<string> =>
    segun(invitacionPublicaSchema, (await consultar(token).expect(200)).body).siguientePaso;
  const redirectDe = (token: string): string =>
    `${prueba.config.webOrigenPublico}/invitacion?token=${token}`;

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

  async function enviosDe(
    clinicaId: string,
    membresiaId: string,
  ): Promise<{ medio: string; reenvio: boolean }[]> {
    const { rows } = await comoSistema<{ medio: string; reenvio: boolean }>(
      prueba.admin,
      clinicaId,
      `select l.despues ->> 'medio' as medio, (l.despues ->> 'reenvio')::boolean as reenvio
       from app.audit_log l join app.invitacion i on i.id = l.entidad_id
       where l.clinica_id = $1 and l.entidad = 'invitacion' and l.accion = 'enviar'
         and i.membresia_id = $2
       order by l.fecha, l.id`,
      [clinicaId, membresiaId],
    );
    return rows;
  }

  describe('de punta a punta, sin cuenta previa', () => {
    it('crear pide el correo de Supabase con el redirectTo de la web; la cuenta confirma desde el correo y acepta con aal1', async () => {
      const [s1, s2] = a.sedes;
      const antes = prueba.adminAuth.invitaciones.length;
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
      // Vence a las 72 horas.
      const horas = (Date.parse(inv.venceEn) - Date.now()) / 3_600_000;
      expect(horas).toBeGreaterThan(71.9);
      expect(horas).toBeLessThanOrEqual(72);

      // Supabase recibió el pedido de invitación: correo invitado y vuelta a /invitacion?token=…
      expect(prueba.adminAuth.invitaciones.slice(antes)).toEqual([
        { email: 'maria.lopez@prueba.test', redirectTo: redirectDe(inv.token) },
      ]);
      expect(redirectDe(inv.token)).toBe(`http://localhost:5173${inv.enlace}`);
      expect(await enviosDe(a.clinicaId, inv.persona.membresiaId)).toEqual([
        { medio: 'correo_invitacion', reenvio: false },
      ]);
      const cuenta = prueba.adminAuth.porCorreo('maria.lopez@prueba.test')!;
      expect(cuenta).toMatchObject({ confirmada: false, nacidaPorInvitacion: true });

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
        siguientePaso: 'revisa_tu_correo',
        venceEn: inv.venceEn,
      });

      // Sin Authorization: rechazo, aunque mande una clave (el contrato ya no la tiene).
      await esperarError(aceptar({ token: inv.token }), 401, 'no_autenticado');
      await esperarError(
        aceptar({ token: inv.token, clave: 'una-clave-larga-123' }),
        401,
        'no_autenticado',
      );

      // Con el JWT de la cuenta, pero el correo todavía sin confirmar: rechazo.
      const jwt = await prueba.token({ sub: cuenta.id, email: cuenta.email });
      const sinConfirmar = await esperarError(
        aceptar({ token: inv.token }, jwt),
        403,
        'sin_permiso',
      );
      expect((sinConfirmar.body as { mensaje: string }).mensaje).toMatch(/confirmaste tu correo/);
      expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
        'pendiente',
      );

      // Abre el correo: la cuenta queda confirmada, pero sigue «revisa tu correo» (todavía tiene
      // que elegir su contraseña en la web y aceptar).
      prueba.adminAuth.confirmar(cuenta.email);
      expect(await siguientePaso(inv.token)).toBe('revisa_tu_correo');

      const aceptada = segun(
        invitacionAceptadaSchema,
        (await aceptar({ token: inv.token }, jwt).expect(200)).body,
      );
      expect(aceptada).toEqual({ email: 'maria.lopez@prueba.test', clinicaId: a.clinicaId });
      expect(await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).toEqual({
        estado: 'activo',
        usuario_id: cuenta.id,
      });

      // La persona entra con su token: solo su clínica, su sede y los módulos de recepción.
      const sesion = segun(
        sesionSchema,
        (await prueba.pedir('get', '/sesion', { token: jwt }).expect(200)).body,
      );
      expect(sesion.clinica.id).toBe(a.clinicaId);
      expect(sesion.clinicas.map((c) => c.id)).toEqual([a.clinicaId]);
      expect(sesion.usuario).toMatchObject({ id: cuenta.id, nombre: 'María López' });
      expect(sesion.sedes.map((s) => s.id)).toEqual([s1!.sedeId]);
      expect(sesion.sedes.map((s) => s.id)).not.toContain(s2!.sedeId);
      expect(sesion.rol.codigo).toBe('recepcion');
      expect(sesion.permisos.some((p) => p.modulo === 'personal')).toBe(false);
      await esperarError(prueba.pedir('get', '/personal', { token: jwt }), 403, 'sin_permiso');

      // El enlace sirve una sola vez.
      await esperarError(aceptar({ token: inv.token }, jwt), 404, 'no_encontrado');
      await esperarError(consultar(inv.token), 404, 'no_encontrado');

      // En la lista ya figura activa, con sus datos de usuario.
      const despues = segun(
        z.array(personaSchema),
        (await prueba.pedir('get', '/personal', { token: duenoA }).expect(200)).body,
      );
      expect(despues.find((p) => p.membresiaId === inv.persona.membresiaId)).toMatchObject({
        usuarioId: cuenta.id,
        estado: 'activo',
        invitacionVenceEn: null,
      });

      // Ya es usuario del sistema: una invitación de otra clínica no le manda correo de Supabase y
      // consultar dice «cuenta existente» sin preguntarle a la Admin API.
      const duenoB = await b.dueno.token();
      const enviosAntes = prueba.adminAuth.invitaciones.length;
      const otra = await invitar(prueba, duenoB, {
        email: 'maria.lopez@prueba.test',
        rolId: b.roles.recepcion,
      });
      expect(prueba.adminAuth.invitaciones.length).toBe(enviosAntes);
      const llamadas = { ...prueba.adminAuth.llamadas };
      expect(await siguientePaso(otra.token)).toBe('cuenta_existente');
      expect(prueba.adminAuth.llamadas).toEqual(llamadas);
    });

    it('con JWT confirmado de otro correo, o un JWT cuyo correo no es el de su cuenta en Auth → rechazo', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      prueba.adminAuth.confirmar(inv.persona.email);
      const otra = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
      prueba.adminAuth.agregar(otra.email, { id: otra.usuarioId });
      const r = await esperarError(
        aceptar({ token: inv.token }, await otra.token()),
        403,
        'sin_permiso',
      );
      expect((r.body as { mensaje: string }).mensaje).toMatch(/otro correo/);
      // El JWT dice el correo invitado, pero en Auth esa cuenta tiene otro correo.
      await esperarError(
        aceptar({ token: inv.token }, await otra.token('aal1', { email: inv.persona.email })),
        403,
        'sin_permiso',
      );
      // Un sub que Auth no conoce, con el correo invitado.
      await esperarError(
        aceptar(
          { token: inv.token },
          await prueba.token({ sub: randomUUID(), email: inv.persona.email }),
        ),
        403,
        'sin_permiso',
      );
      expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
        'pendiente',
      );
      await consultar(inv.token).expect(200);
    });
  });

  describe('con cuenta previa', () => {
    let enB: Persona;
    let inv: Awaited<ReturnType<typeof invitar>>;
    let enviosAntes: number;

    beforeAll(async () => {
      // Trabaja en la clínica B: ya tiene cuenta (en la base y, confirmada, en Auth).
      enB = await crearPersona(prueba, b.clinicaId, {
        rol: 'recepcion',
        email: `con-cuenta-${randomUUID().slice(0, 6)}@prueba.test`,
      });
      prueba.adminAuth.agregar(enB.email, { id: enB.usuarioId });
      enviosAntes = prueba.adminAuth.invitaciones.length;
      inv = await invitar(prueba, duenoA, {
        email: enB.email,
        rolId: a.roles.asistente,
        sedeIds: [a.sedes[1]!.sedeId],
      });
    });

    it('crear no manda correo de Supabase; consultar dice «cuenta existente»', async () => {
      expect(prueba.adminAuth.invitaciones.length).toBe(enviosAntes);
      expect(await enviosDe(a.clinicaId, inv.persona.membresiaId)).toEqual([]);
      expect(await siguientePaso(inv.token)).toBe('cuenta_existente');
    });

    it('sin JWT → rechazo; JWT inválido o vencido → 401; la invitación sigue sirviendo', async () => {
      await esperarError(aceptar({ token: inv.token }), 401, 'no_autenticado');
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
      // Mismo sub, pero el correo del token no es el de la invitación.
      await esperarError(
        aceptar({ token: inv.token }, await enB.token('aal1', { email: 'otro@prueba.test' })),
        403,
        'sin_permiso',
      );
      await consultar(inv.token).expect(200);
      expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
        'pendiente',
      );
    });

    it('JWT aal1 del mismo correo, confirmado → acepta con el sub del token y entra a la clínica A', async () => {
      const jwt = await enB.token('aal1');
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

    it('cuenta confirmada que existe solo en Auth (registrada por su cuenta): sin correo, «cuenta existente», acepta con JWT', async () => {
      const email = `solo-auth-${randomUUID().slice(0, 6)}@prueba.test`;
      const cuenta = prueba.adminAuth.agregar(email);
      const antes = prueba.adminAuth.invitaciones.length;
      const otra = await invitar(prueba, duenoA, { email, rolId: a.roles.recepcion });
      // Supabase respondió «ya existe confirmada»: no se mandó nada.
      expect(prueba.adminAuth.invitaciones.length).toBe(antes);
      expect(prueba.adminAuth.enlaces.map((e) => e.email)).not.toContain(email);
      expect(await siguientePaso(otra.token)).toBe('cuenta_existente');
      await esperarError(aceptar({ token: otra.token }), 401, 'no_autenticado');
      await aceptar({ token: otra.token }, await prueba.token({ sub: cuenta.id, email })).expect(
        200,
      );
      expect(await estadoMembresia(a.clinicaId, otra.persona.membresiaId)).toEqual({
        estado: 'activo',
        usuario_id: cuenta.id,
      });
    });

    it('cuenta nacida de otra invitación, confirmada y sin aceptar nada: «revisa tu correo» y se le manda un enlace de ingreso', async () => {
      const email = `abandonada-${randomUUID().slice(0, 6)}@prueba.test`;
      // La invitó la clínica B, abrió el correo (confirmó) y nunca aceptó.
      const invB = await invitar(prueba, await b.dueno.token(), {
        email,
        rolId: b.roles.recepcion,
      });
      const cuenta = prueba.adminAuth.confirmar(email);
      expect(await siguientePaso(invB.token)).toBe('revisa_tu_correo');

      const enviosAntesA = prueba.adminAuth.invitaciones.length;
      const invA = await invitar(prueba, duenoA, { email, rolId: a.roles.recepcion });
      // Supabase no reenvía una invitación a una cuenta confirmada: va un enlace de ingreso.
      expect(prueba.adminAuth.invitaciones.length).toBe(enviosAntesA);
      expect(prueba.adminAuth.enlaces.at(-1)).toEqual({
        email,
        redirectTo: redirectDe(invA.token),
      });
      expect(await enviosDe(a.clinicaId, invA.persona.membresiaId)).toEqual([
        { medio: 'correo_ingreso', reenvio: false },
      ]);
      expect(await siguientePaso(invA.token)).toBe('revisa_tu_correo');
      await aceptar({ token: invA.token }, await prueba.token({ sub: cuenta.id, email })).expect(
        200,
      );
    });
  });

  describe('tokens que no sirven', () => {
    it('usado, vencido, anulado, reenviado (el viejo) e inventado → misma respuesta en consultar y aceptar', async () => {
      const usada = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      await aceptarDesdeCorreo(prueba, usada);

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
      const ajena = await crearPersona(prueba, b.clinicaId);
      prueba.adminAuth.agregar(ajena.email, { id: ajena.usuarioId });
      const jwtAjeno = await ajena.token();
      // Además, el JWT confirmado del correo de cada invitación (cuando lo hay).
      const jwtPropio = async (token: string): Promise<string | null> => {
        const inv = [usada, anulada, reenviada].find((i) => i.token === token);
        if (!inv) return null;
        const cuenta = prueba.adminAuth.confirmar(inv.persona.email);
        return prueba.token({ sub: cuenta.id, email: cuenta.email });
      };
      const conToken: { estado: number; cuerpo: unknown }[] = [];
      const sinToken: { estado: number; cuerpo: unknown }[] = [];
      for (const token of tokens) {
        const propio = await jwtPropio(token);
        for (const pedido of [
          consultar(token),
          aceptar({ token }, jwtAjeno),
          ...(propio ? [aceptar({ token }, propio)] : []),
        ]) {
          const r = await pedido;
          conToken.push({ estado: r.status, cuerpo: r.body as unknown });
        }
        const r = await aceptar({ token });
        sinToken.push({ estado: r.status, cuerpo: r.body as unknown });
      }
      for (const r of conToken) expect(r).toEqual(conToken[0]);
      expect(conToken[0]?.estado).toBe(404);
      expect(errorApiSchema.parse(conToken[0]?.cuerpo).codigo).toBe('no_encontrado');
      // Sin Authorization siempre lo mismo, sin mirar el token.
      for (const r of sinToken) expect(r).toEqual(sinToken[0]);
      expect(sinToken[0]?.estado).toBe(401);
    });

    it('un token mal formado (muy corto) → datos_invalidos, sin llegar a la base', async () => {
      await esperarError(consultar('corto'), 400, 'datos_invalidos');
      await esperarError(
        aceptar({ token: 'corto' }, await a.dueno.token()),
        400,
        'datos_invalidos',
      );
    });
  });

  describe('frontera de confianza', () => {
    it('usuarioId y email del cuerpo no tienen ningún efecto: el usuario sale del JWT', async () => {
      const yo = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
      prueba.adminAuth.agregar(yo.email, { id: yo.usuarioId });
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
      // La otra persona no ganó acceso a A.
      await esperarError(
        prueba.pedir('get', '/sesion', { token: await otra.token(), clinica: a.clinicaId }),
        403,
        'sin_membresia',
      );
    });

    it('si Supabase no responde al invitar → 503 y la invitación no queda (se puede volver a crear)', async () => {
      const email = `sin-correo-${randomUUID().slice(0, 6)}@prueba.test`;
      prueba.adminAuth.fallas.add('invitar');
      try {
        const r = await esperarError(
          prueba.pedir('post', '/invitaciones', {
            token: duenoA,
            cuerpo: { nombre: 'Sin Correo', email, rolId: a.roles.recepcion },
          }),
          503,
          'servicio_no_disponible',
        );
        expect((r.body as { mensaje: string }).mensaje).toMatch(/no se guardó/);
      } finally {
        prueba.adminAuth.fallas.clear();
      }
      const lista = segun(
        z.array(personaSchema),
        (await prueba.pedir('get', '/personal', { token: duenoA }).expect(200)).body,
      );
      expect(lista.some((p) => p.email === email)).toBe(false);
      const inv = await invitar(prueba, duenoA, { email, rolId: a.roles.recepcion });
      expect(prueba.adminAuth.invitaciones.at(-1)).toEqual({
        email,
        redirectTo: redirectDe(inv.token),
      });
    });

    it('si Supabase no responde al aceptar o al consultar → 503 y la invitación sigue sirviendo', async () => {
      const inv = await invitar(prueba, duenoA, { rolId: a.roles.recepcion });
      const cuenta = prueba.adminAuth.confirmar(inv.persona.email);
      const jwt = await prueba.token({ sub: cuenta.id, email: cuenta.email });
      prueba.adminAuth.fallas.add('obtener');
      prueba.adminAuth.fallas.add('buscar');
      try {
        await esperarError(aceptar({ token: inv.token }, jwt), 503, 'servicio_no_disponible');
        await esperarError(consultar(inv.token), 503, 'servicio_no_disponible');
      } finally {
        prueba.adminAuth.fallas.clear();
      }
      expect((await estadoMembresia(a.clinicaId, inv.persona.membresiaId)).estado).toBe(
        'pendiente',
      );
      await aceptar({ token: inv.token }, jwt).expect(200);
    });
  });

  describe('reenviar y anular', () => {
    it('reenviar: token nuevo, el viejo deja de servir, vuelve a mandar el correo y queda «enviar»', async () => {
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

      // La cuenta seguía sin confirmar: Supabase vuelve a mandar el correo, con el token nuevo.
      expect(prueba.adminAuth.invitaciones.at(-1)).toEqual({
        email: inv.persona.email,
        redirectTo: redirectDe(tokenNuevo),
      });
      expect(await enviosDe(a.clinicaId, inv.persona.membresiaId)).toEqual([
        { medio: 'correo_invitacion', reenvio: false },
        { medio: 'correo_invitacion', reenvio: true },
      ]);
      const { rows } = await comoSistema<{ n: string }>(
        prueba.admin,
        a.clinicaId,
        `select count(*) as n from app.audit_log l join app.invitacion i on i.id = l.entidad_id
         where l.clinica_id = $1 and l.entidad = 'invitacion' and l.accion = 'enviar'
           and i.membresia_id = $2 and l.usuario_id = $3`,
        [a.clinicaId, inv.persona.membresiaId, a.duenoId],
      );
      expect(rows[0]?.n).toBe('2');

      await aceptarDesdeCorreo(prueba, { token: tokenNuevo, persona: inv.persona });
      // Ya aceptada: no se reenvía.
      await esperarError(
        prueba.pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, {
          token: duenoA,
        }),
        409,
        'conflicto',
      );
    });

    it('reenviar a quien ya tiene cuenta confirmada: no manda correo de Supabase, queda «enviar» por enlace', async () => {
      const conCuenta = await crearPersona(prueba, b.clinicaId, { rol: 'recepcion' });
      prueba.adminAuth.agregar(conCuenta.email, { id: conCuenta.usuarioId });
      const inv = await invitar(prueba, duenoA, {
        email: conCuenta.email,
        rolId: a.roles.recepcion,
      });
      const antes = prueba.adminAuth.invitaciones.length;
      await prueba
        .pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, { token: duenoA })
        .expect(200);
      expect(prueba.adminAuth.invitaciones.length).toBe(antes);
      expect(await enviosDe(a.clinicaId, inv.persona.membresiaId)).toEqual([
        { medio: 'enlace', reenvio: true },
      ]);
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
      const antes = prueba.adminAuth.invitaciones.length;
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
      // La base lo rechazó antes: no salió ningún correo.
      expect(prueba.adminAuth.invitaciones.length).toBe(antes);
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
    it('administración invita, reenvía y anula con un rol que no da más que el suyo; recepción no', async () => {
      const administracion = await crearPersona(prueba, a.clinicaId, { rol: 'administracion' });
      const recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const tAdm = await administracion.token();
      const tRec = await recepcion.token();
      const { rolId: rolMenor } = await crearRolDePrueba(prueba.admin, {
        clinicaId: a.clinicaId,
        permisos: ['inicio:ver', 'agenda:ver', 'caja:ver'],
      });

      const inv = await invitar(prueba, tAdm, { rolId: rolMenor });
      await prueba
        .pedir('post', `/invitaciones/${inv.persona.membresiaId}/reenviar`, { token: tAdm })
        .expect(200);

      await esperarError(
        prueba.pedir('post', '/invitaciones', {
          token: tRec,
          cuerpo: { nombre: 'Nadie', email: 'nadie@prueba.test', rolId: rolMenor },
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

  it('sin cuenta: no se puede avisar por correo → 503 y no se crea; con cuenta en la base se crea, pero aceptar → 503', async () => {
    const duenoA = await a.dueno.token();
    const email = `nueva-${randomUUID().slice(0, 6)}@prueba.test`;
    const respuesta = await esperarError(
      prueba.pedir('post', '/invitaciones', {
        token: duenoA,
        cuerpo: { nombre: 'Nueva Persona', email, rolId: a.roles.recepcion },
      }),
      503,
      'servicio_no_disponible',
    );
    expect((respuesta.body as { mensaje: string }).mensaje).toMatch(/Avisá a soporte/);
    const lista = segun(
      z.array(personaSchema),
      (await prueba.pedir('get', '/personal', { token: duenoA }).expect(200)).body,
    );
    expect(lista.some((p) => p.email === email)).toBe(false);

    // Con cuenta previa (usuario en la base) no hace falta el correo de Supabase.
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
    expect(consultada.siguientePaso).toBe('cuenta_existente');
    // Pero sin la Admin API no se puede comprobar que el correo esté confirmado.
    await esperarError(
      prueba.pedir('post', '/invitaciones/aceptar', {
        cuerpo: { token: inv.token },
        token: await conCuenta.token(),
      }),
      503,
      'servicio_no_disponible',
    );
  });
});

describe('dimensión sede en personal e invitaciones', () => {
  let prueba: PruebaPersonal;
  let c: Clinica;

  beforeAll(async () => {
    prueba = await crearPruebaPersonal();
    c = await crearClinica(prueba, { sedes: 3 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('quien ve solo la sede 1 no ve ni modifica a alguien de la sede 3 (404) y no invita con un rol de todas las sedes', async () => {
    const [s1, , s3] = c.sedes;
    const permisosPersonal = [
      'personal:ver',
      'personal:crear',
      'personal:editar',
      'personal:anular',
    ];
    const { rolId: rolEncargada } = await crearRolDePrueba(prueba.admin, {
      clinicaId: c.clinicaId,
      nombre: 'Encargada de sede',
      permisos: [...permisosPersonal, 'agenda:ver'],
    });
    const { rolId: rolMenor } = await crearRolDePrueba(prueba.admin, {
      clinicaId: c.clinicaId,
      permisos: ['agenda:ver'],
    });
    const { rolId: rolTodas } = await crearRolDePrueba(prueba.admin, {
      clinicaId: c.clinicaId,
      permisos: ['agenda:ver'],
      todasLasSedes: true,
    });
    const conRol = async (rolId: string, sedeId: string) => {
      const creado = await crearUsuarioDePrueba(prueba.admin, {
        clinicaId: c.clinicaId,
        rolId,
        sedeIds: [sedeId],
      });
      return {
        ...creado,
        token: () => prueba.token({ sub: creado.usuarioId, email: creado.email }),
      };
    };
    const encargada = await conRol(rolEncargada, s1!.sedeId);
    const t = await encargada.token();

    const duenoC = await c.dueno.token();
    // Una persona activa y una invitación pendiente en la sede 3, cargadas por el dueño.
    const enSede3 = await conRol(rolMenor, s3!.sedeId);
    const invSede3 = await invitar(prueba, duenoC, { rolId: rolMenor, sedeIds: [s3!.sedeId] });
    const enSede1 = await crearPersona(prueba, c.clinicaId, {
      rol: 'recepcion',
      sedes: [s1!.sedeId],
    });

    const lista = segun(
      z.array(personaSchema),
      (await prueba.pedir('get', '/personal', { token: t }).expect(200)).body,
    );
    const ids = lista.map((p) => p.membresiaId);
    expect(ids).toContain(enSede1.membresiaId);
    expect(ids).not.toContain(enSede3.membresiaId);
    expect(ids).not.toContain(invSede3.persona.membresiaId);
    // El dueño (todas las sedes) no está en el alcance de quien ve una sola.
    expect(ids).not.toContain(c.membresiaDuenoId);

    const baja = { motivo: 'Intento fuera de alcance' };
    for (const pedido of [
      prueba.pedir('patch', `/personal/${enSede3.membresiaId}`, {
        token: t,
        cuerpo: { rolId: rolMenor },
      }),
      prueba.pedir('post', `/personal/${enSede3.membresiaId}/desactivar`, {
        token: t,
        cuerpo: baja,
      }),
      prueba.pedir('post', `/personal/${enSede3.membresiaId}/reactivar`, { token: t }),
      prueba.pedir('post', `/invitaciones/${invSede3.persona.membresiaId}/reenviar`, { token: t }),
      prueba.pedir('delete', `/invitaciones/${invSede3.persona.membresiaId}`, {
        token: t,
        cuerpo: baja,
      }),
    ]) {
      await esperarError(pedido, 404, 'no_encontrado');
    }
    // Nada cambió.
    const { rows } = await comoSistema<{ id: string; estado: string; rol_id: string }>(
      prueba.admin,
      c.clinicaId,
      'select id, estado, rol_id from app.membresia where id = any($1::uuid[]) order by id',
      [[enSede3.membresiaId, invSede3.persona.membresiaId]],
    );
    expect(rows).toEqual(
      [
        { id: enSede3.membresiaId, estado: 'activo', rol_id: rolMenor },
        { id: invSede3.persona.membresiaId, estado: 'pendiente', rol_id: rolMenor },
      ].sort((x, y) => x.id.localeCompare(y.id)),
    );

    // No invita con un rol de todas las sedes (aunque no dé más permisos que el suyo).
    const todas = await esperarError(
      prueba.pedir('post', '/invitaciones', {
        token: t,
        cuerpo: {
          nombre: 'Ve Todo',
          email: `todo-${randomUUID().slice(0, 6)}@prueba.test`,
          rolId: rolTodas,
          sedeIds: [s1!.sedeId],
        },
      }),
      403,
      'sin_permiso',
    );
    expect((todas.body as { mensaje: string }).mensaje).toBe(
      'Ese rol ve todas las sedes y el tuyo no. Pedile al dueño que lo asigne.',
    );
    // Ni en una sede que no ve.
    await esperarError(
      prueba.pedir('post', '/invitaciones', {
        token: t,
        cuerpo: {
          nombre: 'Otra Sede',
          email: `otra-${randomUUID().slice(0, 6)}@prueba.test`,
          rolId: rolMenor,
          sedeIds: [s3!.sedeId],
        },
      }),
      403,
      'sede_no_permitida',
    );
    // En la suya, con un rol menor, sí.
    const propia = await invitar(prueba, t, { rolId: rolMenor, sedeIds: [s1!.sedeId] });
    expect(propia.persona.sedeIds).toEqual([s1!.sedeId]);
    // Y a la persona de su sede la puede desactivar con motivo (desactivar no otorga nada, aunque
    // su rol dé más que el de quien desactiva), pero no reactivarla (eso es volver a dar el rol).
    await prueba
      .pedir('post', `/personal/${enSede1.membresiaId}/desactivar`, { token: t, cuerpo: baja })
      .expect(200);
    await esperarError(
      prueba.pedir('post', `/personal/${enSede1.membresiaId}/reactivar`, { token: t }),
      403,
      'sin_permiso',
    );
  });
});
