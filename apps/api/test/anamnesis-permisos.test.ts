/**
 * Anamnesis (Sprint 4): matriz de permisos de las 7 rutas con los roles de sistema tal como los
 * crea la base, 401 sin sesión, 404 con pacientes de otra clínica (y una versión de otra clínica no
 * se ve), y el catálogo de cada clínica aislado.
 */
import { randomUUID } from 'node:crypto';
import { crearAnamnesisDePrueba } from '@conecta/db/pruebas';
import {
  anamnesisSchema,
  catalogoPreguntasSchema,
  paginaHistorialSchema,
  RUTAS_API,
  versionesAnamnesisSchema,
  type Pregunta,
  type RolSistema,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { configLocal } from './archivos-ayudas.js';
import { cuerpoAnamnesis } from './anamnesis-ayudas.js';
import {
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';
import { paciente } from './pacientes-ayudas.js';

type Metodo = 'get' | 'post' | 'put';

const ROLES: RolSistema[] = ['dueno', 'administracion', 'odontologo', 'asistente', 'recepcion'];

interface Caso {
  ruta: string;
  metodo: Metodo;
  preparar: (clinicaId: string) => Promise<{ ruta: string; cuerpo?: object }>;
  estadoOk: number;
  esquema: z.ZodType;
  pueden: RolSistema[];
  /** Ruta con un paciente (para la prueba de otra clínica). */
  conPaciente: boolean;
}

let prueba: Prueba;
let borrarDirectorio: () => Promise<void>;
let a: Clinica;
let b: Clinica;
let catalogoA: Pregunta[];
const tokens = {} as Record<RolSistema, string>;

beforeAll(async () => {
  const local = await configLocal();
  borrarDirectorio = local.borrar;
  prueba = await crearPrueba({ config: { archivos: local.archivos } });
  [a, b] = await Promise.all([
    crearClinica(prueba, { sedes: 1 }),
    crearClinica(prueba, { sedes: 1 }),
  ]);
  tokens.dueno = await a.dueno.token();
  for (const rol of ROLES.filter((r) => r !== 'dueno')) {
    tokens[rol] = await (await crearPersona(prueba, a.clinicaId, { rol })).token();
  }
  const respuesta = await prueba
    .pedir('get', '/anamnesis/preguntas/catalogo', { token: tokens.dueno })
    .expect(200);
  catalogoA = segun(catalogoPreguntasSchema, respuesta.body).preguntas;
});

afterAll(async () => {
  await prueba.cerrar();
  await borrarDirectorio();
});

const conVersion = async (clinicaId: string) => {
  const id = await paciente(prueba, clinicaId);
  await crearAnamnesisDePrueba(prueba.admin, { clinicaId, pacienteId: id });
  return id;
};

const CASOS: Caso[] = [
  {
    ruta: 'GET /anamnesis/preguntas',
    metodo: 'get',
    preparar: () => Promise.resolve({ ruta: '/anamnesis/preguntas' }),
    estadoOk: 200,
    esquema: catalogoPreguntasSchema,
    pueden: ['dueno', 'odontologo', 'asistente'],
    conPaciente: false,
  },
  {
    ruta: 'GET /anamnesis/preguntas/catalogo',
    metodo: 'get',
    preparar: () => Promise.resolve({ ruta: '/anamnesis/preguntas/catalogo' }),
    estadoOk: 200,
    esquema: catalogoPreguntasSchema,
    pueden: ['dueno', 'administracion'],
    conPaciente: false,
  },
  {
    ruta: 'PUT /anamnesis/preguntas',
    metodo: 'put',
    preparar: () =>
      Promise.resolve({ ruta: '/anamnesis/preguntas', cuerpo: { preguntas: catalogoA } }),
    estadoOk: 200,
    esquema: catalogoPreguntasSchema,
    pueden: ['dueno', 'administracion'],
    conPaciente: false,
  },
  {
    ruta: 'GET /pacientes/:id/anamnesis',
    metodo: 'get',
    preparar: async (c) => ({ ruta: `/pacientes/${await conVersion(c)}/anamnesis` }),
    estadoOk: 200,
    esquema: versionesAnamnesisSchema,
    pueden: ['dueno', 'odontologo', 'asistente'],
    conPaciente: true,
  },
  {
    ruta: 'POST /pacientes/:id/anamnesis',
    metodo: 'post',
    preparar: async (c) => ({
      ruta: `/pacientes/${await paciente(prueba, c)}/anamnesis`,
      cuerpo: cuerpoAnamnesis(),
    }),
    estadoOk: 201,
    esquema: anamnesisSchema,
    pueden: ['dueno', 'odontologo'],
    conPaciente: true,
  },
  {
    ruta: 'GET /pacientes/:id/anamnesis/:version',
    metodo: 'get',
    preparar: async (c) => ({ ruta: `/pacientes/${await conVersion(c)}/anamnesis/vigente` }),
    estadoOk: 200,
    esquema: anamnesisSchema,
    pueden: ['dueno', 'odontologo', 'asistente'],
    conPaciente: true,
  },
  {
    ruta: 'GET /pacientes/:id/historial',
    metodo: 'get',
    preparar: async (c) => ({ ruta: `/pacientes/${await conVersion(c)}/historial` }),
    estadoOk: 200,
    esquema: paginaHistorialSchema,
    pueden: ROLES,
    conPaciente: true,
  },
];

describe('anamnesis: permisos y aislamiento', () => {
  it('la matriz cubre exactamente las rutas del Sprint 4 del contrato', () => {
    const delSprint = RUTAS_API.filter(
      (r) => r.includes('/anamnesis') || r.includes('/historial'),
    ).map((r) => r.split(' ').slice(0, 2).join(' '));
    expect(CASOS.map((c) => c.ruta).sort()).toEqual([...delSprint].sort());
  });

  for (const caso of CASOS) {
    describe(caso.ruta, () => {
      it('401 sin sesión', async () => {
        const { ruta, cuerpo } = await caso.preparar(a.clinicaId);
        await esperarError(prueba.pedir(caso.metodo, ruta, { cuerpo }), 401, 'no_autenticado');
      });

      for (const rol of ROLES) {
        const puede = caso.pueden.includes(rol);
        it(`${rol}: ${puede ? String(caso.estadoOk) : '403'}`, async () => {
          const { ruta, cuerpo } = await caso.preparar(a.clinicaId);
          const pedido = prueba.pedir(caso.metodo, ruta, { token: tokens[rol], cuerpo });
          if (!puede) {
            await esperarError(pedido, 403, 'sin_permiso');
            return;
          }
          const respuesta = await pedido;
          expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(caso.estadoOk);
          segun(caso.esquema, respuesta.body);
        });
      }

      if (caso.conPaciente) {
        it('404 con un paciente de otra clínica (y con uno que no existe)', async () => {
          const deB = await caso.preparar(b.clinicaId);
          await esperarError(
            prueba.pedir(caso.metodo, deB.ruta, { token: tokens.dueno, cuerpo: deB.cuerpo }),
            404,
            'no_encontrado',
          );
          const inexistente = deB.ruta.replace(/\/pacientes\/[^/]+/, `/pacientes/${randomUUID()}`);
          await esperarError(
            prueba.pedir(caso.metodo, inexistente, { token: tokens.dueno, cuerpo: deB.cuerpo }),
            404,
            'no_encontrado',
          );
        });
      }
    });
  }

  it('el catálogo es de cada clínica: lo que cambia A no toca a B', async () => {
    const tokenB = await b.dueno.token();
    const antesB = segun(
      catalogoPreguntasSchema,
      (await prueba.pedir('get', '/anamnesis/preguntas/catalogo', { token: tokenB }).expect(200))
        .body,
    ).preguntas;
    const nueva: Pregunta = {
      codigo: `solo_a_${randomUUID().slice(0, 8).replace(/-/g, '')}`,
      seccion: 5,
      orden: 900,
      texto: '¿Pregunta solo de la clínica A?',
      tipo: 'si_no',
      opciones: [],
      alertaSiSi: null,
      conDetalle: false,
      unidad: null,
      minimo: null,
      maximo: null,
      soloSexo: null,
      obligatoria: false,
      activa: true,
    };
    await prueba
      .pedir('put', '/anamnesis/preguntas', {
        token: tokens.dueno,
        cuerpo: { preguntas: [...catalogoA, nueva] },
      })
      .expect(200);
    const despuesB = segun(
      catalogoPreguntasSchema,
      (await prueba.pedir('get', '/anamnesis/preguntas/catalogo', { token: tokenB }).expect(200))
        .body,
    ).preguntas;
    expect(despuesB).toEqual(antesB);
    expect(despuesB.some((p) => p.codigo === nueva.codigo)).toBe(false);
  });
});
