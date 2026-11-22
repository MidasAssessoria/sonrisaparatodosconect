import { crearAlertaSchema, type EditarPaciente, type Paciente } from '@conecta/shared';
import { AvisoExito, Boton, Campo, Chip, HojaInferior } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ErrorCiDuplicada, mensajeDeError } from '../../api/errores.js';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFecha, formatoFechaHora } from '../../utilidades/fechas.js';
import { HojaConMotivo } from '../personal/componentes.js';
import { AvisoCiDuplicada } from './AvisoCiDuplicada.js';
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
  const [ultimo, setUltimo] = useState<EditarPaciente | null>(null);
  const [sinCambios, setSinCambios] = useState(false);

  const editar = useMutation({
    mutationFn: (d: EditarPaciente) => api.pacientes.editar(paciente.id, d),
    onSuccess: (p) => {
      actualizar.ficha(p);
      onGuardado();
    },
  });
  const enviar = (d: EditarPaciente) => {
    setUltimo(d);
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
              enviar(d);
            }}
            onSinCambios={() => setSinCambios(true)}
            error={duplicada ? undefined : (editar.error ?? undefined)}
          />
          {sinCambios ? (
            <p className="w-secundario" role="status">
              {t.datos.sinCambios}
            </p>
          ) : null}
          {duplicada && ultimo ? (
            <AvisoCiDuplicada
              existente={duplicada.existente}
              guardando={editar.isPending}
              onAbrir={() => {
                cerrar();
                void navegar(`/pacientes/${duplicada.existente.id}`);
              }}
              onGuardarIgual={() => enviar({ ...ultimo, confirmarCiDuplicada: true })}
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

function Alertas({ paciente, avisar }: { paciente: Paciente; avisar: Avisar }) {
  const t = useTextos().pacientes;
  const { api, puede, sesion } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const [texto, setTexto] = useState('');
  const [errorTexto, setErrorTexto] = useState<string | null>(null);
  const veClinica = puede('ficha_clinica', 'ver');
  const puedeEditar = puede('ficha_clinica', 'editar') && paciente.activo;
  // Sin acceso clínico (recepción) se ven solo las activas: son las que importan en el mostrador.
  const visibles = veClinica ? paciente.alertas : paciente.alertas.filter((a) => a.activa);

  const crear = useMutation({
    mutationFn: (textoAlerta: string) =>
      api.pacientes.crearAlerta(paciente.id, { texto: textoAlerta }),
    onSuccess: (alerta) => {
      actualizar.cambiarFicha(paciente.id, (p) => ({
        ...p,
        alertas: [...p.alertas, alerta],
        conAlerta: p.conAlerta || alerta.activa,
      }));
      setTexto('');
      avisar(t.alertas.agregada);
    },
  });
  const cambiar = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      api.pacientes.editarAlerta(id, { activa }),
    onSuccess: (_, { id, activa }) => {
      actualizar.cambiarFicha(paciente.id, (p) => {
        const alertas = p.alertas.map((a) => (a.id === id ? { ...a, activa } : a));
        return { ...p, alertas, conAlerta: alertas.some((a) => a.activa) };
      });
    },
  });

  function agregar(e: FormEvent) {
    e.preventDefault();
    const r = crearAlertaSchema.safeParse({ texto });
    if (!r.success) {
      setErrorTexto(r.error.issues[0]?.message ?? t.errores.revisar);
      return;
    }
    setErrorTexto(null);
    void unaVez(() => crear.mutateAsync(r.data.texto).catch(() => undefined));
  }

  return (
    <Seccion titulo={t.alertas.titulo} ayuda={t.alertas.ayuda}>
      {visibles.length === 0 ? (
        <p className="w-secundario">{t.alertas.vacias}</p>
      ) : (
        <ul className="w-lista-ficha">
          {visibles.map((a) => (
            <li key={a.id} className="w-lista-ficha__item">
              <div className="w-lista-ficha__cuerpo">
                <p className="w-lista-ficha__texto">{a.texto}</p>
                <p className="w-secundario">
                  {t.alertas.cargadaPor(
                    formatoFechaHora(a.creadaEn, sesion.clinica.zonaHoraria),
                    a.creadaPor,
                  )}
                </p>
              </div>
              {a.activa ? (
                <Chip tono="atencion" icono="alerta">
                  {t.alertas.activa}
                </Chip>
              ) : (
                <Chip tono="neutro" icono="cerrar">
                  {t.alertas.inactiva}
                </Chip>
              )}
              {puedeEditar ? (
                <Boton
                  variante="fantasma"
                  aria-label={
                    a.activa ? t.alertas.desactivarDe(a.texto) : t.alertas.activarDe(a.texto)
                  }
                  cargando={cambiar.isPending && cambiar.variables?.id === a.id}
                  onClick={() =>
                    void unaVez(() =>
                      cambiar.mutateAsync({ id: a.id, activa: !a.activa }).catch(() => undefined),
                    )
                  }
                >
                  {a.activa ? t.alertas.desactivar : t.alertas.activar}
                </Boton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cambiar.isError ? <MensajeError texto={mensajeDeError(cambiar.error)} /> : null}
      {puedeEditar ? (
        <form className="w-formulario w-alta-alerta" onSubmit={agregar} noValidate>
          <Campo
            etiqueta={t.alertas.nueva}
            ayuda={t.alertas.nuevaAyuda}
            maxLength={200}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              if (errorTexto) setErrorTexto(null);
            }}
            error={errorTexto}
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
