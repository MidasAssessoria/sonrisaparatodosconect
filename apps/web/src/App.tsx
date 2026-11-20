import '@conecta/ui/estilos.css';
import './estilos.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ServicioAuth } from './auth/servicioAuth.js';
import { esReintentable } from './api/errores.js';
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
        // Solo la red y un 5xx genérico se reintentan solos. Nunca un 429 ni un 503
        // (reintento manual), ni errores de acceso o de datos.
        retry: (intentos, error) => esReintentable(error) && intentos < 2,
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
