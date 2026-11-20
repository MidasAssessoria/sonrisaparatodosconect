/**
 * Ayudas de las pruebas de integración: app Nest real contra el Postgres del banco, tokens firmados
 * con claves locales (JWKS en memoria) y fábricas de datos como rol de administración.
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
import { VERIFICADOR_JWT, crearVerificadorJwt } from '../src/auth/verificador-jwt.js';
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
}

export async function crearPrueba(opciones: OpcionesPrueba = {}): Promise<Prueba> {
  const { urlAdmin, urlApi } = inject('conectaDb');
  const config: Config = {
    ...cargarConfig({ NODE_ENV: 'test' }),
    databaseUrl: urlApi,
    poolMax: 4,
    limitePedidosPorMinuto: 100_000,
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
    .useValue(verificador)
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
    const jwt = new SignJWT({
      ...(o.email !== undefined ? { email: o.email } : {}),
      aal: o.aal ?? 'aal1',
      role: 'authenticated',
    })
      .setProtectedHeader({ alg, kid: clave.publica.kid ?? 'sin-kid', typ: 'JWT' })
      .setSubject(o.sub)
      .setIssuer(o.emisor ?? config.emisorJwt)
      .setAudience(o.audiencia ?? AUDIENCIA)
      .setIssuedAt(ahora - 5);
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

/** Ejecuta SQL como alta del sistema (sin usuario) en el contexto de una clínica. */
export async function comoSistema<T extends pg.QueryResultRow = pg.QueryResultRow>(
  admin: pg.Pool,
  clinicaId: string,
  texto: string,
  parametros: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return conContextoCliente(admin, { clinicaId, usuarioId: randomUUID() }, async (cliente) => {
    await cliente.query("select set_config('app.usuario_id', '', true)");
    return cliente.query<T>(texto, parametros);
  });
}

export interface Persona {
  usuarioId: string;
  membresiaId: string;
  email: string;
  /** Token aal1 (o el nivel pedido). */
  token: (aal?: 'aal1' | 'aal2') => Promise<string>;
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
    dueno: {
      usuarioId: base.duenoId,
      membresiaId: fila.id,
      email: fila.email,
      token: (aal = 'aal1') => prueba.token({ sub: base.duenoId, email: fila.email, aal }),
    },
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
  } = {},
): Promise<Persona> {
  const creado = await crearUsuarioDePrueba(prueba.admin, {
    clinicaId,
    rol: opciones.rol ?? 'recepcion',
    estado: opciones.estado ?? 'activo',
    ...(opciones.usuarioId ? { usuarioId: opciones.usuarioId } : {}),
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
  return {
    ...creado,
    token: (aal = 'aal1') => prueba.token({ sub: creado.usuarioId, email: creado.email, aal }),
  };
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
     on conflict (rol_id, modulo, accion) do update set activo = true`,
    [clinicaId, rolId, modulo, accion],
  );
}

/** Fija `mfa_activo` de un usuario (como él mismo, que es lo que permite la política). */
export async function fijarMfa(
  prueba: Prueba,
  clinicaId: string,
  usuarioId: string,
  activo: boolean,
): Promise<void> {
  await conContextoCliente(prueba.admin, { clinicaId, usuarioId }, (cliente) =>
    cliente.query('update app.usuario set mfa_activo = $2 where id = $1', [usuarioId, activo]),
  );
}

export async function leerMfa(
  prueba: Prueba,
  clinicaId: string,
  usuarioId: string,
): Promise<boolean> {
  const { rows } = await conContextoCliente(prueba.admin, { clinicaId, usuarioId }, (cliente) =>
    cliente.query<{ mfa_activo: boolean }>('select mfa_activo from app.usuario where id = $1', [
      usuarioId,
    ]),
  );
  return rows[0]?.mfa_activo ?? false;
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
