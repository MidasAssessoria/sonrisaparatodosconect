import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const entornoSchema = z.enum(['development', 'test', 'production']);

const configSchema = z.object({
  NODE_ENV: entornoSchema,
  PORT: z.coerce.number().int().min(0).max(65535),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SUPABASE_URL: z.url(),
  SUPABASE_JWKS_URL: z.url(),
});

export interface Config {
  entorno: z.infer<typeof entornoSchema>;
  puerto: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseJwksUrl: string;
}

/** Valores para desarrollo y pruebas. En producción no hay valores por defecto: todo es obligatorio. */
const PREDETERMINADOS: Record<'development' | 'test', Record<string, string>> = {
  development: {
    PORT: '3000',
    DATABASE_URL: 'postgres://app_api:app_api@localhost:5432/conecta',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
  },
  test: {
    PORT: '0',
    DATABASE_URL: 'postgres://app_api:app_api@localhost:5432/conecta_test',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
  },
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

  const predeterminados = entorno.data === 'production' ? {} : PREDETERMINADOS[entorno.data];
  const valores: Record<string, string | undefined> = { NODE_ENV: entorno.data };
  for (const clave of ['PORT', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_JWKS_URL'] as const) {
    const valor = env[clave];
    valores[clave] = valor !== undefined && valor !== '' ? valor : predeterminados[clave];
  }
  // PORT tiene un valor por defecto razonable incluso en producción (Railway lo define siempre).
  valores.PORT ??= '3000';

  const resultado = configSchema.safeParse(valores);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((issue) => {
        const clave = issue.path.join('.');
        return valores[clave] === undefined
          ? `- ${clave}: falta. Definila en el entorno (ver .env.example).`
          : `- ${clave}: valor inválido (${issue.message}).`;
      })
      .join('\n');
    throw new ErrorDeConfiguracion(
      `La configuración de la API es inválida (NODE_ENV=${entorno.data}):\n${detalle}`,
    );
  }

  const c = resultado.data;
  return {
    entorno: c.NODE_ENV,
    puerto: c.PORT,
    databaseUrl: c.DATABASE_URL,
    supabaseUrl: c.SUPABASE_URL,
    supabaseJwksUrl: c.SUPABASE_JWKS_URL,
  };
}
