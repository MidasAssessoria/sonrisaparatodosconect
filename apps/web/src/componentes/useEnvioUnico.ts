import { useCallback, useRef } from 'react';

/**
 * Evita el doble envío: mientras una acción está en curso, las siguientes llamadas se ignoran.
 * Hace falta aunque el botón muestre «cargando»: el estado de una mutación de TanStack llega a la
 * pantalla en una tarea posterior, y dos clics rápidos alcanzan a mandar dos pedidos.
 */
export function useEnvioUnico() {
  const enCurso = useRef(false);
  return useCallback(async <T>(accion: () => Promise<T>): Promise<T | undefined> => {
    if (enCurso.current) return undefined;
    enCurso.current = true;
    try {
      return await accion();
    } finally {
      enCurso.current = false;
    }
  }, []);
}
