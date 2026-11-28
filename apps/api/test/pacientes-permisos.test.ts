/**
 * Pacientes (Sprint 3): matriz de permisos de las 12 rutas con los roles de sistema tal como los
 * crea la base (`app.crear_clinica`, 0015), y aislamiento entre clínicas (ids de otra clínica → 404
 * en todo; `clinica_id` del cuerpo ignorado).
 */
import { randomUUID } from 'node:crypto';
import {
  alertaManualSchema,
  paginaPacientesSchema,
  pacienteSchema,
  relacionSchema,
  resultadoBuscarSchema,
  RUTAS_API,
  type RolSistema,
} from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';
import { alerta, fichaApi, filaDe, paciente, vinculo } from './pacientes-ayudas.js';

type Metodo = 'get' | 'post' | 'patch' | 'put' | 'delete';

const ROLES: RolSistema[] = ['dueno', 'administracion', 'odontologo', 'asistente', 'recepcion'];

interface Caso {
  /** Como figura en `RUTAS_API` (método y ruta). */
  ruta: string;
  metodo: Metodo;
  /** Arma la ruta concreta y el cuerpo con datos nuevos de la clínica. */
  preparar: (clinicaId: string) => Promise<{ ruta: string; cuerpo?: object }>;
  estadoOk: number;
  esquema: z.ZodType | null;
  /** Roles que pueden, según la matriz real de la base. */
  pueden: RolSistema[];
}

