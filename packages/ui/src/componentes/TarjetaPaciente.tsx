import type { ReactElement } from 'react';
import type { Tono } from '../tipos.js';
import { cx } from '../utilidades.js';
import { Avatar } from './Avatar.js';
import { Chip } from './estado.js';
import { Icono, type IconoNombre } from './Icono.js';

export interface TarjetaPacienteProps {
  nombre: string;
  edad?: number | undefined;
  /** Documento ya formateado para mostrar (p. ej. «CI 4.123.456»). */
  documento?: string | undefined;
  telefono?: string | undefined;
  proximoTurno?: string | undefined;
  chips?: { tono: Tono; texto: string; icono?: IconoNombre | null | undefined }[] | undefined;
  desactivado?: boolean | undefined;
  onAbrir?: (() => void) | undefined;
  className?: string | undefined;
}

/** «34 años», «1 año», «Menos de 1 año». */
function textoEdad(edad: number): string {
  if (edad < 1) return 'Menos de 1 año';
  return edad === 1 ? '1 año' : `${edad} años`;
}

/** Tarjeta de paciente en listas: toda la tarjeta abre la ficha. */
export function TarjetaPaciente({
  nombre,
  edad,
  documento,
  telefono,
  proximoTurno,
  chips,
  desactivado,
  onAbrir,
  className,
}: TarjetaPacienteProps): ReactElement {
  const meta = [edad != null ? textoEdad(edad) : null, documento, telefono]
    .filter(Boolean)
    .join(' · ');
  return (
    <article className={cx('cn-tarjeta-paciente', desactivado && 'is-desactivado', className)}>
      <button type="button" className="cn-tarjeta-paciente__boton" onClick={onAbrir}>
        <Avatar nombre={nombre} decorativo={true} />
        <span className="cn-tarjeta-paciente__cuerpo">
          <span className="cn-tarjeta-paciente__nombre">{nombre}</span>
          {meta ? <span className="cn-tarjeta-paciente__meta">{meta}</span> : null}
          {proximoTurno ? (
            <span className="cn-tarjeta-paciente__turno">
              <Icono nombre="agenda" tamano={16} />
              Próximo turno: {proximoTurno}
            </span>
          ) : null}
          {chips && chips.length ? (
            <span className="cn-tarjeta-paciente__chips">
              {chips.map((c, i) => (
                <Chip key={i} tono={c.tono} icono={c.icono}>
                  {c.texto}
                </Chip>
              ))}
            </span>
          ) : null}
        </span>
        <Icono nombre="chevron" tamano={20} className="cn-tarjeta-paciente__flecha" />
      </button>
    </article>
  );
}
