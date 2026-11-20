import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { PacienteResultado } from '../tipos.js';
import { cx } from '../utilidades.js';
import { Avatar } from './Avatar.js';
import { Chip } from './estado.js';
import { Icono } from './Icono.js';

export interface BuscadorProps {
  /** Controlado: pasá valor + onCambio y filtrá resultados vos. Sin valor, filtra resultados solo. */
  valor?: string | undefined;
  valorInicial?: string | undefined;
  onCambio?: ((v: string) => void) | undefined;
  resultados?: PacienteResultado[] | undefined;
  onElegir?: ((p: PacienteResultado) => void) | undefined;
  placeholder?: string | undefined;
  etiqueta?: string | undefined;
  compacto?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Buscador de pacientes con resultados mientras se escribe (combobox con lista).
 * Flechas recorren, Enter elige, Escape cierra la lista.
 */
export function Buscador({
  valor: valorControlado,
  valorInicial,
  onCambio,
  resultados,
  onElegir,
  placeholder,
  etiqueta,
  compacto,
  className,
}: BuscadorProps): ReactElement {
  const id = useId();
  const idLista = `${id}-lista`;
  const [texto, setTexto] = useState(valorInicial ?? '');
  const [activo, setActivo] = useState(-1);
  const [cerrado, setCerrado] = useState(false);
  const valor = valorControlado ?? texto;
  const q = valor.trim().toLowerCase();

  let res = resultados;
  if (res && valorControlado == null) {
    res = res.filter((r) =>
      `${r.nombre} ${r.documento ?? ''} ${r.telefono ?? ''}`.toLowerCase().includes(q),
    );
  }
  const abierto = q.length > 0 && !!res && !cerrado;
  const cantidad = res?.length ?? 0;
  const indice = abierto && activo < cantidad ? activo : -1;
  const conLista = abierto && cantidad > 0;

  function elegir(r: PacienteResultado) {
    onElegir?.(r);
    setCerrado(true);
    setActivo(-1);
  }

  function alTecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!res || cantidad === 0 || q.length === 0) return;
      e.preventDefault();
      if (!abierto) {
        setCerrado(false);
        setActivo(e.key === 'ArrowDown' ? 0 : cantidad - 1);
        return;
      }
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      setActivo((indice + paso + cantidad) % cantidad);
    } else if (e.key === 'Enter') {
      const r = res?.[indice];
      if (abierto && r) {
        e.preventDefault();
        elegir(r);
      }
    } else if (e.key === 'Escape') {
      if (abierto) {
        e.preventDefault();
        e.stopPropagation();
        setCerrado(true);
        setActivo(-1);
      }
    }
  }

  return (
    <div
      className={cx('cn-buscador', compacto && 'cn-buscador--compacto', className)}
      role="search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setCerrado(true);
      }}
    >
      <label htmlFor={id} className="cn-oculto">
        {etiqueta ?? 'Buscar paciente'}
      </label>
      <Icono nombre="buscar" tamano={20} className="cn-buscador__icono" />
      <input
        id={id}
        type="search"
        className="cn-buscador__campo"
        value={valor}
        onChange={(e) => {
          setTexto(e.target.value);
          setCerrado(false);
          setActivo(-1);
          onCambio?.(e.target.value);
        }}
        onFocus={() => setCerrado(false)}
        onKeyDown={alTecla}
        placeholder={placeholder ?? 'Buscar paciente: nombre, CI o teléfono'}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={conLista}
        aria-controls={conLista ? idLista : undefined}
        aria-activedescendant={indice >= 0 ? `${idLista}-${indice}` : undefined}
      />
      {abierto && res && (
        <div className="cn-buscador__resultados">
          {cantidad ? (
            <ul id={idLista} role="listbox" aria-label="Pacientes encontrados">
              {res.map((r, i) => (
                <li
                  key={`${r.nombre}-${r.documento ?? i}`}
                  id={`${idLista}-${i}`}
                  role="option"
                  aria-selected={i === indice}
                  className={cx('cn-buscador__item', i === indice && 'is-activo')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(r)}
                >
                  <Avatar nombre={r.nombre} tamano="sm" decorativo={true} />
                  <span className="cn-buscador__texto">
                    <span className="cn-buscador__nombre">{r.nombre}</span>
                    <span className="cn-buscador__meta">
                      {[r.documento, r.telefono].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {r.alerta ? <Chip tono="atencion">{r.alerta}</Chip> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="cn-buscador__vacio" role="status">
              Sin resultados para «{valor}». Revisá cómo está escrito o buscá por CI.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
