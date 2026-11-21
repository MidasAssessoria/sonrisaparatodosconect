import type { Profesional, TramoDisponibilidad } from '@conecta/shared';
import { AvisoExito, Boton, Campo, Icono } from '@conecta/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorConecta } from '../../api/errores.js';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claves, useApiCatalogos } from './api.js';
import {
  claveTramo,
  franjasDelDia,
  ordenarTramos,
  validarDisponibilidad,
  type SedeDisponible,
  type TramoEditable,
} from './disponibilidad.js';
import { DIAS, horaCorta } from './formato.js';

let contador = 0;
const nuevaClave = () => `d${++contador}`;

function editablesDesde(tramos: TramoDisponibilidad[]): TramoEditable[] {
  return ordenarTramos(tramos).map((t) => ({ ...t, clave: nuevaClave() }));
}

function textoTramo(t: TramoDisponibilidad, sedes: SedeDisponible[]): string {
  const sede = sedes.find((s) => s.id === t.sedeId);
  const sillon = sede?.sillones?.find((s) => s.id === t.sillonId);
  return (
    `${horaCorta(t.horaInicio)} a ${horaCorta(t.horaFin)} en ${sede?.nombre ?? 'otra sede'}` +
    (sillon ? ` (${sillon.nombre})` : '')
  );
}

