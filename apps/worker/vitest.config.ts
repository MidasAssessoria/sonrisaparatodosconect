import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@conecta/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
