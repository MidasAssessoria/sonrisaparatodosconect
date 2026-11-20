import { Boton, Icono } from '@conecta/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorConecta, mensajeDeError } from '../api/errores.js';
import { useTextos } from '../i18n/idioma.js';

/*
 * Piezas de estado que todavía no están en @conecta/ui (convendría pasarlas allá):
 * filas esqueleto, mensaje de error con reintento, candado de «sin acceso» y aviso persistente.
 */

/** Filas esqueleto en `fondo-suave` mientras carga una lista. */
export function Esqueleto({ filas = 3, etiqueta }: { filas?: number; etiqueta: string }) {
  return (
    <div className="w-esqueleto" role="status" aria-label={etiqueta} aria-busy="true">
      {Array.from({ length: filas }, (_, i) => (
        <span key={i} className="w-esqueleto__fila" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Segundos que faltan hasta `hasta` (ms), actualizados cada segundo; 0 si ya pasó o no hay. */
function useSegundosRestantes(hasta: number | null): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (hasta === null) return;
    const id = setInterval(() => {
      const n = Date.now();
      setAhora(n);
      if (n >= hasta) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [hasta]);
  return hasta === null ? 0 : Math.max(0, Math.ceil((hasta - ahora) / 1000));
}

/**
 * Error con ícono, texto en coral-texto y acción para resolverlo. Con un 429 que trae
 * `Retry-After`, el reintento queda deshabilitado (con la cuenta regresiva) hasta que se pueda.
 */
export function MensajeError({
  error,
  texto,
  onReintentar,
}: {
  error?: unknown;
  texto?: string;
  onReintentar?: () => void;
}) {
  const t = useTextos();
  const hasta = error instanceof ErrorConecta ? error.reintentarDesde : null;
  const restantes = useSegundosRestantes(hasta);
  return (
    <div className="w-error" role="alert">
      <Icono nombre="alerta" tamano={22} />
      <div className="w-error__cuerpo">
        <p className="w-error__texto">{texto ?? mensajeDeError(error)}</p>
        {onReintentar ? (
          <Boton
            variante="secundario"
            icono="sincronizar"
            disabled={restantes > 0}
            onClick={onReintentar}
          >
            {restantes > 0 ? t.comun.reintentarEn(restantes) : t.comun.reintentar}
          </Boton>
        ) : null}
      </div>
    </div>
  );
}

/** Pantalla o bloque restringido: candado + «Tu rol no tiene acceso a esto». */
export function Candado({ accion }: { accion?: ReactNode }) {
  const t = useTextos();
  return (
    <section className="w-candado" aria-labelledby="w-candado-titulo">
      <span className="w-candado__icono" aria-hidden="true">
        <Icono nombre="candado" tamano={32} />
      </span>
      <h1 id="w-candado-titulo" className="w-candado__titulo">
        {t.comun.sinAcceso}
      </h1>
      <p className="w-candado__texto">{t.comun.sinAccesoTexto}</p>
      {accion}
    </section>
  );
}

/** Aviso de atención que no se puede cerrar. */
export function AvisoPersistente({
  titulo,
  texto,
  accion,
}: {
  titulo: ReactNode;
  texto?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="w-aviso-atencion" role="status">
      <Icono nombre="alerta" tamano={22} />
      <div className="w-aviso-atencion__cuerpo">
        <p className="w-aviso-atencion__titulo">{titulo}</p>
        {texto ? <p className="w-aviso-atencion__texto">{texto}</p> : null}
      </div>
      {accion ? <div className="w-aviso-atencion__accion">{accion}</div> : null}
    </div>
  );
}
