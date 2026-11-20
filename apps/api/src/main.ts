import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { OPCIONES_APP, configurarApp } from './app.js';
import { CONFIG, cargarConfig, type Config } from './config.js';

async function arrancar(): Promise<void> {
  // Validar antes de crear la app: si falta una variable, el proceso termina con un mensaje claro.
  cargarConfig();
  const app = configurarApp(
    await NestFactory.create<NestExpressApplication>(AppModule, {
      ...OPCIONES_APP,
      logger: ['error', 'warn', 'log'],
    }),
  );
  const config = app.get<Config>(CONFIG);
  await app.listen(config.puerto);
  console.log(`API escuchando en el puerto ${config.puerto} (${config.entorno})`);
}

arrancar().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
