import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as EventoTecladoReact,
} from 'react';

type Destino = 'primero' | 'ultimo' | null;

/**
 * Comportamiento de botón con menú (patrón «menu button» de WAI-ARIA):
 * abre con clic, Enter, Espacio o flechas; flechas/Inicio/Fin recorren; Escape cierra y
 * devuelve el foco al botón; un clic afuera o Tab cierran.
 */
export function useDesplegable(inicial = false) {
  const [abierto, setAbierto] = useState(inicial);
  const idMenu = useId();
  const refRaiz = useRef<HTMLDivElement>(null);
  const refBoton = useRef<HTMLButtonElement>(null);
  const refMenu = useRef<HTMLUListElement>(null);
  const destino = useRef<Destino>(null);

  const items = useCallback(
    () =>
      Array.from(
        refMenu.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]',
        ) ?? [],
      ),
    [],
  );

  useEffect(() => {
    if (!abierto) return;
    if (destino.current) {
      const lista = items();
      (destino.current === 'ultimo' ? lista[lista.length - 1] : lista[0])?.focus();
      destino.current = null;
    }
    function fuera(e: MouseEvent) {
      if (refRaiz.current && !refRaiz.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto, items]);

  const abrir = useCallback(
    (d: Destino = 'primero') => {
      if (abierto) {
        const lista = items();
        (d === 'ultimo' ? lista[lista.length - 1] : lista[0])?.focus();
        return;
      }
      destino.current = d;
      setAbierto(true);
    },
    [abierto, items],
  );

  const cerrar = useCallback((devolverFoco = true) => {
    setAbierto(false);
    if (devolverFoco) refBoton.current?.focus();
  }, []);

  const alternar = useCallback(() => {
    if (abierto) cerrar(false);
    else abrir('primero');
  }, [abierto, abrir, cerrar]);

  /** onKeyDown del contenedor: cubre el botón y los ítems. */
  const alTecla = useCallback(
    (e: EventoTecladoReact<HTMLElement>) => {
      const enBoton = e.target === refBoton.current;
      if (e.key === 'Escape' && abierto) {
        e.preventDefault();
        e.stopPropagation();
        cerrar(true);
        return;
      }
      if (enBoton) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          abrir(e.key === 'ArrowUp' ? 'ultimo' : 'primero');
        }
        return;
      }
      if (!abierto) return;
      const lista = items();
      const i = lista.indexOf(document.activeElement as HTMLElement);
      let siguiente: HTMLElement | undefined;
      if (e.key === 'ArrowDown') siguiente = lista[(i + 1) % lista.length];
      else if (e.key === 'ArrowUp') siguiente = lista[(i - 1 + lista.length) % lista.length];
      else if (e.key === 'Home') siguiente = lista[0];
      else if (e.key === 'End') siguiente = lista[lista.length - 1];
      else if (e.key === 'Tab') {
        setAbierto(false);
        return;
      }
      if (siguiente) {
        e.preventDefault();
        siguiente.focus();
      }
    },
    [abierto, abrir, cerrar, items],
  );

  return { abierto, idMenu, refRaiz, refBoton, refMenu, alternar, cerrar, alTecla };
}
