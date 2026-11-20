/** `pnpm --filter @conecta/db migrar`: aplica las migraciones pendientes sobre DATABASE_URL_ADMIN. */
import { migrar } from '../migrar.js';
import { urlAdminDelEntorno } from './entorno.js';

try {
  const resultado = await migrar(urlAdminDelEntorno(), {
    registrar: (mensaje) => console.log(mensaje),
  });
  console.log(
    resultado.aplicadas.length
      ? `Listo: ${resultado.aplicadas.length} migraciones aplicadas.`
      : `Nada para aplicar: las ${resultado.yaAplicadas} migraciones ya estaban aplicadas.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
