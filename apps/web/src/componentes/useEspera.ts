import { useEffect, useState } from 'react';

/**
 * Devuelve `valor` recién cuando dejó de cambiar durante `ms` (espera corta al tipear): mientras
 * la persona escribe no sale un pedido por cada letra.
 */
export function useEspera<T>(valor: T, ms: number): T {
  const [estable, setEstable] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setEstable(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return estable;
}
