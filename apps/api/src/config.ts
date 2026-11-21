import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const entornoSchema = z.enum(['development', 'test', 'production']);

/** Un origen http(s) sin ruta, consulta ni fragmento (p. ej. `https://api.example.com`). */
const origenSchema = z
  .url({ protocol: /^https?$/ })
  .refine((valor) => {
    const url = new URL(valor);
    return url.pathname === '/' && url.search === '' && url.hash === '';
  }, 'solo el origen, sin ruta (p. ej. https://api.example.com)')
  .transform((valor) => new URL(valor).origin);

const secretoFirmaSchema = z.string().min(32, 'usá al menos 32 caracteres aleatorios');

const configSchema = z.object({
  NODE_ENV: entornoSchema,
  PORT: z.coerce.number().int().min(0).max(65535),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100),
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_JWKS_URL: z.url({ protocol: /^https?$/ }),
  WEB_ORIGIN: z
    .string()
    .transform((valor) =>
      valor
        .split(',')
        .map((origen) => origen.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1)),
  TRUST_PROXY: z
    .string()
    .regex(/^(true|false|\d{1,2})$/, 'usá true, false o la cantidad de proxies (p. ej. 1)'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000),
  RATE_LIMIT_USER_PER_MINUTE: z.coerce.number().int().min(1).max(100_000),
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  ARCHIVOS_ALMACEN: z.enum(['local', 'supabase']),
  ARCHIVOS_DIRECTORIO: z.string().min(1),
  ARCHIVOS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'minúsculas, números y guiones'),
  ARCHIVOS_FIRMA_SECRETO: secretoFirmaSchema.optional(),
  WEB_ORIGEN_PUBLICO: origenSchema.optional(),
  API_ORIGEN_PUBLICO: origenSchema.optional(),
});

/**
 * Lo obligatorio depende del entorno: en producción, el secreto de firma siempre, y el origen
 * público de la API si las URLs de descarga las arma la propia API (almacén local).
 */
function esquemaPara(entorno: z.infer<typeof entornoSchema>, almacen: string | undefined) {
  if (entorno !== 'production') return configSchema;
  return configSchema.extend({
    ARCHIVOS_FIRMA_SECRETO: secretoFirmaSchema,
    API_ORIGEN_PUBLICO: almacen === 'local' ? origenSchema : origenSchema.optional(),
  });
}

export interface Config {
  entorno: z.infer<typeof entornoSchema>;
  puerto: number;
  databaseUrl: string;
  /** Conexiones máximas del pool de la API. */
  poolMax: number;
  supabaseUrl: string;
  supabaseJwksUrl: string;
  /** Emisor esperado en los JWT: `<SUPABASE_URL>/auth/v1`. */
  emisorJwt: string;
  /** Orígenes a los que se permite CORS (la web). */
  webOrigenes: string[];
  /**
   * Origen público de la web (`WEB_ORIGEN_PUBLICO`, por defecto el primero de `WEB_ORIGIN`): a
   * `<origen>/invitacion?token=…` vuelve la persona desde el correo de invitación de Supabase.
   */
  webOrigenPublico: string;
  /**
   * Origen público de la API (`API_ORIGEN_PUBLICO`): con el almacén local, la URL firmada de un
   * archivo es `<origen>/api/v1/archivos/descarga?t=…` (absoluta, contrato de archivos). Null solo
   * en producción con Supabase Storage, que firma sus propias URLs absolutas.
   */
  apiOrigenPublico: string | null;
  /**
   * `false`: la IP del cliente es la del socket (se ignora X-Forwarded-For).
   * Un número: cantidad de proxies de confianza delante de la API (Express `trust proxy`).
   */
  trustProxy: false | number;
  /** Pedidos por minuto y por IP antes de responder 429. */
  limitePedidosPorMinuto: number;
  /** Pedidos por minuto y por usuario autenticado (`sub` del token) antes de responder 429. */
  limitePedidosPorUsuario: number;
  /**
   * Clave secreta de Supabase (Admin API: correo de invitación y estado de las cuentas; Storage).
   * Opcional fuera de producción: sin ella, lo que la necesita responde 503 servicio_no_disponible.
   */
  supabaseSecretKey: string | undefined;
  archivos: {
    /** `local`: disco (desarrollo y pruebas). `supabase`: Supabase Storage, bucket privado. */
    almacen: 'local' | 'supabase';
    /** Carpeta del almacén local. */
    directorio: string;
    /** Bucket privado de Supabase Storage. */
    bucket: string;
    /**
     * Secreto para firmar las URLs de descarga del almacén local (HMAC). En desarrollo, si no se
     * define, uno aleatorio por proceso (las URLs emitidas dejan de servir al reiniciar); en
     * pruebas, uno fijo; en producción es obligatorio.
     */
    secretoFirma: string;
  };
}

