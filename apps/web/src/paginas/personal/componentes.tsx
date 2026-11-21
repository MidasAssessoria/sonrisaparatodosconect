import { bajaSchema, type EstadoMembresia, type InvitacionCreada } from '@conecta/shared';
import { Boton, Campo, Chip, HojaInferior, Icono } from '@conecta/ui';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { enlaceCompleto, fecha, mensajeRechazo } from './consultas.js';
import { infoEstadoPersona, T } from './textos.js';
import './personal.css';

/*
 * Piezas de estas pantallas que todavía no están en @conecta/ui. Candidatas a moverse allá:
 * `Segmento` (filtro de opciones excluyentes), `CasillaVerificacion` y `EnlaceUnaVez`.
 */

export function ChipEstadoPersona({ estado }: { estado: EstadoMembresia }) {
  const e = infoEstadoPersona(estado);
  return (
    <Chip tono={e.tono} icono={e.icono}>
      {e.texto}
    </Chip>
  );
}

/** Opciones excluyentes en fila (filtro). Cada opción mide al menos 44 px de alto. */
export function Segmento<V extends string>({
  etiqueta,
  valor,
  opciones,
  onCambio,
}: {
  etiqueta: string;
  valor: V;
  opciones: { valor: V; texto: string }[];
  onCambio: (v: V) => void;
}) {
  return (
    <div className="w-segmento" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          className="w-segmento__opcion"
          aria-pressed={o.valor === valor}
          onClick={() => onCambio(o.valor)}
        >
          {o.valor === valor ? <Icono nombre="check" tamano={18} /> : null}
          <span>{o.texto}</span>
        </button>
      ))}
    </div>
  );
}

/** Casilla con etiqueta visible y zona táctil de 44 px. */
export function CasillaVerificacion({
  etiqueta,
  marcada,
  onCambio,
  disabled,
  etiquetaAccesible,
  className,
}: {
  etiqueta: ReactNode;
  marcada: boolean;
  onCambio: (marcada: boolean) => void;
  disabled?: boolean;
  etiquetaAccesible?: string;
  className?: string;
}) {
  return (
    <label className={`w-casilla${className ? ` ${className}` : ''}`}>
      <input
        type="checkbox"
        checked={marcada}
        disabled={disabled}
        aria-label={etiquetaAccesible}
        onChange={(e) => onCambio(e.target.checked)}
      />
      <span className="w-casilla__texto">{etiqueta}</span>
    </label>
  );
}

/** Sedes donde trabaja (casillas) y sede por defecto (entre las elegidas). */
export function ElegirSedes({
  sedes,
  elegidas,
  defecto,
  onCambio,
  error,
}: {
  sedes: { id: string; nombre: string }[];
  elegidas: string[];
  defecto: string;
  onCambio: (elegidas: string[], defecto: string) => void;
  error?: string | undefined;
}) {
  const alternar = (id: string, marcada: boolean) => {
    const nuevas = marcada ? [...elegidas, id] : elegidas.filter((x) => x !== id);
    onCambio(nuevas, nuevas.includes(defecto) ? defecto : '');
  };
  return (
    <>
      <fieldset className="w-grupo-casillas">
        <legend className="w-grupo-casillas__leyenda">{T.invitar.sedes}</legend>
        <p className="w-secundario">{T.invitar.sedesAyuda}</p>
        {sedes.map((s) => (
          <CasillaVerificacion
            key={s.id}
            etiqueta={s.nombre}
            marcada={elegidas.includes(s.id)}
            onCambio={(m) => alternar(s.id, m)}
          />
        ))}
      </fieldset>
      <Campo
        etiqueta={T.invitar.sedeDefecto}
        tipo="select"
        value={defecto}
        opciones={[
          { valor: '', texto: T.invitar.sinSedeDefecto },
          ...sedes
            .filter((s) => elegidas.includes(s.id))
            .map((s) => ({ valor: s.id, texto: s.nombre })),
        ]}
        onChange={(e) => onCambio(elegidas, e.target.value)}
        error={error}
      />
    </>
  );
}

