import { randomUUID } from 'node:crypto';
import {
  paginaAuditoriaSchema,
  sedeSchema,
  sesionSchema,
  sillonSchema,
  type RolSistema,
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
import { crearSedeDePrueba } from '@conecta/db/pruebas';

type Metodo = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Caso {
  nombre: string;
  metodo: Metodo;
  /** Arma la ruta y el cuerpo (con una sede y un sillón nuevos de la clínica). */
  preparar: (sede: { sedeId: string; sillonId: string }) => { ruta: string; cuerpo?: object };
  estadoOk: number;
  esquema: z.ZodType | null;
  puede: RolSistema;
  noPuede: RolSistema;
}

const CASOS: Caso[] = [
  {
    nombre: 'GET /sedes',
    metodo: 'get',
    preparar: () => ({ ruta: '/sedes' }),
    estadoOk: 200,
    esquema: z.array(sedeSchema),
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    nombre: 'POST /sedes',
    metodo: 'post',
    preparar: () => ({ ruta: '/sedes', cuerpo: { nombre: `Sede ${randomUUID().slice(0, 8)}` } }),
    estadoOk: 201,
    esquema: sedeSchema,
    puede: 'administracion',
    noPuede: 'odontologo',
  },
  {
    nombre: 'GET /sedes/:id',
    metodo: 'get',
    preparar: (s) => ({ ruta: `/sedes/${s.sedeId}` }),
    estadoOk: 200,
    esquema: sedeSchema,
    puede: 'administracion',
    noPuede: 'asistente',
  },
  {
    nombre: 'PATCH /sedes/:id',
    metodo: 'patch',
    preparar: (s) => ({ ruta: `/sedes/${s.sedeId}`, cuerpo: { telefono: '021 555' } }),
    estadoOk: 200,
    esquema: sedeSchema,
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    nombre: 'DELETE /sedes/:id',
    metodo: 'delete',
    preparar: (s) => ({ ruta: `/sedes/${s.sedeId}`, cuerpo: { motivo: 'Prueba de permisos' } }),
    estadoOk: 204,
    esquema: null,
    puede: 'administracion',
    noPuede: 'odontologo',
  },
  {
    nombre: 'PUT /sedes/:id/horarios',
    metodo: 'put',
    preparar: (s) => ({
      ruta: `/sedes/${s.sedeId}/horarios`,
      cuerpo: { horarios: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '12:00' }] },
    }),
    estadoOk: 200,
    esquema: sedeSchema,
    puede: 'administracion',
    noPuede: 'asistente',
  },
  {
    nombre: 'POST /sedes/:id/sillones',
    metodo: 'post',
    preparar: (s) => ({ ruta: `/sedes/${s.sedeId}/sillones`, cuerpo: { nombre: 'Sillón nuevo' } }),
    estadoOk: 201,
    esquema: sillonSchema,
    puede: 'administracion',
    noPuede: 'recepcion',
  },
  {
    nombre: 'PATCH /sillones/:id',
    metodo: 'patch',
    preparar: (s) => ({ ruta: `/sillones/${s.sillonId}`, cuerpo: { nombre: 'Renombrado' } }),
    estadoOk: 200,
    esquema: sillonSchema,
    puede: 'administracion',
    noPuede: 'odontologo',
  },
  {
    nombre: 'GET /auditoria',
    metodo: 'get',
    preparar: () => ({ ruta: '/auditoria' }),
    estadoOk: 200,
    esquema: paginaAuditoriaSchema,
    puede: 'administracion',
    noPuede: 'recepcion',
  },
];

describe('matriz de permisos', () => {
  let prueba: Prueba;
  let a: Clinica;

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 1 });
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  for (const caso of CASOS) {
    it(`${caso.nombre}: ${caso.puede} puede, ${caso.noPuede} → sin_permiso`, async () => {
      const permitido = await crearPersona(prueba, a.clinicaId, { rol: caso.puede });
      const negado = await crearPersona(prueba, a.clinicaId, { rol: caso.noPuede });

      const sedeNegada = await crearSedeDePrueba(prueba.admin, a.clinicaId);
      const n = caso.preparar(sedeNegada);
      await esperarError(
        prueba.pedir(caso.metodo, n.ruta, {
          token: await negado.token(),
          ...(n.cuerpo ? { cuerpo: n.cuerpo } : {}),
        }),
        403,
        'sin_permiso',
      );

      const sedePermitida = await crearSedeDePrueba(prueba.admin, a.clinicaId);
      const p = caso.preparar(sedePermitida);
      const respuesta = await prueba
        .pedir(caso.metodo, p.ruta, {
          token: await permitido.token(),
          ...(p.cuerpo ? { cuerpo: p.cuerpo } : {}),
        })
        .expect(caso.estadoOk);
      if (caso.esquema) segun(caso.esquema, respuesta.body);
    });
  }

  it('GET /sesion: cualquier miembro activo, con cualquier rol', async () => {
    for (const rol of ['recepcion', 'asistente', 'odontologo'] as const) {
      const persona = await crearPersona(prueba, a.clinicaId, { rol });
      segun(
        sesionSchema,
        (await prueba.pedir('get', '/sesion', { token: await persona.token() }).expect(200)).body,
      );
    }
  });

  it('DELETE /sesion/mfa: cualquier miembro con aal2; sin membresía → sin_membresia', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    await prueba.pedir('delete', '/sesion/mfa', { token: await persona.token('aal2') }).expect(204);
    const extrano = await prueba.token({ sub: randomUUID(), aal: 'aal2' });
    await esperarError(
      prueba.pedir('delete', '/sesion/mfa', { token: extrano }),
      403,
      'sin_membresia',
    );
  });

  it('el permiso sale de rol_permiso, no del nombre del rol', async () => {
    const otra = await crearClinica(prueba, { sedes: 1 });
    const persona = await crearPersona(prueba, otra.clinicaId, { rol: 'administracion' });
    const token = await persona.token();
    await prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'Antes' } }).expect(201);
    await comoSistema(
      prueba.admin,
      otra.clinicaId,
      "update app.rol_permiso set activo = false where rol_id = $1 and modulo = 'sedes' and accion = 'crear'",
      [otra.roles.administracion],
    );
    await esperarError(
      prueba.pedir('post', '/sedes', { token, cuerpo: { nombre: 'Después' } }),
      403,
      'sin_permiso',
    );
    // Un rol desactivado se queda sin permisos (el rol Dueño/a no se puede desactivar).
    await comoSistema(
      prueba.admin,
      otra.clinicaId,
      'update app.rol set activo = false where id = $1',
      [otra.roles.administracion],
    );
    await esperarError(prueba.pedir('get', '/sedes', { token }), 403, 'sin_permiso');
    const sesion = segun(
      sesionSchema,
      (await prueba.pedir('get', '/sesion', { token }).expect(200)).body,
    );
    expect(sesion.permisos).toEqual([]);
  });

  it('el mensaje de sin_permiso dice qué falta y qué hacer', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, { rol: 'recepcion' });
    const respuesta = await esperarError(
      prueba.pedir('get', '/sedes', { token: await persona.token() }),
      403,
      'sin_permiso',
    );
    expect((respuesta.body as { mensaje: string }).mensaje).toBe(
      'Tu rol no tiene permiso para ver en Sedes. Pedile acceso a quien administra la clínica.',
    );
  });
});

