import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { PNG_FIRMA } from './lienzo.js';
import { tomarPedidosInvalidos, tomarRutasNoSimuladas } from './rutasNoSimuladas.js';

// Las pantallas se cargan con React.lazy: en un runner lento o con la máquina cargada, el segundo
// que Testing Library espera por defecto no alcanza y las pruebas fallan sin que haya un defecto.
configure({ asyncUtilTimeout: 15_000 });

/*
 * jsdom no dibuja (`getContext` y `toDataURL` no están implementados): la firma manuscrita usa un
 * contexto 2D que acepta todo y un PNG fijo, así un trazo simulado produce una firma.
 */
const metodos2d: Record<string, unknown> = {};
const contexto2d = new Proxy(metodos2d, {
  get: (o, k: string) => (k in o ? o[k] : (o[k] = () => undefined)),
  set: (o, k: string, v: unknown) => ((o[k] = v), true),
});
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => contexto2d,
});
Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  configurable: true,
  value: () => PNG_FIRMA,
});

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // sin almacenamiento
  }
  const sinSimular = tomarRutasNoSimuladas();
  const invalidos = tomarPedidosInvalidos();
  if (invalidos.length) {
    throw new Error(
      `La prueba mandó pedidos que no cumplen el contrato: ${[...new Set(invalidos)].join(' | ')}. ` +
        'La API real los rechazaría: corregí el pedido de la pantalla, no la prueba.',
    );
  }
  if (sinSimular.length) {
    throw new Error(
      `La prueba pidió rutas que no simuló: ${[...new Set(sinSimular)].join(', ')}. ` +
        'Agregalas a crearFetchFalso (o revisá por qué salió ese pedido).',
    );
  }
});
