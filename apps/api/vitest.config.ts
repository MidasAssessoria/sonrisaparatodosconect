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
  },
});
