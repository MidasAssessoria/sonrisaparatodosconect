import { defineConfig } from 'vitest/config';

// Las pruebas corren contra un Postgres real: embebido en local, DATABASE_URL_TEST en CI.
// El globalSetup lo levanta una vez, aplica las migraciones y lo apaga al final.
export default defineConfig({
  // @conecta/shared se lee desde su fuente TS (como en apps/api): las pruebas comparan la base con
  // el contrato actual, no con un dist que puede estar viejo o no existir (en CI las pruebas corren
  // antes del build).
  ssr: {
    resolve: {
      conditions: ['@conecta/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Cada prueba crea sus propias clínicas con ids nuevos: los archivos pueden correr en paralelo.
  },
});
