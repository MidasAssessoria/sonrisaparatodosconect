import { sedeSchema, sillonSchema, type Sede } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comoSistema,
  crearClinica,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';

describe('sedes y sillones', () => {
  let prueba: Prueba;
  let a: Clinica;
  let token: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    token = await a.dueno.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const crearSede = async (cuerpo: object): Promise<Sede> =>
    segun(sedeSchema, (await prueba.pedir('post', '/sedes', { token, cuerpo }).expect(201)).body);

  describe('alta', () => {
    it('crea con todos los datos', async () => {
      const sede = await crearSede({
        nombre: '  Centro  ',
        direccion: 'Av. Mcal. López 1234',
        telefono: '+595 21 600 000',
        estado: 'proxima',
        color: '#1A7F5A',
      });
      expect(sede).toMatchObject({
        nombre: 'Centro',
        direccion: 'Av. Mcal. López 1234',
        telefono: '+595 21 600 000',
        estado: 'proxima',
        color: '#1A7F5A',
        horarios: [],
        sillones: [],
      });
      const obtenida = segun(
        sedeSchema,
        (await prueba.pedir('get', `/sedes/${sede.id}`, { token }).expect(200)).body,
      );
      expect(obtenida).toEqual(sede);
    });

    it('cadena vacía o null en dirección, teléfono y color se guardan como NULL', async () => {
      const sede = await crearSede({
        nombre: 'Sin datos',
        direccion: '',
        telefono: '   ',
        color: null,
      });
      expect(sede).toMatchObject({
        direccion: null,
        telefono: null,
        color: null,
        estado: 'abierta',
      });
      const { rows } = await comoSistema<{ direccion: string | null; telefono: string | null }>(
        prueba.admin,
        a.clinicaId,
        'select direccion, telefono, color from app.sede where id = $1',
        [sede.id],
      );
      expect(rows[0]).toEqual({ direccion: null, telefono: null, color: null });
    });

    it('nombre repetido (sin importar mayúsculas) → conflicto', async () => {
      await crearSede({ nombre: 'Lambaré' });
      const respuesta = await esperarError(
        prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'LAMBARÉ' } }),
        409,
        'conflicto',
      );
      expect((respuesta.body as { mensaje: string }).mensaje).toMatch(
        /Ya hay una sede con ese nombre/,
      );
    });

    it('datos inválidos → datos_invalidos con detalle por campo', async () => {
      const respuesta = await esperarError(
        prueba.pedir('post', '/sedes', {
          token,
          cuerpo: { nombre: 'x', color: 'verde', estado: 'abierto' },
        }),
        400,
        'datos_invalidos',
      );
      const campos = (respuesta.body as { detalles: { campo: string; mensaje: string }[] })
        .detalles;
      expect(campos.map((d) => d.campo).sort()).toEqual(['color', 'estado', 'nombre']);
      expect(campos.find((d) => d.campo === 'nombre')?.mensaje).toBe('Poné el nombre de la sede.');
      expect(campos.find((d) => d.campo === 'color')?.mensaje).toBe('Elegí un color válido.');
      expect(campos.find((d) => d.campo === 'estado')?.mensaje).toMatch(
        /^Elegí uno de estos valores/,
      );
    });

    it('sin cuerpo, JSON roto o cuerpo que no es objeto → datos_invalidos', async () => {
      await esperarError(prueba.pedir('post', '/sedes', { token }), 400, 'datos_invalidos');
      await esperarError(
        prueba
          .pedir('post', '/sedes', { token })
          .set('Content-Type', 'application/json')
          .send('{"nombre": '),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('post', '/sedes', { token, cuerpo: ['Centro'] }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba
          .pedir('post', '/sedes', { token })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('nombre=Centro'),
        400,
        'datos_invalidos',
      );
    });
  });

  describe('edición', () => {
    it('edita y vacía campos (cadena vacía o null → NULL)', async () => {
      const sede = await crearSede({
        nombre: 'Editable',
        direccion: 'Calle 1',
        telefono: '021 111',
        color: '#000000',
      });
      const editada = segun(
        sedeSchema,
        (
          await prueba
            .pedir('patch', `/sedes/${sede.id}`, {
              token,
              cuerpo: {
                nombre: 'Editada',
                direccion: '',
                telefono: null,
                color: '',
                estado: 'cerrada',
              },
            })
            .expect(200)
        ).body,
      );
      expect(editada).toMatchObject({
        id: sede.id,
        nombre: 'Editada',
        direccion: null,
        telefono: null,
        color: null,
        estado: 'cerrada',
      });
    });

    it('cuerpo vacío no cambia nada', async () => {
      const sede = await crearSede({ nombre: 'Quieta', direccion: 'X' });
      const igual = segun(
        sedeSchema,
        (await prueba.pedir('patch', `/sedes/${sede.id}`, { token, cuerpo: {} }).expect(200)).body,
      );
      expect(igual).toEqual(sede);
    });

    it('renombrar a un nombre existente → conflicto', async () => {
      await crearSede({ nombre: 'Ocupado' });
      const sede = await crearSede({ nombre: 'Libre' });
      await esperarError(
        prueba.pedir('patch', `/sedes/${sede.id}`, { token, cuerpo: { nombre: 'ocupado' } }),
        409,
        'conflicto',
      );
    });

    it('id que no es UUID o inexistente → no_encontrado', async () => {
      await esperarError(prueba.pedir('get', '/sedes/abc', { token }), 404, 'no_encontrado');
      await esperarError(
        prueba.pedir('patch', '/sedes/00000000-0000-4000-8000-000000000000', {
          token,
          cuerpo: { nombre: 'Nada' },
        }),
        404,
        'no_encontrado',
      );
    });
  });

  describe('horarios', () => {
    it('reemplaza el horario completo y conserva los tramos que no cambian', async () => {
      const sede = await crearSede({ nombre: 'Con horario' });
      const primero = segun(
        sedeSchema,
        (
          await prueba
            .pedir('put', `/sedes/${sede.id}/horarios`, {
              token,
              cuerpo: {
                horarios: [
                  { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00' },
                  { diaSemana: 1, horaInicio: '12:00', horaFin: '18:00', intervaloMin: 20 },
                  { diaSemana: 6, horaInicio: '08:00', horaFin: '12:00' },
                ],
              },
            })
            .expect(200)
        ).body,
      );
      expect(primero.horarios).toEqual([
        { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 },
        { diaSemana: 1, horaInicio: '12:00', horaFin: '18:00', intervaloMin: 20 },
        { diaSemana: 6, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 },
      ]);

      const segundo = segun(
        sedeSchema,
        (
          await prueba
            .pedir('put', `/sedes/${sede.id}/horarios`, {
              token,
              cuerpo: {
                horarios: [
                  { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00' },
                  { diaSemana: 2, horaInicio: '09:00', horaFin: '13:00' },
                ],
              },
            })
            .expect(200)
        ).body,
      );
      expect(segundo.horarios).toEqual([
        { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 },
        { diaSemana: 2, horaInicio: '09:00', horaFin: '13:00', intervaloMin: 30 },
      ]);

      // Nada se borra: los tramos quitados quedan inactivos; el que no cambió es la misma fila.
      const { rows } = await comoSistema<{ activos: string; inactivos: string; filas: string }>(
        prueba.admin,
        a.clinicaId,
        `select count(*) filter (where activo) as activos, count(*) filter (where not activo) as inactivos,
                count(*) as filas
         from app.sede_horario where sede_id = $1`,
        [sede.id],
      );
      expect(rows[0]).toEqual({ activos: '2', inactivos: '2', filas: '4' });

      const vacio = segun(
        sedeSchema,
        (
          await prueba
            .pedir('put', `/sedes/${sede.id}/horarios`, { token, cuerpo: { horarios: [] } })
            .expect(200)
        ).body,
      );
      expect(vacio.horarios).toEqual([]);
    });

    it('rechaza tramos superpuestos el mismo día y dice cuáles', async () => {
      const sede = await crearSede({ nombre: 'Superpuesta' });
      const respuesta = await esperarError(
        prueba.pedir('put', `/sedes/${sede.id}/horarios`, {
          token,
          cuerpo: {
            horarios: [
              { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00' },
              { diaSemana: 2, horaInicio: '11:00', horaFin: '14:00' },
              { diaSemana: 1, horaInicio: '11:00', horaFin: '14:00' },
            ],
          },
        }),
        400,
        'datos_invalidos',
      );
      const cuerpo = respuesta.body as {
        mensaje: string;
        detalles: { campo: string; mensaje: string }[];
      };
      expect(cuerpo.mensaje).toContain('lunes');
      expect(cuerpo.mensaje).toContain('11:00 a 14:00');
      expect(cuerpo.mensaje).toContain('08:00 a 12:00');
      expect(cuerpo.detalles).toEqual([
        {
          campo: 'horarios.2',
          mensaje: 'El lunes, el tramo de 11:00 a 14:00 se superpone con el de 08:00 a 12:00.',
        },
      ]);
      const sinCambios = segun(
        sedeSchema,
        (await prueba.pedir('get', `/sedes/${sede.id}`, { token }).expect(200)).body,
      );
      expect(sinCambios.horarios).toEqual([]);
    });

    it('tramos idénticos repetidos también se superponen', async () => {
      const sede = await crearSede({ nombre: 'Repetida' });
      const tramo = { diaSemana: 3, horaInicio: '08:00', horaFin: '12:00' };
      await esperarError(
        prueba.pedir('put', `/sedes/${sede.id}/horarios`, {
          token,
          cuerpo: { horarios: [tramo, tramo] },
        }),
        400,
        'datos_invalidos',
      );
    });

    it('cierre antes de la apertura u hora inválida → datos_invalidos', async () => {
      const sede = await crearSede({ nombre: 'Horas malas' });
      const respuesta = await esperarError(
        prueba.pedir('put', `/sedes/${sede.id}/horarios`, {
          token,
          cuerpo: {
            horarios: [
              { diaSemana: 1, horaInicio: '12:00', horaFin: '08:00' },
              { diaSemana: 7, horaInicio: '25:00', horaFin: '26:00' },
            ],
          },
        }),
        400,
        'datos_invalidos',
      );
      const campos = (respuesta.body as { detalles: { campo: string }[] }).detalles.map(
        (d) => d.campo,
      );
      expect(campos).toEqual(
        expect.arrayContaining([
          'horarios.0.horaFin',
          'horarios.1.diaSemana',
          'horarios.1.horaInicio',
        ]),
      );
    });
  });

  describe('baja', () => {
    it('da de baja con motivo: deja de listarse y de existir para la API', async () => {
      const sede = await crearSede({ nombre: 'Para baja' });
      await esperarError(
        prueba.pedir('delete', `/sedes/${sede.id}`, { token, cuerpo: { motivo: 'no' } }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('delete', `/sedes/${sede.id}`, { token }),
        400,
        'datos_invalidos',
      );
      const respuesta = await prueba
        .pedir('delete', `/sedes/${sede.id}`, { token, cuerpo: { motivo: 'Cerró el local' } })
        .expect(204);
      expect(respuesta.text).toBe('');

      const lista = segun(
        z.array(sedeSchema),
        (await prueba.pedir('get', '/sedes', { token }).expect(200)).body,
      );
      expect(lista.some((s) => s.id === sede.id)).toBe(false);
      await esperarError(prueba.pedir('get', `/sedes/${sede.id}`, { token }), 404, 'no_encontrado');
      await esperarError(
        prueba.pedir('delete', `/sedes/${sede.id}`, { token, cuerpo: { motivo: 'Otra vez' } }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('post', `/sedes/${sede.id}/sillones`, { token, cuerpo: { nombre: 'S' } }),
        404,
        'no_encontrado',
      );

      const { rows } = await comoSistema<{
        motivo_baja: string;
        deleted_by: string;
        deleted_at: Date;
      }>(
        prueba.admin,
        a.clinicaId,
        'select motivo_baja, deleted_by, deleted_at from app.sede where id = $1',
        [sede.id],
      );
      expect(rows[0]).toMatchObject({ motivo_baja: 'Cerró el local', deleted_by: a.duenoId });

      // El nombre queda libre para una sede nueva.
      await crearSede({ nombre: 'Para baja' });
    });
  });

  describe('sillones', () => {
    it('crea, renombra, desactiva y reactiva', async () => {
      const sede = await crearSede({ nombre: 'Con sillones' });
      const sillon = segun(
        sillonSchema,
        (
          await prueba
            .pedir('post', `/sedes/${sede.id}/sillones`, { token, cuerpo: { nombre: 'Sillón 1' } })
            .expect(201)
        ).body,
      );
      expect(sillon).toMatchObject({ sedeId: sede.id, nombre: 'Sillón 1', activo: true });

      await esperarError(
        prueba.pedir('post', `/sedes/${sede.id}/sillones`, {
          token,
          cuerpo: { nombre: 'sillón 1' },
        }),
        409,
        'conflicto',
      );

      const renombrado = segun(
        sillonSchema,
        (
          await prueba
            .pedir('patch', `/sillones/${sillon.id}`, { token, cuerpo: { nombre: 'Sillón A' } })
            .expect(200)
        ).body,
      );
      expect(renombrado.nombre).toBe('Sillón A');

      const inactivo = segun(
        sillonSchema,
        (
          await prueba
            .pedir('patch', `/sillones/${sillon.id}`, { token, cuerpo: { activo: false } })
            .expect(200)
        ).body,
      );
      expect(inactivo.activo).toBe(false);

      // Con el primero inactivo, el nombre queda libre; reactivarlo choca.
      await prueba
        .pedir('post', `/sedes/${sede.id}/sillones`, { token, cuerpo: { nombre: 'Sillón A' } })
        .expect(201);
      await esperarError(
        prueba.pedir('patch', `/sillones/${sillon.id}`, { token, cuerpo: { activo: true } }),
        409,
        'conflicto',
      );

      const conSillones = segun(
        sedeSchema,
        (await prueba.pedir('get', `/sedes/${sede.id}`, { token }).expect(200)).body,
      );
      expect(conSillones.sillones.map((s) => [s.nombre, s.activo])).toEqual([
        ['Sillón A', false],
        ['Sillón A', true],
      ]);
    });

    it('sillón inexistente o de una sede dada de baja → no_encontrado', async () => {
      await esperarError(
        prueba.pedir('patch', '/sillones/00000000-0000-4000-8000-000000000000', {
          token,
          cuerpo: { activo: false },
        }),
        404,
        'no_encontrado',
      );
      const sede = await crearSede({ nombre: 'Se va' });
      const sillon = segun(
        sillonSchema,
        (
          await prueba
            .pedir('post', `/sedes/${sede.id}/sillones`, { token, cuerpo: { nombre: 'S1' } })
            .expect(201)
        ).body,
      );
      await prueba
        .pedir('delete', `/sedes/${sede.id}`, { token, cuerpo: { motivo: 'Se mudó' } })
        .expect(204);
      await esperarError(
        prueba.pedir('patch', `/sillones/${sillon.id}`, { token, cuerpo: { nombre: 'S2' } }),
        404,
        'no_encontrado',
      );
    });
  });
});
