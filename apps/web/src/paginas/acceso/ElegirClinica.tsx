import { Boton, Icono } from '@conecta/ui';
import { useState } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { mensajeDeError } from '../../api/errores.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';

export function ElegirClinica() {
  const t = useTextos();
  const { estado, elegirClinica, cerrarSesion } = useSesion();
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (estado.fase !== 'elegir_clinica') return null;

  async function elegir(id: string) {
    if (eligiendo !== null) return;
    setEligiendo(id);
    setError(null);
    try {
      await elegirClinica(id);
    } catch (e) {
      setError(mensajeDeError(e));
      setEligiendo(null);
    }
  }

  return (
    <MarcoAcceso titulo={t.clinica.titulo}>
      <p className="w-acceso__texto">{t.clinica.texto}</p>
      <ul className="w-opciones" aria-label={t.clinica.titulo}>
        {estado.clinicas.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="w-opcion"
              aria-current={c.id === estado.actualId ? 'true' : undefined}
              disabled={eligiendo !== null}
              onClick={() => void elegir(c.id)}
            >
              <Icono nombre="sede" tamano={22} />
              <span className="w-opcion__texto">{c.nombre}</span>
              {c.id === estado.actualId ? <Icono nombre="check" tamano={20} /> : null}
              <Icono nombre="chevron" tamano={20} />
            </button>
          </li>
        ))}
      </ul>
      {error ? <MensajeError texto={error} /> : null}
      <Boton variante="fantasma" bloque icono="salir" onClick={() => void cerrarSesion()}>
        {t.armazon.cerrarSesion}
      </Boton>
    </MarcoAcceso>
  );
}
