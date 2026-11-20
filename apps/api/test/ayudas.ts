/**
 * Ayudas de las pruebas de integración: app Nest real contra el Postgres del banco, tokens firmados
 * con claves locales (JWKS en memoria) y fábricas de datos como rol de administración.
 *
 * Tokens: como los de Supabase, llevan `session_id` e `iat`. Cada persona tiene una sesión fija
 * (`persona.sesionId`) y su token sale por defecto con el nivel que su rol exige (aal2 para dueño y
 * administración, aal1 para el resto).
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { conContextoCliente } from '@conecta/db';
import {
  crearClinicaDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '@conecta/db/pruebas';
import { errorApiSchema, type Accion, type Modulo, type RolSistema } from '@conecta/shared';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';
import pg from 'pg';
import request from 'supertest';
import { expect, inject } from 'vitest';
import type { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { OPCIONES_APP, PREFIJO_API, configurarApp } from '../src/app.js';
import {
  VERIFICADOR_JWT,
  crearVerificadorJwt,
  type VerificadorJwt,
} from '../src/auth/verificador-jwt.js';
import { REGISTRO, registroSilencioso, type Registro } from '../src/comun/registro.js';
import { CONFIG, cargarConfig, type Config } from '../src/config.js';

export const AUDIENCIA = 'authenticated';

export interface ParDeClaves {
  privada: CryptoKey;
  publica: JWK;
}

export async function generarClaves(alg: 'ES256' | 'RS256', kid: string): Promise<ParDeClaves> {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const publica = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
  return { privada: privateKey, publica };
}

export interface OpcionesToken {
  sub: string;
  email?: string;
  aal?: string;
  alg?: 'ES256' | 'RS256';
  emisor?: string;
  audiencia?: string;
  /** Segundos desde ahora (negativo = vencido). Por defecto 600; null = sin exp. */
  venceEn?: number | null;
  /** Firmar con otra clave (p. ej. de otro par). */
  clave?: ParDeClaves;
  /** `session_id`. Por defecto uno nuevo; null = sin `session_id`; cualquier valor va tal cual. */
  sesion?: unknown;
  /** `iat` en segundos desde la época. Por defecto, hace 5 segundos. */
  iat?: number;
}

export interface Prueba {
  app: NestExpressApplication;
  config: Config;
  admin: pg.Pool;
  servidor(): Server;
  token(opciones: OpcionesToken): Promise<string>;
  /** Pedido a `/api/v1<ruta>` con token y clínica opcionales. */
  pedir(
    metodo: 'get' | 'post' | 'patch' | 'put' | 'delete',
    ruta: string,
    opciones?: { token?: string; clinica?: string; cuerpo?: unknown },
  ): request.Test;
  cerrar(): Promise<void>;
}

export interface OpcionesPrueba {
  config?: Partial<Config>;
  registro?: Registro;
  modulosExtra?: Type[];
  /** Otro verificador de JWT (p. ej. contra un JWKS remoto de prueba). */
  verificador?: VerificadorJwt;
}

