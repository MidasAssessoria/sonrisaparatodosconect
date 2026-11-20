import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions, defineConfig, loadEnv } from 'vite';

// '@conecta/source' hace que los paquetes internos (@conecta/shared, @conecta/ui) se lean desde su fuente TS.
const CONDICION_FUENTE = '@conecta/source';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  return {
    envDir: '../..',
    plugins: [react()],
    resolve: { conditions: [CONDICION_FUENTE, ...defaultClientConditions] },
    ssr: { resolve: { conditions: [CONDICION_FUENTE, ...defaultServerConditions] } },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
