import {
  guardarAgendaConfigSchema,
  type AgendaConfig,
  type GuardarAgendaConfig,
} from '@conecta/shared';
import { AvisoExito, Boton, Campo, Chip } from '@conecta/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claves } from '../catalogos/consultas.js';
import { textoMinutos } from '../catalogos/formato.js';
import { Interruptor } from '../catalogos/Interruptor.js';
import '../catalogos/catalogos.css';

/** 120 → «2 h»; 0 → «Sin anticipación». */
export function textoAnticipacion(min: number): string {
  return min === 0 ? 'Sin anticipación' : textoMinutos(min);
}

const HORAS = Array.from({ length: 49 }, (_, i) => i);
const MINUTOS = [0, 15, 30, 45];

type Errores = Partial<Record<'anticipacionMin' | 'diasAdelante', string>>;

function Formulario({ sedeId, inicial }: { sedeId: string; inicial: AgendaConfig }) {
  const { api, sesion } = useSesionLista();
  const consultas = useQueryClient();
  const unaVez = useEnvioUnico();
  const [horas, setHoras] = useState(Math.floor(inicial.anticipacionMin / 60));
  const [minutos, setMinutos] = useState(inicial.anticipacionMin % 60);
  const [dias, setDias] = useState(String(inicial.diasAdelante));
  const [activa, setActiva] = useState(inicial.reservaOnlineActiva);
  const [errores, setErrores] = useState<Errores>({});
  const [guardado, setGuardado] = useState(false);

  const guardar = useMutation({
    mutationFn: (d: GuardarAgendaConfig) => api.agenda.guardar(sedeId, d),
    onSuccess: (c) => {
      consultas.setQueryData(claves.agenda(sesion.clinica.id, sedeId), c);
      setGuardado(true);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setGuardado(false);
    const r = guardarAgendaConfigSchema.safeParse({
      anticipacionMin: horas * 60 + minutos,
      diasAdelante: /^\d+$/.test(dias.trim()) ? Number(dias.trim()) : Number.NaN,
      reservaOnlineActiva: activa,
    });
    if (!r.success) {
      const nuevos: Errores = {};
      for (const issue of r.error.issues) {
        const campo = issue.path[0];
        if (campo === 'anticipacionMin')
          nuevos.anticipacionMin = 'La anticipación va hasta 48 horas.';
        if (campo === 'diasAdelante') nuevos.diasAdelante = 'Poné de 1 a 90 días.';
      }
      setErrores(nuevos);
      return;
    }
    setErrores({});
    void unaVez(() => guardar.mutateAsync(r.data).catch(() => undefined));
  }

  const minutosOpciones = MINUTOS.includes(minutos)
    ? MINUTOS
    : [...MINUTOS, minutos].sort((a, b) => a - b);

  return (
    <form className="w-formulario" onSubmit={enviar} noValidate aria-label="Reserva online">
      <Interruptor
        etiqueta="Reserva online"
        textoSi="Activa"
        textoNo="Apagada"
        ayuda="Los pacientes pueden pedir turno desde internet en esta sede."
        activo={activa}
        onCambiar={(v) => {
          setActiva(v);
          setGuardado(false);
        }}
      />
      <fieldset className="w-grupo">
        <legend className="w-grupo__leyenda">Anticipación mínima</legend>
        <div className="w-par-campos">
          <Campo
            etiqueta="Horas"
            tipo="select"
            value={String(horas)}
            opciones={HORAS.map((h) => ({
              valor: String(h),
              texto: h === 1 ? '1 hora' : `${h} horas`,
            }))}
            onChange={(e) => setHoras(Number(e.target.value))}
          />
          <Campo
            etiqueta="Minutos"
            tipo="select"
            value={String(minutos)}
            opciones={minutosOpciones.map((m) => ({ valor: String(m), texto: `${m} min` }))}
            onChange={(e) => setMinutos(Number(e.target.value))}
            error={errores.anticipacionMin}
          />
        </div>
        <p className="w-secundario">
          {horas * 60 + minutos === 0
            ? 'Se puede reservar online hasta el último momento.'
            : `No se reserva online para dentro de menos de ${textoMinutos(horas * 60 + minutos)}.`}
        </p>
      </fieldset>
      <Campo
        etiqueta="Días hacia adelante"
        tipo="number"
        inputMode="numeric"
        min={1}
        max={90}
        value={dias}
        ayuda="Hasta cuántos días adelante se puede reservar (de 1 a 90)."
        onChange={(e) => setDias(e.target.value)}
        error={errores.diasAdelante}
      />
      {guardar.isError ? <MensajeError error={guardar.error} /> : null}
      {guardado ? (
        <AvisoExito titulo="Reserva online guardada" onCerrar={() => setGuardado(false)} />
      ) : null}
      <div className="w-botonera">
        <Boton type="submit" variante="primario" cargando={guardar.isPending}>
          Guardar reserva online
        </Boton>
      </div>
    </form>
  );
}

function Resumen({ c }: { c: AgendaConfig }) {
  return (
    <dl className="w-datos">
      <div>
        <dt>Reserva online</dt>
        <dd>
          {c.reservaOnlineActiva ? (
            <Chip tono="exito" icono="check">
              Activa
            </Chip>
          ) : (
            <Chip tono="neutro" icono="cerrar">
              Apagada
            </Chip>
          )}
        </dd>
      </div>
      <div>
        <dt>Anticipación mínima</dt>
        <dd>{textoAnticipacion(c.anticipacionMin)}</dd>
      </div>
      <div>
        <dt>Días hacia adelante</dt>
        <dd>{c.diasAdelante === 1 ? '1 día' : `${c.diasAdelante} días`}</dd>
      </div>
    </dl>
  );
}

/** Configuración de agenda y reserva online de la sede (`GET`/`PUT /sedes/:id/agenda`). */
export function ReservaOnline({ sedeId }: { sedeId: string }) {
  const { api, sesion, puede } = useSesionLista();
  const consulta = useQuery({
    queryKey: claves.agenda(sesion.clinica.id, sedeId),
    queryFn: () => api.agenda.obtener(sedeId),
  });
  if (consulta.isPending) return <Esqueleto filas={3} etiqueta="Cargando la reserva online" />;
  if (consulta.isError) {
    return <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />;
  }
  if (!puede('sedes', 'editar')) return <Resumen c={consulta.data} />;
  return <Formulario key={sedeId} sedeId={sedeId} inicial={consulta.data} />;
}
