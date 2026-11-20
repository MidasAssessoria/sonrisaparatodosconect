export interface Registro {
  info(mensaje: string): void;
}

export interface Worker {
  /** Promesa que se resuelve cuando el worker terminó de cerrar. */
  cerrado: Promise<void>;
  detener(motivo: string): Promise<void>;
}

/** Arranca el worker. Todavía no hay cola: solo deja el ciclo de vida listo. */
export function iniciarWorker(registro: Registro): Worker {
  let resolverCierre: () => void = () => undefined;
  const cerrado = new Promise<void>((resolve) => {
    resolverCierre = resolve;
  });
  let deteniendo = false;

  registro.info('worker listo');

  return {
    cerrado,
    detener(motivo) {
      if (!deteniendo) {
        deteniendo = true;
        registro.info(`worker cerrando (${motivo})`);
        // Acá se detendrá la cola (pg-boss) cuando exista.
        resolverCierre();
      }
      return cerrado;
    },
  };
}
