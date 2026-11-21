import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CONFIG, cargarConfig, type Config } from './config.js';

async function arrancar(): Promise<void> {
  // Validar antes de cargar la app: si falta una variable, el proceso termina con un mensaje claro.
  // NestJS y los módulos se importan recién después (import dinámico): con la configuración
  // inválida no se carga nada más, así el error sale rápido.
  cargarConfig();
  const [{ NestFactory }, { AppModule }, { OPCIONES_APP, configurarApp }] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('./app.js'),
  ]);
  const app = configurarApp(
    await NestFactory.create<NestExpressApplication>(AppModule, {
      ...OPCIONES_APP,
      logger: ['error', 'warn', 'log'],
    }),
  );
  // La configuración en uso es la del módulo (el secreto de firma aleatorio de desarrollo se
  // genera una vez por proceso, ahí).
  const config = app.get<Config>(CONFIG);
  await app.listen(config.puerto);
  console.log(`API escuchando en el puerto ${String(config.puerto)} (${config.entorno})`);
}

arrancar().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
