import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { Inicio } from './paginas/Inicio.js';

export function App() {
  const [clienteConsultas] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={clienteConsultas}>
      <Routes>
        <Route path="/" element={<Inicio />} />
      </Routes>
    </QueryClientProvider>
  );
}
