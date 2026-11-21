import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@conecta/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Postgres real (embebido en local, DATABASE_URL_TEST en CI), como en apps/api: por ruta al
    // fuente de @conecta/db (el globalSetup se carga fuera de la condición @conecta/source).
    globalSetup: ['../../packages/db/src/pruebas/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
