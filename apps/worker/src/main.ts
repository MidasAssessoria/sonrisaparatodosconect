import { iniciarWorker } from './worker.js';

const worker = iniciarWorker({ info: (mensaje) => console.log(mensaje) });

for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(senal, () => {
    void worker.detener(senal);
  });
}

// Mantiene vivo el proceso hasta recibir una señal; sin cola todavía no hay otro trabajo pendiente.
const latido = setInterval(() => undefined, 60_000);

await worker.cerrado;
clearInterval(latido);
console.log('worker cerrado');
