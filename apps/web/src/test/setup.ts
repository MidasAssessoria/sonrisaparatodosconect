import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { tomarRutasNoSimuladas } from './rutasNoSimuladas.js';

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
