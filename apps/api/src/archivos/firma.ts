/**
 * Token de las URLs firmadas del almacén local (`GET /api/v1/archivos/descarga?t=<token>`).
 *
 *   token = base64url(JSON del contenido) "." base64url(HMAC-SHA256(secreto, "conecta-archivo-v1." + parte1))
 *
 * El contenido lleva el id del archivo, la clínica, el usuario que pidió la URL (la descarga vuelve
 * a comprobar su membresía activa) y el vencimiento en segundos. No lleva nombres ni rutas: la URL
 * puede quedar en registros de proxies. La firma se compara en tiempo constante, y un token que
 * vence más allá del máximo (5 minutos) se rechaza aunque esté bien firmado.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Máximo de vida de una URL firmada (contrato: 5 minutos como máximo). */
export const VIGENCIA_MAXIMA_SEGUNDOS = 5 * 60;
/** Vida de las URLs que entrega la API. */
export const VIGENCIA_URL_SEGUNDOS = VIGENCIA_MAXIMA_SEGUNDOS;

const DOMINIO = 'conecta-archivo-v1.';
const LARGO_MAXIMO_TOKEN = 600;
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const contenidoSchema = z
  .object({
    a: z.string().regex(PATRON_UUID),
    c: z.string().regex(PATRON_UUID),
    u: z.string().regex(PATRON_UUID),
    e: z.number().int().positive(),
  })
  .strict();

export interface ContenidoToken {
  archivoId: string;
  clinicaId: string;
  usuarioId: string;
  /** Vencimiento (época, segundos). */
  venceEn: number;
}

function hmac(secreto: string, parte: string): Buffer {
  return createHmac('sha256', secreto)
    .update(DOMINIO + parte, 'utf8')
    .digest();
}

export function firmarToken(secreto: string, contenido: ContenidoToken): string {
  const json = JSON.stringify({
    a: contenido.archivoId,
    c: contenido.clinicaId,
    u: contenido.usuarioId,
    e: contenido.venceEn,
  });
  const parte = Buffer.from(json, 'utf8').toString('base64url');
  return `${parte}.${hmac(secreto, parte).toString('base64url')}`;
}

/**
 * Devuelve el contenido si el token está bien firmado con `secreto`, no venció y no vence más allá
 * de la vigencia máxima. Si no, null (sin decir por qué).
 */
export function verificarToken(
  secreto: string,
  token: unknown,
  ahoraMs: number = Date.now(),
): ContenidoToken | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > LARGO_MAXIMO_TOKEN) {
    return null;
  }
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [parte, firma] = partes as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(parte) || !/^[A-Za-z0-9_-]+$/.test(firma)) return null;

  const esperada = hmac(secreto, parte);
  const recibida = Buffer.from(firma, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;

  let datos: unknown;
  try {
    datos = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const resultado = contenidoSchema.safeParse(datos);
  if (!resultado.success) return null;
  const ahora = Math.floor(ahoraMs / 1000);
  const { a, c, u, e } = resultado.data;
  if (e <= ahora || e > ahora + VIGENCIA_MAXIMA_SEGUNDOS + 5) return null;
  return { archivoId: a, clinicaId: c, usuarioId: u, venceEn: e };
}