const CLAVES = [
  'PORT',
  'DATABASE_URL',
  'DATABASE_POOL_MAX',
  'SUPABASE_URL',
  'SUPABASE_JWKS_URL',
  'WEB_ORIGIN',
  'TRUST_PROXY',
  'RATE_LIMIT_PER_MINUTE',
  'RATE_LIMIT_USER_PER_MINUTE',
  'SUPABASE_SECRET_KEY',
  'ARCHIVOS_ALMACEN',
  'ARCHIVOS_DIRECTORIO',
  'ARCHIVOS_BUCKET',
  'ARCHIVOS_FIRMA_SECRETO',
  'WEB_ORIGEN_PUBLICO',
  'API_ORIGEN_PUBLICO',
] as const;

/** Valores por defecto en cualquier entorno (incluida producción). */
const PREDETERMINADOS_COMUNES: Partial<Record<(typeof CLAVES)[number], string>> = {
  // PORT tiene un valor por defecto razonable incluso en producción (Railway lo define siempre).
  PORT: '3000',
  DATABASE_POOL_MAX: '10',
  RATE_LIMIT_PER_MINUTE: '300',
  RATE_LIMIT_USER_PER_MINUTE: '120',
  ARCHIVOS_BUCKET: 'conecta-privado',
};

/**
 * Valores para desarrollo y pruebas. En producción no hay valores por defecto para lo sensible ni
 * para TRUST_PROXY: detrás de un proxy, sin él, todos los clientes comparten un contador del
 * límite de pedidos y la auditoría guarda la IP del proxy.
 */
const PREDETERMINADOS: Record<'development' | 'test', Record<string, string>> = {
  development: {
    DATABASE_URL: 'postgres://app_api:app_api@localhost:5432/conecta',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    WEB_ORIGIN: 'http://localhost:5173',
    TRUST_PROXY: 'false',
    ARCHIVOS_ALMACEN: 'local',
    ARCHIVOS_DIRECTORIO: '../../.archivos',
    // Sin ARCHIVOS_FIRMA_SECRETO: uno aleatorio por proceso. Sin API_ORIGEN_PUBLICO:
    // http://localhost:<PORT>. Los dos los resuelve cargarConfig.
  },
  test: {
    PORT: '0',
    DATABASE_URL: 'postgres://app_api:app_api@localhost:5432/conecta_test',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    WEB_ORIGIN: 'http://localhost:5173',
    TRUST_PROXY: 'false',
    ARCHIVOS_ALMACEN: 'local',
    ARCHIVOS_DIRECTORIO: '../../.archivos-prueba',
    ARCHIVOS_FIRMA_SECRETO: 'pruebas-no-usar-en-produccion-0123456789',
    API_ORIGEN_PUBLICO: 'http://api.prueba.localhost',
  },
};

/** Por qué falta cada variable, cuando no alcanza con «definila». */
const EXPLICACION_FALTANTE: Partial<Record<(typeof CLAVES)[number], string>> = {
  TRUST_PROXY:
    'falta. En producción definila explícitamente: la cantidad de proxies delante de la API ' +
    '(p. ej. 1 detrás del balanceador de Railway) o false si los clientes llegan directo. Sin ' +
    'esto, detrás de un proxy todos los clientes comparten el límite de pedidos y la auditoría ' +
    'guarda la IP del proxy.',
  API_ORIGEN_PUBLICO:
    'falta. Con ARCHIVOS_ALMACEN=local la API arma las URLs de descarga absolutas con su origen ' +
    'público (p. ej. https://api.example.com).',
};

