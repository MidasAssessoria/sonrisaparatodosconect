/**
 * Ayudas de las pruebas de personal, invitaciones y roles. `crearPruebaPersonal` arma la misma app
 * que `crearPrueba` (ayudas.ts) pero con un `AdminAuth` en memoria y el límite de las rutas
 * públicas de invitación configurable (por defecto, alto: solo la prueba del límite lo baja).
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import '@conecta/db/pruebas';
import {
  invitacionCreadaSchema,
  rolSchema,
  type CrearInvitacion,
  type InvitacionCreada,
  type Rol,
} from '@conecta/shared';
import { createLocalJWKSet, SignJWT } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { OPCIONES_APP, PREFIJO_API, configurarApp } from '../src/app.js';
import { VERIFICADOR_JWT, crearVerificadorJwt } from '../src/auth/verificador-jwt.js';
import { REGISTRO, registroSilencioso } from '../src/comun/registro.js';
import { CONFIG, cargarConfig, type Config } from '../src/config.js';
import { ADMIN_AUTH, adminAuthNoConfigurado, type AdminAuth } from '../src/personal/admin-auth.js';
import { AdminAuthFalso } from '../src/personal/admin-auth-falso.js';
import { LIMITE_INVITACIONES_POR_MINUTO } from '../src/personal/limite-invitaciones.js';
import { AUDIENCIA, generarClaves, segun, type OpcionesToken, type Prueba } from './ayudas.js';

export interface PruebaPersonal extends Prueba {
  /** Cuentas de Supabase Auth en memoria (lo que crea la invitación por correo) y sus llamadas. */
  adminAuth: AdminAuthFalso;
}

export interface OpcionesPruebaPersonal {
  config?: Partial<Config>;
  /** Pedidos por minuto y por IP en consultar/aceptar. Por defecto 100.000. */
  limiteInvitaciones?: number;
  /** `false`: sin clave secreta (la implementación real de «no configurado»). */
  conAdminAuth?: boolean;
}

export async function crearPruebaPersonal(
  opciones: OpcionesPruebaPersonal = {},
): Promise<PruebaPersonal> {
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
  const verificador = crearVerificadorJwt(createLocalJWKSet({ keys: [ec.publica] }), {
    emisor: config.emisorJwt,
  });
  const adminAuth = new AdminAuthFalso();
  const implementacion: AdminAuth =
    opciones.conAdminAuth === false ? adminAuthNoConfigurado : adminAuth;

  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(VERIFICADOR_JWT)
    .useValue(verificador)
    .overrideProvider(REGISTRO)
    .useValue(registroSilencioso)
    .overrideProvider(ADMIN_AUTH)
    .useValue(implementacion)
    .overrideProvider(LIMITE_INVITACIONES_POR_MINUTO)
    .useValue(opciones.limiteInvitaciones ?? 100_000)
    .compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>(OPCIONES_APP));
  await app.init();

  const admin = new pg.Pool({ connectionString: urlAdmin, max: 3 });
  admin.on('error', () => undefined);
  const servidor = (): Server => app.getHttpServer();

  const token = async (o: OpcionesToken): Promise<string> => {
    const ahora = Math.floor(Date.now() / 1000);
    const sesion = o.sesion === undefined ? randomUUID() : o.sesion;
    const jwt = new SignJWT({
      ...(o.email !== undefined ? { email: o.email } : {}),
      aal: o.aal ?? 'aal1',
      role: 'authenticated',
      ...(sesion !== null ? { session_id: sesion } : {}),
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'clave-ec', typ: 'JWT' })
      .setSubject(o.sub)
      .setIssuer(o.emisor ?? config.emisorJwt)
      .setAudience(o.audiencia ?? AUDIENCIA)
      .setIssuedAt(o.iat ?? ahora - 5);
    if (o.venceEn !== null) jwt.setExpirationTime(ahora + (o.venceEn ?? 600));
    return jwt.sign((o.clave ?? ec).privada);
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
    adminAuth,
    cerrar: async () => {
      await app.close();
      await admin.end();
    },
  };
}

/** Token en claro del enlace `/invitacion?token=…`. */
export function tokenDeEnlace(enlace: string): string {
  const token = new URL(enlace, 'http://web.test').searchParams.get('token');
  if (!token) throw new Error(`El enlace no trae token: ${enlace}`);
  return token;
}

/** `POST /invitaciones` que tiene que salir bien (201, validado contra el contrato). */
export async function invitar(
  prueba: Prueba,
  token: string,
  cuerpo: Partial<CrearInvitacion> & { rolId: string },
): Promise<InvitacionCreada & { token: string }> {
  const respuesta = await prueba.pedir('post', '/invitaciones', {
    token,
    cuerpo: {
      nombre: 'Persona Invitada',
      email: `invitada-${randomUUID().slice(0, 8)}@prueba.test`,
      ...cuerpo,
    },
  });
  if (respuesta.status !== 201) {
    throw new Error(
      `Invitar respondió ${String(respuesta.status)}: ${JSON.stringify(respuesta.body)}`,
    );
  }
  const creada = segun(invitacionCreadaSchema, respuesta.body);
  return { ...creada, token: tokenDeEnlace(creada.enlace) };
}

/** Lista de roles (GET /roles) validada. */
export async function listarRoles(prueba: Prueba, token: string): Promise<Rol[]> {
  const respuesta = await prueba.pedir('get', '/roles', { token });
  return segun(z.array(rolSchema), respuesta.body);
}

/**
 * Lo que hace una persona invitada sin cuenta previa: abre el correo de invitación de Supabase (la
 * cuenta queda confirmada), vuelve con sesión (JWT aal1 de esa cuenta) y acepta. Devuelve el id de
 * la cuenta y su token.
 */
export async function aceptarDesdeCorreo(
  prueba: PruebaPersonal,
  inv: { token: string; persona: { email: string } },
): Promise<{ cuentaId: string; jwt: string }> {
  const cuenta = prueba.adminAuth.confirmar(inv.persona.email);
  const jwt = await prueba.token({ sub: cuenta.id, email: cuenta.email });
  const respuesta = await prueba.pedir('post', '/invitaciones/aceptar', {
    token: jwt,
    cuerpo: { token: inv.token },
  });
  if (respuesta.status !== 200) {
    throw new Error(
      `Aceptar respondió ${String(respuesta.status)}: ${JSON.stringify(respuesta.body)}`,
    );
  }
  return { cuentaId: cuenta.id, jwt };
}
