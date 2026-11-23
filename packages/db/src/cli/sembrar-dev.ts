/**
 * `pnpm --filter @conecta/db sembrar-dev`: aplica las migraciones y da de alta la clínica de
 * demostración. Opcional: SEMILLA_DUENO_ID y SEMILLA_DUENO_EMAIL para usar un usuario real de
 * Supabase Auth local como dueño.
 */
import { crearPool } from '../contexto.js';
import { migrar } from '../migrar.js';
import { sembrarDemo } from '../semilla.js';
import { urlAdminDelEntorno } from './entorno.js';

let pool: ReturnType<typeof crearPool> | undefined;
try {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('sembrar-dev no corre con NODE_ENV=production.');
  }
  const url = urlAdminDelEntorno();
  await migrar(url);
  pool = crearPool(url, { max: 1 });
  const resultado = await sembrarDemo(pool, {
    duenoId: process.env['SEMILLA_DUENO_ID'] || undefined,
    duenoEmail: process.env['SEMILLA_DUENO_EMAIL'] || undefined,
  });
  const { profesionales, tramos, tratamientos, pacientes, relaciones } = resultado.agregados;
  const agregados = `${profesionales} profesionales, ${tramos} tramos, ${tratamientos} tratamientos, ${pacientes} pacientes y ${relaciones} vínculos`;
  console.log(
    resultado.creada
      ? `Clínica de demostración creada (${resultado.clinicaId}), dueña ${resultado.duenoId}, con ${agregados}.`
      : profesionales + tramos + tratamientos + pacientes + relaciones > 0
        ? `La clínica de demostración ya existía (${resultado.clinicaId}): se completó con ${agregados}.`
        : `La clínica de demostración ya existía (${resultado.clinicaId}) y estaba completa: no se tocó nada.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