export class ErrorDeConfiguracion extends Error {
  override name = 'ErrorDeConfiguracion';
}

/** Lee y valida la configuración desde las variables de entorno. Falla con un mensaje que dice qué corregir. */
export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const entorno = entornoSchema.safeParse(env.NODE_ENV ?? 'development');
  if (!entorno.success) {
    throw new ErrorDeConfiguracion(
      `NODE_ENV tiene un valor inválido («${env.NODE_ENV ?? ''}»). Usá development, test o production.`,
    );
  }

  const predeterminados: Record<string, string | undefined> = {
    ...PREDETERMINADOS_COMUNES,
    ...(entorno.data === 'production' ? {} : PREDETERMINADOS[entorno.data]),
  };
  const valores: Record<string, string | undefined> = { NODE_ENV: entorno.data };
  for (const clave of CLAVES) {
    const valor = env[clave];
    valores[clave] = valor !== undefined && valor !== '' ? valor : predeterminados[clave];
  }

  if (entorno.data === 'development' && valores['API_ORIGEN_PUBLICO'] === undefined) {
    valores['API_ORIGEN_PUBLICO'] = `http://localhost:${valores['PORT'] ?? '3000'}`;
  }

  const resultado = esquemaPara(entorno.data, valores['ARCHIVOS_ALMACEN']).safeParse(valores);
  if (!resultado.success) {
    const vistas = new Set<string>();
    const detalle = resultado.error.issues
      .map((issue) => {
        const clave = String(issue.path[0] ?? '');
        if (vistas.has(clave)) return null;
        vistas.add(clave);
        if (valores[clave] !== undefined) return `- ${clave}: valor inválido (${issue.message}).`;
        const explicacion = EXPLICACION_FALTANTE[clave as (typeof CLAVES)[number]];
        return explicacion
          ? `- ${clave}: ${explicacion}`
          : `- ${clave}: falta. Definila en el entorno (ver .env.example).`;
      })
      .filter((linea) => linea !== null)
      .join('\n');
    throw new ErrorDeConfiguracion(
      `La configuración de la API es inválida (NODE_ENV=${entorno.data}):\n${detalle}`,
    );
  }

  const c = resultado.data;
  const supabaseUrl = c.SUPABASE_URL.replace(/\/+$/, '');
  return {
    entorno: c.NODE_ENV,
    puerto: c.PORT,
    databaseUrl: c.DATABASE_URL,
    poolMax: c.DATABASE_POOL_MAX,
    supabaseUrl,
    supabaseJwksUrl: c.SUPABASE_JWKS_URL,
    emisorJwt: `${supabaseUrl}/auth/v1`,
    webOrigenes: c.WEB_ORIGIN,
    webOrigenPublico: c.WEB_ORIGEN_PUBLICO ?? new URL(c.WEB_ORIGIN[0] ?? '').origin,
    apiOrigenPublico: c.API_ORIGEN_PUBLICO ?? null,
    trustProxy:
      c.TRUST_PROXY === 'false' || c.TRUST_PROXY === '0'
        ? false
        : c.TRUST_PROXY === 'true'
          ? 1
          : Number(c.TRUST_PROXY),
    limitePedidosPorMinuto: c.RATE_LIMIT_PER_MINUTE,
    limitePedidosPorUsuario: c.RATE_LIMIT_USER_PER_MINUTE,
    supabaseSecretKey: c.SUPABASE_SECRET_KEY,
    archivos: {
      almacen: c.ARCHIVOS_ALMACEN,
      directorio: c.ARCHIVOS_DIRECTORIO,
      bucket: c.ARCHIVOS_BUCKET,
      // Solo puede faltar en desarrollo (en pruebas hay uno fijo; en producción es obligatorio).
      secretoFirma: c.ARCHIVOS_FIRMA_SECRETO ?? randomBytes(32).toString('base64url'),
    },
  };
}
