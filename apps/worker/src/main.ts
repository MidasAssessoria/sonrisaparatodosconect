import { cargarConfig } from './config.js';
import { crearRegistroConsola } from './registro.js';
import { iniciarWorker } from './worker.js';

const registro = crearRegistroConsola();

try {
  const config = cargarConfig();
  const worker = await iniciarWorker(config, registro);
  for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(senal, () => {
      void worker.detener(senal);
    });
  }
  await worker.cerrado;
} catch (error) {
  // Solo el mensaje de configuración (no trae valores) o el nombre del error.
  if (error instanceof Error && error.name === 'ErrorDeConfiguracion') console.error(error.message);
  else
    registro.error('worker_no_arranco', {
      error: error instanceof Error ? error.name : 'desconocido',
    });
  process.exitCode = 1;
}