export async function crearPrueba(opciones: OpcionesPrueba = {}): Promise<Prueba> {
  const { urlAdmin, urlApi } = inject('conectaDb');
  const config: Config = {
    ...cargarConfig({ NODE_ENV: 'test' }),
    databaseUrl: urlApi,
    poolMax: 4,
    limitePedidosPorMinuto: 100_000,
    limitePedidosPorUsuario: 100_000,
    ...opciones.config,
  };
  const ec = await generarClaves('ES256', 'clave-ec');
  const rsa = await generarClaves('RS256', 'clave-rsa');
  const verificador = crearVerificadorJwt(createLocalJWKSet({ keys: [ec.publica, rsa.publica] }), {
    emisor: config.emisorJwt,
  });

  const modulo = await Test.createTestingModule({
    imports: [AppModule, ...(opciones.modulosExtra ?? [])],
  })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(VERIFICADOR_JWT)
    .useValue(opciones.verificador ?? verificador)
    .overrideProvider(REGISTRO)
    .useValue(opciones.registro ?? registroSilencioso)
    .compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>(OPCIONES_APP));
  await app.init();

  const admin = new pg.Pool({ connectionString: urlAdmin, max: 3 });
  admin.on('error', () => undefined);
  const servidor = (): Server => app.getHttpServer();

  const token = async (o: OpcionesToken): Promise<string> => {
    const alg = o.alg ?? 'ES256';
    const clave = o.clave ?? (alg === 'ES256' ? ec : rsa);
    const ahora = Math.floor(Date.now() / 1000);
    const sesion = o.sesion === undefined ? randomUUID() : o.sesion;
    const jwt = new SignJWT({
      ...(o.email !== undefined ? { email: o.email } : {}),
      aal: o.aal ?? 'aal1',
      role: 'authenticated',
      ...(sesion !== null ? { session_id: sesion } : {}),
    })
      .setProtectedHeader({ alg, kid: clave.publica.kid ?? 'sin-kid', typ: 'JWT' })
      .setSubject(o.sub)
      .setIssuer(o.emisor ?? config.emisorJwt)
      .setAudience(o.audiencia ?? AUDIENCIA)
      .setIssuedAt(o.iat ?? ahora - 5);
    if (o.venceEn !== null) jwt.setExpirationTime(ahora + (o.venceEn ?? 600));
    return jwt.sign(clave.privada);
  };

  const pedir: Prueba['pedir'] = (metodo, ruta, o = {}) => {
    let pedido = request(servidor())[metodo](`/${PREFIJO_API}${ruta}`);
    if (o.token) pedido = pedido.set('Authorization', `Bearer ${o.token}`);
    if (o.clinica) pedido = pedido.set('X-Clinica-Id', o.clinica);
    if (o.cuerpo !== undefined) pedido = pedido.send(o.cuerpo as object);
    return pedido;
  };

  return {
    app,
    config,
    admin,
    servidor,
    token,
    pedir,
    cerrar: async () => {
      await app.close();
      await admin.end();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Datos de prueba (como administración, fuera de la API)
// ---------------------------------------------------------------------------------------------

/** Contexto fijado por las ayudas de administración: sin comprobar membresía (no hay actor). */
const SIN_VERIFICAR = { verificarMembresia: false } as const;

/** Ejecuta SQL como alta del sistema (sin usuario) en el contexto de una clínica. */
export async function comoSistema<T extends pg.QueryResultRow = pg.QueryResultRow>(
  admin: pg.Pool,
  clinicaId: string,
  texto: string,
  parametros: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return conContextoCliente(
    admin,
    { clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      return cliente.query<T>(texto, parametros);
    },
    SIN_VERIFICAR,
  );
}

/** Ejecuta SQL como administración con un usuario en el contexto (p. ej. para ver sus sesiones). */
export async function comoUsuarioAdmin<T extends pg.QueryResultRow = pg.QueryResultRow>(
  admin: pg.Pool,
  clinicaId: string,
  usuarioId: string,
  texto: string,
  parametros: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return conContextoCliente(
    admin,
    { clinicaId, usuarioId },
    (cliente) => cliente.query<T>(texto, parametros),
    SIN_VERIFICAR,
  );
}

/** Roles de sistema que exigen doble factor (dato de `rol.exige_mfa`, ver 0008). */
const ROLES_CON_MFA: readonly RolSistema[] = ['dueno', 'administracion'];

export interface Persona {
  usuarioId: string;
  membresiaId: string;
  email: string;
  /** Sesión de Supabase de esta persona: todos sus tokens la llevan salvo que se pida otra. */
  sesionId: string;
  /**
   * Token con la sesión de la persona. Por defecto aal2 si su rol exige doble factor y aal1 si no.
   */
  token: (aal?: 'aal1' | 'aal2', opciones?: Partial<OpcionesToken>) => Promise<string>;
}

function persona(
  prueba: Prueba,
  datos: { usuarioId: string; membresiaId: string; email: string },
  rol: RolSistema,
): Persona {
  const sesionId = randomUUID();
  const predeterminado = ROLES_CON_MFA.includes(rol) ? 'aal2' : 'aal1';
  return {
    ...datos,
    sesionId,
    token: (aal = predeterminado, opciones = {}) =>
      prueba.token({
        sub: datos.usuarioId,
        email: datos.email,
        aal,
        sesion: sesionId,
        ...opciones,
      }),
  };
}

export interface Clinica extends ClinicaDePrueba {
  dueno: Persona;
  sedes: { sedeId: string; sillonId: string }[];
}

export async function crearClinica(
  prueba: Prueba,
  opciones: { sedes?: number; nombre?: string } = {},
): Promise<Clinica> {
  const base = await crearClinicaDePrueba(
    prueba.admin,
    opciones.nombre ? { nombre: opciones.nombre } : {},
  );
  const { rows } = await comoSistema<{ id: string; email: string }>(
    prueba.admin,
    base.clinicaId,
    `select m.id, u.email from app.membresia m join app.usuario u on u.id = m.usuario_id
     where m.clinica_id = $1 and m.usuario_id = $2`,
    [base.clinicaId, base.duenoId],
  );
  const fila = rows[0];
  if (!fila) throw new Error('No se encontró la membresía del dueño.');
  const sedes: Clinica['sedes'] = [];
  for (let i = 0; i < (opciones.sedes ?? 2); i++) {
    sedes.push(
      await crearSedeDePrueba(prueba.admin, base.clinicaId, { nombre: `Sede ${String(i + 1)}` }),
    );
  }
  return {
    ...base,
    sedes,
    dueno: persona(
      prueba,
      { usuarioId: base.duenoId, membresiaId: fila.id, email: fila.email },
      'dueno',
    ),
  };
}

export async function crearPersona(
  prueba: Prueba,
  clinicaId: string,
  opciones: {
    rol?: RolSistema;
    estado?: 'pendiente' | 'activo' | 'inactivo';
    usuarioId?: string;
    sedes?: string[];
    sedeDefectoId?: string;
    email?: string;
  } = {},
): Promise<Persona> {
  const rol = opciones.rol ?? 'recepcion';
  const creado = await crearUsuarioDePrueba(prueba.admin, {
    clinicaId,
    rol,
    estado: opciones.estado ?? 'activo',
    ...(opciones.usuarioId ? { usuarioId: opciones.usuarioId } : {}),
    ...(opciones.email ? { email: opciones.email } : {}),
  });
  for (const sedeId of opciones.sedes ?? []) {
    await comoSistema(
      prueba.admin,
      clinicaId,
      'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
      [clinicaId, creado.membresiaId, sedeId],
    );
  }
  if (opciones.sedeDefectoId) {
    await comoSistema(
      prueba.admin,
      clinicaId,
      'update app.membresia set sede_defecto_id = $2 where id = $1',
      [creado.membresiaId, opciones.sedeDefectoId],
    );
  }
  return persona(prueba, creado, rol);
}

export async function otorgarPermiso(
  prueba: Prueba,
  clinicaId: string,
  rolId: string,
  modulo: Modulo,
  accion: Accion,
): Promise<void> {
  await comoSistema(
    prueba.admin,
    clinicaId,
    `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, $3, $4)
     on conflict (clinica_id, rol_id, modulo, accion) do update set activo = true`,
    [clinicaId, rolId, modulo, accion],
  );
}

/**
 * Fija `mfa_activo` de un usuario como administración (app_api ya no puede escribirlo: lo cambian
 * `app.activar_mfa()` y `app.desactivar_mfa()`).
 */
export async function fijarMfa(
  prueba: Prueba,
  clinicaId: string,
  usuarioId: string,
  activo: boolean,
): Promise<void> {
  await comoUsuarioAdmin(
    prueba.admin,
    clinicaId,
    usuarioId,
    'update app.usuario set mfa_activo = $2 where id = $1',
    [usuarioId, activo],
  );
}

export async function leerMfa(
  prueba: Prueba,
  clinicaId: string,
  usuarioId: string,
): Promise<boolean> {
  const { rows } = await comoUsuarioAdmin<{ mfa_activo: boolean }>(
    prueba.admin,
    clinicaId,
    usuarioId,
    'select mfa_activo from app.usuario where id = $1',
    [usuarioId],
  );
  return rows[0]?.mfa_activo ?? false;
}

export interface FilaSesion {
  cerrada_en: Date | null;
  motivo_cierre: 'salida' | 'inactividad' | null;
  ultima_actividad: Date;
}

/** Estado de una sesión en la base (`app.sesion`), o null si nunca se tocó. */
export async function leerSesion(
  prueba: Prueba,
  clinicaId: string,
  usuarioId: string,
  sesionId: string,
): Promise<FilaSesion | null> {
  const { rows } = await comoUsuarioAdmin<FilaSesion>(
    prueba.admin,
    clinicaId,
    usuarioId,
    'select cerrada_en, motivo_cierre, ultima_actividad from app.sesion where id = $1',
    [sesionId],
  );
  return rows[0] ?? null;
}

/** Cantidad de `ingresar` registrados para una sesión en una clínica. */
export async function ingresosDeSesion(
  prueba: Prueba,
  clinicaId: string,
  sesionId: string,
): Promise<number> {
  const { rows } = await comoSistema<{ n: string }>(
    prueba.admin,
    clinicaId,
    `select count(*) as n from app.audit_log
     where clinica_id = $1 and entidad = 'sesion' and entidad_id = $2 and accion = 'ingresar'`,
    [clinicaId, sesionId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Hora actual según la base (ISO con microsegundos), para cortes temporales en las pruebas. */
export async function relojDeLaBase(prueba: Prueba): Promise<string> {
  const { rows } = await prueba.admin.query<{ ahora: string }>(
    `select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ahora`,
  );
  const ahora = rows[0]?.ahora;
  if (!ahora) throw new Error('La base no devolvió la hora.');
  return ahora;
}

/** Valida una respuesta exitosa contra el esquema del contrato y la devuelve tipada. */
export function segun<S extends z.ZodType>(esquema: S, cuerpo: unknown): z.output<S> {
  const resultado = esquema.safeParse(cuerpo);
  if (!resultado.success) {
    expect.fail(`La respuesta no cumple el contrato: ${JSON.stringify(resultado.error.issues)}`);
  }
  return resultado.data;
}

/** Comprueba estado y código de error (y que el cuerpo cumpla `errorApiSchema`). */
export async function esperarError(
  pedido: request.Test,
  estado: number,
  codigo: string,
): Promise<request.Response> {
  const respuesta = await pedido;
  expect({ estado: respuesta.status, cuerpo: respuesta.body as unknown }).toMatchObject({
    estado,
    cuerpo: { codigo },
  });
  segun(errorApiSchema, respuesta.body);
  return respuesta;
}
