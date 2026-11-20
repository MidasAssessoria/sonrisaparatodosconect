import { defineConfig } from 'vitest/config';

// Las pruebas corren contra un Postgres real: embebido en local, DATABASE_URL_TEST en CI.
// El globalSetup lo levanta una vez, aplica las migraciones y lo apaga al final.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Cada prueba crea sus propias clínicas con ids nuevos: los archivos pueden correr en paralelo.
  },
});
