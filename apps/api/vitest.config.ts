import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS necesita la metadata de los decoradores (emitDecoratorMetadata), que esbuild no emite.
// SWC la genera; la condición @conecta/source hace que los paquetes internos se lean desde su fuente TS.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  // Condición propia + las predeterminadas de Vite para servidor. No agregar 'import' acá:
  // haría que dependencias CJS (router → is-promise) reciban la variante ESM y se rompan.
  ssr: {
    resolve: {
      conditions: ['@conecta/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    // Postgres real (embebido en local, DATABASE_URL_TEST en CI), levantado una vez por corrida.
    // Va por ruta al fuente de @conecta/db a propósito: Vitest carga el globalSetup fuera del entorno
    // donde vale la condición @conecta/source, así que por nombre de paquete resolvería a dist, que
    // no existe en una copia limpia (el CI corre las pruebas antes del build) y en local puede estar viejo.
    globalSetup: ['../../packages/db/src/pruebas/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