/** Confirmación con motivo obligatorio (anular invitación, desactivar persona). */
export function HojaConMotivo({
  abierta,
  titulo,
  texto,
  confirmar,
  onCerrar,
  onConfirmar,
  enviando,
  error,
}: {
  abierta: boolean;
  titulo: string;
  texto: string;
  confirmar: string;
  onCerrar: () => void;
  onConfirmar: (motivo: string) => void;
  enviando: boolean;
  error?: unknown;
}) {
  const idForm = useId();
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = bajaSchema.safeParse({ motivo });
    if (!r.success) {
      setErrorMotivo(r.error.issues[0]?.message ?? 'Contanos el motivo.');
      return;
    }
    setErrorMotivo(null);
    onConfirmar(r.data.motivo);
  }

  return (
    <HojaInferior
      abierta={abierta}
      titulo={titulo}
      onCerrar={onCerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            {T.invitar.cancelar}
          </Boton>
          <Boton type="submit" form={idForm} variante="peligro" cargando={enviando}>
            {confirmar}
          </Boton>
        </>
      }
    >
      <form id={idForm} className="w-formulario" onSubmit={enviar} noValidate>
        <p>{texto}</p>
        <Campo
          etiqueta={T.anular.motivo}
          tipo="textarea"
          requerido
          maxLength={300}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errorMotivo}
        />
        {error ? <MensajeError texto={mensajeRechazo(error)} /> : null}
      </form>
    </HojaInferior>
  );
}

/** Confirmación simple (reenviar invitación). */
export function HojaConfirmar({
  abierta,
  titulo,
  texto,
  confirmar,
  onCerrar,
  onConfirmar,
  enviando,
  error,
}: {
  abierta: boolean;
  titulo: string;
  texto: string;
  confirmar: string;
  onCerrar: () => void;
  onConfirmar: () => void;
  enviando: boolean;
  error?: unknown;
}) {
  return (
    <HojaInferior
      abierta={abierta}
      titulo={titulo}
      onCerrar={onCerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            {T.invitar.cancelar}
          </Boton>
          <Boton variante="primario" cargando={enviando} onClick={onConfirmar}>
            {confirmar}
          </Boton>
        </>
      }
    >
      <p>{texto}</p>
      {error ? <MensajeError texto={mensajeRechazo(error)} /> : null}
    </HojaInferior>
  );
}

/**
 * Enlace de invitación recién creado o reenviado. Se muestra una sola vez: vive solo en el estado
 * de la pantalla y desaparece al cerrarlo.
 */
export function EnlaceUnaVez({
  invitacion,
  clinica,
  reenvio,
  zona,
  onCerrar,
}: {
  invitacion: InvitacionCreada;
  clinica: string;
  reenvio: boolean;
  zona: string;
  onCerrar: () => void;
}) {
  const [copia, setCopia] = useState<'nada' | 'ok' | 'error'>('nada');
  const url = enlaceCompleto(invitacion.enlace);
  const vence = fecha(invitacion.venceEn, zona);
  const nombre = invitacion.persona.nombre;
  const mensaje = T.enlace.mensajeWhatsapp(nombre, clinica, url, vence);
  const idEnlace = useId();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopia('ok');
    } catch {
      setCopia('error');
    }
  }

  return (
    <section className="w-enlace-invitacion" aria-labelledby={`${idEnlace}-titulo`}>
      <div className="w-enlace-invitacion__cabecera">
        <span className="w-enlace-invitacion__sello" aria-hidden="true">
          <Icono nombre="check" tamano={22} />
        </span>
        <h2 id={`${idEnlace}-titulo`} className="w-enlace-invitacion__titulo">
          {reenvio ? T.enlace.tituloReenvio(nombre) : T.enlace.tituloNueva(nombre)}
        </h2>
      </div>
      <div className="w-aviso-atencion" role="status">
        <Icono nombre="alerta" tamano={22} />
        <div className="w-aviso-atencion__cuerpo">
          <p className="w-aviso-atencion__titulo">{T.enlace.unaVez}</p>
          <p className="w-aviso-atencion__texto">
            {reenvio ? `${T.enlace.anteriorAnulado} ` : ''}
            {T.enlace.vence(vence)}
          </p>
        </div>
      </div>
      <p className="w-nota">{T.enlace.queRecibe}</p>
      <label className="w-enlace-invitacion__etiqueta" htmlFor={idEnlace}>
        {T.enlace.etiqueta}
      </label>
      <input
        id={idEnlace}
        className="w-enlace-invitacion__url"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
      />
      <div className="w-botonera">
        <Boton variante="primario" icono="archivo" onClick={() => void copiar()}>
          {T.enlace.copiar}
        </Boton>
        <a
          className="cn-boton cn-boton--secundario cn-boton--md"
          href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icono nombre="mensaje" tamano={20} />
          <span>{T.enlace.whatsapp}</span>
        </a>
        <Boton variante="fantasma" onClick={onCerrar}>
          {T.enlace.listo}
        </Boton>
      </div>
      {copia === 'ok' ? (
        <p className="w-nota" role="status">
          {T.enlace.copiado}
        </p>
      ) : null}
      {copia === 'error' ? <MensajeError texto={T.enlace.noSeCopio} /> : null}
    </section>
  );
}
