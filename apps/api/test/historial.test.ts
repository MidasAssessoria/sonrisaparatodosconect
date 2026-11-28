/**
 * Historial del paciente (Sprint 4): línea de tiempo del más nuevo al más viejo, paginación con
 * cursor estable, eventos clínicos (anamnesis, alertas) solo con `ficha_clinica:ver`, y errores de
 * la consulta.
 */
import { errorApiSchema, paginaHistorialSchema, pacienteSchema } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ALERGIA_PENICILINA, guardarApi } from './anamnesis-ayudas.js';
import { configLocal } from './archivos-ayudas.js';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';
import { paciente, vinculo } from './pacientes-ayudas.js';

type Evento = z.infer<typeof paginaHistorialSchema>['eventos'][number];

let prueba: Prueba;
let borrarDirectorio: () => Promise<void>;
let A: Clinica;
let tOdo: string;
let tRecepcion: string;
let pid: string;

beforeAll(async () => {
  const local = await configLocal();
  borrarDirectorio = local.borrar;
  prueba = await crearPrueba({ config: { archivos: local.archivos } });
  A = await crearClinica(prueba, { sedes: 1 });
  tOdo = await (await crearPersona(prueba, A.clinicaId, { rol: 'odontologo' })).token();
  tRecepcion = await (await crearPersona(prueba, A.clinicaId, { rol: 'recepcion' })).token();

  // Alta por recepción, dos ediciones, un vínculo, dos versiones y una alerta manual.
  const alta = await prueba
    .pedir('post', '/pacientes', {
      token: tRecepcion,
      cuerpo: { nombres: 'Marta', apellidos: 'Ríos', sexo: 'F', fechaNac: '1985-02-02' },
    })
    .expect(201);
  pid = segun(pacienteSchema, alta.body).id;
  await prueba
    .pedir('patch', `/pacientes/${pid}`, { token: tRecepcion, cuerpo: { ciudad: 'Luque' } })
    .expect(200);
  await prueba
    .pedir('patch', `/pacientes/${pid}`, { token: tRecepcion, cuerpo: { telefono: '0981123456' } })
    .expect(200);
  const hija = await paciente(prueba, A.clinicaId, { nombres: 'Lucía', sexo: 'F' });
  await vinculo(prueba, A.clinicaId, pid, hija, 'hijo');
  await guardarApi(prueba, tOdo, pid, { respuestas: [ALERGIA_PENICILINA] });
  await guardarApi(prueba, tOdo, pid, { versionBase: 1 });
  await prueba
    .pedir('post', `/pacientes/${pid}/alertas`, {
      token: tOdo,
      cuerpo: { tipo: 'condicion', texto: 'Hipertensión controlada' },
    })
    .expect(201);
});

afterAll(async () => {
  await prueba.cerrar();
  await borrarDirectorio();
});

async function pagina(token: string, consulta = '') {
  const respuesta = await prueba.pedir('get', `/pacientes/${pid}/historial${consulta}`, { token });
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
  return segun(paginaHistorialSchema, respuesta.body);
}

async function todas(token: string, limite: number): Promise<Evento[][]> {
  const paginas: Evento[][] = [];
  let cursor: string | null = null;
  do {
    const consulta: string = `?limite=${String(limite)}${cursor ? `&cursor=${cursor}` : ''}`;
    const p = await pagina(token, consulta);
    paginas.push(p.eventos);
    cursor = p.siguienteCursor;
  } while (cursor && paginas.length < 50);
  return paginas;
}

