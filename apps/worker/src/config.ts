/**
 * Configuración del worker, validada con Zod al arrancar. Si falta algo, el proceso termina con un
 * mensaje que dice qué corregir (sin mostrar valores: pueden ser secretos).
 *
 *   WORKER_DATABASE_URL   conexión con el rol app_worker (sin BYPASSRLS, no dueño de nada).
 *   WORKER_POOL_MAX       conexiones por pool (pg-boss y lecturas de app). Por defecto 4.
 *   WORKER_CONCURRENCIA   trabajos a la vez por cola. Por defecto 2.
 *   WORKER_CIERRE_MS      cuánto espera el cierre ordenado al trabajo en curso. Por defecto 30000.
 *   ARCHIVOS_ALMACEN, ARCHIVOS_DIRECTORIO, SUPABASE_URL, SUPABASE_SECRET_KEY: como en la API (el
 *   worker relee los archivos del mismo almacén).
 */
import { z } from 'zod';

const entornoSchema = z.enum(['development', 'test', 'production']);

const configSchema = z
  .object({
    NODE_ENV: entornoSchema,
    WORKER_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    WORKER_POOL_MAX: z.coerce.number().int().min(1).max(50),
    WORKER_CONCURRENCIA: z.coerce.number().int().min(1).max(20),
    WORKER_CIERRE_MS: z.coerce.number().int().min(1000).max(600_000),
    ARCHIVOS_ALMACEN: z.enum(['local', 'supabase']),
    ARCHIVOS_DIRECTORIO: z.string().min(1),
    SUPABASE_URL: z.url({ protocol: /^https?$/ }),
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  })
  .refine((c) => c.ARCHIVOS_ALMACEN !== 'supabase' || c.SUPABASE_SECRET_KEY !== undefined, {
    path: ['SUPABASE_SECRET_KEY'],
    message: 'hace falta con ARCHIVOS_ALMACEN=supabase',
  });

export interface ConfigWorker {
  entorno: z.infer<typeof entornoSchema>;
  databaseUrl: string;
  poolMax: number;
  concurrencia: number;
  cierreMs: number;
  archivos: { almacen: 'local' | 'supabase'; directorio: string };
  supabaseUrl: string;
  supabaseSecretKey: string | undefined;
}

const CLAVES = [
  'WORKER_DATABASE_URL',
  'WORKER_POOL_MAX',
  'WORKER_CONCURRENCIA',
  'WORKER_CIERRE_MS',
  'ARCHIVOS_ALMACEN',
  'ARCHIVOS_DIRECTORIO',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
] as const;

const COMUNES: Partial<Record<(typeof CLAVES)[number], string>> = {
  WORKER_POOL_MAX: '4',
  WORKER_CONCURRENCIA: '2',
  WORKER_CIERRE_MS: '30000',
};

const PREDETERMINADOS: Record<
  'development' | 'test',
  Partial<Record<(typeof CLAVES)[number], string>>
> = {
  development: {
    WORKER_DATABASE_URL: 'postgres://app_worker:app_worker@localhost:5432/conecta',
    ARCHIVOS_ALMACEN: 'local',
    ARCHIVOS_DIRECTORIO: '../../.archivos',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  },
  test: {
    WORKER_DATABASE_URL: 'postgres://app_worker:app_worker@localhost:5432/conecta_test',
    ARCHIVOS_ALMACEN: 'local',
    ARCHIVOS_DIRECTORIO: '../../.archivos-prueba',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  },
};

export class ErrorDeConfiguracion extends Error {
  override name = 'ErrorDeConfiguracion';
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): ConfigWorker {
  const entorno = entornoSchema.safeParse(env.NODE_ENV ?? 'development');
  if (!entorno.success) {
    throw new ErrorDeConfiguracion(
      'NODE_ENV tiene un valor inválido. Usá development, test o production.',
    );
  }
  const predeterminados = {
    ...COMUNES,
    ...(entorno.data === 'production' ? {} : PREDETERMINADOS[entorno.data]),
  };
  const valores: Record<string, string | undefined> = { NODE_ENV: entorno.data };
  for (const clave of CLAVES) {
    const valor = env[clave];
    valores[clave] = valor !== undefined && valor !== '' ? valor : predeterminados[clave];
  }
  const resultado = configSchema.safeParse(valores);
  if (!resultado.success) {
    const vistas = new Set<string>();
    const detalle = resultado.error.issues
      .map((issue) => {
        const clave = String(issue.path[0] ?? '');
        if (vistas.has(clave)) return null;
        vistas.add(clave);
        return valores[clave] === undefined
          ? `- ${clave}: falta. Definila en el entorno (ver .env.example).`
          : `- ${clave}: valor inválido (${issue.message}).`;
      })
      .filter((linea) => linea !== null)
      .join('\n');
    throw new ErrorDeConfiguracion(
      `La configuración del worker es inválida (NODE_ENV=${entorno.data}):\n${detalle}`,
    );
  }
  const c = resultado.data;
  return {
    entorno: c.NODE_ENV,
    databaseUrl: c.WORKER_DATABASE_URL,
    poolMax: c.WORKER_POOL_MAX,
    concurrencia: c.WORKER_CONCURRENCIA,
    cierreMs: c.WORKER_CIERRE_MS,
    archivos: { almacen: c.ARCHIVOS_ALMACEN, directorio: c.ARCHIVOS_DIRECTORIO },
    supabaseUrl: c.SUPABASE_URL.replace(/\/+$/, ''),
    supabaseSecretKey: c.SUPABASE_SECRET_KEY,
  };
}