/** Disponibilidad en texto, para quien no puede editar. */
function ResumenDisponibilidad({
  tramos,
  sedes,
}: {
  tramos: TramoDisponibilidad[];
  sedes: SedeDisponible[];
}) {
  return (
    <dl className="w-horarios-resumen">
      {DIAS.map((d) => {
        const delDia = ordenarTramos(tramos.filter((t) => t.diaSemana === d.dia));
        return (
          <div key={d.dia}>
            <dt>{d.nombre}</dt>
            <dd>
              {delDia.length ? delDia.map((t) => textoTramo(t, sedes)).join(' · ') : 'No atiende'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Editor de la disponibilidad semanal (mismo patrón que el editor de horarios de la sede). Guarda
 * el reemplazo completo: los tramos de sedes que la persona no ve viajan iguales.
 */
export function EditorDisponibilidad({
  profesional,
  sedes,
  editable,
}: {
  profesional: Profesional;
  /** Sedes que la persona puede ver, con horario y sillones si se conocen. */
  sedes: SedeDisponible[];
  editable: boolean;
}) {
  const { sesion, sedeActiva } = useSesionLista();
  const api = useApiCatalogos();
  const consultas = useQueryClient();
  const unaVez = useEnvioUnico();
  const idsVisibles = new Set(sedes.map((s) => s.id));
  const ajenos = profesional.disponibilidad.filter((t) => !idsVisibles.has(t.sedeId));
  const guardados = new Set(profesional.disponibilidad.map(claveTramo));

  const [tramos, setTramos] = useState(() =>
    editablesDesde(profesional.disponibilidad.filter((t) => idsVisibles.has(t.sedeId))),
  );
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [cambios, setCambios] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const guardar = useMutation({
    mutationFn: (t: TramoDisponibilidad[]) =>
      api.profesionales.reemplazarDisponibilidad(profesional.id, { tramos: t }),
    onSuccess: async (p) => {
      consultas.setQueryData(claves.profesional(sesion.clinica.id, p.id), p);
      await consultas.invalidateQueries({
        queryKey: claves.profesionales(sesion.clinica.id),
        exact: true,
      });
    },
  });

  if (!editable) return <ResumenDisponibilidad tramos={profesional.disponibilidad} sedes={sedes} />;

  if (sedes.length === 0) {
    return (
      <p className="w-secundario">
        No tenés sedes asignadas: pedí acceso a una sede para cargar la disponibilidad.
      </p>
    );
  }

  const tocar = () => {
    setCambios(true);
    setGuardado(false);
  };

  function cambiar(clave: string, parcial: Partial<TramoEditable>) {
    setTramos((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...parcial } : t)));
    tocar();
  }

  function agregar(dia: number) {
    const delDia = tramos.filter((t) => t.diaSemana === dia);
    const ultimo = delDia[delDia.length - 1];
    let tramo: TramoEditable;
    if (ultimo) {
      tramo = { ...ultimo, clave: nuevaClave(), horaInicio: ultimo.horaFin, horaFin: '' };
    } else {
      const sedeId =
        sedeActiva.tipo === 'sede' && idsVisibles.has(sedeActiva.id)
          ? sedeActiva.id
          : (sedes[0]?.id ?? '');
      const franja = franjasDelDia(sedes.find((s) => s.id === sedeId)?.horarios ?? [], dia)[0];
      tramo = {
        clave: nuevaClave(),
        sedeId,
        diaSemana: dia,
        horaInicio: franja?.horaInicio ?? '08:00',
        horaFin: franja?.horaFin ?? '12:00',
        sillonId: null,
      };
    }
    setTramos((ts) => [...ts, tramo]);
    tocar();
  }

  function quitar(clave: string) {
    setTramos((ts) => ts.filter((t) => t.clave !== clave));
    setErrores((previos) => {
      const resto = { ...previos };
      delete resto[clave];
      return resto;
    });
    tocar();
  }

  function enviar() {
    const r = validarDisponibilidad(tramos, { sedes, ajenos, guardados });
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    void unaVez(async () => {
      try {
        await guardar.mutateAsync(r.tramos);
        setCambios(false);
        setGuardado(true);
      } catch (e) {
        // Los detalles de la API señalan el tramo por posición en el pedido («tramos.3…»).
        if (e instanceof ErrorConecta) {
          const porTramo: Record<string, string> = {};
          for (const d of e.detalles) {
            const m = /^tramos\.(\d+)/.exec(d.campo);
            const clave = m ? r.claves[Number(m[1])] : null;
            if (clave && !porTramo[clave]) porTramo[clave] = d.mensaje;
          }
          setErrores(porTramo);
        }
      }
    });
  }

  const hayErrores = Object.keys(errores).length > 0;

  return (
    <div className="w-horarios">
      {DIAS.map((d) => {
        const delDia = tramos.filter((t) => t.diaSemana === d.dia);
        const ajenosDelDia = ajenos.filter((t) => t.diaSemana === d.dia);
        return (
          <fieldset key={d.dia} className="w-dia">
            <legend className="w-dia__nombre">{d.nombre}</legend>
            {delDia.length === 0 && ajenosDelDia.length === 0 ? (
              <p className="w-secundario">No atiende</p>
            ) : null}
            {ajenosDelDia.map((t) => (
              <p key={claveTramo(t)} className="w-disp-ajeno">
                <Icono nombre="candado" tamano={18} />
                <span>
                  {horaCorta(t.horaInicio)} a {horaCorta(t.horaFin)} en una sede que no ves. Se
                  mantiene como está.
                </span>
              </p>
            ))}
            {delDia.map((t, i) => {
              const n = i + 1;
              const sede = sedes.find((s) => s.id === t.sedeId);
              const sillones = (sede?.sillones ?? []).filter(
                (s) => s.activo || s.id === t.sillonId,
              );
              const sillonDesconocido =
                t.sillonId !== null && !sillones.some((s) => s.id === t.sillonId);
              return (
                <div key={t.clave} className="w-disp-tramo">
                  <div className="w-disp-tramo__campos">
                    <Campo
                      className="w-disp-tramo__ancho"
                      etiqueta={`Sede (tramo ${n})`}
                      tipo="select"
                      value={t.sedeId}
                      opciones={sedes.map((s) => ({ valor: s.id, texto: s.nombre }))}
                      onChange={(e) => cambiar(t.clave, { sedeId: e.target.value, sillonId: null })}
                    />
                    <Campo
                      etiqueta={`Desde (tramo ${n})`}
                      tipo="time"
                      value={t.horaInicio}
                      onChange={(e) => cambiar(t.clave, { horaInicio: e.target.value })}
                    />
                    <Campo
                      etiqueta={`Hasta (tramo ${n})`}
                      tipo="time"
                      value={t.horaFin}
                      onChange={(e) => cambiar(t.clave, { horaFin: e.target.value })}
                    />
                    <Campo
                      className="w-disp-tramo__ancho"
                      etiqueta={`Sillón (tramo ${n})`}
                      tipo="select"
                      value={t.sillonId ?? ''}
                      opciones={[
                        { valor: '', texto: 'Sin sillón fijo' },
                        ...(sillonDesconocido && t.sillonId
                          ? [{ valor: t.sillonId, texto: 'Sillón asignado' }]
                          : []),
                        ...sillones.map((s) => ({
                          valor: s.id,
                          texto: s.activo ? s.nombre : `${s.nombre} (inactivo)`,
                        })),
                      ]}
                      onChange={(e) => cambiar(t.clave, { sillonId: e.target.value || null })}
                    />
                  </div>
                  {errores[t.clave] ? (
                    <p className="cn-campo__error" role="alert">
                      <Icono nombre="alerta" tamano={18} />
                      <span>{errores[t.clave]}</span>
                    </p>
                  ) : null}
                  <div className="w-disp-tramo__pie">
                    <Boton
                      variante="fantasma"
                      icono="cerrar"
                      onClick={() => quitar(t.clave)}
                      aria-label={`Quitar tramo ${n} del ${d.enFrase}`}
                    >
                      Quitar
                    </Boton>
                  </div>
                </div>
              );
            })}
            <Boton variante="fantasma" icono="mas" onClick={() => agregar(d.dia)}>
              {delDia.length ? 'Agregar otro tramo' : 'Agregar tramo'}
            </Boton>
          </fieldset>
        );
      })}
      {hayErrores ? <MensajeError texto="Revisá los tramos marcados antes de guardar." /> : null}
      {guardar.isError ? <MensajeError error={guardar.error} /> : null}
      {guardado ? (
        <AvisoExito titulo="Disponibilidad guardada" onCerrar={() => setGuardado(false)} />
      ) : null}
      <div className="w-botonera">
        <Boton
          variante="primario"
          cargando={guardar.isPending}
          disabled={!cambios}
          onClick={enviar}
        >
          Guardar disponibilidad
        </Boton>
        {cambios ? (
          <Boton
            variante="fantasma"
            onClick={() => {
              setTramos(
                editablesDesde(profesional.disponibilidad.filter((t) => idsVisibles.has(t.sedeId))),
              );
              setErrores({});
              setCambios(false);
              guardar.reset();
            }}
          >
            Descartar cambios
          </Boton>
        ) : null}
      </div>
    </div>
  );
}
