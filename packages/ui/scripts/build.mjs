// Pasos del build que tsc no hace: `limpiar` borra dist/ y `copiar` lleva CSS y fuentes a dist/
// con la misma estructura que src/ (así las url('../fuentes/…') siguen funcionando).
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(raiz, 'dist');
const paso = process.argv[2];

if (paso === 'limpiar') {
  rmSync(dist, { recursive: true, force: true });
} else if (paso === 'copiar') {
  for (const carpeta of ['estilos', 'fuentes']) {
    cpSync(join(raiz, 'src', carpeta), join(dist, carpeta), { recursive: true });
  }
  const faltan = ['estilos/estilos.css', 'estilos/tokens.css', 'estilos/fuentes.css', 'index.js']
    .concat(readdirSync(join(raiz, 'src', 'fuentes')).map((f) => `fuentes/${f}`))
    .filter((f) => !existsSync(join(dist, f)));
  if (faltan.length) {
    console.error(`Faltan en dist/: ${faltan.join(', ')}`);
    process.exit(1);
  }
} else {
  console.error('Uso: node scripts/build.mjs limpiar|copiar');
  process.exit(1);
}
