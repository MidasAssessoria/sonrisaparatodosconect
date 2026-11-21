import { bajaSchema, crearBloqueoSchema, type Bloqueo, type CrearBloqueo } from '@conecta/shared';
import { AvisoExito, Boton, Campo, EstadoVacio, HojaInferior } from '@conecta/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFechaHora } from '../../utilidades/fechas.js';
import { claves } from './consultas.js';
import { instanteLocal } from './formato.js';

interface DatosBloqueo {
  desdeDia: string;
  desdeHora: string;
  hastaDia: string;
  hastaHora: string;
  motivo: string;
}

type Errores = Partial<Record<'desde' | 'hasta' | 'motivo', string>>;

const VACIO: DatosBloqueo = {
  desdeDia: '',
  desdeHora: '',
  hastaDia: '',
  hastaHora: '',
  motivo: '',
};

/** Valida el alta: fecha y hora en la zona de la clínica → ISO con desfase. */
export function validarBloqueo(
  d: DatosBloqueo,
  zona: string,
): { ok: true; datos: CrearBloqueo } | { ok: false; errores: Errores } {
  const errores: Errores = {};
  const desde = instanteLocal(d.desdeDia, d.desdeHora, zona);
  const hasta = instanteLocal(d.hastaDia, d.hastaHora, zona);
  if (!desde) errores.desde = 'Elegí la fecha y la hora de inicio.';
  if (!hasta) errores.hasta = 'Elegí la fecha y la hora de fin.';
  const r = crearBloqueoSchema.safeParse({
    desde: desde ?? '',
    hasta: hasta ?? '',
    motivo: d.motivo,
  });
  if (r.success && !errores.desde && !errores.hasta) return { ok: true, datos: r.data };
  if (!r.success) {
    for (const issue of r.error.issues) {
      const campo = issue.path[0] as keyof Errores | undefined;
      if (campo && !errores[campo]) {
        errores[campo] =
          campo === 'motivo' && issue.code === 'too_big'
            ? 'El motivo puede tener hasta 200 caracteres.'
            : issue.message;
      }
    }
  }
  return { ok: false, errores };
}

function FilaBloqueo({
  bloqueo,
  zona,
  editable,
  onQuitar,
}: {
  bloqueo: Bloqueo;
  zona: string;
  editable: boolean;
  onQuitar: () => void;
}) {
  const desde = formatoFechaHora(bloqueo.desde, zona);
  const hasta = formatoFechaHora(bloqueo.hasta, zona);
  return (
    <li>
      <div className="w-lista-simple__texto">
        <p className="w-lista-simple__titulo">
          {desde} a {hasta}
        </p>
        <p className="w-secundario">{bloqueo.motivo}</p>
      </div>
      {editable ? (
        <Boton
          variante="secundario"
          onClick={onQuitar}
          aria-label={`Quitar el bloqueo del ${desde}`}
        >
          Quitar bloqueo
        </Boton>
      ) : null}
    </li>
  );
}

