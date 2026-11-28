/**
 * Revisiones del Sprint 3 por la API (contrato/pacientes.ts tras la revisión de seguridad y las
 * migraciones 0023–0027), contra el Postgres real del banco:
 *   - toda respuesta con la ficha completa deja `ver` en la auditoría y exige `pacientes:ver`;
 *   - el 409 de CI duplicada trae `existente` solo para quien puede ver pacientes;
 *   - una alerta inactiva nunca sale para quien no tiene `ficha_clinica:ver`;
 *   - la auditoría de cada módulo solo la lee quien puede ver ese módulo;
 *   - marcas del vínculo desde los dos lados (`familiarEs*`, `PATCH /relaciones/:id`) y cambio de
 *     sexo que choca con un vínculo cargado a mano;
 *   - cursor opaco de la lista.
 */
import { crearRolDePrueba, crearUsuarioDePrueba } from '@conecta/db/pruebas';
import {
  alertaManualSchema,
  ciDuplicadaSchema,
  paginaAuditoriaSchema,
  paginaPacientesSchema,
  pacienteSchema,
  relacionSchema,
  type Relacion,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';
import { alerta, eventosDe, fichaApi, filaDe, paciente, vinculo } from './pacientes-ayudas.js';

type Detalles = { mensaje: string; detalles?: { campo: string; mensaje: string }[] };

describe('pacientes: revisiones del Sprint 3', () => {
  let prueba: Prueba;
  let a: Clinica;
  let tDueno: string;
  let tRecepcion: string;
  let tOdontologo: string;

  /** Persona con un rol a medida (sin doble factor, sin sedes). */
  async function conRol(
    clinica: Clinica,
    permisos: string[],
  ): Promise<{ token: string; usuarioId: string }> {
    const { rolId } = await crearRolDePrueba(prueba.admin, {
      clinicaId: clinica.clinicaId,
      permisos,
    });
    const creado = await crearUsuarioDePrueba(prueba.admin, {
      clinicaId: clinica.clinicaId,
      rolId,
      sedeIds: clinica.sedes.map((s) => s.sedeId),
    });
    return {
      token: await prueba.token({ sub: creado.usuarioId, email: creado.email }),
      usuarioId: creado.usuarioId,
    };
  }

  /** Cuántos `ver` de un paciente dejó un usuario. */
  async function vistas(clinicaId: string, pacienteId: string, usuarioId: string): Promise<number> {
    return (await eventosDe(prueba, clinicaId, pacienteId)).filter(
      (e) => e.accion === 'ver' && e.usuario_id === usuarioId,
    ).length;
  }

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    tDueno = await a.dueno.token();
    tRecepcion = await (await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' })).token();
    tOdontologo = await (await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' })).token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  describe('toda respuesta con la ficha completa queda en auditoría como «ver»', () => {
    let recepcionId: string;
    let odontologoId: string;
    let tRec: string;
    let tOdo: string;

    beforeAll(async () => {
      const rec = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
      const odo = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
      recepcionId = rec.usuarioId;
      odontologoId = odo.usuarioId;
      tRec = await rec.token();
      tOdo = await odo.token();
    });

    it('PATCH {} responde la ficha y deja «ver» del módulo pacientes', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Vacío', ci: '2345678' });
      const respuesta = await prueba
        .pedir('patch', `/pacientes/${id}`, { token: tRec, cuerpo: {} })
        .expect(200);
      expect(segun(pacienteSchema, respuesta.body)).toMatchObject({ id, ci: '2345678' });
      const eventos = await eventosDe(prueba, a.clinicaId, id);
      expect(eventos.filter((e) => e.usuario_id === recepcionId)).toEqual([
        { accion: 'ver', modulo: 'pacientes', entidad: 'paciente', usuario_id: recepcionId },
      ]);
    });

    it('PATCH con los mismos valores también deja «ver», una vez por pedido', async () => {
      const id = await paciente(prueba, a.clinicaId, {
        nombres: 'Igual',
        telefono: '0981 222 333',
      });
      for (const cuerpo of [{ nombres: 'Igual' }, { telefono: '0981 222 333' }, { ci: '' }]) {
        await prueba.pedir('patch', `/pacientes/${id}`, { token: tRec, cuerpo }).expect(200);
      }
      expect(await vistas(a.clinicaId, id, recepcionId)).toBe(3);
    });

    it('PATCH con la misma nota interna deja «ver»', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Con nota' });
      await prueba
        .pedir('patch', `/pacientes/${id}`, { token: tOdo, cuerpo: { notaInterna: 'Ansioso' } })
        .expect(200);
      const respuesta = await prueba
        .pedir('patch', `/pacientes/${id}`, { token: tOdo, cuerpo: { notaInterna: 'Ansioso' } })
        .expect(200);
      expect(segun(pacienteSchema, respuesta.body).notaInterna).toBe('Ansioso');
      expect(await vistas(a.clinicaId, id, odontologoId)).toBe(2);
    });

    it('desactivar y reactivar dejan «ver»', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Baja y alta' });
      const dueno = a.dueno.usuarioId;
      await prueba
        .pedir('post', `/pacientes/${id}/desactivar`, {
          token: tDueno,
          cuerpo: { motivo: 'Se mudó de ciudad' },
        })
        .expect(200);
      expect(await vistas(a.clinicaId, id, dueno)).toBe(1);
      await prueba.pedir('post', `/pacientes/${id}/reactivar`, { token: tDueno }).expect(200);
      expect(await vistas(a.clinicaId, id, dueno)).toBe(2);
    });

    it('un pedido que falla no deja «ver»', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Falla' });
      await esperarError(
        prueba.pedir('patch', `/pacientes/${id}`, {
          token: tRec,
          cuerpo: { fechaNac: '2999-01-01' },
        }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('post', `/pacientes/${id}/reactivar`, { token: tDueno }),
        409,
        'conflicto',
      );
      expect((await eventosDe(prueba, a.clinicaId, id)).filter((e) => e.accion === 'ver')).toEqual(
        [],
      );
    });
  });

  describe('pacientes:editar o anular sin pacientes:ver', () => {
    let token: string;
    let usuarioId: string;

    beforeAll(async () => {
      ({ token, usuarioId } = await conRol(a, [
        'pacientes:editar',
        'pacientes:anular',
        'pacientes:crear',
      ]));
    });

    it('PATCH, desactivar y reactivar → 403 sin hacer el cambio ni devolver la ficha', async () => {
      const activo = await paciente(prueba, a.clinicaId, {
        nombres: 'Reservada',
        apellidos: 'Pérez',
        ci: '4555666',
      });
      const inactivo = await paciente(prueba, a.clinicaId, {
        nombres: 'Reservado',
        activo: false,
      });
      const pedidos: ['patch' | 'post', string, object | undefined][] = [
        ['patch', `/pacientes/${activo}`, {}],
        ['patch', `/pacientes/${activo}`, { ciudad: 'Luque' }],
        ['patch', `/pacientes/${activo}`, { ci: '4555666' }],
        ['post', `/pacientes/${activo}/desactivar`, { motivo: 'Sin permiso de ver' }],
        ['post', `/pacientes/${inactivo}/reactivar`, undefined],
      ];
      for (const [metodo, ruta, cuerpo] of pedidos) {
        const r = await esperarError(
          prueba.pedir(metodo, ruta, { token, ...(cuerpo ? { cuerpo } : {}) }),
          403,
          'sin_permiso',
        );
        expect((r.body as Detalles).mensaje).toMatch(/«ver» en Pacientes/);
        expect(JSON.stringify(r.body)).not.toMatch(/Reservad|Pérez|4555666/);
      }
      expect(await filaDe(prueba, a.clinicaId, 'paciente', activo)).toMatchObject({
        activo: true,
        ciudad: null,
      });
      expect(await filaDe(prueba, a.clinicaId, 'paciente', inactivo)).toMatchObject({
        activo: false,
      });
      expect(await vistas(a.clinicaId, activo, usuarioId)).toBe(0);
      expect(await vistas(a.clinicaId, inactivo, usuarioId)).toBe(0);
    });

    it('crear o editar un vínculo (responden datos del familiar) → 403 sin cambiar nada', async () => {
      const uno = await paciente(prueba, a.clinicaId, { nombres: 'Uno' });
      const dos = await paciente(prueba, a.clinicaId, { nombres: 'Familiar Secreto' });
      const r = await esperarError(
        prueba.pedir('post', `/pacientes/${uno}/relaciones`, {
          token,
          cuerpo: { familiarId: dos, tipo: 'hermano' },
        }),
        403,
        'sin_permiso',
      );
      expect(JSON.stringify(r.body)).not.toMatch(/Secreto/);
      expect((await fichaApi(prueba, tDueno, uno)).relaciones).toEqual([]);

      const relacion = await vinculo(prueba, a.clinicaId, uno, dos, 'hermano');
      await esperarError(
        prueba.pedir('patch', `/relaciones/${relacion}`, { token, cuerpo: { esTutorLegal: true } }),
        403,
        'sin_permiso',
      );
      expect(await filaDe(prueba, a.clinicaId, 'paciente_relacion', relacion)).toMatchObject({
        es_tutor_legal: false,
      });
      // Quitar el vínculo no responde datos: sigue con pacientes:editar.
      await prueba.pedir('delete', `/relaciones/${relacion}`, { token }).expect(204);
    });

    it('el alta (solo responde lo que se cargó) sigue sin exigir pacientes:ver', async () => {
      const r = await prueba
        .pedir('post', '/pacientes', { token, cuerpo: { nombres: 'Alta a ciegas' } })
        .expect(201);
      expect(segun(pacienteSchema, r.body)).toMatchObject({ nombres: 'Alta a ciegas' });
    });
  });

  describe('409 de CI duplicada', () => {
    it('sin pacientes:ver: solo código, mensaje sin nombre y detalle en ci', async () => {
      const { token } = await conRol(a, ['pacientes:crear']);
      const existente = await paciente(prueba, a.clinicaId, {
        nombres: 'Dueña',
        apellidos: 'De La Cédula',
        ci: '3999111',
      });
      const r = await prueba
        .pedir('post', '/pacientes', { token, cuerpo: { nombres: 'Nueva', ci: '3.999.111' } })
        .expect(409);
      expect(Object.keys(r.body as object).sort()).toEqual(['codigo', 'detalles', 'mensaje']);
      expect(r.body).toEqual({
        codigo: 'conflicto',
        mensaje:
          'Esa cédula ya está cargada en otro paciente de la clínica. Revisala o, si es otra persona, guardá igual.',
        detalles: [{ campo: 'ci', mensaje: 'Esta cédula ya está cargada en otro paciente.' }],
      });
      expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`Dueña|Cédula|${existente}`));
      expect(ciDuplicadaSchema.safeParse(r.body).success).toBe(false);

      // Con la confirmación guarda igual.
      await prueba
        .pedir('post', '/pacientes', {
          token,
          cuerpo: { nombres: 'Nueva', ci: '3999111', confirmarCiDuplicada: true },
        })
        .expect(201);
    });

    it('con pacientes:ver: el contrato completo con existente', async () => {
      const { token } = await conRol(a, ['pacientes:crear', 'pacientes:ver']);
      const existente = await paciente(prueba, a.clinicaId, {
        nombres: 'Titular',
        apellidos: 'Gómez',
        ci: '3999222',
      });
      const r = await prueba
        .pedir('post', '/pacientes', { token, cuerpo: { nombres: 'Otra', ci: '3999222' } })
        .expect(409);
      expect(Object.keys(r.body as object).sort()).toEqual([
        'codigo',
        'detalles',
        'existente',
        'mensaje',
      ]);
      const cuerpo = segun(ciDuplicadaSchema, r.body);
      expect(cuerpo.existente).toMatchObject({ id: existente, nombres: 'Titular' });
      expect(cuerpo.mensaje).toMatch(/3\.999\.222: Titular Gómez/);
    });
  });

  describe('alertas inactivas sin ficha_clinica:ver', () => {
    let token: string;
    let id: string;
    let activa: string;
    let inactiva: string;

    beforeAll(async () => {
      ({ token } = await conRol(a, ['pacientes:ver', 'ficha_clinica:editar']));
      id = await paciente(prueba, a.clinicaId, { nombres: 'Con alertas' });
      activa = await alerta(prueba, a.clinicaId, id, { texto: 'Alergia al ibuprofeno' });
      inactiva = await alerta(prueba, a.clinicaId, id, {
        texto: 'Texto clínico reservado',
        activa: false,
      });
    });

    it('PATCH sobre una inactiva → 404 (activar o desactivar) sin su texto ni cambiarla', async () => {
      for (const activaNueva of [true, false]) {
        const r = await esperarError(
          prueba.pedir('patch', `/alertas/${inactiva}`, { token, cuerpo: { activa: activaNueva } }),
          404,
          'no_encontrado',
        );
        expect(JSON.stringify(r.body)).not.toMatch(/reservado/);
      }
      expect(await filaDe(prueba, a.clinicaId, 'paciente_alerta', inactiva)).toMatchObject({
        activa: false,
      });
    });

    it('desactivar una activa → 403 (hace falta ver la ficha clínica) y queda activa', async () => {
      const r = await esperarError(
        prueba.pedir('patch', `/alertas/${activa}`, { token, cuerpo: { activa: false } }),
        403,
        'sin_permiso',
      );
      expect((r.body as Detalles).mensaje).toMatch(/verla y editarla/);
      expect(await filaDe(prueba, a.clinicaId, 'paciente_alerta', activa)).toMatchObject({
        activa: true,
      });
    });

    it('una activa sí sale (está en la ficha); cargar una nueva también', async () => {
      const r = await prueba
        .pedir('patch', `/alertas/${activa}`, { token, cuerpo: { activa: true } })
        .expect(200);
      expect(segun(alertaManualSchema, r.body)).toMatchObject({ id: activa, activa: true });
      const nueva = await prueba
        .pedir('post', `/pacientes/${id}/alertas`, {
          token,
          cuerpo: { tipo: 'condicion', texto: 'Embarazo de 20 semanas' },
        })
        .expect(201);
      expect(segun(alertaManualSchema, nueva.body)).toMatchObject({
        tipo: 'condicion',
        activa: true,
      });
      const ficha = await fichaApi(prueba, token, id);
      expect(ficha.alertas.every((x) => x.activa)).toBe(true);
      expect(JSON.stringify(ficha)).not.toMatch(/reservado/);
    });

    it('sin pacientes:ver ni ficha_clinica:ver no responde ninguna alerta (403)', async () => {
      const soloEditar = await conRol(a, ['ficha_clinica:editar']);
      const r = await esperarError(
        prueba.pedir('patch', `/alertas/${activa}`, {
          token: soloEditar.token,
          cuerpo: { activa: true },
        }),
        403,
        'sin_permiso',
      );
      expect(JSON.stringify(r.body)).not.toMatch(/ibuprofeno/);
    });

    it('con ficha_clinica:ver la inactiva sí se ve y se reactiva', async () => {
      const r = await prueba
        .pedir('patch', `/alertas/${inactiva}`, { token: tOdontologo, cuerpo: { activa: false } })
        .expect(200);
      expect(segun(alertaManualSchema, r.body)).toMatchObject({
        texto: 'Texto clínico reservado',
        activa: false,
      });
    });
  });

  describe('auditoría: cada módulo solo para quien lo puede ver', () => {
    it('la nota interna y las alertas no salen en GET /auditoria sin ficha_clinica:ver', async () => {
      const c = await crearClinica(prueba, { sedes: 1 });
      const odo = await (await crearPersona(prueba, c.clinicaId, { rol: 'odontologo' })).token();
      const id = await paciente(prueba, c.clinicaId, { nombres: 'Auditada' });
      await prueba
        .pedir('patch', `/pacientes/${id}`, {
          token: odo,
          cuerpo: { notaInterna: 'Nota muy reservada' },
        })
        .expect(200);
      await prueba
        .pedir('post', `/pacientes/${id}/alertas`, {
          token: odo,
          cuerpo: { tipo: 'alergia', texto: 'Alergia reservada' },
        })
        .expect(201);

      const sinFicha = await conRol(c, ['auditoria:ver', 'pacientes:ver']);
      const conFicha = await conRol(c, ['auditoria:ver', 'pacientes:ver', 'ficha_clinica:ver']);
      const pagina = async (token: string) =>
        segun(
          paginaAuditoriaSchema,
          (await prueba.pedir('get', '/auditoria?limite=100', { token }).expect(200)).body,
        );

      const vistaSin = await pagina(sinFicha.token);
      expect(vistaSin.items.length).toBeGreaterThan(0);
      expect(new Set(vistaSin.items.map((e) => e.modulo))).toEqual(new Set(['pacientes']));
      expect(JSON.stringify(vistaSin)).not.toMatch(/reservada/);

      const vistaCon = await pagina(conFicha.token);
      expect(vistaCon.items.map((e) => e.entidad)).toEqual(
        expect.arrayContaining(['paciente_nota', 'paciente_alerta']),
      );
      expect(JSON.stringify(vistaCon)).toMatch(/Nota muy reservada/);
    });
  });

  describe('grupo familiar: marcas desde los dos lados', () => {
    const ver = async (pacienteId: string, familiarId: string): Promise<Relacion | undefined> =>
      (await fichaApi(prueba, tRecepcion, pacienteId)).relaciones.find(
        (r) => r.familiar.id === familiarId,
      );

    it('al crear, familiarEs* marca al otro lado', async () => {
      const ana = await paciente(prueba, a.clinicaId, { nombres: 'Ana', sexo: 'F' });
      const mateo = await paciente(prueba, a.clinicaId, { nombres: 'Mateo', sexo: 'M' });
      // Desde la ficha de Mateo: Ana es su madre, su tutora y paga por él.
      const creada = segun(
        relacionSchema,
        (
          await prueba
            .pedir('post', `/pacientes/${mateo}/relaciones`, {
              token: tRecepcion,
              cuerpo: {
                familiarId: ana,
                tipo: 'madre',
                familiarEsTutorLegal: true,
                familiarEsResponsablePago: true,
              },
            })
            .expect(201)
        ).body,
      );
      expect(creada).toMatchObject({
        familiar: { id: ana },
        tipo: 'madre',
        esTutorLegal: false,
        esResponsablePago: false,
        familiarEsTutorLegal: true,
        familiarEsResponsablePago: true,
      });
      expect(await ver(ana, mateo)).toMatchObject({
        tipo: 'hijo',
        esTutorLegal: true,
        esResponsablePago: true,
        familiarEsTutorLegal: false,
        familiarEsResponsablePago: false,
      });
    });

    it('PATCH /relaciones/:id cambia las cuatro marcas desde cualquiera de los dos ids', async () => {
      const papa = await paciente(prueba, a.clinicaId, { nombres: 'Raúl', sexo: 'M' });
      const hija = await paciente(prueba, a.clinicaId, { nombres: 'Lucía', sexo: 'F' });
      const desdeHija = await vinculo(prueba, a.clinicaId, hija, papa, 'padre');
      const desdePapa = (await ver(papa, hija))?.id ?? '';
      expect(desdePapa).not.toBe('');

      // Desde la hija: el padre es su tutor y paga.
      const r1 = segun(
        relacionSchema,
        (
          await prueba
            .pedir('patch', `/relaciones/${desdeHija}`, {
              token: tRecepcion,
              cuerpo: { familiarEsTutorLegal: true, familiarEsResponsablePago: true },
            })
            .expect(200)
        ).body,
      );
      expect(r1).toMatchObject({
        id: desdeHija,
        familiar: { id: papa },
        tipo: 'padre',
        esTutorLegal: false,
        familiarEsTutorLegal: true,
        familiarEsResponsablePago: true,
      });

      // Desde el padre, en un solo pedido: pasa el pago a la hija y deja la tutoría.
      const r2 = segun(
        relacionSchema,
        (
          await prueba
            .pedir('patch', `/relaciones/${desdePapa}`, {
              token: tRecepcion,
              cuerpo: { esResponsablePago: false, familiarEsResponsablePago: true },
            })
            .expect(200)
        ).body,
      );
      expect(r2).toMatchObject({
        id: desdePapa,
        tipo: 'hijo',
        esTutorLegal: true,
        esResponsablePago: false,
        familiarEsTutorLegal: false,
        familiarEsResponsablePago: true,
      });
      expect(await ver(hija, papa)).toMatchObject({
        esTutorLegal: false,
        esResponsablePago: true,
        familiarEsTutorLegal: true,
        familiarEsResponsablePago: false,
      });

      // Sin cambios: responde igual.
      const r3 = await prueba
        .pedir('patch', `/relaciones/${desdePapa}`, { token: tRecepcion, cuerpo: {} })
        .expect(200);
      expect(segun(relacionSchema, r3.body)).toEqual(r2);
    });

    it('una marca en los dos sentidos → 400 y no cambia nada (al crear y al editar)', async () => {
      const uno = await paciente(prueba, a.clinicaId, { nombres: 'Pareja Uno' });
      const dos = await paciente(prueba, a.clinicaId, { nombres: 'Pareja Dos' });
      const alCrear = await esperarError(
        prueba.pedir('post', `/pacientes/${uno}/relaciones`, {
          token: tRecepcion,
          cuerpo: {
            familiarId: dos,
            tipo: 'pareja',
            esTutorLegal: true,
            familiarEsTutorLegal: true,
          },
        }),
        400,
        'datos_invalidos',
      );
      expect((alCrear.body as Detalles).mensaje).toMatch(/un solo sentido/);
      expect((await fichaApi(prueba, tRecepcion, uno)).relaciones).toEqual([]);

      const id = await vinculo(prueba, a.clinicaId, uno, dos, 'pareja');
      await prueba
        .pedir('patch', `/relaciones/${id}`, {
          token: tRecepcion,
          cuerpo: { esResponsablePago: true },
        })
        .expect(200);
      const alEditar = await esperarError(
        prueba.pedir('patch', `/relaciones/${id}`, {
          token: tRecepcion,
          cuerpo: { familiarEsResponsablePago: true },
        }),
        400,
        'datos_invalidos',
      );
      expect((alEditar.body as Detalles).mensaje).toMatch(/un solo sentido/);
      expect(await ver(uno, dos)).toMatchObject({
        esResponsablePago: true,
        familiarEsResponsablePago: false,
      });
    });

    it('vínculo quitado → 409; inexistente o de otra clínica → 404; cuerpo inválido → 400', async () => {
      const uno = await paciente(prueba, a.clinicaId, { nombres: 'Quitado Uno' });
      const dos = await paciente(prueba, a.clinicaId, { nombres: 'Quitado Dos' });
      const id = await vinculo(prueba, a.clinicaId, uno, dos, 'hermano');
      await prueba.pedir('delete', `/relaciones/${id}`, { token: tRecepcion }).expect(204);
      const quitado = await esperarError(
        prueba.pedir('patch', `/relaciones/${id}`, {
          token: tRecepcion,
          cuerpo: { esTutorLegal: true },
        }),
        409,
        'conflicto',
      );
      expect((quitado.body as Detalles).mensaje).toMatch(/ya se quitó/);
      for (const ruta of [
        '/relaciones/00000000-0000-4000-8000-000000000009',
        '/relaciones/no-es-uuid',
      ]) {
        await esperarError(
          prueba.pedir('patch', ruta, { token: tRecepcion, cuerpo: {} }),
          404,
          'no_encontrado',
        );
      }
      const otro = await vinculo(prueba, a.clinicaId, uno, dos, 'hermano');
      await esperarError(
        prueba.pedir('patch', `/relaciones/${otro}`, {
          token: tRecepcion,
          cuerpo: { esTutorLegal: 'sí' },
        }),
        400,
        'datos_invalidos',
      );
    });

    it('cambio de sexo: un tipo elegido a mano que deja de corresponder → 400 en sexo', async () => {
      const madre = await paciente(prueba, a.clinicaId, { nombres: 'Marta', sexo: 'F' });
      const hijo = await paciente(prueba, a.clinicaId, { nombres: 'Pablo', sexo: 'M' });
      // Desde la ficha de Pablo, alguien eligió «madre» para Marta.
      await prueba
        .pedir('post', `/pacientes/${hijo}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: madre, tipo: 'madre' },
        })
        .expect(201);
      const r = await esperarError(
        prueba.pedir('patch', `/pacientes/${madre}`, { token: tRecepcion, cuerpo: { sexo: 'M' } }),
        400,
        'datos_invalidos',
      );
      expect(r.body).toMatchObject({
        mensaje:
          'Este paciente figura como madre en su grupo familiar y el sexo nuevo no coincide. Quitá ese vínculo y cargalo de nuevo, o revisá el sexo.',
        detalles: [{ campo: 'sexo' }],
      });
      expect(await filaDe(prueba, a.clinicaId, 'paciente', madre)).toMatchObject({ sexo: 'F' });
      expect(await ver(hijo, madre)).toMatchObject({ tipo: 'madre' });
    });

    it('cambio de sexo: el tipo que calculó la base (espejo) lo sigue', async () => {
      const progenitor = await paciente(prueba, a.clinicaId, { nombres: 'Alex', sexo: 'F' });
      const nena = await paciente(prueba, a.clinicaId, { nombres: 'Nina', sexo: 'F' });
      // Desde la ficha de Alex: Nina es su hija. En la de Nina, Alex queda «madre» por el sexo.
      await prueba
        .pedir('post', `/pacientes/${progenitor}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: nena, tipo: 'hijo' },
        })
        .expect(201);
      expect(await ver(nena, progenitor)).toMatchObject({ tipo: 'madre' });
      await prueba
        .pedir('patch', `/pacientes/${progenitor}`, { token: tRecepcion, cuerpo: { sexo: 'M' } })
        .expect(200);
      expect(await ver(nena, progenitor)).toMatchObject({ tipo: 'padre' });
    });
  });

  describe('cursor opaco de la lista', () => {
    let c: Clinica;
    let token: string;

    beforeAll(async () => {
      c = await crearClinica(prueba, { sedes: 1 });
      token = await c.dueno.token();
      for (const [nombres, apellidos] of [
        ['Ana', 'Acosta'],
        ['Bruno', 'Benítez'],
        ['Carla', 'Cáceres'],
        ['Diego', 'Duarte'],
        ['Elsa', 'Espínola'],
      ] as const) {
        await paciente(prueba, c.clinicaId, { nombres, apellidos });
      }
    });

    const pagina = async (cursor: string | null) =>
      segun(
        paginaPacientesSchema,
        (
          await prueba
            .pedir(
              'get',
              `/pacientes?limite=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
              { token },
            )
            .expect(200)
        ).body,
      );

    it('se pasa tal cual de una página a la otra, sin repetidos ni saltos aunque alguien se renombre', async () => {
      const p1 = await pagina(null);
      expect(p1.items.map((p) => p.apellidos)).toEqual(['Acosta', 'Benítez']);
      const cursor = p1.siguienteCursor ?? '';
      // Opaco: base64url, sin el id ni el nombre a la vista.
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(cursor).not.toContain(p1.items[1]?.id ?? '-');
      expect(cursor.toLowerCase()).not.toContain('benitez');

      // Benítez se renombra a «Zárate» entre una página y la otra: la lista sigue desde donde se vio.
      await prueba
        .pedir('patch', `/pacientes/${p1.items[1]?.id ?? ''}`, {
          token,
          cuerpo: { apellidos: 'Zárate' },
        })
        .expect(200);
      const vistos = [...p1.items.map((p) => p.apellidos)];
      let siguiente: string | null = cursor;
      while (siguiente) {
        const p = await pagina(siguiente);
        vistos.push(...p.items.map((x) => x.apellidos));
        siguiente = p.siguienteCursor;
      }
      expect(vistos).toEqual(['Acosta', 'Benítez', 'Cáceres', 'Duarte', 'Espínola', 'Zárate']);
    });

    it('un cursor adulterado o cortado → 400 en el campo cursor', async () => {
      const cursor = (await pagina(null)).siguienteCursor ?? '';
      const adulterados = [
        `${cursor.startsWith('A') ? 'B' : 'A'}${cursor.slice(1)}`,
        cursor.slice(0, 6),
        '00000000-0000-4000-8000-000000000005',
        'cualquiera',
      ];
      for (const malo of adulterados) {
        const r = await esperarError(
          prueba.pedir('get', `/pacientes?cursor=${encodeURIComponent(malo)}`, { token }),
          400,
          'datos_invalidos',
        );
        expect({ malo, detalles: (r.body as Detalles).detalles }).toEqual({
          malo,
          detalles: [{ campo: 'cursor', mensaje: 'Volvé a cargar la lista desde el principio.' }],
        });
      }
      // Más largo que lo que admite el contrato (400): lo rechaza la validación.
      await esperarError(
        prueba.pedir('get', `/pacientes?cursor=${'A'.repeat(401)}`, { token }),
        400,
        'datos_invalidos',
      );
    });
  });
});
