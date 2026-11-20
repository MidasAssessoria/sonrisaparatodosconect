import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { tomarRutasNoSimuladas } from './rutasNoSimuladas.js';

// Las pantallas se cargan con React.lazy: en un runner lento o con la máquina cargada, el segundo
// que Testing Library espera por defecto no alcanza y las pruebas fallan sin que haya un defecto.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // sin almacenamiento
  }
  const sinSimular = tomarRutasNoSimuladas();
  if (sinSimular.length) {
    throw new Error(
      `La prueba pidió rutas que no simuló: ${[...new Set(sinSimular)].join(', ')}. ` +
        'Agregalas a crearFetchFalso (o revisá por qué salió ese pedido).',
    );
  }
});