/** Bloqueos que todavía no terminaron: lista, alta y baja con motivo. */
export function Bloqueos({
  profesionalId,
  bloqueos,
  editable,
}: {
  profesionalId: string;
  bloqueos: Bloqueo[];
  editable: boolean;
}) {
  const { api, sesion } = useSesionLista();
  const zona = sesion.clinica.zonaHoraria;
  const consultas = useQueryClient();
  const unaVezAlta = useEnvioUnico();
  const unaVezBaja = useEnvioUnico();
  const idBaja = useId();
  const [d, setD] = useState<DatosBloqueo>(VACIO);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [aQuitar, setAQuitar] = useState<Bloqueo | null>(null);
  const [motivoBaja, setMotivoBaja] = useState('');
  const [errorMotivoBaja, setErrorMotivoBaja] = useState<string | null>(null);

  const recargar = async () => {
    await consultas.invalidateQueries({
      queryKey: claves.profesional(sesion.clinica.id, profesionalId),
    });
  };

  const crear = useMutation({
    mutationFn: (datos: CrearBloqueo) => api.profesionales.crearBloqueo(profesionalId, datos),
    onSuccess: async () => {
      setD(VACIO);
      setAviso('Bloqueo agregado');
      await recargar();
    },
  });

  const quitar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) =>
      api.profesionales.quitarBloqueo(id, { motivo }),
    onSuccess: async () => {
      setAQuitar(null);
      setAviso('Bloqueo quitado');
      await recargar();
    },
  });

  function agregar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    const r = validarBloqueo(d, zona);
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    void unaVezAlta(() => crear.mutateAsync(r.datos).catch(() => undefined));
  }

  function confirmarBaja(e: FormEvent) {
    e.preventDefault();
    if (!aQuitar) return;
    const r = bajaSchema.safeParse({ motivo: motivoBaja });
    if (!r.success) {
      setErrorMotivoBaja(r.error.issues[0]?.message ?? 'Contanos el motivo de la baja.');
      return;
    }
    setErrorMotivoBaja(null);
    const id = aQuitar.id;
    void unaVezBaja(() => quitar.mutateAsync({ id, motivo: r.data.motivo }).catch(() => undefined));
  }

  return (
    <div className="w-sillones">
      {bloqueos.length === 0 ? (
        <EstadoVacio
          ilustracion={false}
          titulo="No hay bloqueos por delante."
          texto={
            editable
              ? 'Cargá vacaciones, congresos o licencias para que no se den turnos.'
              : undefined
          }
        />
      ) : (
        <ul className="w-lista-simple" aria-label="Bloqueos">
          {bloqueos.map((b) => (
            <FilaBloqueo
              key={b.id}
              bloqueo={b}
              zona={zona}
              editable={editable}
              onQuitar={() => {
                quitar.reset();
                setMotivoBaja('');
                setErrorMotivoBaja(null);
                setAQuitar(b);
              }}
            />
          ))}
        </ul>
      )}
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}

      {editable ? (
        <form
          className="w-formulario-en-linea"
          onSubmit={agregar}
          noValidate
          aria-label="Nuevo bloqueo"
        >
          <h3 className="w-lista-simple__titulo">Nuevo bloqueo</h3>
          <div className="w-fila-fechas">
            <Campo
              etiqueta="Desde (fecha)"
              tipo="date"
              value={d.desdeDia}
              onChange={(e) => setD({ ...d, desdeDia: e.target.value })}
            />
            <Campo
              etiqueta="Desde (hora)"
              tipo="time"
              value={d.desdeHora}
              onChange={(e) => setD({ ...d, desdeHora: e.target.value })}
              error={errores.desde}
            />
            <Campo
              etiqueta="Hasta (fecha)"
              tipo="date"
              value={d.hastaDia}
              onChange={(e) => setD({ ...d, hastaDia: e.target.value })}
            />
            <Campo
              etiqueta="Hasta (hora)"
              tipo="time"
              value={d.hastaHora}
              onChange={(e) => setD({ ...d, hastaHora: e.target.value })}
              error={errores.hasta}
            />
          </div>
          <p className="w-secundario">Fechas y horas de la clínica.</p>
          <Campo
            etiqueta="Motivo del bloqueo"
            requerido
            maxLength={200}
            placeholder="Vacaciones, congreso, licencia…"
            value={d.motivo}
            onChange={(e) => setD({ ...d, motivo: e.target.value })}
            error={errores.motivo}
          />
          {crear.isError ? <MensajeError error={crear.error} /> : null}
          <div className="w-botonera">
            <Boton type="submit" icono="mas" cargando={crear.isPending}>
              Agregar bloqueo
            </Boton>
          </div>
        </form>
      ) : null}

      {editable ? (
        <HojaInferior
          abierta={aQuitar !== null}
          titulo="Quitar bloqueo"
          onCerrar={() => setAQuitar(null)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setAQuitar(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" form={idBaja} variante="peligro" cargando={quitar.isPending}>
                Confirmar
              </Boton>
            </>
          }
        >
          {aQuitar ? (
            <form id={idBaja} className="w-formulario" onSubmit={confirmarBaja} noValidate>
              <p>
                {formatoFechaHora(aQuitar.desde, zona)} a {formatoFechaHora(aQuitar.hasta, zona)}:
                se vuelven a poder dar turnos en ese período. El bloqueo queda en el historial.
              </p>
              <Campo
                etiqueta="Motivo de la baja"
                tipo="textarea"
                requerido
                maxLength={300}
                value={motivoBaja}
                onChange={(e) => setMotivoBaja(e.target.value)}
                error={errorMotivoBaja}
              />
              {quitar.isError ? <MensajeError error={quitar.error} /> : null}
            </form>
          ) : null}
        </HojaInferior>
      ) : null}
    </div>
  );
}
