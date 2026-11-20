import type { Idioma } from '@conecta/ui';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { claves, escribir, leer } from '../sesion/preferencias.js';
import { es, type Textos, type TextosParciales } from './es.js';
import { gn } from './gn.js';

const DICCIONARIOS: Record<Idioma, TextosParciales> = { es, gn };

/** Español completo con lo que haya traducido encima. */
export function textosPara(idioma: Idioma): Textos {
  const parcial = DICCIONARIOS[idioma];
  const base = es as unknown as Textos;
  const resultado = { ...base } as Record<string, unknown>;
  for (const seccion of Object.keys(base) as (keyof Textos)[]) {
    resultado[seccion] = { ...base[seccion], ...(parcial[seccion] ?? {}) };
  }
  return resultado as unknown as Textos;
}

interface ValorIdioma {
  idioma: Idioma;
  setIdioma: (i: Idioma) => void;
  t: Textos;
}

const ContextoIdioma = createContext<ValorIdioma | null>(null);

function idiomaGuardado(): Idioma {
  return leer(claves.idioma) === 'gn' ? 'gn' : 'es';
}

export function ProveedorIdioma({ children }: { children: ReactNode }) {
  const [idioma, setIdiomaEstado] = useState<Idioma>(idiomaGuardado);
  useEffect(() => {
    document.documentElement.lang = idioma === 'gn' ? 'gn' : 'es-PY';
  }, [idioma]);
  const valor = useMemo<ValorIdioma>(
    () => ({
      idioma,
      setIdioma: (i) => {
        escribir(claves.idioma, i);
        setIdiomaEstado(i);
      },
      t: textosPara(idioma),
    }),
    [idioma],
  );
  return <ContextoIdioma.Provider value={valor}>{children}</ContextoIdioma.Provider>;
}

export function useIdioma(): ValorIdioma {
  const v = useContext(ContextoIdioma);
  if (!v) throw new Error('useIdioma necesita <ProveedorIdioma>');
  return v;
}

export function useTextos(): Textos {
  return useIdioma().t;
}