describe('pacientes: permisos y aislamiento', () => {
  let prueba: Prueba;
  let a: Clinica;
  let b: Clinica;
  const tokens = {} as Record<RolSistema, string>;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
    b = await crearClinica(prueba, { sedes: 1 });
    tokens.dueno = await a.dueno.token();
    for (const rol of ROLES.filter((r) => r !== 'dueno')) {
      tokens[rol] = await (await crearPersona(prueba, a.clinicaId, { rol })).token();
    }
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  const nuevo = (clinicaId: string, extra: Parameters<typeof paciente>[2] = {}) =>
    paciente(prueba, clinicaId, extra);

  const CASOS: Caso[] = [
    {
      ruta: 'GET /pacientes',
      metodo: 'get',
      preparar: () => Promise.resolve({ ruta: '/pacientes' }),
      estadoOk: 200,
      esquema: paginaPacientesSchema,
      pueden: ROLES,
    },
    {
      ruta: 'POST /pacientes',
      metodo: 'post',
      preparar: () => Promise.resolve({ ruta: '/pacientes', cuerpo: { nombres: 'Alta' } }),
      estadoOk: 201,
      esquema: pacienteSchema,
      pueden: ['dueno', 'odontologo', 'recepcion'],
    },
    {
      ruta: 'GET /pacientes/:id',
      metodo: 'get',
      preparar: async (c) => ({ ruta: `/pacientes/${await nuevo(c)}` }),
      estadoOk: 200,
      esquema: pacienteSchema,
      pueden: ROLES,
    },
    {
      ruta: 'PATCH /pacientes/:id',
      metodo: 'patch',
      preparar: async (c) => ({
        ruta: `/pacientes/${await nuevo(c)}`,
        cuerpo: { ciudad: 'Luque' },
      }),
      estadoOk: 200,
      esquema: pacienteSchema,
      pueden: ['dueno', 'odontologo', 'recepcion'],
    },
    {
      ruta: 'POST /pacientes/:id/desactivar',
      metodo: 'post',
      preparar: async (c) => ({
        ruta: `/pacientes/${await nuevo(c)}/desactivar`,
        cuerpo: { motivo: 'Prueba de permisos' },
      }),
      estadoOk: 200,
      esquema: pacienteSchema,
      pueden: ['dueno'],
    },
    {
      ruta: 'POST /pacientes/:id/reactivar',
      metodo: 'post',
      preparar: async (c) => ({
        ruta: `/pacientes/${await nuevo(c, { activo: false })}/reactivar`,
      }),
      estadoOk: 200,
      esquema: pacienteSchema,
      pueden: ['dueno'],
    },
    {
      ruta: 'GET /buscar',
      metodo: 'get',
      preparar: () => Promise.resolve({ ruta: '/buscar?q=alta' }),
      estadoOk: 200,
      esquema: resultadoBuscarSchema,
      pueden: ROLES,
    },
    {
      ruta: 'POST /pacientes/:id/relaciones',
      metodo: 'post',
      preparar: async (c) => ({
        ruta: `/pacientes/${await nuevo(c)}/relaciones`,
        cuerpo: { familiarId: await nuevo(c), tipo: 'hermano' },
      }),
      estadoOk: 201,
      esquema: relacionSchema,
      pueden: ['dueno', 'odontologo', 'recepcion'],
    },
    {
      ruta: 'PATCH /relaciones/:id',
      metodo: 'patch',
      preparar: async (c) => ({
        ruta: `/relaciones/${await vinculo(prueba, c, await nuevo(c), await nuevo(c), 'hermano')}`,
        cuerpo: { esResponsablePago: true },
      }),
      estadoOk: 200,
      esquema: relacionSchema,
      pueden: ['dueno', 'odontologo', 'recepcion'],
    },
    {
      ruta: 'DELETE /relaciones/:id',
      metodo: 'delete',
      preparar: async (c) => ({
        ruta: `/relaciones/${await vinculo(prueba, c, await nuevo(c), await nuevo(c), 'pareja')}`,
      }),
      estadoOk: 204,
      esquema: null,
      pueden: ['dueno', 'odontologo', 'recepcion'],
    },
    {
      ruta: 'POST /pacientes/:id/alertas',
      metodo: 'post',
      preparar: async (c) => ({
        ruta: `/pacientes/${await nuevo(c)}/alertas`,
        cuerpo: { tipo: 'alergia', texto: 'Alergia al látex' },
      }),
      estadoOk: 201,
      esquema: alertaManualSchema,
      pueden: ['dueno', 'odontologo'],
    },
    {
      ruta: 'PATCH /alertas/:id',
      metodo: 'patch',
      preparar: async (c) => ({
        ruta: `/alertas/${await alerta(prueba, c, await nuevo(c))}`,
        cuerpo: { activa: false },
      }),
      estadoOk: 200,
      esquema: alertaManualSchema,
      pueden: ['dueno', 'odontologo'],
    },
  ];

  it('los casos cubren las 12 rutas de pacientes del contrato, con el permiso declarado', () => {
    const delContrato = RUTAS_API.filter((r) =>
      /^(GET|POST|PATCH|DELETE) \/(pacientes|buscar|relaciones|alertas)\b/.test(r),
    ).map((r) => r.split(' ').slice(0, 2).join(' '));
    expect(CASOS.map((c) => c.ruta).sort()).toEqual([...delContrato].sort());
    expect(delContrato).toHaveLength(12);
  });

  for (const caso of CASOS) {
    for (const rol of ROLES) {
      const puede = caso.pueden.includes(rol);
      it(`${caso.ruta}: ${rol} ${puede ? 'puede' : 'no puede'}`, async () => {
        const { ruta, cuerpo } = await caso.preparar(a.clinicaId);
        const pedido = prueba.pedir(caso.metodo, ruta, {
          token: tokens[rol],
          ...(cuerpo ? { cuerpo } : {}),
        });
        if (!puede) {
          await esperarError(pedido, 403, 'sin_permiso');
          return;
        }
        const respuesta = await pedido;
        expect({ rol, estado: respuesta.status }).toEqual({ rol, estado: caso.estadoOk });
        if (caso.esquema) segun(caso.esquema, respuesta.body);
      });
    }
  }

  it('lo que un rol no puede hacer no deja nada hecho', async () => {
    const id = await nuevo(a.clinicaId, { nombres: 'Intacto' });
    await esperarError(
      prueba.pedir('post', `/pacientes/${id}/desactivar`, {
        token: tokens.recepcion,
        cuerpo: { motivo: 'No debería' },
      }),
      403,
      'sin_permiso',
    );
    await esperarError(
      prueba.pedir('post', `/pacientes/${id}/alertas`, {
        token: tokens.recepcion,
        cuerpo: { tipo: 'condicion', texto: 'No debería' },
      }),
      403,
      'sin_permiso',
    );
    const ficha = await fichaApi(prueba, tokens.dueno, id);
    expect(ficha).toMatchObject({ activo: true, alertas: [] });
  });

  describe('aislamiento entre clínicas', () => {
    let deB: string;
    let relacionB: string;
    let alertaB: string;

    beforeAll(async () => {
      deB = await nuevo(b.clinicaId, { nombres: 'Secreta', apellidos: 'De Otra', ci: '5123456' });
      relacionB = await vinculo(prueba, b.clinicaId, deB, await nuevo(b.clinicaId), 'hermano');
      alertaB = await alerta(prueba, b.clinicaId, deB);
    });

    it('ids de otra clínica → 404 en todas las rutas con id', async () => {
      const t = tokens.dueno;
      const propio = await nuevo(a.clinicaId);
      const pedidos: [Metodo, string, object | undefined][] = [
        ['get', `/pacientes/${deB}`, undefined],
        ['patch', `/pacientes/${deB}`, { ciudad: 'Luque' }],
        ['patch', `/pacientes/${deB}`, { ci: '5123456', confirmarCiDuplicada: true }],
        ['post', `/pacientes/${deB}/desactivar`, { motivo: 'Desde otra clínica' }],
        ['post', `/pacientes/${deB}/reactivar`, undefined],
        ['post', `/pacientes/${deB}/relaciones`, { familiarId: propio, tipo: 'hermano' }],
        ['post', `/pacientes/${propio}/relaciones`, { familiarId: deB, tipo: 'hermano' }],
        ['patch', `/relaciones/${relacionB}`, { esTutorLegal: true }],
        ['delete', `/relaciones/${relacionB}`, undefined],
        ['post', `/pacientes/${deB}/alertas`, { tipo: 'alergia', texto: 'Desde otra clínica' }],
        ['patch', `/alertas/${alertaB}`, { activa: false }],
      ];
      for (const [metodo, ruta, cuerpo] of pedidos) {
        const respuesta = await prueba.pedir(metodo, ruta, {
          token: t,
          ...(cuerpo ? { cuerpo } : {}),
        });
        expect({
          metodo,
          ruta,
          estado: respuesta.status,
          codigo: (respuesta.body as { codigo?: string }).codigo,
        }).toEqual({ metodo, ruta, estado: 404, codigo: 'no_encontrado' });
        expect(JSON.stringify(respuesta.body)).not.toMatch(/Secreta|5123456/);
      }
      // En B no cambió nada.
      expect(await filaDe(prueba, b.clinicaId, 'paciente', deB)).toMatchObject({
        activo: true,
        ciudad: null,
      });
      expect(await filaDe(prueba, b.clinicaId, 'paciente_relacion', relacionB)).toMatchObject({
        deleted_at: null,
        es_tutor_legal: false,
      });
      expect(await filaDe(prueba, b.clinicaId, 'paciente_alerta', alertaB)).toMatchObject({
        activa: true,
      });
      const { rows } = await comoSistema<{ n: string }>(
        prueba.admin,
        b.clinicaId,
        'select count(*) as n from app.paciente_alerta where paciente_id = $1',
        [deB],
      );
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it('la lista, el buscador y la CI duplicada no ven pacientes de otra clínica', async () => {
      const t = tokens.recepcion;
      const lista = segun(
        paginaPacientesSchema,
        (await prueba.pedir('get', '/pacientes?q=secreta', { token: t }).expect(200)).body,
      );
      expect(lista.items).toEqual([]);
      const buscar = segun(
        resultadoBuscarSchema,
        (await prueba.pedir('get', '/buscar?q=5123456', { token: t }).expect(200)).body,
      );
      expect(buscar.pacientes).toEqual([]);
      // La misma CI que un paciente de B no es duplicada en A.
      const alta = segun(
        pacienteSchema,
        (
          await prueba
            .pedir('post', '/pacientes', { token: t, cuerpo: { nombres: 'Propia', ci: '5123456' } })
            .expect(201)
        ).body,
      );
      expect(alta.ci).toBe('5123456');
    });

    it('clinica_id en el cuerpo se ignora: el paciente queda en la clínica del token', async () => {
      const respuesta = await prueba
        .pedir('post', '/pacientes', {
          token: tokens.recepcion,
          cuerpo: {
            nombres: `Colado ${randomUUID().slice(0, 6)}`,
            clinica_id: b.clinicaId,
            clinicaId: b.clinicaId,
          },
        })
        .expect(201);
      const alta = segun(pacienteSchema, respuesta.body);
      expect(await filaDe(prueba, a.clinicaId, 'paciente', alta.id)).toMatchObject({
        clinica_id: a.clinicaId,
      });
      expect(await filaDe(prueba, b.clinicaId, 'paciente', alta.id)).toBeUndefined();

      // Tampoco se puede mover al editar.
      await prueba
        .pedir('patch', `/pacientes/${alta.id}`, {
          token: tokens.recepcion,
          cuerpo: { clinica_id: b.clinicaId, clinicaId: b.clinicaId, ciudad: 'Luque' },
        })
        .expect(200);
      expect(await filaDe(prueba, a.clinicaId, 'paciente', alta.id)).toMatchObject({
        clinica_id: a.clinicaId,
        ciudad: 'Luque',
      });
    });

    it('la cabecera X-Clinica-Id de una clínica sin membresía no da acceso', async () => {
      await esperarError(
        prueba.pedir('get', `/pacientes/${deB}`, { token: tokens.recepcion, clinica: b.clinicaId }),
        403,
        'sin_membresia',
      );
    });
  });
});
