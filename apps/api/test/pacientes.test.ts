/**
 * Pacientes por la API (Sprint 3): alta y edición, CI duplicada (409 con `existente`), ficha con
 * `ver` en auditoría, nota interna y alertas según permiso, grupo familiar, baja y reactivación,
 * lista y buscador. Contra el Postgres real del banco.
 */
import {
  alertaManualSchema,
  ciDuplicadaSchema,
  digitoVerificadorRuc,
  paginaPacientesSchema,
  pacienteSchema,
  relacionSchema,
  resultadoBuscarSchema,
  type PacienteResumen,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';
import {
  alerta,
  crearPacienteApi,
  eventosDe,
  fichaApi,
  paciente,
  vinculo,
} from './pacientes-ayudas.js';

type Detalles = { mensaje: string; detalles?: { campo: string; mensaje: string }[] };

const anioActual = new Date().getUTCFullYear();

describe('pacientes', () => {
  let prueba: Prueba;
  let a: Clinica;
  let dueno: string;
  let recepcion: Persona;
  let odontologo: Persona;
  let asistente: Persona;
  let tRecepcion: string;
  let tOdontologo: string;
  let tAsistente: string;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    dueno = await a.dueno.token();
    recepcion = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    odontologo = await crearPersona(prueba, a.clinicaId, { rol: 'odontologo' });
    asistente = await crearPersona(prueba, a.clinicaId, { rol: 'asistente' });
    tRecepcion = await recepcion.token();
    tOdontologo = await odontologo.token();
    tAsistente = await asistente.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  describe('alta y edición', () => {
    it('normaliza los datos como el contrato y calcula edad y pediátrico', async () => {
      const base = '80012345';
      const nacimiento = `${String(anioActual - 8)}-01-15`;
      const p = await crearPacienteApi(prueba, tRecepcion, {
        nombres: '  María José  ',
        apellidos: 'González Peña',
        ci: '4.123.456',
        ruc: `${base}-${String(digitoVerificadorRuc(base))}`,
        fechaNac: nacimiento,
        sexo: 'F',
        telefono: '0981 123 456',
        email: 'Maria@Correo.COM',
        ciudad: 'Luque',
        direccion: 'Avda. Siempre Viva 123',
        idioma: 'gn',
        aceptaWhatsapp: true,
      });
      expect(p).toMatchObject({
        nombres: 'María José',
        apellidos: 'González Peña',
        ci: '4123456',
        ruc: `${base}-${String(digitoVerificadorRuc(base))}`,
        fechaNac: nacimiento,
        sexo: 'F',
        telefono: '+595981123456',
        email: 'maria@correo.com',
        ciudad: 'Luque',
        idioma: 'gn',
        aceptaWhatsapp: true,
        origen: 'recepcion',
        activo: true,
        pediatrico: true,
        conAlerta: false,
        notaInterna: null,
        alertas: [],
        relaciones: [],
        motivoBaja: null,
      });
      expect(p.edad).toBeGreaterThanOrEqual(7);
      expect(p.edad).toBeLessThanOrEqual(8);
    });

    it('solo el nombre es obligatorio; cadena vacía en un dato opcional = sin dato', async () => {
      const p = await crearPacienteApi(prueba, tRecepcion, {
        nombres: 'Lucía',
        apellidos: '',
        ci: '',
        telefono: '  ',
        email: '',
      });
      expect(p).toMatchObject({
        apellidos: null,
        ci: null,
        telefono: null,
        email: null,
        edad: null,
        pediatrico: false,
        idioma: 'es',
        aceptaWhatsapp: false,
      });
    });

    it('datos inválidos → datos_invalidos con detalle por campo', async () => {
      const respuesta = await esperarError(
        prueba.pedir('post', '/pacientes', {
          token: tRecepcion,
          cuerpo: { nombres: 'A', ci: '12', ruc: 'abc', telefono: '12', email: 'x' },
        }),
        400,
        'datos_invalidos',
      );
      const campos = (respuesta.body as Detalles).detalles?.map((d) => d.campo).sort();
      expect(campos).toEqual(['ci', 'email', 'nombres', 'ruc', 'telefono']);
    });

    it('fecha de nacimiento futura → 400 en el campo fechaNac (lo decide la base)', async () => {
      const respuesta = await esperarError(
        prueba.pedir('post', '/pacientes', {
          token: tRecepcion,
          cuerpo: { nombres: 'Futuro', fechaNac: `${String(anioActual + 1)}-01-01` },
        }),
        400,
        'datos_invalidos',
      );
      expect((respuesta.body as Detalles).detalles).toEqual([
        { campo: 'fechaNac', mensaje: 'No puede ser futura.' },
      ]);
      expect((respuesta.body as Detalles).mensaje).toMatch(/no puede ser futura/);
    });

    it('edita solo lo que viene; null y cadena vacía borran el dato', async () => {
      const p = await crearPacienteApi(prueba, tRecepcion, {
        nombres: 'Pedro',
        apellidos: 'Acosta',
        telefono: '0971 222 333',
        ciudad: 'Asunción',
      });
      const editado = segun(
        pacienteSchema,
        (
          await prueba
            .pedir('patch', `/pacientes/${p.id}`, {
              token: tRecepcion,
              cuerpo: { apellidos: null, telefono: '', sexo: 'M', aceptaWhatsapp: true },
            })
            .expect(200)
        ).body,
      );
      expect(editado).toMatchObject({
        nombres: 'Pedro',
        apellidos: null,
        telefono: null,
        ciudad: 'Asunción',
        sexo: 'M',
        aceptaWhatsapp: true,
      });
      // Un cuerpo vacío no cambia nada.
      const igual = segun(
        pacienteSchema,
        (
          await prueba
            .pedir('patch', `/pacientes/${p.id}`, { token: tRecepcion, cuerpo: {} })
            .expect(200)
        ).body,
      );
      expect(igual).toEqual(editado);
    });

    it('el nombre no se puede vaciar al editar', async () => {
      const p = await crearPacienteApi(prueba, tRecepcion, { nombres: 'Rosa' });
      await esperarError(
        prueba.pedir('patch', `/pacientes/${p.id}`, { token: tRecepcion, cuerpo: { nombres: '' } }),
        400,
        'datos_invalidos',
      );
    });
  });

  describe('CI duplicada', () => {
    let existente: string;

    beforeAll(async () => {
      existente = (
        await crearPacienteApi(prueba, tRecepcion, {
          nombres: 'Carlos',
          apellidos: 'Benítez',
          ci: '3.555.777',
        })
      ).id;
    });

    async function cuantosConCi(ci: string): Promise<number> {
      const { rows } = await comoSistema<{ n: string }>(
        prueba.admin,
        a.clinicaId,
        'select count(*) as n from app.paciente where clinica_id = $1 and ci = $2',
        [a.clinicaId, ci],
      );
      return Number(rows[0]?.n ?? 0);
    }

    function comprobar409(cuerpo: unknown): PacienteResumen {
      const r = segun(ciDuplicadaSchema, cuerpo);
      expect(Object.keys(cuerpo as object).sort()).toEqual([
        'codigo',
        'detalles',
        'existente',
        'mensaje',
      ]);
      expect(cuerpo).toMatchObject({
        codigo: 'conflicto',
        detalles: [{ campo: 'ci', mensaje: 'Esta cédula ya está cargada en otro paciente.' }],
      });
      expect(r.mensaje).toBe(
        'Ya hay un paciente con la cédula 3.555.777: Carlos Benítez. Abrí su ficha o, si es otra persona, guardá igual.',
      );
      return r.existente;
    }

    it('alta sin confirmar → 409 con la forma exacta del contrato y sin guardar', async () => {
      const respuesta = await prueba
        .pedir('post', '/pacientes', {
          token: tRecepcion,
          cuerpo: { nombres: 'Otro Carlos', ci: '3555777' },
        })
        .expect(409);
      const e = comprobar409(respuesta.body);
      expect(e).toMatchObject({
        id: existente,
        nombres: 'Carlos',
        apellidos: 'Benítez',
        ci: '3555777',
        activo: true,
      });
      expect(await cuantosConCi('3555777')).toBe(1);
    });

    it('alta con confirmarCiDuplicada → 201 y la CI queda repetida', async () => {
      const p = await crearPacienteApi(prueba, tRecepcion, {
        nombres: 'Otro Carlos',
        ci: '3.555.777',
        confirmarCiDuplicada: true,
      });
      expect(p.ci).toBe('3555777');
      expect(await cuantosConCi('3555777')).toBe(2);
    });

    it('edición: sin confirmar → 409 con existente; con confirmación guarda', async () => {
      const otro = await crearPacienteApi(prueba, tRecepcion, { nombres: 'Sin CI' });
      const respuesta = await prueba
        .pedir('patch', `/pacientes/${otro.id}`, {
          token: tRecepcion,
          cuerpo: { ci: '3 555 777', ciudad: 'Areguá' },
        })
        .expect(409);
      // Activos primero y después el más antiguo: el primero que la tuvo.
      expect(comprobar409(respuesta.body).id).toBe(existente);
      expect((await fichaApi(prueba, tRecepcion, otro.id)).ciudad).toBeNull();

      const guardado = segun(
        pacienteSchema,
        (
          await prueba
            .pedir('patch', `/pacientes/${otro.id}`, {
              token: tRecepcion,
              cuerpo: { ci: '3555777', ciudad: 'Areguá', confirmarCiDuplicada: true },
            })
            .expect(200)
        ).body,
      );
      expect(guardado).toMatchObject({ ci: '3555777', ciudad: 'Areguá' });

      // Volver a mandar la CI que ya tiene no es un cambio: no pregunta otra vez.
      await prueba
        .pedir('patch', `/pacientes/${otro.id}`, { token: tRecepcion, cuerpo: { ci: '3555777' } })
        .expect(200);
    });

    it('la propia CI del paciente no cuenta como duplicada al editar', async () => {
      const unico = await crearPacienteApi(prueba, tRecepcion, { nombres: 'Única', ci: '7123123' });
      await prueba
        .pedir('patch', `/pacientes/${unico.id}`, {
          token: tRecepcion,
          cuerpo: { ci: '7.123.123', nombres: 'Única Cambiada' },
        })
        .expect(200);
    });

    it('un paciente inactivo con esa CI también avisa', async () => {
      await paciente(prueba, a.clinicaId, {
        nombres: 'Dado',
        apellidos: 'De Baja',
        ci: '6123456',
        activo: false,
      });
      const respuesta = await prueba
        .pedir('post', '/pacientes', {
          token: tRecepcion,
          cuerpo: { nombres: 'Nuevo', ci: '6123456' },
        })
        .expect(409);
      expect(segun(ciDuplicadaSchema, respuesta.body).existente).toMatchObject({
        nombres: 'Dado',
        activo: false,
      });
    });
  });

  describe('ficha', () => {
    it('abrir una ficha deja «ver» en la auditoría con el módulo pacientes', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Auditada' });
      const antes = await eventosDe(prueba, a.clinicaId, id);
      await fichaApi(prueba, tRecepcion, id);
      await fichaApi(prueba, tOdontologo, id);
      const despues = (await eventosDe(prueba, a.clinicaId, id)).slice(antes.length);
      expect(despues).toEqual([
        {
          accion: 'ver',
          modulo: 'pacientes',
          entidad: 'paciente',
          usuario_id: recepcion.usuarioId,
        },
        {
          accion: 'ver',
          modulo: 'pacientes',
          entidad: 'paciente',
          usuario_id: odontologo.usuarioId,
        },
      ]);
    });

    it('listar y buscar no registran «ver»; un id que no existe tampoco', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Zacarías', apellidos: 'Listado' });
      await prueba.pedir('get', '/pacientes?q=zacarias', { token: tRecepcion }).expect(200);
      await prueba.pedir('get', '/buscar?q=zacarias', { token: tRecepcion }).expect(200);
      expect((await eventosDe(prueba, a.clinicaId, id)).map((e) => e.accion)).toEqual(['crear']);
      const inexistente = '00000000-0000-4000-8000-000000000001';
      await esperarError(
        prueba.pedir('get', `/pacientes/${inexistente}`, { token: tRecepcion }),
        404,
        'no_encontrado',
      );
      expect(await eventosDe(prueba, a.clinicaId, inexistente)).toEqual([]);
    });

    it('un id que no es UUID → 404', async () => {
      await esperarError(
        prueba.pedir('get', '/pacientes/no-es-un-id', { token: tRecepcion }),
        404,
        'no_encontrado',
      );
    });
  });

  describe('nota interna', () => {
    let id: string;

    beforeAll(async () => {
      id = await paciente(prueba, a.clinicaId, { nombres: 'Con Nota' });
    });

    it('la carga quien tiene ficha_clinica:editar y la ve quien tiene ficha_clinica:ver', async () => {
      const editado = segun(
        pacienteSchema,
        (
          await prueba
            .pedir('patch', `/pacientes/${id}`, {
              token: tOdontologo,
              cuerpo: { notaInterna: '  Muy ansioso con las agujas.  ' },
            })
            .expect(200)
        ).body,
      );
      expect(editado.notaInterna).toBe('Muy ansioso con las agujas.');
      expect((await fichaApi(prueba, tOdontologo, id)).notaInterna).toBe(
        'Muy ansioso con las agujas.',
      );
      expect((await fichaApi(prueba, tAsistente, id)).notaInterna).toBe(
        'Muy ansioso con las agujas.',
      );
      expect((await fichaApi(prueba, dueno, id)).notaInterna).toBe('Muy ansioso con las agujas.');
    });

    it('recepción no la ve (null) aunque exista', async () => {
      expect((await fichaApi(prueba, tRecepcion, id)).notaInterna).toBeNull();
    });

    it('PATCH con notaInterna sin ficha_clinica:editar → 403 y no cambia nada', async () => {
      const respuesta = await esperarError(
        prueba.pedir('patch', `/pacientes/${id}`, {
          token: tRecepcion,
          cuerpo: { notaInterna: 'Otra cosa', ciudad: 'Luque' },
        }),
        403,
        'sin_permiso',
      );
      expect((respuesta.body as Detalles).mensaje).toMatch(/nota interna/);
      await esperarError(
        prueba.pedir('patch', `/pacientes/${id}`, {
          token: tRecepcion,
          cuerpo: { notaInterna: null },
        }),
        403,
        'sin_permiso',
      );
      const ficha = await fichaApi(prueba, tOdontologo, id);
      expect(ficha).toMatchObject({ notaInterna: 'Muy ansioso con las agujas.', ciudad: null });
    });

    it('recepción edita los datos personales sin tocar la nota', async () => {
      await prueba
        .pedir('patch', `/pacientes/${id}`, { token: tRecepcion, cuerpo: { ciudad: 'Luque' } })
        .expect(200);
      expect(await fichaApi(prueba, tOdontologo, id)).toMatchObject({
        ciudad: 'Luque',
        notaInterna: 'Muy ansioso con las agujas.',
      });
    });

    it('null o vacío la borran', async () => {
      await prueba
        .pedir('patch', `/pacientes/${id}`, { token: tOdontologo, cuerpo: { notaInterna: '' } })
        .expect(200);
      expect((await fichaApi(prueba, tOdontologo, id)).notaInterna).toBeNull();
      await prueba
        .pedir('patch', `/pacientes/${id}`, {
          token: tOdontologo,
          cuerpo: { notaInterna: 'Vuelve' },
        })
        .expect(200);
      await prueba
        .pedir('patch', `/pacientes/${id}`, { token: tOdontologo, cuerpo: { notaInterna: null } })
        .expect(200);
      expect((await fichaApi(prueba, tOdontologo, id)).notaInterna).toBeNull();
    });
  });

  describe('alertas manuales', () => {
    it('alta, desactivar y reactivar; las inactivas solo con ficha_clinica:ver', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Alérgico' });
      const creada = segun(
        alertaManualSchema,
        (
          await prueba
            .pedir('post', `/pacientes/${id}/alertas`, {
              token: tOdontologo,
              cuerpo: { tipo: 'alergia', texto: '  Alergia a la penicilina ' },
            })
            .expect(201)
        ).body,
      );
      expect(creada).toMatchObject({
        tipo: 'alergia',
        texto: 'Alergia a la penicilina',
        activa: true,
      });
      expect(typeof creada.creadaPor).toBe('string');
      const segunda = segun(
        alertaManualSchema,
        (
          await prueba
            .pedir('post', `/pacientes/${id}/alertas`, {
              token: tOdontologo,
              cuerpo: { tipo: 'condicion', texto: 'Embarazo' },
            })
            .expect(201)
        ).body,
      );

      const desactivada = segun(
        alertaManualSchema,
        (
          await prueba
            .pedir('patch', `/alertas/${segunda.id}`, {
              token: tOdontologo,
              cuerpo: { activa: false },
            })
            .expect(200)
        ).body,
      );
      expect(desactivada).toMatchObject({
        id: segunda.id,
        tipo: 'condicion',
        activa: false,
        texto: 'Embarazo',
      });

      const clinica = await fichaApi(prueba, tOdontologo, id);
      expect(clinica.alertas.map((x) => [x.tipo, x.texto, x.activa])).toEqual([
        ['alergia', 'Alergia a la penicilina', true],
        ['condicion', 'Embarazo', false],
      ]);
      expect(clinica.conAlerta).toBe(true);
      expect((await fichaApi(prueba, tAsistente, id)).alertas).toHaveLength(2);

      const mostrador = await fichaApi(prueba, tRecepcion, id);
      expect(mostrador.alertas.map((x) => x.texto)).toEqual(['Alergia a la penicilina']);
      expect(mostrador.conAlerta).toBe(true);

      // Reactivar.
      const reactivada = segun(
        alertaManualSchema,
        (
          await prueba
            .pedir('patch', `/alertas/${segunda.id}`, {
              token: tOdontologo,
              cuerpo: { activa: true },
            })
            .expect(200)
        ).body,
      );
      expect(reactivada.activa).toBe(true);
      expect((await fichaApi(prueba, tRecepcion, id)).alertas).toHaveLength(2);
    });

    it('sin alertas activas, conAlerta es false', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Sin alertas activas' });
      await alerta(prueba, a.clinicaId, id, { activa: false });
      const ficha = await fichaApi(prueba, tRecepcion, id);
      expect(ficha).toMatchObject({ conAlerta: false, alertas: [] });
    });

    it('sin tipo o con un tipo que no existe → 400 en el campo tipo', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Sin tipo' });
      for (const cuerpo of [{ texto: 'Alergia al látex' }, { tipo: 'medica', texto: 'Diabetes' }]) {
        const r = await esperarError(
          prueba.pedir('post', `/pacientes/${id}/alertas`, { token: tOdontologo, cuerpo }),
          400,
          'datos_invalidos',
        );
        expect((r.body as Detalles).detalles?.map((d) => d.campo)).toEqual(['tipo']);
      }
      expect((await fichaApi(prueba, tOdontologo, id)).alertas).toEqual([]);
    });

    it('texto muy corto → 400; alerta o paciente que no existe → 404', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Corto' });
      await esperarError(
        prueba.pedir('post', `/pacientes/${id}/alertas`, {
          token: tOdontologo,
          cuerpo: { tipo: 'alergia', texto: ' ab ' },
        }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('post', '/pacientes/00000000-0000-4000-8000-000000000002/alertas', {
          token: tOdontologo,
          cuerpo: { tipo: 'alergia', texto: 'Alergia' },
        }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('patch', '/alertas/00000000-0000-4000-8000-000000000003', {
          token: tOdontologo,
          cuerpo: { activa: false },
        }),
        404,
        'no_encontrado',
      );
    });
  });

  describe('grupo familiar', () => {
    it('crea el vínculo y su espejo, con las marcas vistas desde los dos lados', async () => {
      const ana = await paciente(prueba, a.clinicaId, {
        nombres: 'Ana',
        apellidos: 'Ruiz',
        sexo: 'F',
      });
      const mateo = await paciente(prueba, a.clinicaId, {
        nombres: 'Mateo',
        apellidos: 'Ruiz',
        sexo: 'M',
        fechaNac: `${String(anioActual - 6)}-03-01`,
      });
      const creada = segun(
        relacionSchema,
        (
          await prueba
            .pedir('post', `/pacientes/${ana}/relaciones`, {
              token: tRecepcion,
              cuerpo: {
                familiarId: mateo,
                tipo: 'hijo',
                esTutorLegal: true,
                esResponsablePago: true,
              },
            })
            .expect(201)
        ).body,
      );
      expect(creada).toMatchObject({
        familiar: { id: mateo, nombre: 'Mateo Ruiz' },
        tipo: 'hijo',
        esTutorLegal: true,
        esResponsablePago: true,
        familiarEsTutorLegal: false,
        familiarEsResponsablePago: false,
      });
      expect(creada.familiar.edad).toBeGreaterThanOrEqual(5);

      expect((await fichaApi(prueba, tRecepcion, ana)).relaciones).toEqual([creada]);
      const espejo = (await fichaApi(prueba, tRecepcion, mateo)).relaciones;
      expect(espejo).toHaveLength(1);
      expect(espejo[0]).toMatchObject({
        familiar: { id: ana, nombre: 'Ana Ruiz', edad: null },
        tipo: 'madre',
        esTutorLegal: false,
        esResponsablePago: false,
        familiarEsTutorLegal: true,
        familiarEsResponsablePago: true,
      });
      expect(espejo[0]?.id).not.toBe(creada.id);
    });

    it('la baja acepta el id de cualquiera de los dos lados y se lleva los dos', async () => {
      const papa = await paciente(prueba, a.clinicaId, { nombres: 'Raúl', sexo: 'M' });
      const hija = await paciente(prueba, a.clinicaId, { nombres: 'Sofía', sexo: 'F' });
      for (const lado of ['propio', 'espejo'] as const) {
        const creada = segun(
          relacionSchema,
          (
            await prueba
              .pedir('post', `/pacientes/${hija}/relaciones`, {
                token: tRecepcion,
                cuerpo: { familiarId: papa, tipo: 'padre' },
              })
              .expect(201)
          ).body,
        );
        const espejo = (await fichaApi(prueba, tRecepcion, papa)).relaciones[0];
        expect(espejo).toMatchObject({ tipo: 'hijo', familiar: { id: hija } });
        const id = lado === 'propio' ? creada.id : (espejo?.id ?? '');
        await prueba.pedir('delete', `/relaciones/${id}`, { token: tRecepcion }).expect(204);
        expect((await fichaApi(prueba, tRecepcion, hija)).relaciones).toEqual([]);
        expect((await fichaApi(prueba, tRecepcion, papa)).relaciones).toEqual([]);
        // Repetir la baja no falla.
        await prueba.pedir('delete', `/relaciones/${id}`, { token: tRecepcion }).expect(204);
      }
    });

    it('tipo incompatible con el sexo del familiar → mensaje que dice qué revisar', async () => {
      const varon = await paciente(prueba, a.clinicaId, { nombres: 'Hugo', sexo: 'M' });
      const mujer = await paciente(prueba, a.clinicaId, { nombres: 'Elena', sexo: 'F' });
      const nino = await paciente(prueba, a.clinicaId, { nombres: 'Tomás', sexo: 'M' });
      const madre = await esperarError(
        prueba.pedir('post', `/pacientes/${nino}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: varon, tipo: 'madre' },
        }),
        400,
        'datos_invalidos',
      );
      expect((madre.body as Detalles).mensaje).toBe(
        'Madre tiene que ser una paciente de sexo femenino. Revisá el vínculo o el sexo cargado.',
      );
      expect((madre.body as Detalles).detalles?.[0]?.campo).toBe('tipo');
      const padre = await esperarError(
        prueba.pedir('post', `/pacientes/${nino}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: mujer, tipo: 'padre' },
        }),
        400,
        'datos_invalidos',
      );
      expect((padre.body as Detalles).mensaje).toBe(
        'Padre tiene que ser un paciente de sexo masculino. Revisá el vínculo o el sexo cargado.',
      );
      expect((await fichaApi(prueba, tRecepcion, nino)).relaciones).toEqual([]);
    });

    it('consigo mismo, par repetido, familiar inactivo o inexistente', async () => {
      const uno = await paciente(prueba, a.clinicaId, { nombres: 'Uno' });
      const dos = await paciente(prueba, a.clinicaId, { nombres: 'Dos' });
      const inactivo = await paciente(prueba, a.clinicaId, { nombres: 'Inactivo', activo: false });
      await esperarError(
        prueba.pedir('post', `/pacientes/${uno}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: uno, tipo: 'hermano' },
        }),
        400,
        'datos_invalidos',
      );
      await vinculo(prueba, a.clinicaId, uno, dos, 'hermano');
      const repetido = await esperarError(
        prueba.pedir('post', `/pacientes/${dos}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: uno, tipo: 'hermano' },
        }),
        409,
        'conflicto',
      );
      expect((repetido.body as Detalles).mensaje).toMatch(/ya están vinculados/);
      const conInactivo = await esperarError(
        prueba.pedir('post', `/pacientes/${uno}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: inactivo, tipo: 'pareja' },
        }),
        409,
        'conflicto',
      );
      expect((conInactivo.body as Detalles).mensaje).toMatch(/Reactivá/);
      await esperarError(
        prueba.pedir('post', `/pacientes/${uno}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: '00000000-0000-4000-8000-000000000004', tipo: 'otro' },
        }),
        404,
        'no_encontrado',
      );
      await esperarError(
        prueba.pedir('post', `/pacientes/${uno}/relaciones`, {
          token: tRecepcion,
          cuerpo: { familiarId: dos, tipo: 'primo' },
        }),
        400,
        'datos_invalidos',
      );
    });
  });

  describe('desactivar y reactivar', () => {
    it('desactiva con motivo, reactiva y borra el motivo', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Mudado' });
      const baja = segun(
        pacienteSchema,
        (
          await prueba
            .pedir('post', `/pacientes/${id}/desactivar`, {
              token: dueno,
              cuerpo: { motivo: '  Se mudó a otra ciudad  ' },
            })
            .expect(200)
        ).body,
      );
      expect(baja).toMatchObject({ activo: false, motivoBaja: 'Se mudó a otra ciudad' });
      await esperarError(
        prueba.pedir('post', `/pacientes/${id}/desactivar`, {
          token: dueno,
          cuerpo: { motivo: 'Otra vez' },
        }),
        409,
        'conflicto',
      );
      const alta = segun(
        pacienteSchema,
        (await prueba.pedir('post', `/pacientes/${id}/reactivar`, { token: dueno }).expect(200))
          .body,
      );
      expect(alta).toMatchObject({ activo: true, motivoBaja: null });
      await esperarError(
        prueba.pedir('post', `/pacientes/${id}/reactivar`, { token: dueno }),
        409,
        'conflicto',
      );
      const eventos = (await eventosDe(prueba, a.clinicaId, id)).map((e) => e.accion);
      // Cada respuesta con la ficha deja «ver»; los 409 no dejan nada.
      expect(eventos).toEqual(['crear', 'anular', 'ver', 'editar', 'ver']);
    });

    it('sin motivo (o muy corto) → 400 y el paciente sigue activo', async () => {
      const id = await paciente(prueba, a.clinicaId, { nombres: 'Sigue' });
      for (const cuerpo of [undefined, {}, { motivo: '' }, { motivo: 'ab' }]) {
        const respuesta = await esperarError(
          prueba.pedir('post', `/pacientes/${id}/desactivar`, {
            token: dueno,
            ...(cuerpo !== undefined ? { cuerpo } : {}),
          }),
          400,
          'datos_invalidos',
        );
        if (cuerpo !== undefined) {
          expect((respuesta.body as Detalles).detalles?.[0]?.campo).toBe('motivo');
        }
      }
      expect((await fichaApi(prueba, dueno, id)).activo).toBe(true);
    });
  });

  describe('lista y buscador', () => {
    let c: Clinica;
    let token: string;
    let jose: string;

    beforeAll(async () => {
      c = await crearClinica(prueba, { sedes: 1 });
      token = await c.dueno.token();
      jose = await paciente(prueba, c.clinicaId, {
        nombres: 'José',
        apellidos: 'González Peña',
        ci: '4.123.456',
        telefono: '0981 123 456',
        fechaNac: `${String(anioActual - 5)}-02-01`,
      });
      await paciente(prueba, c.clinicaId, { nombres: 'Ana', apellidos: 'Acosta' });
      await paciente(prueba, c.clinicaId, { nombres: 'Bruno', apellidos: 'Benítez' });
      await paciente(prueba, c.clinicaId, {
        nombres: 'Gonzalo',
        apellidos: 'Zárate',
        activo: false,
      });
      await alerta(prueba, c.clinicaId, jose);
    });

    const buscar = async (q: string): Promise<string[]> => {
      const r = await prueba
        .pedir('get', `/buscar?q=${encodeURIComponent(q)}`, { token })
        .expect(200);
      return segun(resultadoBuscarSchema, r.body).pacientes.map((p) => p.id);
    };

    it('sin tildes ni mayúsculas, CI con o sin puntos, teléfono en cualquier formato', async () => {
      for (const q of [
        'gonzalez',
        'GONZÁLEZ',
        'gonzález peña',
        'jose gonz',
        '4.123.456',
        '4123456',
        '0981 123 456',
        '0981123456',
        '+595 981 123456',
        '595981123456',
        '981-123-456',
      ]) {
        expect({ q, ids: await buscar(q) }).toEqual({ q, ids: [jose] });
      }
    });

    it('con menos de 2 caracteres devuelve una lista vacía', async () => {
      expect(await buscar('')).toEqual([]);
      expect(await buscar('j')).toEqual([]);
      expect(await buscar('   g   ')).toEqual([]);
      const r = await prueba.pedir('get', '/buscar', { token }).expect(200);
      expect(r.body).toEqual({ pacientes: [] });
    });

    it('el buscador no muestra inactivos; la lista sí con el filtro inactivos', async () => {
      expect(await buscar('gonza')).toEqual([jose]);
      const inactivos = segun(
        paginaPacientesSchema,
        (await prueba.pedir('get', '/pacientes?filtro=inactivos', { token }).expect(200)).body,
      );
      expect(inactivos.items.map((p) => p.nombres)).toEqual(['Gonzalo']);
    });

    it('lista ordenada por apellidos con cursor, filtros y búsqueda', async () => {
      const p1 = segun(
        paginaPacientesSchema,
        (await prueba.pedir('get', '/pacientes?limite=2', { token }).expect(200)).body,
      );
      expect(p1.items.map((p) => p.apellidos)).toEqual(['Acosta', 'Benítez']);
      expect(p1.siguienteCursor).not.toBeNull();
      const p2 = segun(
        paginaPacientesSchema,
        (
          await prueba
            .pedir('get', `/pacientes?limite=2&cursor=${String(p1.siguienteCursor)}`, { token })
            .expect(200)
        ).body,
      );
      expect(p2.items.map((p) => p.apellidos)).toEqual(['González Peña']);
      expect(p2.siguienteCursor).toBeNull();
      expect(p2.items[0]).toMatchObject({ pediatrico: true, conAlerta: true, ci: '4123456' });

      const ped = segun(
        paginaPacientesSchema,
        (await prueba.pedir('get', '/pacientes?filtro=pediatricos', { token }).expect(200)).body,
      );
      expect(ped.items.map((p) => p.id)).toEqual([jose]);
      const conAlerta = segun(
        paginaPacientesSchema,
        (await prueba.pedir('get', '/pacientes?filtro=con_alerta', { token }).expect(200)).body,
      );
      expect(conAlerta.items.map((p) => p.id)).toEqual([jose]);
      const q = segun(
        paginaPacientesSchema,
        (await prueba.pedir('get', '/pacientes?q=4.123.456', { token }).expect(200)).body,
      );
      expect(q.items.map((p) => p.id)).toEqual([jose]);
    });

    it('cursor, filtro o límite inválidos → 400', async () => {
      await esperarError(
        prueba.pedir('get', '/pacientes?cursor=00000000-0000-4000-8000-000000000005', { token }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('get', '/pacientes?cursor=cualquiera', { token }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('get', '/pacientes?filtro=con_saldo', { token }),
        400,
        'datos_invalidos',
      );
      await esperarError(
        prueba.pedir('get', '/pacientes?limite=500', { token }),
        400,
        'datos_invalidos',
      );
    });

    it('con muchos pacientes responde rápido', async () => {
      const m = await crearClinica(prueba, { sedes: 1 });
      const t = await m.dueno.token();
      await comoSistema(
        prueba.admin,
        m.clinicaId,
        `insert into app.paciente (clinica_id, nombres, apellidos, ci, telefono)
         select $1, 'Nombre ' || g,
                (array['González', 'Benítez', 'Acosta', 'Peña', 'Ramírez'])[1 + g % 5] || ' ' || g,
                (1000000 + g)::text, '+595981' || lpad(g::text, 6, '0')
         from generate_series(1, 5000) g`,
        [m.clinicaId],
      );
      // Calentar (planes, conexiones) y medir.
      await prueba.pedir('get', '/buscar?q=gonzalez', { token: t }).expect(200);
      const casos = ['gonzalez 123', 'benitez', '1004321', '0981 004 321', 'nombre 4999'];
      for (const q of casos) {
        const inicio = performance.now();
        const r = await prueba
          .pedir('get', `/buscar?q=${encodeURIComponent(q)}`, { token: t })
          .expect(200);
        const ms = performance.now() - inicio;
        expect(segun(resultadoBuscarSchema, r.body).pacientes.length).toBeGreaterThan(0);
        expect({ q, rapido: ms < 1500 }).toEqual({ q, rapido: true });
      }
      const inicio = performance.now();
      const r = await prueba
        .pedir('get', '/pacientes?q=ramirez&limite=50', { token: t })
        .expect(200);
      expect(segun(paginaPacientesSchema, r.body).items).toHaveLength(50);
      expect(performance.now() - inicio).toBeLessThan(1500);
    });
  });
});