describe('historial del paciente', () => {
  it('con ficha clínica: todos los eventos, del más nuevo al más viejo', async () => {
    const { eventos, siguienteCursor } = await pagina(tOdo);
    expect(siguienteCursor).toBeNull();
    expect(eventos.map((e) => e.tipo)).toEqual([
      'alerta_creada',
      'anamnesis',
      'anamnesis',
      'vinculo_agregado',
      'datos_editados',
      'datos_editados',
      'alta',
    ]);
    const fechas = eventos.map((e) => e.fecha);
    expect(fechas).toEqual([...fechas].sort().reverse());
    expect(eventos[2]).toMatchObject({
      tipo: 'anamnesis',
      referencia: '1',
      descripcion: 'Se registró la anamnesis (versión 1). Firmó Ana Benítez. Deja 1 alerta médica.',
    });
    expect(eventos[0]?.descripcion).toBe('Se cargó la alerta «Hipertensión controlada».');
    expect(eventos[3]).toMatchObject({ referencia: expect.any(String) as string });
    expect(eventos[6]?.autor).toEqual(expect.any(String));
  });

  it('recepción: sin eventos clínicos ni su texto', async () => {
    const respuesta = await prueba.pedir('get', `/pacientes/${pid}/historial`, {
      token: tRecepcion,
    });
    expect(respuesta.status).toBe(200);
    const { eventos } = segun(paginaHistorialSchema, respuesta.body);
    expect(eventos.map((e) => e.tipo)).toEqual([
      'vinculo_agregado',
      'datos_editados',
      'datos_editados',
      'alta',
    ]);
    const texto = JSON.stringify(respuesta.body);
    for (const clinico of ['anamnesis', 'Hipertensión', 'alerta', 'penicilina']) {
      expect(texto).not.toContain(clinico);
    }
  });

  it('paginación: las páginas juntas son la lista completa, sin repetidos', async () => {
    const completa = (await pagina(tOdo, '?limite=100')).eventos;
    const paginas = await todas(tOdo, 2);
    expect(paginas.map((p) => p.length)).toEqual([2, 2, 2, 1]);
    expect(paginas.flat()).toEqual(completa);
    const recepcion = await todas(tRecepcion, 3);
    expect(recepcion.map((p) => p.length)).toEqual([3, 1]);
  });

  it('el cursor es estable aunque lleguen eventos nuevos', async () => {
    const primera = await pagina(tOdo, '?limite=3');
    expect(primera.siguienteCursor).not.toBeNull();
    await prueba
      .pedir('patch', `/pacientes/${pid}`, { token: tRecepcion, cuerpo: { ciudad: 'Areguá' } })
      .expect(200);
    const segunda = await pagina(tOdo, `?limite=3&cursor=${primera.siguienteCursor ?? ''}`);
    const claves = (es: Evento[]) => es.map((e) => `${e.tipo}|${e.fecha}|${e.descripcion}`);
    for (const clave of claves(segunda.eventos)) {
      expect(claves(primera.eventos)).not.toContain(clave);
    }
    expect(segunda.eventos.map((e) => e.tipo)).toEqual([
      'vinculo_agregado',
      'datos_editados',
      'datos_editados',
    ]);
    // El evento nuevo aparece arriba al volver a empezar.
    const deNuevo = await pagina(tOdo, '?limite=1');
    expect(deNuevo.eventos[0]?.tipo).toBe('datos_editados');
  });

  it('400: cursor adulterado, límite fuera de rango', async () => {
    const malo = await esperarError(
      prueba.pedir('get', `/pacientes/${pid}/historial?cursor=aGFzdGFsdWVnbw`, { token: tOdo }),
      400,
      'datos_invalidos',
    );
    const cuerpo = segun(errorApiSchema, malo.body);
    expect(cuerpo.detalles?.[0]?.campo).toBe('cursor');
    expect(cuerpo.mensaje).toContain('historial');
    for (const limite of ['0', '101', 'muchos']) {
      const r = await esperarError(
        prueba.pedir('get', `/pacientes/${pid}/historial?limite=${limite}`, { token: tOdo }),
        400,
        'datos_invalidos',
      );
      expect(segun(errorApiSchema, r.body).detalles?.[0]?.campo).toBe('limite');
    }
  });
});
