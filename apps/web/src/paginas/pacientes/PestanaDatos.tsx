import {
  crearAlertaSchema,
  TIPOS_ALERTA,
  type AlertaManual,
  type EditarPaciente,
  type Paciente,
  type TipoAlerta,
} from '@conecta/shared';
import { AvisoExito, Boton, Campo, Chip, HojaInferior, type Tono } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { CrearAlerta } from '../../api/cliente.js';
import { ErrorCiDuplicada, mensajeDeError } from '../../api/errores.js';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFecha, formatoFechaHora } from '../../utilidades/fechas.js';
import { HojaConMotivo, Segmento } from '../personal/componentes.js';
import { AvisoCiDuplicada, enviarConfirmando } from './AvisoCiDuplicada.js';
import { useActualizarPacientes } from './consultas.js';
import { formatoDia, nombreCompleto, textoCi, textoTelefono } from './formato.js';
import { FormularioPaciente } from './FormularioPaciente.js';
import { GrupoFamiliar } from './GrupoFamiliar.js';

type Avisar = (texto: string) => void;

function Seccion({
  titulo,
  ayuda,
  accion,
  children,
}: {
  titulo: string;
  ayuda?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="w-tarjeta" aria-labelledby={id}>
      <div className="w-tarjeta__cabecera">
        <h2 id={id} className="w-seccion-ficha__titulo">
          {titulo}
        </h2>
        {accion}
      </div>
      {ayuda ? <p className="w-secundario w-seccion-ficha__ayuda">{ayuda}</p> : null}
      {children}
    </section>
  );
}

/* ---------- Datos personales ---------- */

