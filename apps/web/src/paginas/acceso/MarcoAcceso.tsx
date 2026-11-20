import { Marca, SelectorIdioma } from '@conecta/ui';
import type { ReactNode } from 'react';
import { useIdioma } from '../../i18n/idioma.js';

/** Armazón de las pantallas sin sesión: marca, ES · GN y una tarjeta centrada. */
export function MarcoAcceso({ titulo, children }: { titulo: string; children: ReactNode }) {
  const { idioma, setIdioma, t } = useIdioma();
  return (
    <div className="w-acceso">
      <header className="w-acceso__cabecera">
        <Marca />
        <SelectorIdioma valor={idioma} onCambio={setIdioma} />
      </header>
      <main className="w-acceso__tarjeta">
        <p className="w-acceso__saludo" lang="gn">
          {t.comun.saludo}
        </p>
        <h1 className="w-acceso__titulo">{titulo}</h1>
        {children}
      </main>
    </div>
  );
}
