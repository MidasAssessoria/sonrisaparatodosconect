import { horarioSedeSchema, type HorarioSede } from '@conecta/shared';
import { AvisoExito, Boton, Campo } from '@conecta/ui';
import { useState } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { DIAS_SEMANA } from './estadoSede.js';

export interface Tramo {
  clave: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  intervaloMin: number;
}

let contador = 0;
const nuevaClave = () => `t${++contador}`;

export function tramosDesde(horarios: HorarioSede[]): Tramo[] {
  return [...horarios]
    .sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio))
    .map((h) => ({ ...h, clave: nuevaClave() }));
}

/** «08:00» → «8:00». */
export function horaCorta(h: string): string {
  return h.replace(/^0(\d)/, '$1');
}

/**
 * Valida los tramos con el esquema del contrato y además que no se superpongan en el mismo día.
 * Devuelve los errores por clave de tramo, o los horarios listos para la API.
 */
export function validarTramos(
  tramos: Tramo[],
): { ok: true; horarios: HorarioSede[] } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const horarios: HorarioSede[] = [];
  for (const t of tramos) {
    if (!t.horaInicio || !t.horaFin) {
      errores[t.clave] = 'Completá la hora de apertura y la de cierre.';
      continue;
    }
    const r = horarioSedeSchema.safeParse({
      diaSemana: t.diaSemana,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      intervaloMin: t.intervaloMin,
    });
    if (!r.success) {
      errores[t.clave] = r.error.issues[0]?.message ?? 'Revisá este tramo.';
      continue;
    }
    horarios.push(r.data);
  }
  for (const d of DIAS_SEMANA) {
    const delDia = tramos
      .filter((t) => t.diaSemana === d.dia && !errores[t.clave])
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    for (let i = 1; i < delDia.length; i++) {
      const previo = delDia[i - 1];
      const actual = delDia[i];
      if (previo && actual && actual.horaInicio < previo.horaFin) {
        errores[actual.clave] =
          `Se superpone con el tramo de ${horaCorta(previo.horaInicio)} a ${horaCorta(previo.horaFin)}.`;
      }
    }
  }
  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, horarios };
}

/** Horario de la semana en texto, para quien no puede editar. */
function ResumenHorarios({ tramos }: { tramos: Tramo[] }) {
  return (
    <dl className="w-horarios-resumen">
      {DIAS_SEMANA.map((d) => {
        const delDia = tramos.filter((t) => t.diaSemana === d.dia);
        return (
          <div key={d.dia}>
            <dt>{d.nombre}</dt>
            <dd>
              {delDia.length
                ? delDia
                    .map((t) => `${horaCorta(t.horaInicio)} a ${horaCorta(t.horaFin)}`)
                    .join(' · ')
                : 'Cerrado'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function EditorHorarios({
  horarios,
  editable,
  onGuardar,
  guardando,
  error,
}: {
  horarios: HorarioSede[];
  editable: boolean;
  onGuardar: (horarios: HorarioSede[]) => Promise<void>;
  guardando: boolean;
  error?: unknown;
}) {
  const [tramos, setTramos] = useState(() => tramosDesde(horarios));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [cambios, setCambios] = useState(false);
  const [guardado, setGuardado] = useState(false);

  if (!editable) return <ResumenHorarios tramos={tramos} />;

  function cambiar(clave: string, parcial: Partial<Tramo>) {
    setTramos((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...parcial } : t)));
    setCambios(true);
    setGuardado(false);
  }

  function agregar(dia: number) {
    const delDia = tramos.filter((t) => t.diaSemana === dia);
    const ultimo = delDia[delDia.length - 1];
    const tramo: Tramo = ultimo
      ? {
          clave: nuevaClave(),
          diaSemana: dia,
          horaInicio: ultimo.horaFin,
          horaFin: '',
          intervaloMin: 30,
        }
      : {
          clave: nuevaClave(),
          diaSemana: dia,
          horaInicio: '08:00',
          horaFin: '12:00',
          intervaloMin: 30,
        };
    setTramos((ts) => [...ts, tramo]);
    setCambios(true);
    setGuardado(false);
  }

  function quitar(clave: string) {
    setTramos((ts) => ts.filter((t) => t.clave !== clave));
    setErrores((previos) => {
      const resto = { ...previos };
      delete resto[clave];
      return resto;
    });
    setCambios(true);
    setGuardado(false);
  }

  async function guardar() {
    const r = validarTramos(tramos);
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    try {
      await onGuardar(r.horarios);
      setCambios(false);
      setGuardado(true);
    } catch {
      // El error lo muestra el padre (prop `error`).
    }
  }

  const hayErrores = Object.keys(errores).length > 0;

  return (
    <div className="w-horarios">
      {DIAS_SEMANA.map((d) => {
        const delDia = tramos.filter((t) => t.diaSemana === d.dia);
        return (
          <fieldset key={d.dia} className="w-dia">
            <legend className="w-dia__nombre">{d.nombre}</legend>
            {delDia.length === 0 ? <p className="w-secundario">Cerrado</p> : null}
            {delDia.map((t, i) => (
              <div key={t.clave} className="w-tramo">
                <div className="w-tramo__horas">
                  <Campo
                    etiqueta={`Abre (tramo ${i + 1})`}
                    tipo="time"
                    value={t.horaInicio}
                    onChange={(e) => cambiar(t.clave, { horaInicio: e.target.value })}
                  />
                  <Campo
                    etiqueta={`Cierra (tramo ${i + 1})`}
                    tipo="time"
                    value={t.horaFin}
                    onChange={(e) => cambiar(t.clave, { horaFin: e.target.value })}
                    error={errores[t.clave]}
                  />
                </div>
                <Boton
                  variante="fantasma"
                  icono="cerrar"
                  aria-label={`Quitar tramo ${i + 1} del ${d.nombre.toLowerCase()}`}
                  onClick={() => quitar(t.clave)}
                />
              </div>
            ))}
            <Boton variante="fantasma" icono="mas" onClick={() => agregar(d.dia)}>
              {delDia.length ? 'Agregar otro tramo' : 'Agregar horario'}
            </Boton>
          </fieldset>
        );
      })}
      {hayErrores ? <MensajeError texto="Revisá los horarios marcados antes de guardar." /> : null}
      {error ? <MensajeError error={error} /> : null}
      {guardado ? (
        <AvisoExito titulo="Horarios guardados" onCerrar={() => setGuardado(false)} />
      ) : null}
      <div className="w-botonera">
        <Boton
          variante="primario"
          cargando={guardando}
          disabled={!cambios}
          onClick={() => void guardar()}
        >
          Guardar horarios
        </Boton>
        {cambios ? (
          <Boton
            variante="fantasma"
            onClick={() => {
              setTramos(tramosDesde(horarios));
              setErrores({});
              setCambios(false);
            }}
          >
            Descartar cambios
          </Boton>
        ) : null}
      </div>
    </div>
  );
}