describe('dimensión sede', () => {
  let prueba: Prueba;
  let a: Clinica;
  /** Recepción con sedes:* otorgado, asignada a la sede 0, con la sede 1 por defecto. */
  let token: string;
  let propia: { sedeId: string; sillonId: string };
  let porDefecto: { sedeId: string; sillonId: string };
  let ajena: { sedeId: string; sillonId: string };

  beforeAll(async () => {
    prueba = await crearPrueba();
    a = await crearClinica(prueba, { sedes: 3 });
    [propia, porDefecto, ajena] = a.sedes as [typeof propia, typeof propia, typeof propia];
    for (const accion of ['ver', 'crear', 'editar', 'anular'] as const) {
      await otorgarPermiso(prueba, a.clinicaId, a.roles.recepcion, 'sedes', accion);
    }
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [propia.sedeId],
      sedeDefectoId: porDefecto.sedeId,
    });
    token = await persona.token();
  });

  afterAll(async () => {
    await prueba.cerrar();
  });

  it('GET /sedes lista solo las sedes asignadas y la por defecto', async () => {
    const sedes = segun(
      z.array(sedeSchema),
      (await prueba.pedir('get', '/sedes', { token }).expect(200)).body,
    );
    expect(sedes.map((s) => s.id).sort()).toEqual([propia.sedeId, porDefecto.sedeId].sort());
  });

  it('opera sobre sus sedes', async () => {
    await prueba.pedir('get', `/sedes/${propia.sedeId}`, { token }).expect(200);
    await prueba.pedir('get', `/sedes/${porDefecto.sedeId}`, { token }).expect(200);
    await prueba
      .pedir('patch', `/sillones/${propia.sillonId}`, { token, cuerpo: { nombre: 'Propio' } })
      .expect(200);
  });

  it('sobre una sede no permitida → sede_no_permitida en cada endpoint', async () => {
    const pedidos: [Metodo, string, object | undefined][] = [
      ['get', `/sedes/${ajena.sedeId}`, undefined],
      ['patch', `/sedes/${ajena.sedeId}`, { nombre: 'Tomada' }],
      ['delete', `/sedes/${ajena.sedeId}`, { motivo: 'No es mía' }],
      ['put', `/sedes/${ajena.sedeId}/horarios`, { horarios: [] }],
      ['post', `/sedes/${ajena.sedeId}/sillones`, { nombre: 'Intruso' }],
      ['patch', `/sillones/${ajena.sillonId}`, { activo: false }],
    ];
    for (const [metodo, ruta, cuerpo] of pedidos) {
      await esperarError(
        prueba.pedir(metodo, ruta, { token, ...(cuerpo ? { cuerpo } : {}) }),
        403,
        'sede_no_permitida',
      );
    }
    // Y nada cambió.
    const { rows } = await comoSistema<{
      nombre: string;
      deleted_at: Date | null;
      activo: boolean;
    }>(
      prueba.admin,
      a.clinicaId,
      `select s.nombre, s.deleted_at, si.activo from app.sede s join app.sillon si on si.sede_id = s.id
       where s.id = $1`,
      [ajena.sedeId],
    );
    expect(rows[0]).toMatchObject({ deleted_at: null, activo: true });
    expect(rows[0]?.nombre).not.toBe('Tomada');
  });

  it('una asignación desactivada deja de contar', async () => {
    const persona = await crearPersona(prueba, a.clinicaId, {
      rol: 'recepcion',
      sedes: [ajena.sedeId],
    });
    const t = await persona.token();
    await prueba.pedir('get', `/sedes/${ajena.sedeId}`, { token: t }).expect(200);
    await comoSistema(
      prueba.admin,
      a.clinicaId,
      'update app.usuario_sede set activo = false where membresia_id = $1',
      [persona.membresiaId],
    );
    await esperarError(
      prueba.pedir('get', `/sedes/${ajena.sedeId}`, { token: t }),
      403,
      'sede_no_permitida',
    );
  });
});
