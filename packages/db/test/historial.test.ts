/**
 * Historial del paciente (0030), como app_api: eventos y orden, descripciones, cursor estable y
 * eventos clínicos solo con ficha_clinica:ver.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bajaRelacion,
  cambiarAlerta,
  campoDeError,
  catalogoPreguntas,
  conContexto,
  crearAlerta,
  crearPaciente,
  crearRelacion,
  desactivarPaciente,
  editarPaciente,
  guardarAnamnesis,
  historialPaciente,
  reactivarPaciente,
  type EventoHistorial,
} from '../src/index.js';
import {
  crearClinicaDePrueba,
  crearFirmaDePrueba,
  crearPacienteDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, intentar, nuevoPool, rechazo, urls, valor } from './ayudas.js';

const admin = nuevoPool(urls().urlAdmin);
const api = nuevoPool(urls().urlApi);

let clinica: ClinicaDePrueba;
let otra: ClinicaDePrueba;
const usuarios = { recepcion: '', odontologo: '' };
const nombres: Record<string, string> = {};

type Quien = 'dueno' | keyof typeof usuarios;
const idDe = (quien: Quien): string => (quien === 'dueno' ? clinica.duenoId : usuarios[quien]);

function conApi<T>(quien: Quien, fn: Parameters<typeof conContexto<T>>[2]): Promise<T> {
  return conContexto(api, { clinicaId: clinica.clinicaId, usuarioId: idDe(quien) }, fn);
}

let pacienteId: string;
let familiarId: string;
let alertaId: string;
/** Todo el historial visto por el odontólogo, del más nuevo al más viejo. */
let completo: EventoHistorial[];

const historial = (quien: Quien, limite = 100) =>
  conApi(quien, (tx) => historialPaciente(tx, pacienteId, { limite }));

beforeAll(async () => {
  clinica = await crearClinicaDePrueba(admin);
  otra = await crearClinicaDePrueba(admin);
  for (const rol of ['recepcion', 'odontologo'] as const) {
    usuarios[rol] = (
      await crearUsuarioDePrueba(admin, {
        clinicaId: clinica.clinicaId,
        rol,
        nombre: `Persona ${rol}`,
      })
    ).usuarioId;
    nombres[rol] = `Persona ${rol}`;
  }
  nombres['dueno'] = await enTransaccion(admin, { usuario: clinica.duenoId }, (c) =>
    valor<string>(c, 'select nombre from app.usuario where id = $1', [clinica.duenoId]),
  );

  // La historia, una transacción por paso (cada evento con su hora).
  pacienteId = await conApi('recepcion', (tx) =>
    crearPaciente(tx, { nombres: 'Lucía', apellidos: 'Historial', sexo: 'F' }),
  );
  await conApi('recepcion', (tx) =>
    editarPaciente(tx, pacienteId, { telefono: '0981 222 333', email: 'lucia@example.com' }),
  );
  familiarId = (
    await crearPacienteDePrueba(admin, {
      clinicaId: clinica.clinicaId,
      nombres: 'Tomás',
      apellidos: 'Historial',
    })
  ).pacienteId;
  const relacion = await conApi('recepcion', (tx) =>
    crearRelacion(tx, { pacienteId, familiarId, tipo: 'hijo', esTutorLegal: true }),
  );
  alertaId = (
    await conApi('odontologo', (tx) =>
      crearAlerta(tx, pacienteId, { tipo: 'alergia', texto: 'Alergia al ibuprofeno' }),
    )
  ).id;
  await conApi('odontologo', (tx) => cambiarAlerta(tx, alertaId, false));
  const { archivoId } = await crearFirmaDePrueba(admin, {
    clinicaId: clinica.clinicaId,
    pacienteId,
  });
  await conApi('odontologo', async (tx) =>
    guardarAnamnesis(tx, pacienteId, {
      versionBase: null,
      huellaCatalogo: (await catalogoPreguntas(tx)).huella,
      respuestas: [{ codigo: 'alergias', opciones: ['penicilina'] }],
      firmante: { nombre: 'Lucía Historial', ci: null, esTutor: false },
      firmaArchivoId: archivoId,
      declaracionVeracidad: true,
    }),
  );
  await conApi('dueno', (tx) => desactivarPaciente(tx, pacienteId, 'Se mudó al interior.'));
  await conApi('dueno', (tx) => reactivarPaciente(tx, pacienteId));
  await conApi('recepcion', (tx) => bajaRelacion(tx, relacion.id, 'Error de carga'));
  completo = (await historial('odontologo')).eventos;
});

