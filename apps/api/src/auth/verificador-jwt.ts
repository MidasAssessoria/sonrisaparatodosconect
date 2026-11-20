/**
 * Verificación del JWT de Supabase Auth.
 *
 * En producción las claves salen del JWKS remoto del proyecto (`SUPABASE_JWKS_URL`); las pruebas
 * inyectan un verificador con un JWKS local para firmar sus propios tokens. Se valida firma
 * (solo ES256 o RS256: nunca `none` ni HS*), vencimiento, emisor `<SUPABASE_URL>/auth/v1` y audiencia
 * `authenticated`. Del token solo se usan `sub`, `email`, `aal`, `iat` y `session_id`.
 *
 * Un token inválido es `no_autenticado` (401: la web cierra la sesión). No poder verificarlo porque
 * el JWKS no responde, responde un error o devuelve algo roto es `servicio_no_disponible` (503): no
 * es culpa del token y la web no tiene que sacar a nadie.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { idSchema } from '@conecta/shared';
import { errores } from '../errores/error-api.js';

export const VERIFICADOR_JWT = Symbol('VERIFICADOR_JWT');

export const ALGORITMOS_JWT = ['ES256', 'RS256'] as const;
export const AUDIENCIA_JWT = 'authenticated';

export type NivelAutenticacion = 'aal1' | 'aal2';

export interface IdentidadToken {
  /** `sub`: id del usuario en Supabase Auth (= `app.usuario.id`). */
  usuarioId: string;
  email: string | null;
  /** `aal2` = pasó el segundo factor en esta sesión. Cualquier otro valor cuenta como `aal1`. */
  nivel: NivelAutenticacion;
  /** `session_id`: la sesión de Supabase Auth (= `app.sesion.id`). */
  sesionId: string;
  /** `iat`: cuándo se emitió el token (para ignorar tokens aal2 anteriores a la baja del factor). */
  emitidoEn: Date;
}

export interface VerificadorJwt {
  /** Devuelve la identidad o lanza `no_autenticado` (o `servicio_no_disponible`). */
  verificar(token: string): Promise<IdentidadToken>;
}

export interface OpcionesVerificador {
  emisor: string;
  audiencia?: string;
}

/**
 * Errores de jose que significan «este token no sirve». Cualquier otro (JWKS que responde un error,
 * que no responde, que devuelve un JSON roto o claves inválidas, falla de red) es de la dependencia.
 */
const CODIGOS_TOKEN_INVALIDO = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

const MENSAJE_SESION_INVALIDA = 'Tu sesión no es válida. Ingresá de nuevo.';

export function crearVerificadorJwt(
  claves: JWTVerifyGetKey,
  opciones: OpcionesVerificador,
): VerificadorJwt {
  return {
    async verificar(token: string): Promise<IdentidadToken> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, claves, {
          algorithms: [...ALGORITMOS_JWT],
          issuer: opciones.emisor,
          audience: opciones.audiencia ?? AUDIENCIA_JWT,
          requiredClaims: ['exp', 'sub', 'iat'],
          clockTolerance: 5,
        }));
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          throw errores.noAutenticado('Tu sesión venció. Ingresá de nuevo.');
        }
        if (error instanceof errors.JOSEError && CODIGOS_TOKEN_INVALIDO.has(error.code)) {
          throw errores.noAutenticado();
        }
        throw errores.servicioNoDisponible(
          'No pudimos verificar tu sesión en este momento. Probá de nuevo en unos segundos.',
        );
      }

      const sub = idSchema.safeParse(payload.sub);
      if (!sub.success) throw errores.noAutenticado();
      const sesion = idSchema.safeParse(payload['session_id']);
      if (!sesion.success) throw errores.noAutenticado(MENSAJE_SESION_INVALIDA);
      if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
        throw errores.noAutenticado(MENSAJE_SESION_INVALIDA);
      }
      const email = typeof payload['email'] === 'string' ? payload['email'] : null;
      return {
        usuarioId: sub.data.toLowerCase(),
        email,
        nivel: payload['aal'] === 'aal2' ? 'aal2' : 'aal1',
        sesionId: sesion.data.toLowerCase(),
        emitidoEn: new Date(payload.iat * 1000),
      };
    },
  };
}

/** Verificador de producción: JWKS remoto de Supabase, con caché y tiempo de espera acotado. */
export function crearVerificadorSupabase(jwksUrl: string, emisor: string): VerificadorJwt {
  const jwks = createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return crearVerificadorJwt(jwks, { emisor });
}

const PATRON_BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)$/;

/** Extrae el token de `Authorization: Bearer …` o lanza `no_autenticado`. */
export function tokenDeCabecera(cabecera: string | string[] | undefined): string {
  if (typeof cabecera !== 'string' || cabecera.length > 8192) {
    throw errores.noAutenticado('Falta tu sesión. Ingresá para continuar.');
  }
  const coincidencia = PATRON_BEARER.exec(cabecera.trim());
  if (!coincidencia?.[1]) throw errores.noAutenticado('Falta tu sesión. Ingresá para continuar.');
  return coincidencia[1];
}
