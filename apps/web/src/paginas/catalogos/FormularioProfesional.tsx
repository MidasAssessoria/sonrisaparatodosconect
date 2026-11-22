import {
  crearProfesionalSchema,
  type CrearProfesional,
  type EditarProfesional,
  type Persona,
  type Profesional,
} from '@conecta/shared';
import { Campo, Icono } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { COLORES_SEDE } from '../sedes/estadoSede.js';
import { Interruptor } from './Interruptor.js';

type CampoForm = 'nombre' | 'especialidad' | 'color' | 'registroProf' | 'membresiaId';
type Errores = Partial<Record<CampoForm, string>>;

export interface DatosProfesional {
  nombre: string;
  especialidad: string;
  color: string;
  registroProf: string;
  /** '' = sin persona del equipo asociada. */
  membresiaId: string;
  activo: boolean;
}

/** Colores de la agenda: los de marca del design system (nunca los clínicos). */
export const COLORES_PROFESIONAL = COLORES_SEDE;

export function datosProfesional(p?: Profesional): DatosProfesional {
  return {
    nombre: p?.nombre ?? '',
    especialidad: p?.especialidad ?? '',
    color: p?.color ?? COLORES_PROFESIONAL[0]?.valor ?? '#2ec4b6',
    registroProf: p?.registroProf ?? '',
    membresiaId: p?.membresiaId ?? '',
    activo: p?.activo ?? true,
  };
}

export type EnvioProfesional =
  { modo: 'crear'; datos: CrearProfesional } | { modo: 'editar'; datos: EditarProfesional };

/** Valida con el contrato. En el alta se omite lo vacío; en la edición lo vacío se borra (`null`). */
export function validarProfesional(
  d: DatosProfesional,
  modo: 'crear' | 'editar',
): { ok: true; envio: EnvioProfesional } | { ok: false; errores: Errores } {
  const r = crearProfesionalSchema.safeParse({
    nombre: d.nombre,
    color: d.color,
    ...(d.especialidad.trim() ? { especialidad: d.especialidad } : {}),
    ...(d.registroProf.trim() ? { registroProf: d.registroProf } : {}),
    ...(d.membresiaId ? { membresiaId: d.membresiaId } : {}),
  });
  if (!r.success) {
    const errores: Errores = {};
    for (const issue of r.error.issues) {
      const campo = issue.path[0] as CampoForm | undefined;
      if (!campo || errores[campo]) continue;
      errores[campo] =
        campo === 'nombre'
          ? issue.code === 'too_big'
            ? 'El nombre puede tener hasta 120 caracteres.'
            : 'Poné el nombre.'
          : campo === 'especialidad'
            ? 'La especialidad puede tener hasta 80 caracteres.'
            : campo === 'registroProf'
              ? 'El registro puede tener hasta 40 caracteres.'
              : issue.message;
    }
    return { ok: false, errores };
  }
  if (modo === 'crear') return { ok: true, envio: { modo, datos: r.data } };
  return {
    ok: true,
    envio: {
      modo,
      datos: {
        nombre: r.data.nombre,
        color: r.data.color,
        especialidad: r.data.especialidad ?? null,
        registroProf: r.data.registroProf ?? null,
        membresiaId: r.data.membresiaId ?? null,
        activo: d.activo,
      },
    },
  };
}

/** Alta y edición. Va dentro de una `HojaInferior`; el botón de guardar apunta al form por `id`. */
export function FormularioProfesional({
  id,
  modo,
  inicial,
  personas,
  onGuardar,
  error,
}: {
  id: string;
  modo: 'crear' | 'editar';
  inicial: DatosProfesional;
  /** `null` = no se pueden listar (sin `personal:ver` o falló la carga). */
  personas: Persona[] | null;
  onGuardar: (envio: EnvioProfesional) => void;
  error?: unknown;
}) {
  const [d, setD] = useState(inicial);
  const [errores, setErrores] = useState<Errores>({});

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = validarProfesional(d, modo);
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    onGuardar(r.envio);
  }

  // Personas activas o pendientes que no son ya otro profesional (más la asociada ahora).
  const elegibles = (personas ?? []).filter(
    (p) =>
      p.membresiaId === inicial.membresiaId ||
      (p.estado !== 'inactivo' && p.profesionalId === null),
  );

  return (
    <form id={id} className="w-formulario" onSubmit={enviar} noValidate>
      <Campo
        etiqueta="Nombre"
        requerido
        value={d.nombre}
        maxLength={120}
        placeholder="Dra. Marta Acosta"
        onChange={(e) => setD({ ...d, nombre: e.target.value })}
        error={errores.nombre}
      />
      <Campo
        etiqueta="Especialidad"
        value={d.especialidad}
        maxLength={80}
        placeholder="Ortodoncia"
        onChange={(e) => setD({ ...d, especialidad: e.target.value })}
        error={errores.especialidad}
      />
      <Campo
        etiqueta="Registro profesional"
        value={d.registroProf}
        maxLength={40}
        ayuda="Sale en recetas y consentimientos."
        onChange={(e) => setD({ ...d, registroProf: e.target.value })}
        error={errores.registroProf}
      />
      {personas !== null ? (
        <Campo
          etiqueta="Persona del equipo"
          tipo="select"
          value={d.membresiaId}
          ayuda="Si atiende y además entra al sistema. Puede quedar sin persona asociada."
          opciones={[
            { valor: '', texto: 'Sin persona del equipo' },
            ...elegibles.map((p) => ({ valor: p.membresiaId, texto: `${p.nombre} · ${p.email}` })),
          ]}
          onChange={(e) => setD({ ...d, membresiaId: e.target.value })}
          error={errores.membresiaId}
        />
      ) : null}
      <fieldset className="w-colores">
        <legend className="w-colores__leyenda">Color en la agenda · obligatorio</legend>
        <div className="w-colores__opciones" role="radiogroup" aria-label="Color en la agenda">
          {COLORES_PROFESIONAL.map((c) => {
            const elegido = d.color.toLowerCase() === c.valor.toLowerCase();
            return (
              <button
                key={c.valor}
                type="button"
                role="radio"
                aria-checked={elegido}
                className="w-color"
                onClick={() => setD({ ...d, color: c.valor })}
              >
                <span
                  className="w-color__muestra"
                  style={{ background: c.valor }}
                  aria-hidden="true"
                >
                  {elegido ? <Icono nombre="check" tamano={16} /> : null}
                </span>
                <span>{c.nombre}</span>
              </button>
            );
          })}
        </div>
        {errores.color ? <p className="w-error-campo">{errores.color}</p> : null}
      </fieldset>
      {modo === 'editar' ? (
        <Interruptor
          etiqueta="Activo"
          ayuda="Un profesional inactivo no aparece para dar turnos. No se borra nada."
          activo={d.activo}
          onCambiar={(activo) => setD({ ...d, activo })}
        />
      ) : null}
      {error ? <MensajeError error={error} /> : null}
    </form>
  );
}
