import {
  crearSedeSchema,
  ESTADOS_SEDE,
  type CrearSede,
  type EstadoSede,
  type Sede,
} from '@conecta/shared';
import { Campo, Icono } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { COLORES_SEDE, TEXTO_ESTADO_SEDE } from './estadoSede.js';

type Errores = Partial<Record<'nombre' | 'direccion' | 'telefono' | 'estado' | 'color', string>>;

export interface DatosFormularioSede {
  nombre: string;
  direccion: string;
  telefono: string;
  estado: EstadoSede;
  color: string | null;
}

export function datosIniciales(sede?: Sede): DatosFormularioSede {
  return {
    nombre: sede?.nombre ?? '',
    direccion: sede?.direccion ?? '',
    telefono: sede?.telefono ?? '',
    estado: sede?.estado ?? 'abierta',
    color: sede?.color ?? null,
  };
}

/** Valida con el esquema del contrato y devuelve el cuerpo listo para la API. */
export function validarSede(
  d: DatosFormularioSede,
): { ok: true; datos: CrearSede } | { ok: false; errores: Errores } {
  const r = crearSedeSchema.safeParse({
    nombre: d.nombre,
    estado: d.estado,
    ...(d.direccion.trim() ? { direccion: d.direccion } : {}),
    ...(d.telefono.trim() ? { telefono: d.telefono } : {}),
    ...(d.color ? { color: d.color } : {}),
  });
  if (r.success) return { ok: true, datos: r.data };
  const errores: Errores = {};
  for (const issue of r.error.issues) {
    const campo = issue.path[0] as keyof Errores | undefined;
    if (campo && !errores[campo]) {
      errores[campo] =
        campo === 'nombre' && issue.code === 'too_big'
          ? 'El nombre puede tener hasta 80 caracteres.'
          : campo === 'nombre'
            ? 'Poné el nombre de la sede.'
            : issue.message;
    }
  }
  return { ok: false, errores };
}

/**
 * Formulario de alta y edición. Va dentro de una `HojaInferior`; el botón de guardar
 * vive en las acciones de la hoja y apunta a este form por `id`.
 */
export function FormularioSede({
  id,
  inicial,
  onGuardar,
  error,
}: {
  id: string;
  inicial: DatosFormularioSede;
  onGuardar: (datos: CrearSede) => void;
  error?: unknown;
}) {
  const [d, setD] = useState(inicial);
  const [errores, setErrores] = useState<Errores>({});

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = validarSede(d);
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    onGuardar(r.datos);
  }

  return (
    <form id={id} className="w-formulario" onSubmit={enviar} noValidate>
      <Campo
        etiqueta="Nombre"
        requerido
        value={d.nombre}
        maxLength={80}
        onChange={(e) => setD({ ...d, nombre: e.target.value })}
        error={errores.nombre}
      />
      <Campo
        etiqueta="Dirección"
        value={d.direccion}
        maxLength={200}
        onChange={(e) => setD({ ...d, direccion: e.target.value })}
        error={errores.direccion}
      />
      <Campo
        etiqueta="Teléfono"
        tipo="tel"
        inputMode="tel"
        value={d.telefono}
        maxLength={30}
        onChange={(e) => setD({ ...d, telefono: e.target.value })}
        error={errores.telefono}
      />
      <Campo
        etiqueta="Estado"
        tipo="select"
        value={d.estado}
        opciones={ESTADOS_SEDE.map((v) => ({ valor: v, texto: TEXTO_ESTADO_SEDE[v] }))}
        onChange={(e) => setD({ ...d, estado: e.target.value as EstadoSede })}
        error={errores.estado}
      />
      <fieldset className="w-colores">
        <legend className="w-colores__leyenda">Color en la agenda</legend>
        <div className="w-colores__opciones" role="radiogroup" aria-label="Color en la agenda">
          <button
            type="button"
            role="radio"
            aria-checked={d.color === null}
            className="w-color w-color--ninguno"
            onClick={() => setD({ ...d, color: null })}
          >
            {d.color === null ? <Icono nombre="check" tamano={20} /> : null}
            <span>Sin color</span>
          </button>
          {COLORES_SEDE.map((c) => {
            const elegido = d.color?.toLowerCase() === c.valor.toLowerCase();
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
      {error ? <MensajeError error={error} /> : null}
    </form>
  );
}
