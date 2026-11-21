import { randomUUID } from 'node:crypto';
import { crearSedeDePrueba } from '@conecta/db/pruebas';
import {
  bloqueoSchema,
  profesionalSchema,
  type Profesional,
  type RolSistema,
  type TramoDisponibilidad,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
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
import {
  SEMANA_COMPLETA,
  auditoriaDe,
  crearProfesional,
  fijarHorario,
} from './profesionales-ayudas.js';

type Metodo = 'get' | 'post' | 'patch' | 'put' | 'delete';
type Detalles = { mensaje: string; detalles?: { campo: string; mensaje: string }[] };

const tramo = (
  sedeId: string,
  diaSemana: number,
  horaInicio: string,
  horaFin: string,
  sillonId: string | null = null,
): TramoDisponibilidad => ({ sedeId, diaSemana, horaInicio, horaFin, sillonId });

describe('profesionales', () => {
  let prueba: Prueba;
  let a: Clinica;
  let b: Clinica;
  let token: string;
  let sede1: { sedeId: string; sillonId: string };
  let sede2: { sedeId: string; sillonId: string };

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 2 });
    b = await crearClinica(prueba, { sedes: 1 });
    token = await a.dueno.token();
    [sede1, sede2] = a.sedes as [typeof sede1, typeof sede1];
    // Sede 1: lunes a sábado 08–18, salvo el martes (08–12 y 14–18). Sede 2: lunes a sábado 08–18.
    await fijarHorario(prueba, a.clinicaId, sede1.sedeId, [
      ...SEMANA_COMPLETA.filter((f) => f.diaSemana !== 2),
      { diaSemana: 2, horaInicio: '08:00', horaFin: '12:00' },
      { diaSemana: 2, horaInicio: '14:00', horaFin: '18:00' },
    ]);
    await fijarHorario(prueba, a.clinicaId, sede2.sedeId, SEMANA_COMPLETA);
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const reemplazar = (id: string, tramos: TramoDisponibilidad[], t = token) =>
    prueba.pedir('put', `/profesionales/${id}/disponibilidad`, { token: t, cuerpo: { tramos } });

  describe('alta, detalle y edición', () => {
    it('crea con todos los datos y lo devuelve igual en el detalle', async () => {
      const p = await crearProfesional(prueba, token, {
        nombre: '  Dr. Benítez  ',
        especialidad: 'Ortodoncia',
        color: '#0055AA',
        registroProf: 'RP-1234',
        membresiaId: a.dueno.membresiaId,
      });
      expect(p).toMatchObject({
        nombre: 'Dr. Benítez',
        especialidad: 'Ortodoncia',
        color: '#0055AA',
        registroProf: 'RP-1234',
        membresiaId: a.dueno.membresiaId,
        activo: true,
        disponibilidad: [],
        bloqueos: [],
      });
      const detalle = segun(
        profesionalSchema,
        (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
      );
      expect(detalle).toEqual(p);
    });

    it('cadena vacía en especialidad y registro = sin dato; sin usuario asociado', async () => {
      const p = await crearProfesional(prueba, token, { especialidad: '', registroProf: '  ' });
      expect(p).toMatchObject({ especialidad: null, registroProf: null, membresiaId: null });
    });

    it('datos inválidos → datos_invalidos con detalle por campo', async () => {
      const respuesta = await esperarError(
        prueba.pedir('post', '/profesionales', {
          token,
          cuerpo: { nombre: 'x', color: 'verde', membresiaId: 'no-es-id' },
        }),
        400,
        'datos_invalidos',
      );
      const campos = (respuesta.body as Detalles).detalles?.map((d) => d.campo).sort();
      expect(campos).toEqual(['color', 'membresiaId', 'nombre']);
    });

    it('edita, vacía campos con null y desactiva', async () => {
      const p = await crearProfesional(prueba, token, {
        especialidad: 'Endodoncia',
        registroProf: 'RP-9',
      });
      const editado = segun(
        profesionalSchema,
        (
          await prueba
            .pedir('patch', `/profesionales/${p.id}`, {
              token,
              cuerpo: {
                nombre: 'Dra. Acosta Ruiz',
                especialidad: null,
                registroProf: '',
                activo: false,
              },
            })
            .expect(200)
        ).body,
      );
      expect(editado).toMatchObject({
        nombre: 'Dra. Acosta Ruiz',
        especialidad: null,
        registroProf: null,
        activo: false,
      });
      const igual = segun(
        profesionalSchema,
        (await prueba.pedir('patch', `/profesionales/${p.id}`, { token, cuerpo: {} }).expect(200))
          .body,
      );
      expect(igual).toEqual(editado);
    });

    it('lista activos primero y después por nombre', async () => {
      const otra = await crearClinica(prueba, { sedes: 1 });
      const t = await otra.dueno.token();
      const zeta = await crearProfesional(prueba, t, { nombre: 'Zeta' });
      const alfa = await crearProfesional(prueba, t, { nombre: 'Alfa' });
      const beta = await crearProfesional(prueba, t, { nombre: 'Beta' });
      await prueba
        .pedir('patch', `/profesionales/${alfa.id}`, { token: t, cuerpo: { activo: false } })
        .expect(200);
      const lista = segun(
        z.array(profesionalSchema),
        (await prueba.pedir('get', '/profesionales', { token: t }).expect(200)).body,
      );
      expect(lista.map((p) => [p.nombre, p.activo])).toEqual([
        ['Beta', true],
        ['Zeta', true],
        ['Alfa', false],
      ]);
      expect(lista.map((p) => p.id)).toEqual([beta.id, zeta.id, alfa.id]);
    });

    it('membresía: de esta clínica y una sola vez; ajena o inexistente → no_encontrado', async () => {
      const persona = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
      const p = await crearProfesional(prueba, token, { membresiaId: persona.membresiaId });
      expect(p.membresiaId).toBe(persona.membresiaId);

      const repetida = await esperarError(
        prueba.pedir('post', '/profesionales', {
          token,
          cuerpo: { nombre: 'Otro', color: '#000000', membresiaId: persona.membresiaId },
        }),
        409,
        'conflicto',
      );
      expect((repetida.body as Detalles).mensaje).toMatch(/ya tiene un profesional asociado/);

      await esperarError(
        prueba.pedir('post', '/profesionales', {
          token,
          cuerpo: { nombre: 'Ajeno', color: '#000000', membresiaId: b.dueno.membresiaId },
        }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('patch', `/profesionales/${p.id}`, {
          token,
          cuerpo: { membresiaId: randomUUID() },
        }),
        404,
        'no_encontrado',
      );
      // Desasociar con null y volver a asociar.
      const sinUsuario = segun(
        profesionalSchema,
        (
          await prueba
            .pedir('patch', `/profesionales/${p.id}`, { token, cuerpo: { membresiaId: null } })
            .expect(200)
        ).body,
      );
      expect(sinUsuario.membresiaId).toBeNull();
    });

    it('id que no es UUID o inexistente → no_encontrado', async () => {
      await esperarError(
        prueba.pedir('get', '/profesionales/abc', { token }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('patch', `/profesionales/${randomUUID()}`, {
          token,
          cuerpo: { nombre: 'Nadie' },
        }),
        404,
        'no_encontrado',
      );
    });
  });

  describe('disponibilidad', () => {
    it('guarda tramos válidos en dos sedes, con sillón, y los devuelve ordenados', async () => {
      const p = await crearProfesional(prueba, token);
      const guardado = segun(
        profesionalSchema,
        (
          await reemplazar(p.id, [
            tramo(sede2.sedeId, 3, '08:00', '12:00'),
            tramo(sede1.sedeId, 1, '12:00', '18:00', sede1.sillonId),
            tramo(sede2.sedeId, 1, '08:00', '12:00'),
            // Martes en sede 1: dentro de la franja de la tarde.
            tramo(sede1.sedeId, 2, '14:00', '16:00'),
          ]).expect(200)
        ).body,
      );
      expect(guardado.disponibilidad).toEqual([
        tramo(sede2.sedeId, 1, '08:00', '12:00'),
        tramo(sede1.sedeId, 1, '12:00', '18:00', sede1.sillonId),
        tramo(sede1.sedeId, 2, '14:00', '16:00'),
        tramo(sede2.sedeId, 3, '08:00', '12:00'),
      ]);
      const detalle = segun(
        profesionalSchema,
        (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
      );
      expect(detalle.disponibilidad).toEqual(guardado.disponibilidad);
    });

    it('reemplazo: conserva lo igual (misma fila), desactiva lo quitado e inserta lo nuevo', async () => {
      const p = await crearProfesional(prueba, token);
      await reemplazar(p.id, [
        tramo(sede1.sedeId, 1, '08:00', '12:00'),
        tramo(sede1.sedeId, 4, '08:00', '12:00'),
      ]).expect(200);
      const idDe = async () => {
        const { rows } = await comoSistema<{ id: string }>(
          prueba.admin,
          a.clinicaId,
          `select id from app.profesional_disponibilidad
           where profesional_id = $1 and dia_semana = 1 and activo`,
          [p.id],
        );
        return rows[0]?.id;
      };
      const antes = await idDe();

      const segundo = segun(
        profesionalSchema,
        (
          await reemplazar(p.id, [
            tramo(sede1.sedeId, 1, '08:00', '12:00'),
            tramo(sede2.sedeId, 5, '09:00', '13:00'),
          ]).expect(200)
        ).body,
      );
      expect(segundo.disponibilidad).toEqual([
        tramo(sede1.sedeId, 1, '08:00', '12:00'),
        tramo(sede2.sedeId, 5, '09:00', '13:00'),
      ]);
      expect(await idDe()).toBe(antes);
      const { rows } = await comoSistema<{ activos: string; inactivos: string }>(
        prueba.admin,
        a.clinicaId,
        `select count(*) filter (where activo) as activos, count(*) filter (where not activo) as inactivos
         from app.profesional_disponibilidad where profesional_id = $1`,
        [p.id],
      );
      expect(rows[0]).toEqual({ activos: '2', inactivos: '1' });

      // Cambiar solo el sillón también es un tramo nuevo.
      const conSillon = segun(
        profesionalSchema,
        (
          await reemplazar(p.id, [
            tramo(sede1.sedeId, 1, '08:00', '12:00', sede1.sillonId),
            tramo(sede2.sedeId, 5, '09:00', '13:00'),
          ]).expect(200)
        ).body,
      );
      expect(conSillon.disponibilidad[0]?.sillonId).toBe(sede1.sillonId);

      const vacio = segun(profesionalSchema, (await reemplazar(p.id, []).expect(200)).body);
      expect(vacio.disponibilidad).toEqual([]);
    });

    it('superpuesto el mismo día en dos sedes → datos_invalidos que dice qué tramos chocan', async () => {
      const p = await crearProfesional(prueba, token);
      const respuesta = await esperarError(
        reemplazar(p.id, [
          tramo(sede1.sedeId, 1, '08:00', '12:00'),
          tramo(sede2.sedeId, 3, '11:00', '14:00'),
          tramo(sede2.sedeId, 1, '11:00', '14:00'),
        ]),
        400,
        'datos_invalidos',
      );
      const cuerpo = respuesta.body as Detalles;
      expect(cuerpo.detalles).toEqual([
        {
          campo: 'tramos.2',
          mensaje:
            'El lunes, el tramo de 11:00 a 14:00 en «Sede 2» se superpone con el de 08:00 a 12:00 en «Sede 1»: no puede estar en dos sedes a la vez.',
        },
      ]);
      expect(cuerpo.mensaje).toContain('lunes');
      // Tocarse en un extremo está bien, y nada quedó guardado del intento anterior.
      const ok = segun(
        profesionalSchema,
        (
          await reemplazar(p.id, [
            tramo(sede1.sedeId, 1, '08:00', '12:00'),
            tramo(sede2.sedeId, 1, '12:00', '14:00'),
          ]).expect(200)
        ).body,
      );
      expect(ok.disponibilidad).toHaveLength(2);
      // Tramos idénticos repetidos también se superponen.
      await esperarError(
        reemplazar(p.id, [
          tramo(sede1.sedeId, 4, '08:00', '10:00'),
          tramo(sede1.sedeId, 4, '08:00', '10:00'),
        ]),
        400,
        'datos_invalidos',
      );
    });

    it('fuera del horario de la sede (o un día que no atiende) → datos_invalidos con el horario', async () => {
      const p = await crearProfesional(prueba, token);
      const respuesta = await esperarError(
        reemplazar(p.id, [
          // Martes en sede 1: cruza el corte del mediodía.
          tramo(sede1.sedeId, 2, '10:00', '15:00'),
          // Domingo: la sede no atiende.
          tramo(sede1.sedeId, 0, '08:00', '12:00'),
          tramo(sede2.sedeId, 3, '07:00', '09:00'),
        ]),
        400,
        'datos_invalidos',
      );
      const cuerpo = respuesta.body as Detalles;
      expect(cuerpo.detalles).toEqual([
        {
          campo: 'tramos.0',
          mensaje:
            'El martes la sede «Sede 1» atiende de 08:00 a 12:00 y de 14:00 a 18:00: el tramo de 10:00 a 15:00 queda fuera de ese horario.',
        },
        {
          campo: 'tramos.1',
          mensaje:
            'El domingo la sede «Sede 1» no atiende: quitá el tramo de 08:00 a 12:00 o cargá primero el horario de la sede.',
        },
        {
          campo: 'tramos.2',
          mensaje:
            'El miércoles la sede «Sede 2» atiende de 08:00 a 18:00: el tramo de 07:00 a 09:00 queda fuera de ese horario.',
        },
      ]);
      // Un horario desactivado no cuenta.
      const sede = await crearSedeDePrueba(prueba.admin, a.clinicaId, {
        nombre: 'Sin horario activo',
      });
      await fijarHorario(prueba, a.clinicaId, sede.sedeId, [
        { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00' },
      ]);
      await comoSistema(
        prueba.admin,
        a.clinicaId,
        'update app.sede_horario set activo = false where sede_id = $1',
        [sede.sedeId],
      );
      await esperarError(
        reemplazar(p.id, [tramo(sede.sedeId, 1, '08:00', '10:00')]),
        400,
        'datos_invalidos',
      );
    });

    it('sede dada de baja → datos_invalidos; sus tramos dejan de listarse y se pueden quitar', async () => {
      const p = await crearProfesional(prueba, token);
      const sede = await crearSedeDePrueba(prueba.admin, a.clinicaId, { nombre: 'Se cierra' });
      await fijarHorario(prueba, a.clinicaId, sede.sedeId, SEMANA_COMPLETA);
      await reemplazar(p.id, [tramo(sede.sedeId, 6, '08:00', '12:00')]).expect(200);
      await prueba
        .pedir('delete', `/sedes/${sede.sedeId}`, { token, cuerpo: { motivo: 'Cerró el local' } })
        .expect(204);

      const detalle = segun(
        profesionalSchema,
        (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
      );
      expect(detalle.disponibilidad).toEqual([]);

      const respuesta = await esperarError(
        reemplazar(p.id, [tramo(sede.sedeId, 6, '08:00', '12:00')]),
        400,
        'datos_invalidos',
      );
      expect((respuesta.body as Detalles).detalles?.[0]).toEqual({
        campo: 'tramos.0.sedeId',
        mensaje:
          'La sede «Se cierra» está dada de baja: quitá el tramo del sábado de 08:00 a 12:00.',
      });

      // Reemplazar sin ese tramo lo desactiva.
      await reemplazar(p.id, [tramo(sede1.sedeId, 6, '08:00', '12:00')]).expect(200);
      const { rows } = await comoSistema<{ n: string }>(
        prueba.admin,
        a.clinicaId,
        'select count(*) as n from app.profesional_disponibilidad where profesional_id = $1 and sede_id = $2 and activo',
        [p.id, sede.sedeId],
      );
      expect(rows[0]?.n).toBe('0');
    });

    it('sillón de otra sede o inactivo → datos_invalidos; de otra clínica → no_encontrado', async () => {
      const p = await crearProfesional(prueba, token);
      const respuesta = await esperarError(
        reemplazar(p.id, [tramo(sede1.sedeId, 1, '08:00', '12:00', sede2.sillonId)]),
        400,
        'datos_invalidos',
      );
      expect((respuesta.body as Detalles).detalles).toEqual([
        {
          campo: 'tramos.0.sillonId',
          mensaje:
            'El sillón «Sillón 1» es de «Sede 2», no de «Sede 1»: elegí un sillón de esa sede para el tramo del lunes de 08:00 a 12:00.',
        },
      ]);

      const sede = await crearSedeDePrueba(prueba.admin, a.clinicaId, { nombre: 'Sillón apagado' });
      await fijarHorario(prueba, a.clinicaId, sede.sedeId, SEMANA_COMPLETA);
      await comoSistema(
        prueba.admin,
        a.clinicaId,
        'update app.sillon set activo = false where id = $1',
        [sede.sillonId],
      );
      const inactivo = await esperarError(
        reemplazar(p.id, [tramo(sede.sedeId, 1, '08:00', '12:00', sede.sillonId)]),
        400,
        'datos_invalidos',
      );
      expect((inactivo.body as Detalles).mensaje).toMatch(/está desactivado/);

      await esperarError(
        reemplazar(p.id, [tramo(sede1.sedeId, 1, '08:00', '12:00', b.sedes[0]?.sillonId ?? '')]),
        404,
        'no_encontrado',
      );
      await esperarError(
        reemplazar(p.id, [tramo(b.sedes[0]?.sedeId ?? '', 1, '08:00', '12:00')]),
        404,
        'no_encontrado',
      );
    });

    it('la base también rechaza tramos superpuestos (restricción traducida)', async () => {
      const p = await crearProfesional(prueba, token);
      await reemplazar(p.id, [tramo(sede1.sedeId, 1, '08:00', '12:00')]).expect(200);
      // Un tramo superpuesto insertado por fuera de la API choca con la exclusión de la base.
      const error = await comoSistema(
        prueba.admin,
        a.clinicaId,
        `insert into app.profesional_disponibilidad
           (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin)
         values ($1, $2, $3, 1, '10:00', '11:00')`,
        [a.clinicaId, p.id, sede2.sedeId],
      ).then(
        () => null,
        (e: unknown) => e as { code?: string; constraint?: string },
      );
      expect(error).toMatchObject({
        code: '23P01',
        constraint: 'profesional_disponibilidad_superpuesta',
      });
    });

    it('si otra persona está guardando la misma disponibilidad → conflicto claro, sin cambios', async () => {
      const p = await crearProfesional(prueba, token);
      const cliente = await prueba.admin.connect();
      try {
        await cliente.query('begin');
        await cliente.query("select set_config('app.clinica_id', $1, true)", [a.clinicaId]);
        await cliente.query('select id from app.profesional where id = $1 for update', [p.id]);
        const respuesta = await esperarError(
          reemplazar(p.id, [tramo(sede1.sedeId, 1, '08:00', '12:00')]),
          409,
          'conflicto',
        );
        expect((respuesta.body as Detalles).mensaje).toMatch(/Otra persona.*Probá de nuevo/);
      } finally {
        await cliente.query('rollback');
        cliente.release();
      }
      const detalle = segun(
        profesionalSchema,
        (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
      );
      expect(detalle.disponibilidad).toEqual([]);
    });

    it('dos PUT simultáneos que se pisarían: gana uno solo, sin mezclar', async () => {
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        const p = await crearProfesional(prueba, token);
        const versionA = [
          tramo(sede1.sedeId, 1, '08:00', '12:00'),
          tramo(sede1.sedeId, 3, '08:00', '12:00'),
        ];
        const versionB = [
          tramo(sede2.sedeId, 1, '10:00', '14:00'),
          tramo(sede2.sedeId, 5, '08:00', '12:00'),
        ];
        const [ra, rb] = await Promise.all([
          reemplazar(p.id, versionA),
          reemplazar(p.id, versionB),
        ]);
        const estados = [ra.status, rb.status];
        for (const r of [ra, rb]) {
          expect([200, 409]).toContain(r.status);
          if (r.status === 409) {
            expect((r.body as Detalles).mensaje).toMatch(/Probá de nuevo|Recargá/);
          }
        }
        expect(estados).toContain(200);
        const final = segun(
          profesionalSchema,
          (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
        );
        const ordenar = (ts: TramoDisponibilidad[]) =>
          [...ts].sort(
            (x, y) => x.diaSemana - y.diaSemana || x.horaInicio.localeCompare(y.horaInicio),
          );
        // Uno de los dos, entero: nunca una mezcla.
        expect([ordenar(versionA), ordenar(versionB)]).toContainEqual(
          ordenar(final.disponibilidad),
        );
        if (estados.includes(409)) {
          const ganador = ra.status === 200 ? versionA : versionB;
          expect(ordenar(final.disponibilidad)).toEqual(ordenar(ganador));
        }
      }
    });

    it('cuerpo inválido → datos_invalidos por campo', async () => {
      const p = await crearProfesional(prueba, token);
      const respuesta = await esperarError(
        reemplazar(p.id, [
          {
            sedeId: sede1.sedeId,
            diaSemana: 7,
            horaInicio: '12:00',
            horaFin: '08:00',
            sillonId: null,
          },
        ]),
        400,
        'datos_invalidos',
      );
      const campos = (respuesta.body as Detalles).detalles?.map((d) => d.campo);
      expect(campos).toEqual(expect.arrayContaining(['tramos.0.diaSemana']));
      await esperarError(
        prueba.pedir('put', `/profesionales/${p.id}/disponibilidad`, { token, cuerpo: {} }),
        400,
        'datos_invalidos',
      );
    });
  });

  describe('bloqueos', () => {
    it('alta, listado de los que no terminaron, baja con motivo', async () => {
      const p = await crearProfesional(prueba, token);
      const ahora = Date.now();
      const dia = 86_400_000;
      const lejano = segun(
        bloqueoSchema,
        (
          await prueba
            .pedir('post', `/profesionales/${p.id}/bloqueos`, {
              token,
              cuerpo: {
                desde: new Date(ahora + 20 * dia).toISOString(),
                hasta: new Date(ahora + 25 * dia).toISOString(),
                motivo: 'Congreso',
              },
            })
            .expect(201)
        ).body,
      );
      const cercano = segun(
        bloqueoSchema,
        (
          await prueba
            .pedir('post', `/profesionales/${p.id}/bloqueos`, {
              token,
              cuerpo: {
                desde: new Date(ahora - dia).toISOString(),
                hasta: new Date(ahora + 2 * dia).toISOString(),
                motivo: '  Vacaciones  ',
              },
            })
            .expect(201)
        ).body,
      );
      expect(cercano.motivo).toBe('Vacaciones');
      // Uno que ya terminó (cargado por fuera) no se lista.
      await comoSistema(
        prueba.admin,
        a.clinicaId,
        `insert into app.profesional_bloqueo (clinica_id, profesional_id, desde, hasta, motivo)
         values ($1, $2, now() - interval '10 days', now() - interval '1 day', 'Pasado')`,
        [a.clinicaId, p.id],
      );

      const detalle = segun(
        profesionalSchema,
        (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
      );
      expect(detalle.bloqueos.map((x) => x.id)).toEqual([cercano.id, lejano.id]);
      const lista = segun(
        z.array(profesionalSchema),
        (await prueba.pedir('get', '/profesionales', { token }).expect(200)).body,
      );
      expect(lista.find((x) => x.id === p.id)?.bloqueos).toEqual(detalle.bloqueos);

      await esperarError(
        prueba.pedir('delete', `/bloqueos/${lejano.id}`, { token, cuerpo: { motivo: 'no' } }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('delete', `/bloqueos/${lejano.id}`, { token }),
        400,
        'datos_invalidos',
      );
      const baja = await prueba
        .pedir('delete', `/bloqueos/${lejano.id}`, { token, cuerpo: { motivo: 'Se suspendió' } })
        .expect(204);
      expect(baja.text).toBe('');
      await esperarError(
        prueba.pedir('delete', `/bloqueos/${lejano.id}`, { token, cuerpo: { motivo: 'Otra vez' } }),
        404,
        'no_encontrado',
      );
      const despues = segun(
        profesionalSchema,
        (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
      );
      expect(despues.bloqueos.map((x) => x.id)).toEqual([cercano.id]);
      const { rows } = await comoSistema<{ motivo_baja: string; deleted_by: string }>(
        prueba.admin,
        a.clinicaId,
        'select motivo_baja, deleted_by from app.profesional_bloqueo where id = $1',
        [lejano.id],
      );
      expect(rows[0]).toEqual({ motivo_baja: 'Se suspendió', deleted_by: a.duenoId });
    });

    it('fin antes del inicio, motivo corto o fecha sin zona → datos_invalidos', async () => {
      const p = await crearProfesional(prueba, token);
      const fin = await esperarError(
        prueba.pedir('post', `/profesionales/${p.id}/bloqueos`, {
          token,
          cuerpo: {
            desde: '2030-01-10T08:00:00Z',
            hasta: '2030-01-09T08:00:00Z',
            motivo: 'Vacaciones',
          },
        }),
        400,
        'datos_invalidos',
      );
      expect((fin.body as Detalles).detalles).toEqual([
        { campo: 'hasta', mensaje: 'El fin del bloqueo tiene que ser posterior al inicio.' },
      ]);
      await esperarError(
        prueba.pedir('post', `/profesionales/${p.id}/bloqueos`, {
          token,
          cuerpo: { desde: '2030-01-10T08:00:00', hasta: '2030-01-11T08:00:00Z', motivo: 'x' },
        }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('post', `/profesionales/${randomUUID()}/bloqueos`, {
          token,
          cuerpo: { desde: '2030-01-10T08:00:00Z', hasta: '2030-01-11T08:00:00Z', motivo: 'Viaje' },
        }),
        404,
        'no_encontrado',
      );
    });
  });

  describe('auditoría', () => {
    it('altas, ediciones y bajas quedan con el módulo personal y el autor', async () => {
      const p = await crearProfesional(prueba, token);
      await prueba
        .pedir('patch', `/profesionales/${p.id}`, { token, cuerpo: { especialidad: 'Cirugía' } })
        .expect(200);
      await prueba
        .pedir('patch', `/profesionales/${p.id}`, { token, cuerpo: { activo: false } })
        .expect(200);
      expect(await auditoriaDe(prueba, a.clinicaId, 'profesional', p.id)).toEqual(
        ['crear', 'editar', 'anular'].map((accion) => ({
          accion,
          modulo: 'personal',
          usuario_id: a.duenoId,
          sede_id: null,
        })),
      );

      await reemplazar(p.id, [tramo(sede2.sedeId, 2, '08:00', '12:00')]).expect(200);
      const { rows } = await comoSistema<{ id: string }>(
        prueba.admin,
        a.clinicaId,
        'select id from app.profesional_disponibilidad where profesional_id = $1',
        [p.id],
      );
      expect(
        await auditoriaDe(prueba, a.clinicaId, 'profesional_disponibilidad', rows[0]?.id ?? ''),
      ).toEqual([
        { accion: 'crear', modulo: 'personal', usuario_id: a.duenoId, sede_id: sede2.sedeId },
      ]);

      const bloqueo = segun(
        bloqueoSchema,
        (
          await prueba
            .pedir('post', `/profesionales/${p.id}/bloqueos`, {
              token,
              cuerpo: {
                desde: '2031-01-10T08:00:00Z',
                hasta: '2031-01-11T08:00:00Z',
                motivo: 'Curso',
              },
            })
            .expect(201)
        ).body,
      );
      await prueba
        .pedir('delete', `/bloqueos/${bloqueo.id}`, { token, cuerpo: { motivo: 'Se canceló' } })
        .expect(204);
      expect(await auditoriaDe(prueba, a.clinicaId, 'profesional_bloqueo', bloqueo.id)).toEqual(
        ['crear', 'anular'].map((accion) => ({
          accion,
          modulo: 'personal',
          usuario_id: a.duenoId,
          sede_id: null,
        })),
      );
    });
  });

  describe('aislamiento entre clínicas', () => {
    it('ids de otra clínica → no_encontrado en todo, y B no cambia', async () => {
      const tokenB = await b.dueno.token();
      await fijarHorario(prueba, b.clinicaId, b.sedes[0]?.sedeId ?? '', SEMANA_COMPLETA);
      const deB = await crearProfesional(prueba, tokenB, { nombre: 'De B' });
      await prueba
        .pedir('put', `/profesionales/${deB.id}/disponibilidad`, {
          token: tokenB,
          cuerpo: { tramos: [tramo(b.sedes[0]?.sedeId ?? '', 1, '08:00', '12:00')] },
        })
        .expect(200);
      const bloqueoB = segun(
        bloqueoSchema,
        (
          await prueba
            .pedir('post', `/profesionales/${deB.id}/bloqueos`, {
              token: tokenB,
              cuerpo: {
                desde: '2031-02-01T08:00:00Z',
                hasta: '2031-02-02T08:00:00Z',
                motivo: 'Viaje',
              },
            })
            .expect(201)
        ).body,
      );
      const foto = async () =>
        JSON.stringify(
          (
            await comoSistema(
              prueba.admin,
              b.clinicaId,
              `select json_build_object(
                 'p', (select json_agg(x order by x.id) from app.profesional x),
                 'd', (select json_agg(x order by x.id) from app.profesional_disponibilidad x),
                 'b', (select json_agg(x order by x.id) from app.profesional_bloqueo x)) as foto`,
            )
          ).rows[0],
        );
      const antes = await foto();

      const pedidos: [Metodo, string, object | undefined][] = [
        ['get', `/profesionales/${deB.id}`, undefined],
        ['patch', `/profesionales/${deB.id}`, { nombre: 'Tomado' }],
        ['put', `/profesionales/${deB.id}/disponibilidad`, { tramos: [] }],
        [
          'post',
          `/profesionales/${deB.id}/bloqueos`,
          { desde: '2031-03-01T08:00:00Z', hasta: '2031-03-02T08:00:00Z', motivo: 'Intruso' },
        ],
        ['delete', `/bloqueos/${bloqueoB.id}`, { motivo: 'No es mío' }],
      ];
      for (const [metodo, ruta, cuerpo] of pedidos) {
        await esperarError(
          prueba.pedir(metodo, ruta, { token, ...(cuerpo ? { cuerpo } : {}) }),
          404,
          'no_encontrado',
        );
      }
      const lista = segun(
        z.array(profesionalSchema),
        (await prueba.pedir('get', '/profesionales', { token }).expect(200)).body,
      );
      expect(lista.some((x) => x.id === deB.id)).toBe(false);
      expect(await foto()).toBe(antes);
    });

    it('clinica_id en el cuerpo se ignora', async () => {
      const p = await crearProfesional(prueba, token, {
        clinicaId: b.clinicaId,
        clinica_id: b.clinicaId,
      });
      const { rows } = await comoSistema<{ clinica_id: string }>(
        prueba.admin,
        a.clinicaId,
        'select clinica_id from app.profesional where id = $1',
        [p.id],
      );
      expect(rows[0]?.clinica_id).toBe(a.clinicaId);
    });
  });
});

interface Caso {
  nombre: string;
  metodo: Metodo;
  preparar: (ctx: { profesional: Profesional; bloqueoId: string; sedeId: string }) => {
    ruta: string;
    cuerpo?: object;
  };
  estadoOk: number;
  esquema: z.ZodType | null;
  puede: RolSistema;
  noPuede: RolSistema;
}

const CASOS: Caso[] = [
  {
    nombre: 'GET /profesionales',
    metodo: 'get',
    preparar: () => ({ ruta: '/profesionales' }),
    estadoOk: 200,
    esquema: z.array(profesionalSchema),
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    nombre: 'POST /profesionales',
    metodo: 'post',
    preparar: () => ({ ruta: '/profesionales', cuerpo: { nombre: 'Nuevo', color: '#123456' } }),
    estadoOk: 201,
    esquema: profesionalSchema,
    puede: 'administracion',
    noPuede: 'odontologo',
  },
  {
    nombre: 'GET /profesionales/:id',
    metodo: 'get',
    preparar: (c) => ({ ruta: `/profesionales/${c.profesional.id}` }),
    estadoOk: 200,
    esquema: profesionalSchema,
    puede: 'administracion',
    noPuede: 'asistente',
  },
  {
    nombre: 'PATCH /profesionales/:id',
    metodo: 'patch',
    preparar: (c) => ({
      ruta: `/profesionales/${c.profesional.id}`,
      cuerpo: { especialidad: 'X' },
    }),
    estadoOk: 200,
    esquema: profesionalSchema,
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    nombre: 'PUT /profesionales/:id/disponibilidad',
    metodo: 'put',
    preparar: (c) => ({
      ruta: `/profesionales/${c.profesional.id}/disponibilidad`,
      cuerpo: { tramos: [tramo(c.sedeId, 1, '08:00', '12:00')] },
    }),
    estadoOk: 200,
    esquema: profesionalSchema,
    puede: 'administracion',
    noPuede: 'odontologo',
  },
  {
    nombre: 'POST /profesionales/:id/bloqueos',
    metodo: 'post',
    preparar: (c) => ({
      ruta: `/profesionales/${c.profesional.id}/bloqueos`,
      cuerpo: { desde: '2032-01-01T08:00:00Z', hasta: '2032-01-02T08:00:00Z', motivo: 'Feria' },
    }),
    estadoOk: 201,
    esquema: bloqueoSchema,
    puede: 'administracion',
    noPuede: 'asistente',
  },
  {
    nombre: 'DELETE /bloqueos/:id',
    metodo: 'delete',
    preparar: (c) => ({
      ruta: `/bloqueos/${c.bloqueoId}`,
      cuerpo: { motivo: 'Prueba de permisos' },
    }),
    estadoOk: 204,
    esquema: null,
    puede: 'administracion',
    noPuede: 'recepcion',
  },
];

describe('profesionales: matriz de permisos y dimensión sede', () => {
  let prueba: Prueba;
  let a: Clinica;
  let token: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 3 });
    token = await a.dueno.token();
    for (const s of a.sedes) await fijarHorario(prueba, a.clinicaId, s.sedeId, SEMANA_COMPLETA);
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const preparar = async () => {
    const profesional = await crearProfesional(prueba, token);
    const bloqueo = segun(
      bloqueoSchema,
      (
        await prueba
          .pedir('post', `/profesionales/${profesional.id}/bloqueos`, {
            token,
            cuerpo: {
              desde: '2032-02-01T08:00:00Z',
              hasta: '2032-02-02T08:00:00Z',
              motivo: 'Base',
            },
          })
          .expect(201)
      ).body,
    );
    return { profesional, bloqueoId: bloqueo.id, sedeId: a.sedes[0]?.sedeId ?? '' };
  };

  for (const caso of CASOS) {
    it(`${caso.nombre}: ${caso.puede} puede, ${caso.noPuede} → sin_permiso`, async () => {
      const permitido = await crearPersona(prueba, a.clinicaId, { rol: caso.puede });
      const negado = await crearPersona(prueba, a.clinicaId, { rol: caso.noPuede });

      const n = caso.preparar(await preparar());
      await esperarError(
        prueba.pedir(caso.metodo, n.ruta, {
          token: await negado.token(),
          ...(n.cuerpo ? { cuerpo: n.cuerpo } : {}),
        }),
        403,
        'sin_permiso',
      );

      const p = caso.preparar(await preparar());
      const respuesta = await prueba
        .pedir(caso.metodo, p.ruta, {
          token: await permitido.token(),
          ...(p.cuerpo ? { cuerpo: p.cuerpo } : {}),
        })
        .expect(caso.estadoOk);
      if (caso.esquema) segun(caso.esquema, respuesta.body);
    });
  }

  it('sin todas las sedes: solo agrega o quita tramos en sus sedes', async () => {
    const [propia, ajena] = a.sedes as [Clinica['sedes'][number], Clinica['sedes'][number]];
    for (const accion of ['ver', 'editar'] as const) {
      await otorgarPermiso(prueba, a.clinicaId, a.roles.recepcion, 'personal', accion);
    }
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [propia.sedeId],
    });
    const t = await persona.token();
    const p = await crearProfesional(prueba, token);
    const enAjena = tramo(ajena.sedeId, 1, '08:00', '12:00');
    await reemplazarCon(prueba, t, p.id, []).expect(200);
    await prueba
      .pedir('put', `/profesionales/${p.id}/disponibilidad`, {
        token,
        cuerpo: { tramos: [enAjena] },
      })
      .expect(200);

    // Ve el profesional completo, también el tramo de la otra sede.
    const visto = segun(
      profesionalSchema,
      (await prueba.pedir('get', `/profesionales/${p.id}`, { token: t }).expect(200)).body,
    );
    expect(visto.disponibilidad).toEqual([enAjena]);

    // Agregar en su sede conservando el de la otra: bien.
    const enPropia = tramo(propia.sedeId, 2, '08:00', '12:00');
    await reemplazarCon(prueba, t, p.id, [enAjena, enPropia]).expect(200);
    // Agregar en la otra sede o quitar el de la otra sede: sede_no_permitida, sin cambios.
    await esperarError(
      reemplazarCon(prueba, t, p.id, [enAjena, enPropia, tramo(ajena.sedeId, 3, '08:00', '12:00')]),
      403,
      'sede_no_permitida',
    );
    await esperarError(reemplazarCon(prueba, t, p.id, [enPropia]), 403, 'sede_no_permitida');
    const final = segun(
      profesionalSchema,
      (await prueba.pedir('get', `/profesionales/${p.id}`, { token }).expect(200)).body,
    );
    expect(final.disponibilidad).toEqual([enAjena, enPropia]);
  });
});

function reemplazarCon(prueba: Prueba, token: string, id: string, tramos: TramoDisponibilidad[]) {
  return prueba.pedir('put', `/profesionales/${id}/disponibilidad`, { token, cuerpo: { tramos } });
}
