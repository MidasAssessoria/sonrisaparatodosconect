/**
 * globalSetup de Vitest: levanta el banco una vez por corrida, aplica las migraciones y entrega
 * las URLs a las pruebas con `inject('conectaDb')`. Al terminar apaga Postgres y borra sus datos.
 *
 *   // vitest.config.ts
 *   test: { globalSetup: ['./test/global-setup.ts'] }
 *   // test/global-setup.ts
 *   export { default } from '@conecta/db/pruebas/global-setup';
 */
import type { TestProject } from 'vitest/node';
import { iniciarBanco } from './banco.js';

export default async function configurarBanco(proyecto: TestProject): Promise<() => Promise<void>> {
  const banco = await iniciarBanco({
    registrar: process.env['CONECTA_DB_VERBOSO'] ? (mensaje) => console.log(mensaje) : undefined,
  });
  proyecto.provide('conectaDb', { urlAdmin: banco.urlAdmin, urlApi: banco.urlApi });
  return () => banco.detener();
}