describe('historial del paciente', () => {
  it('arma la línea de tiempo del más nuevo al más viejo, con autor, descripción y referencia', () => {
    expect(completo.map((e) => [e.tipo, e.descripcion, e.autor, e.referencia])).toEqual([
      [
        'vinculo_quitado',
        'Se quitó a Tomás Historial del grupo familiar: Error de carga.',
        nombres['recepcion'],
        familiarId,
      ],
      ['reactivacion', 'Se reactivó la ficha del paciente.', nombres['dueno'], null],
      ['baja', 'Se dio de baja: Se mudó al interior.', nombres['dueno'], null],
      [
        'anamnesis',
        'Se registró la anamnesis (versión 1). Firmó Lucía Historial. Deja 1 alerta médica.',
        nombres['odontologo'],
        '1',
      ],
      [
        'alerta_desactivada',
        'Se desactivó la alerta «Alergia al ibuprofeno».',
        nombres['odontologo'],
        alertaId,
      ],
      [
        'alerta_creada',
        'Se cargó la alerta «Alergia al ibuprofeno».',
        nombres['odontologo'],
        alertaId,
      ],
      [
        'vinculo_agregado',
        'Se agregó a Tomás Historial al grupo familiar (hijo).',
        nombres['recepcion'],
        familiarId,
      ],
      ['datos_editados', 'Se editaron los datos: teléfono y correo.', nombres['recepcion'], null],
      ['alta', 'Alta del paciente.', nombres['recepcion'], null],
    ]);
    const fechas = completo.map((e) => Date.parse(e.fecha));
    expect([...fechas].sort((a, b) => b - a)).toEqual(fechas);
  });

  it('sin ficha_clinica:ver no aparece ningún evento clínico (y la auditoría tampoco los deja ver)', async () => {
    const deRecepcion = (await historial('recepcion')).eventos;
    expect(deRecepcion.map((e) => e.tipo)).toEqual([
      'vinculo_quitado',
      'reactivacion',
      'baja',
      'vinculo_agregado',
      'datos_editados',
      'alta',
    ]);
    expect(deRecepcion).toEqual(
      completo.filter(
        (e) => !['anamnesis', 'alerta_creada', 'alerta_desactivada'].includes(e.tipo),
      ),
    );
    // La política de auditoría por módulo (0023) ya los oculta, aunque la consulta no filtre.
    await enTransaccion(
      api,
      { clinica: clinica.clinicaId, usuario: usuarios.recepcion },
      async (c) => {
        expect(
          await valor(
            c,
            `select count(*)::int from app.audit_log
           where entidad in ('anamnesis', 'anamnesis_respuesta', 'paciente_alerta')`,
          ),
        ).toBe(0);
        expect(
          await valor(c, 'select count(*)::int from app.historial_paciente($1)', [pacienteId]),
        ).toBe(6);
      },
    );
  });

  it('el cursor recorre todo sin repetidos ni saltos, aunque lleguen eventos nuevos en el medio', async () => {
    const vistos: EventoHistorial[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const pagina: { eventos: EventoHistorial[]; siguienteCursor: string | null } = await conApi(
        'odontologo',
        (tx) => historialPaciente(tx, pacienteId, { cursor, limite: 2 }),
      );
      vistos.push(...pagina.eventos);
      cursor = pagina.siguienteCursor;
      paginas++;
      if (paginas === 2) {
        // Un evento nuevo entre la página 2 y la 3: no aparece más abajo.
        await conApi('recepcion', (tx) => editarPaciente(tx, pacienteId, { ciudad: 'Luque' }));
      }
    } while (cursor !== null);
    expect(paginas).toBe(5);
    expect(vistos).toEqual(completo);
    // Desde el principio, el nuevo está arriba.
    const ahora = (await historial('odontologo', 1)).eventos;
    expect(ahora.map((e) => [e.tipo, e.descripcion])).toEqual([
      ['datos_editados', 'Se editaron los datos: ciudad.'],
    ]);
  });

  it('cursor y límite inválidos, y pacientes de otra clínica', async () => {
    for (const cursor of [
      'abc',
      'x'.repeat(60),
      Buffer.from('h1:abc:def').toString('base64url'),
      '%%%%%%%%%%',
    ]) {
      try {
        await conApi('odontologo', (tx) => historialPaciente(tx, pacienteId, { cursor }));
        throw new Error(`El cursor ${cursor} pasó.`);
      } catch (error) {
        expect(campoDeError(error)).toMatchObject({
          codigoPg: '22023',
          restriccion: 'cursor_invalido',
        });
      }
    }
    await enTransaccion(
      api,
      { clinica: clinica.clinicaId, usuario: usuarios.odontologo },
      async (c) => {
        expect(
          await intentar(c, 'select * from app.historial_paciente($1, null, 0)', [pacienteId]),
        ).toMatchObject(rechazo('22023', 'historial_limite'));
        expect(
          await intentar(c, 'select * from app.historial_paciente($1, null, 1001)', [pacienteId]),
        ).toMatchObject(rechazo('22023', 'historial_limite'));
      },
    );
    // El mismo paciente desde otra clínica: nada.
    const ajeno = await conContexto(
      api,
      { clinicaId: otra.clinicaId, usuarioId: otra.duenoId },
      (tx) => historialPaciente(tx, pacienteId),
    );
    expect(ajeno).toEqual({ eventos: [], siguienteCursor: null });
  });
});
