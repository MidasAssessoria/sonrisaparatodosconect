/** Entrada de desarrollo de la prueba técnica (sin router, sin sesión). */
import '@conecta/ui/estilos.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PruebaOdontograma } from '../PruebaOdontograma.js';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el elemento #raiz');
createRoot(raiz).render(
  <StrictMode>
    <PruebaOdontograma />
  </StrictMode>,
);
