import type { INestApplication } from '@nestjs/common';

export const PREFIJO_API = 'api/v1';

/** Configuración común a `main.ts` y a las pruebas. */
export function configurarApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(PREFIJO_API);
  app.enableShutdownHooks();
  return app;
}
