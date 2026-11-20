import '@conecta/ui/estilos.css';
import './estilos.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ServicioAuth } from './auth/servicioAuth.js';
import { ErrorConecta, reaccionPorCodigo } from './api/errores.js';
import { ProveedorIdioma } from './i18n/idioma.js';
import { PantallaSinConfiguracion } from './paginas/acceso/PantallasEstado.js';
import { Rutas } from './Rutas.js';
import { ProveedorSesion } from './sesion/ProveedorSesion.js';

export interface ServiciosApp {
  /** Autenticación (Supabase en producción; uno falso en las pruebas). `null` = sin configurar. */
  auth: ServicioAuth | null;
  /** `fetch` para la API (por defecto el global). */
  fetch?: typeof fetch | undefined;
}

export function crearClienteConsultas(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Errores de acceso o de datos no se arreglan reintentando.
        retry: (intentos, error) =>
          error instanceof ErrorConecta &&
          reaccionPorCodigo(error.codigo).tipo === 'mensaje' &&
          ['sin_conexion', 'error_interno'].includes(error.codigo) &&
          intentos < 2,
      },
    },
  });
}

/** La app espera estar dentro de un router (`BrowserRouter` en `main.tsx`, `MemoryRouter` en pruebas). */
export function App({ servicios }: { servicios: ServiciosApp }) {
  const [consultas] = useState(crearClienteConsultas);
  return (
    <ProveedorIdioma>
      {servicios.auth ? (
        <QueryClientProvider client={consultas}>
          <ProveedorSesion auth={servicios.auth} fetch={servicios.fetch}>
            <Rutas />
          </ProveedorSesion>
        </QueryClientProvider>
      ) : (
        <PantallaSinConfiguracion />
      )}
    </ProveedorIdioma>
  );
}
