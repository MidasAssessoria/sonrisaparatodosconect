import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { crearServicioAuthDesdeEntorno } from './auth/supabase.js';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el elemento #raiz en index.html');

const auth = crearServicioAuthDesdeEntorno();

createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      <App servicios={{ auth }} />
    </BrowserRouter>
  </StrictMode>,
);