function HojaEditar({
  paciente,
  abierta,
  onCerrar,
  onGuardado,
}: {
  paciente: Paciente;
  abierta: boolean;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const t = useTextos().pacientes;
  const { api } = useSesionLista();
  const navegar = useNavigate();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const idForm = useId();
  /** El próximo envío del formulario va con `confirmarCiDuplicada` («Guardar igual»). */
  const confirmar = useRef(false);
  const [sinCambios, setSinCambios] = useState(false);

  const editar = useMutation({
    mutationFn: (d: EditarPaciente) => api.pacientes.editar(paciente.id, d),
    onSuccess: (p) => {
      actualizar.ficha(p);
      onGuardado();
    },
  });
  const enviar = (d: EditarPaciente) => {
    setSinCambios(false);
    void unaVez(() => editar.mutateAsync(d).catch(() => undefined));
  };
  const cerrar = () => {
    editar.reset();
    setSinCambios(false);
    onCerrar();
  };
  const duplicada = editar.error instanceof ErrorCiDuplicada ? editar.error : null;

  return (
    <HojaInferior
      abierta={abierta}
      titulo={t.datos.tituloEditar}
      onCerrar={cerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={cerrar}>
            {t.alta.cancelar}
          </Boton>
          <Boton type="submit" form={idForm} variante="primario" cargando={editar.isPending}>
            {t.datos.guardar}
          </Boton>
        </>
      }
    >
      {abierta ? (
        <>
          <FormularioPaciente
            id={idForm}
            paciente={paciente}
            onEnviar={(d) => {
              editar.reset();
              enviar(confirmar.current ? { ...d, confirmarCiDuplicada: true } : d);
            }}
            onSinCambios={() => setSinCambios(true)}
            // Lo que se cambie después del 409 deja viejo el aviso: se oculta.
            onCambio={() => {
              if (editar.error instanceof ErrorCiDuplicada) editar.reset();
            }}
            error={duplicada ? undefined : (editar.error ?? undefined)}
          />
          {sinCambios ? (
            <p className="w-secundario" role="status">
              {t.datos.sinCambios}
            </p>
          ) : null}
          {duplicada ? (
            <AvisoCiDuplicada
              error={duplicada}
              guardando={editar.isPending}
              onAbrir={(id) => {
                cerrar();
                void navegar(`/pacientes/${id}`);
              }}
              onGuardarIgual={() => enviarConfirmando(idForm, confirmar)}
            />
          ) : null}
        </>
      ) : null}
    </HojaInferior>
  );
}

function DatosPersonales({ paciente, avisar }: { paciente: Paciente; avisar: Avisar }) {
  const t = useTextos().pacientes;
  const { puede, sesion } = useSesionLista();
  const [editando, setEditando] = useState(false);
  const puedeEditar = puede('pacientes', 'editar') && paciente.activo;
  const nada = t.sinDato;
  const c = t.campos;

  const filas: [string, ReactNode][] = [
    [c.ci, textoCi(t, paciente.ci) ?? nada],
    [c.ruc, paciente.ruc ?? nada],
    [
      c.fechaNac,
      paciente.fechaNac
        ? `${formatoDia(paciente.fechaNac)}${paciente.edad != null ? ` (${t.edad(paciente.edad)})` : ''}`
        : nada,
    ],
    [c.sexo, paciente.sexo === 'F' ? c.sexoF : paciente.sexo === 'M' ? c.sexoM : nada],
    [c.telefono, textoTelefono(paciente.telefono) ?? nada],
    [c.email, paciente.email ?? nada],
    [c.ciudad, paciente.ciudad ?? nada],
    [c.direccion, paciente.direccion ?? nada],
    [c.idioma, paciente.idioma === 'gn' ? c.idiomaGn : c.idiomaEs],
    [
      c.aceptaWhatsapp,
      paciente.aceptaWhatsapp ? (
        <Chip tono="exito" icono="check">
          {t.datos.acepta}
        </Chip>
      ) : (
        <Chip tono="neutro" icono="cerrar">
          {t.datos.noAcepta}
        </Chip>
      ),
    ],
    [c.origen, paciente.origen === 'online' ? c.origenOnline : c.origenRecepcion],
    [c.alta, formatoFecha(paciente.creadoEn, sesion.clinica.zonaHoraria)],
  ];

  return (
    <Seccion
      titulo={t.datos.titulo}
      accion={
        puedeEditar ? (
          <Boton variante="secundario" onClick={() => setEditando(true)}>
            {t.datos.editar}
          </Boton>
        ) : undefined
      }
    >
      <dl className="w-datos">
        {filas.map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            <dt>{etiqueta}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      </dl>
      {puedeEditar ? (
        <HojaEditar
          paciente={paciente}
          abierta={editando}
          onCerrar={() => setEditando(false)}
          onGuardado={() => {
            setEditando(false);
            avisar(t.datos.guardado);
          }}
        />
      ) : null}
    </Seccion>
  );
}

/* ---------- Nota interna (solo con ficha_clinica:ver) ---------- */

function NotaInterna({ paciente, avisar }: { paciente: Paciente; avisar: Avisar }) {
  const t = useTextos().pacientes;
  const { api, puede } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const puedeEditar =
    puede('ficha_clinica', 'editar') && puede('pacientes', 'editar') && paciente.activo;

  const guardar = useMutation({
    mutationFn: (notaInterna: string | null) => api.pacientes.editar(paciente.id, { notaInterna }),
    onSuccess: (p) => {
      actualizar.ficha(p);
      setEditando(false);
      avisar(t.nota.guardada);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const limpio = texto.trim();
    void unaVez(() => guardar.mutateAsync(limpio ? limpio : null).catch(() => undefined));
  }

  return (
    <Seccion
      titulo={t.nota.titulo}
      ayuda={t.nota.ayuda}
      accion={
        puedeEditar && !editando ? (
          <Boton
            variante="secundario"
            onClick={() => {
              guardar.reset();
              setTexto(paciente.notaInterna ?? '');
              setEditando(true);
            }}
          >
            {t.nota.editar}
          </Boton>
        ) : undefined
      }
    >
      {editando ? (
        <form className="w-formulario" onSubmit={enviar} noValidate>
          <Campo
            etiqueta={t.nota.etiqueta}
            tipo="textarea"
            rows={4}
            maxLength={2000}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {guardar.isError ? <MensajeError texto={mensajeDeError(guardar.error)} /> : null}
          <div className="w-botonera">
            <Boton variante="secundario" onClick={() => setEditando(false)}>
              {t.alta.cancelar}
            </Boton>
            <Boton type="submit" variante="primario" cargando={guardar.isPending}>
              {t.nota.guardar}
            </Boton>
          </div>
        </form>
      ) : paciente.notaInterna ? (
        <p className="w-nota-interna">{paciente.notaInterna}</p>
      ) : (
        <p className="w-secundario">{t.nota.vacia}</p>
      )}
    </Seccion>
  );
}

/* ---------- Alertas manuales ---------- */

/** Tono de una alerta según su tipo (README: alergias en coral, condiciones en sol). */
function chipTipoAlerta(tipo: TipoAlerta): { tono: Tono; icono: 'alerta' | 'info' } {
  return tipo === 'alergia'
    ? { tono: 'atencion', icono: 'alerta' }
    : { tono: 'progreso', icono: 'info' };
}

/** Una alerta con su propio candado de doble envío: tocar otra fila no se pierde. */
function FilaAlerta({
  paciente,
  alerta: a,
  puedeEditar,
}: {
  paciente: Paciente;
  alerta: AlertaManual;
  puedeEditar: boolean;
}) {
  const t = useTextos().pacientes;
  const { api, sesion } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const cambiar = useMutation({
    mutationFn: (activa: boolean) => api.pacientes.editarAlerta(a.id, { activa }),
    onSuccess: (alerta) => {
      actualizar.cambiarFicha(paciente.id, (p) => {
        const alertas = p.alertas.map((x) => (x.id === alerta.id ? alerta : x));
        return { ...p, alertas, conAlerta: alertas.some((x) => x.activa) };
      });
    },
  });
  const tipo = chipTipoAlerta(a.tipo);
  return (
    <li className="w-lista-ficha__item w-alerta-fila">
      <div className="w-lista-ficha__cuerpo">
        <p className="w-lista-ficha__texto">{a.texto}</p>
        <p className="w-secundario">
          {t.alertas.cargadaPor(
            formatoFechaHora(a.creadaEn, sesion.clinica.zonaHoraria),
            a.creadaPor,
          )}
        </p>
        {cambiar.isError ? <MensajeError texto={mensajeDeError(cambiar.error)} /> : null}
      </div>
      <span className="w-chips">
        {a.activa ? (
          <Chip tono={tipo.tono} icono={tipo.icono}>
            {t.alertas.tipos[a.tipo]}
          </Chip>
        ) : (
          <>
            <Chip tono="neutro" icono={tipo.icono}>
              {t.alertas.tipos[a.tipo]}
            </Chip>
            <Chip tono="neutro" icono="cerrar">
              {t.alertas.inactiva}
            </Chip>
          </>
        )}
      </span>
      {puedeEditar ? (
        <Boton
          variante="fantasma"
          aria-label={a.activa ? t.alertas.desactivarDe(a.texto) : t.alertas.activarDe(a.texto)}
          cargando={cambiar.isPending}
          onClick={() => void unaVez(() => cambiar.mutateAsync(!a.activa).catch(() => undefined))}
        >
          {a.activa ? t.alertas.desactivar : t.alertas.activar}
        </Boton>
      ) : null}
    </li>
  );
}

function Alertas({ paciente, avisar }: { paciente: Paciente; avisar: Avisar }) {
  const t = useTextos().pacientes;
  const { api, puede } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const [tipo, setTipo] = useState<TipoAlerta | ''>('');
  const [texto, setTexto] = useState('');
  const [errores, setErrores] = useState<{ tipo?: string | undefined; texto?: string | undefined }>(
    {},
  );
  const veClinica = puede('ficha_clinica', 'ver');
  const puedeEditar = puede('ficha_clinica', 'editar') && paciente.activo;
  // Sin acceso clínico (recepción) se ven solo las activas: son las que importan en el mostrador.
  const visibles = veClinica ? paciente.alertas : paciente.alertas.filter((a) => a.activa);

  const crear = useMutation({
    mutationFn: (datos: CrearAlerta) => api.pacientes.crearAlerta(paciente.id, datos),
    onSuccess: (alerta) => {
      actualizar.cambiarFicha(paciente.id, (p) => ({
        ...p,
        alertas: [...p.alertas, alerta],
        conAlerta: p.conAlerta || alerta.activa,
      }));
      setTexto('');
      setTipo('');
      avisar(t.alertas.agregada);
    },
  });

  function agregar(e: FormEvent) {
    e.preventDefault();
    const r = crearAlertaSchema.safeParse({ tipo, texto });
    if (!r.success) {
      const faltan: typeof errores = {};
      for (const issue of r.error.issues) {
        const campo = issue.path[0];
        if (campo === 'tipo') faltan.tipo ??= t.alertas.faltaTipo;
        if (campo === 'texto') faltan.texto ??= issue.message;
      }
      setErrores(faltan);
      return;
    }
    setErrores({});
    void unaVez(() => crear.mutateAsync(r.data).catch(() => undefined));
  }

  return (
    <Seccion titulo={t.alertas.titulo} ayuda={t.alertas.ayuda}>
      {visibles.length === 0 ? (
        <p className="w-secundario">{t.alertas.vacias}</p>
      ) : (
        <ul className="w-lista-ficha">
          {visibles.map((a) => (
            <FilaAlerta key={a.id} paciente={paciente} alerta={a} puedeEditar={puedeEditar} />
          ))}
        </ul>
      )}
      {puedeEditar ? (
        <form className="w-formulario w-alta-alerta" onSubmit={agregar} noValidate>
          <div className="w-campo-segmento">
            <span className="cn-campo__etiqueta" aria-hidden="true">
              {t.alertas.tipo}
            </span>
            <Segmento<TipoAlerta | ''>
              etiqueta={t.alertas.tipo}
              valor={tipo}
              opciones={TIPOS_ALERTA.map((v) => ({ valor: v, texto: t.alertas.tipos[v] }))}
              onCambio={(v) => {
                setTipo(v);
                setErrores((er) => ({ ...er, tipo: undefined }));
              }}
            />
            {errores.tipo ? (
              <p className="w-error-campo" role="alert">
                {errores.tipo}
              </p>
            ) : null}
          </div>
          <Campo
            etiqueta={t.alertas.nueva}
            ayuda={t.alertas.nuevaAyuda}
            maxLength={200}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              if (errores.texto) setErrores((er) => ({ ...er, texto: undefined }));
            }}
            error={errores.texto}
          />
          {crear.isError ? <MensajeError texto={mensajeDeError(crear.error)} /> : null}
          <div>
            <Boton type="submit" variante="secundario" icono="mas" cargando={crear.isPending}>
              {t.alertas.agregar}
            </Boton>
          </div>
        </form>
      ) : null}
    </Seccion>
  );
}

/* ---------- Desactivar / reactivar ---------- */

function EstadoPaciente({ paciente, avisar }: { paciente: Paciente; avisar: Avisar }) {
  const t = useTextos().pacientes;
  const { api } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const [desactivando, setDesactivando] = useState(false);

  const desactivar = useMutation({
    mutationFn: (motivo: string) => api.pacientes.desactivar(paciente.id, { motivo }),
    onSuccess: (p) => {
      actualizar.ficha(p);
      setDesactivando(false);
      avisar(t.baja.desactivado);
    },
  });
  const reactivar = useMutation({
    mutationFn: () => api.pacientes.reactivar(paciente.id),
    onSuccess: (p) => {
      actualizar.ficha(p);
      avisar(t.baja.reactivado);
    },
  });

  return (
    <Seccion titulo={t.baja.titulo}>
      {paciente.activo ? (
        <>
          <p className="w-secundario">{t.baja.activoTexto}</p>
          <div className="w-botonera">
            <Boton
              variante="peligro"
              onClick={() => {
                desactivar.reset();
                setDesactivando(true);
              }}
            >
              {t.baja.desactivar}
            </Boton>
          </div>
        </>
      ) : (
        <>
          {reactivar.isError ? <MensajeError texto={mensajeDeError(reactivar.error)} /> : null}
          <div className="w-botonera">
            <Boton
              variante="primario"
              cargando={reactivar.isPending}
              onClick={() => void unaVez(() => reactivar.mutateAsync().catch(() => undefined))}
            >
              {t.baja.reactivar}
            </Boton>
          </div>
        </>
      )}
      {desactivando ? (
        <HojaConMotivo
          abierta
          titulo={t.baja.tituloDesactivar(nombreCompleto(paciente))}
          texto={t.baja.textoDesactivar}
          confirmar={t.baja.confirmar}
          onCerrar={() => setDesactivando(false)}
          onConfirmar={(m) => void unaVez(() => desactivar.mutateAsync(m).catch(() => undefined))}
          enviando={desactivar.isPending}
          error={desactivar.error}
        />
      ) : null}
    </Seccion>
  );
}

/** Pestaña «Datos»: datos personales, alertas, nota interna, grupo familiar y estado. */
export function PestanaDatos({ paciente }: { paciente: Paciente }) {
  const { puede } = useSesionLista();
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <div className="w-pestana-datos">
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}
      <DatosPersonales paciente={paciente} avisar={setAviso} />
      <Alertas paciente={paciente} avisar={setAviso} />
      {puede('ficha_clinica', 'ver') ? <NotaInterna paciente={paciente} avisar={setAviso} /> : null}
      <GrupoFamiliar paciente={paciente} avisar={setAviso} />
      {puede('pacientes', 'anular') ? (
        <EstadoPaciente paciente={paciente} avisar={setAviso} />
      ) : null}
    </div>
  );
}
