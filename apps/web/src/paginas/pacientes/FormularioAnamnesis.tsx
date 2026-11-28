import {
  crearAnamnesisSchema,
  formatoCi,
  SECCIONES_ANAMNESIS,
  type Anamnesis,
  type Paciente,
  type Pregunta,
} from '@conecta/shared';
import { Boton, Campo, FirmaManuscrita, HojaInferior, Icono } from '@conecta/ui';
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ErrorConecta } from '../../api/errores.js';
import { AvisoPersistente, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { CasillaVerificacion, Segmento } from '../personal/componentes.js';
import { useGuardarAnamnesis, useRecargarVersiones } from './consultasAnamnesis.js';
import { nombreCompleto } from './formato.js';
import {
  armarRespuestas,
  armarSignos,
  CAMPOS_SIGNOS,
  muestraDetalle,
  preguntasDelFormulario,
  SIGNOS_VACIOS,
  VALOR_VACIO,
  valoresIniciales,
  type CampoSigno,
  type SignosTexto,
  type ValoresFormulario,
  type ValorPregunta,
} from './respuestasAnamnesis.js';

/** Errores del formulario: por pregunta (`respuestas.<codigo>`), signo o campo del firmante. */
type Errores = Record<string, string>;

/** Un error de la API por campo (`respuestas.alergias`, `firmante.ci`…) a la clave de pantalla. */
function claveDeCampo(campo: string): string {
  return campo.replace(/^respuestas\./, 'r:').replace(/^signosVitales\./, 's:');
}

const idCampo = (base: string, clave: string) => `${base}-${clave.replace(/[^a-z0-9_-]/gi, '_')}`;

/* ---------- Preguntas ---------- */

function ErrorPregunta({ id, texto }: { id: string; texto: string | undefined }) {
  if (!texto) return null;
  return (
    <p id={id} className="w-error-campo w-anam-error">
      <Icono nombre="alerta" tamano={18} />
      <span>{texto}</span>
    </p>
  );
}

function CampoPregunta({
  pregunta: p,
  valor: v,
  error,
  base,
  onCambio,
}: {
  pregunta: Pregunta;
  valor: ValorPregunta;
  error: string | undefined;
  base: string;
  onCambio: (v: ValorPregunta) => void;
}) {
  const t = useTextos().pacientes.formularioAnamnesis;
  const id = idCampo(base, `r:${p.codigo}`);
  const etiqueta = `${p.texto}${p.obligatoria ? t.obligatoria : ''}`;
  const detalle = muestraDetalle(p, v) ? (
    <Campo
      etiqueta={t.detalle}
      ayuda={t.detalleAyuda}
      maxLength={300}
      value={v.detalle}
      onChange={(e) => onCambio({ ...v, detalle: e.target.value })}
    />
  ) : null;

  if (p.tipo === 'texto') {
    return (
      <div className="w-anam-pregunta" id={id} tabIndex={-1}>
        <Campo
          etiqueta={etiqueta}
          tipo="textarea"
          rows={2}
          maxLength={1000}
          value={v.texto}
          onChange={(e) => onCambio({ ...v, texto: e.target.value })}
          error={error}
        />
      </div>
    );
  }
  if (p.tipo === 'numero') {
    const ayuda = t.numeroAyuda(p.minimo, p.maximo);
    return (
      <div className="w-anam-pregunta" id={id} tabIndex={-1}>
        <Campo
          etiqueta={p.unidad ? `${etiqueta} (${p.unidad})` : etiqueta}
          inputMode="decimal"
          autoComplete="off"
          value={v.numero}
          onChange={(e) => onCambio({ ...v, numero: e.target.value })}
          ayuda={ayuda || undefined}
          error={error}
        />
      </div>
    );
  }
  const idError = `${id}-error`;
  return (
    <fieldset
      className="w-anam-pregunta w-anam-pregunta--opciones"
      id={id}
      tabIndex={-1}
      aria-describedby={error ? idError : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="w-anam-pregunta__texto">{etiqueta}</legend>
      {p.tipo === 'si_no' ? (
        <Segmento<'si' | 'no' | ''>
          etiqueta={t.respuesta}
          valor={v.si === null ? '' : v.si ? 'si' : 'no'}
          opciones={[
            { valor: 'si', texto: t.si },
            { valor: 'no', texto: t.no },
          ]}
          onCambio={(x) => onCambio({ ...v, si: x === 'si' })}
        />
      ) : (
        <div className="w-anam-opciones">
          {p.opciones.map((o) => (
            <CasillaVerificacion
              key={o.valor}
              etiqueta={o.etiqueta}
              marcada={v.opciones.includes(o.valor)}
              onCambio={(m) =>
                onCambio({
                  ...v,
                  // Se mantiene el orden del catálogo.
                  opciones: p.opciones
                    .map((x) => x.valor)
                    .filter((x) => (x === o.valor ? m : v.opciones.includes(x))),
                })
              }
            />
          ))}
        </div>
      )}
      <ErrorPregunta id={idError} texto={error} />
      {detalle}
    </fieldset>
  );
}

function SeccionFormulario({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="w-tarjeta w-anam-seccion" aria-labelledby={id}>
      <h2 id={id} className="w-seccion-ficha__titulo">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/* ---------- Firmante ---------- */

interface Firmante {
  esTutor: boolean;
  nombre: string;
  ci: string;
  /** Familiar elegido del grupo (para marcar el botón), o `null`. */
  familiarId: string | null;
}

function QuienFirma({
  paciente,
  requiereTutor,
  firmante,
  errores,
  base,
  onCambio,
}: {
  paciente: Paciente;
  requiereTutor: boolean;
  firmante: Firmante;
  errores: Errores;
  base: string;
  onCambio: (f: Firmante) => void;
}) {
  const textos = useTextos().pacientes;
  const t = textos.formularioAnamnesis;
  const [sinCi, setSinCi] = useState(false);
  const tutores = paciente.relaciones.filter((r) => r.familiarEsTutorLegal);
  const nombrePaciente = nombreCompleto(paciente);

  /** Elegir un tutor del grupo familiar completa su nombre y su CI (las trae el vínculo). */
  function elegirTutor(r: Paciente['relaciones'][number]) {
    const { id, nombre, ci } = r.familiar;
    setSinCi(!ci);
    onCambio({ esTutor: true, familiarId: id, nombre, ci: ci ? formatoCi(ci) : '' });
  }

  const datosTutor = (
    <>
      {tutores.length ? (
        <div className="w-campo-segmento">
          <span className="cn-campo__etiqueta" aria-hidden="true">
            {t.tutoresGrupo}
          </span>
          <div className="w-segmento" role="group" aria-label={t.tutoresGrupo}>
            {tutores.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-segmento__opcion"
                aria-pressed={firmante.familiarId === r.familiar.id}
                onClick={() => elegirTutor(r)}
              >
                {firmante.familiarId === r.familiar.id ? (
                  <Icono nombre="check" tamano={18} />
                ) : null}
                <span>{t.usarTutor(r.familiar.nombre, textos.tipos[r.tipo])}</span>
              </button>
            ))}
            <button
              type="button"
              className="w-segmento__opcion"
              aria-pressed={firmante.familiarId === null}
              onClick={() => {
                setSinCi(false);
                onCambio({ esTutor: true, familiarId: null, nombre: '', ci: '' });
              }}
            >
              {firmante.familiarId === null ? <Icono nombre="check" tamano={18} /> : null}
              <span>{t.otraPersona}</span>
            </button>
          </div>
        </div>
      ) : null}
      <div className="w-form-paciente__fila">
        <Campo
          id={idCampo(base, 'firmante.nombre')}
          etiqueta={t.nombreTutor}
          requerido
          maxLength={120}
          autoComplete="off"
          value={firmante.nombre}
          onChange={(e) => onCambio({ ...firmante, nombre: e.target.value, familiarId: null })}
          error={errores['firmante.nombre']}
        />
        <Campo
          id={idCampo(base, 'firmante.ci')}
          etiqueta={t.ciTutor}
          requerido
          inputMode="numeric"
          autoComplete="off"
          maxLength={15}
          value={firmante.ci}
          onChange={(e) => {
            setSinCi(false);
            onCambio({ ...firmante, ci: e.target.value });
          }}
          ayuda={sinCi ? t.sinCiEnFicha : t.ciTutorAyuda}
          error={errores['firmante.ci']}
        />
      </div>
    </>
  );

  return (
    <div className="w-anam-firmante">
      <h3 className="w-anam-bloque__titulo">{t.quienFirma}</h3>
      {requiereTutor ? (
        <>
          <p>{t.menor}</p>
          {datosTutor}
        </>
      ) : (
        <>
          <CasillaVerificacion
            etiqueta={t.firmaTutor}
            marcada={firmante.esTutor}
            onCambio={(m) =>
              onCambio(
                m
                  ? { esTutor: true, familiarId: null, nombre: '', ci: '' }
                  : { esTutor: false, familiarId: null, nombre: nombrePaciente, ci: '' },
              )
            }
          />
          <p className="w-secundario">{t.firmaTutorAyuda}</p>
          {firmante.esTutor ? datosTutor : <p>{t.firmaPaciente(nombrePaciente)}</p>}
          {!firmante.esTutor && errores['firmante.nombre'] ? (
            <ErrorPregunta id={`${base}-nombre-error`} texto={errores['firmante.nombre']} />
          ) : null}
        </>
      )}
    </div>
  );
}

/* ---------- Formulario ---------- */

export interface FormularioAnamnesisProps {
  paciente: Paciente;
  catalogo: Pregunta[];
  /** Versión vigente al abrir (precarga y `versionBase`), o `null` si es la primera. */
  vigente: Anamnesis | null;
  requiereTutor: boolean;
  onGuardada: (a: Anamnesis) => void;
  onCancelar: () => void;
}

/**
 * Cuestionario pensado para que lo complete el paciente en la tablet: por secciones, con zonas
 * táctiles grandes, y al final quién firma, la firma y la declaración.
 */
export function FormularioAnamnesis({
  paciente,
  catalogo,
  vigente,
  requiereTutor,
  onGuardada,
  onCancelar,
}: FormularioAnamnesisProps) {
  const textos = useTextos().pacientes;
  const t = textos.formularioAnamnesis;
  const base = useId();
  const unaVez = useEnvioUnico();
  const guardarVersion = useGuardarAnamnesis(paciente.id);
  const recargarVersiones = useRecargarVersiones(paciente.id);
  const refResumen = useRef<HTMLDivElement>(null);

  const preguntas = useMemo(
    () => preguntasDelFormulario(catalogo, paciente.sexo),
    [catalogo, paciente.sexo],
  );
  const [valores, setValores] = useState<ValoresFormulario>(() =>
    valoresIniciales(preguntas, vigente),
  );
  const [signos, setSignos] = useState<SignosTexto>(SIGNOS_VACIOS);
  const nombrePaciente = nombreCompleto(paciente);
  const [firmante, setFirmante] = useState<Firmante>(
    requiereTutor
      ? { esTutor: true, familiarId: null, nombre: '', ci: '' }
      : { esTutor: false, familiarId: null, nombre: nombrePaciente, ci: '' },
  );
  const [firma, setFirma] = useState<string | null>(null);
  const [declaro, setDeclaro] = useState(false);
  const [versionBase, setVersionBase] = useState<number | null>(vigente?.version ?? null);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<unknown>(null);
  const [conflicto, setConflicto] = useState<ErrorConecta | null>(null);
  const [recargada, setRecargada] = useState<number | null>(null);
  const [recargando, setRecargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [tocado, setTocado] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  const tocar = () => setTocado(true);
  const quitarError = (clave: string) =>
    setErrores((e) => {
      if (!(clave in e)) return e;
      const resto = { ...e };
      delete resto[clave];
      return resto;
    });

  const sv = vigente?.signosVitales;
  const anteriores: Record<CampoSigno, string | null> = {
    presionSistolica: sv?.presionSistolica != null ? String(sv.presionSistolica) : null,
    presionDiastolica: sv?.presionDiastolica != null ? String(sv.presionDiastolica) : null,
    pulso: sv?.pulso != null ? String(sv.pulso) : null,
    pesoKg: sv?.pesoKg != null ? String(sv.pesoKg).replace('.', ',') : null,
  };
  const etiquetaSigno: Record<CampoSigno, string> = {
    presionSistolica: t.sistolica,
    presionDiastolica: t.diastolica,
    pulso: t.pulso,
    pesoKg: t.peso,
  };

  /** Mensajes del resumen, en el orden de la pantalla. */
  function resumen(e: Errores): { clave: string; texto: string }[] {
    const orden = [
      ...preguntas.map((p) => `r:${p.codigo}`),
      ...CAMPOS_SIGNOS.map((c) => `s:${c}`),
      'firmante.nombre',
      'firmante.ci',
      'firmaPng',
      'declaracionVeracidad',
    ];
    const etiquetas: Record<string, string> = {
      ...Object.fromEntries(preguntas.map((p) => [`r:${p.codigo}`, p.texto])),
      ...Object.fromEntries(CAMPOS_SIGNOS.map((c) => [`s:${c}`, etiquetaSigno[c]])),
      'firmante.nombre': t.nombreTutor,
      'firmante.ci': t.ciTutor,
      firmaPng: t.firmaGenerica,
      declaracionVeracidad: t.declaracion,
    };
    const claves = [
      ...orden.filter((c) => c in e),
      ...Object.keys(e).filter((c) => !orden.includes(c)),
    ];
    return claves.map((c) => ({
      clave: c,
      texto: etiquetas[c] ? `${etiquetas[c]}: ${e[c] ?? ''}` : (e[c] ?? ''),
    }));
  }

  function mostrarErrores(e: Errores) {
    setErrores(e);
    // El resumen aparece al pie; el foco va ahí para que el lector de pantalla lo lea.
    setTimeout(() => refResumen.current?.focus(), 0);
  }

  async function guardar() {
    setErrorGeneral(null);
    const r = armarRespuestas(preguntas, valores, t);
    const s = armarSignos(signos, t);
    const nuevos: Errores = {};
    for (const [codigo, m] of Object.entries(r.errores)) nuevos[`r:${codigo}`] = m;
    for (const [campo, m] of Object.entries(s.errores)) if (m) nuevos[`s:${campo}`] = m;

    const cuerpo = {
      versionBase,
      respuestas: r.respuestas,
      signosVitales: s.signos,
      firmante: firmante.esTutor
        ? { nombre: firmante.nombre.trim(), ci: firmante.ci.trim() || null, esTutor: true }
        : { nombre: nombrePaciente, ci: paciente.ci, esTutor: false },
      firmaPng: firma ?? '',
      declaracionVeracidad: declaro,
    };
    const v = crearAnamnesisSchema.safeParse(cuerpo);
    if (!v.success) {
      for (const issue of v.error.issues) {
        const clave = claveDeCampo(issue.path.join('.'));
        if (clave === 'firmaPng') nuevos[clave] ??= t.faltaFirma;
        else nuevos[clave] ??= issue.message;
      }
    }
    if (Object.keys(nuevos).length || !v.success) {
      mostrarErrores(nuevos);
      return;
    }
    setErrores({});
    setGuardando(true);
    try {
      const a = await guardarVersion(v.data);
      onGuardada(a);
    } catch (e) {
      if (e instanceof ErrorConecta && e.codigo === 'conflicto') {
        setConflicto(e);
        setRecargada(null);
      } else if (e instanceof ErrorConecta && e.detalles.length) {
        const porCampo: Errores = {};
        for (const d of e.detalles) porCampo[claveDeCampo(d.campo)] = d.mensaje;
        setErrorGeneral(e);
        mostrarErrores(porCampo);
      } else {
        setErrorGeneral(e);
      }
    } finally {
      setGuardando(false);
    }
  }

  async function cargarVersionNueva() {
    setRecargando(true);
    try {
      const nueva = await recargarVersiones();
      setVersionBase(nueva);
      setRecargada(nueva);
      setConflicto(null);
    } catch (e) {
      setErrorGeneral(e);
    } finally {
      setRecargando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void unaVez(guardar);
  }

  const siguiente = (versionBase ?? 0) + 1;
  const lista = resumen(errores);
  const nombreFirma = firmante.esTutor ? firmante.nombre.trim() : nombrePaciente;

  return (
    <form className="w-anam-formulario" onSubmit={enviar} noValidate>
      <header className="w-anam-formulario__cabecera">
        <h2 className="w-anam-formulario__titulo">
          {vigente ? t.tituloActualizar(nombrePaciente) : t.tituloNueva(nombrePaciente)}
        </h2>
        <p>{t.siguienteVersion(siguiente, versionBase)}</p>
        <p className="w-secundario">{t.pasarTablet}</p>
      </header>

      {SECCIONES_ANAMNESIS.map((s) => {
        const deSeccion = preguntas.filter((p) => p.seccion === s.numero);
        if (!deSeccion.length) return null;
        return (
          <SeccionFormulario key={s.numero} titulo={`${s.numero}. ${s.titulo}`}>
            {deSeccion.map((p) => (
              <CampoPregunta
                key={p.codigo}
                pregunta={p}
                base={base}
                valor={valores[p.codigo] ?? VALOR_VACIO}
                error={errores[`r:${p.codigo}`]}
                onCambio={(nuevo) => {
                  tocar();
                  quitarError(`r:${p.codigo}`);
                  setValores((vs) => ({ ...vs, [p.codigo]: nuevo }));
                }}
              />
            ))}
          </SeccionFormulario>
        );
      })}
      {!preguntas.length ? <AvisoPersistente titulo={t.sinPreguntas} /> : null}

      <SeccionFormulario titulo={t.signos}>
        <p className="w-secundario">{t.signosAyuda}</p>
        <div className="w-form-paciente__fila">
          {CAMPOS_SIGNOS.map((c) => {
            const anterior = anteriores[c];
            return (
              <Campo
                key={c}
                id={idCampo(base, `s:${c}`)}
                etiqueta={etiquetaSigno[c]}
                inputMode={c === 'pesoKg' ? 'decimal' : 'numeric'}
                autoComplete="off"
                value={signos[c]}
                onChange={(e) => {
                  tocar();
                  quitarError(`s:${c}`);
                  setSignos((x) => ({ ...x, [c]: e.target.value }));
                }}
                ayuda={anterior ? t.anterior(anterior) : undefined}
                error={errores[`s:${c}`]}
              />
            );
          })}
        </div>
      </SeccionFormulario>

      <SeccionFormulario titulo={t.firmaTitulo}>
        <QuienFirma
          paciente={paciente}
          requiereTutor={requiereTutor}
          firmante={firmante}
          errores={errores}
          base={base}
          onCambio={(f) => {
            tocar();
            quitarError('firmante.nombre');
            quitarError('firmante.ci');
            setFirmante(f);
          }}
        />
        <div id={idCampo(base, 'firmaPng')} tabIndex={-1}>
          <FirmaManuscrita
            etiqueta={nombreFirma ? t.firma(nombreFirma) : t.firmaGenerica}
            valor={firma}
            nombreSugerido={nombreFirma}
            maxCaracteres={400_000}
            onCambio={(png) => {
              tocar();
              quitarError('firmaPng');
              setFirma(png);
            }}
            error={errores['firmaPng']}
          />
        </div>
        <div id={idCampo(base, 'declaracionVeracidad')} tabIndex={-1}>
          <CasillaVerificacion
            className="w-anam-declaracion"
            etiqueta={t.declaracion}
            marcada={declaro}
            onCambio={(m) => {
              tocar();
              quitarError('declaracionVeracidad');
              setDeclaro(m);
            }}
          />
          <ErrorPregunta id={`${base}-declaracion-error`} texto={errores['declaracionVeracidad']} />
        </div>
      </SeccionFormulario>

      {conflicto ? (
        <AvisoPersistente
          titulo={t.conflictoTitulo}
          texto={`${conflicto.message} ${t.conflictoTexto}`}
          accion={
            <Boton
              variante="secundario"
              icono="sincronizar"
              cargando={recargando}
              onClick={() => void cargarVersionNueva()}
            >
              {t.conflictoCargar}
            </Boton>
          }
        />
      ) : null}
      {recargada !== null ? (
        <div className="w-aviso-atencion w-aviso-neutro" role="status">
          <Icono nombre="info" tamano={22} />
          <div className="w-aviso-atencion__cuerpo">
            <p className="w-aviso-atencion__titulo">{t.conflictoListo(recargada)}</p>
            <a
              className="w-anam-enlace"
              href={`/pacientes/${paciente.id}/anamnesis?version=${recargada}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.verVersionNueva(recargada)}
            </a>
          </div>
        </div>
      ) : null}

      <div ref={refResumen} tabIndex={-1} className="w-anam-resumen" role="alert">
        {lista.length ? (
          <div className="w-error">
            <Icono nombre="alerta" tamano={22} />
            <div className="w-error__cuerpo">
              <p className="w-error__texto">{t.revisar}</p>
              <ul className="w-anam-resumen__lista">
                {lista.map((x) => (
                  <li key={x.clave}>
                    <a
                      href={`#${idCampo(base, x.clave)}`}
                      onClick={(e) => {
                        const destino = document.getElementById(idCampo(base, x.clave));
                        if (!destino) return;
                        e.preventDefault();
                        destino.scrollIntoView?.({ block: 'center' });
                        destino.focus();
                      }}
                    >
                      {x.texto}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
      {errorGeneral && !conflicto && !lista.length ? <MensajeError error={errorGeneral} /> : null}

      <div className="w-botonera w-anam-formulario__acciones">
        <Boton
          variante="secundario"
          onClick={() => (tocado ? setConfirmarSalida(true) : onCancelar())}
        >
          {t.cancelar}
        </Boton>
        <Boton type="submit" variante="primario" tamano="lg" cargando={guardando}>
          {t.guardar}
        </Boton>
      </div>

      <HojaInferior
        abierta={confirmarSalida}
        titulo={t.salirTitulo}
        onCerrar={() => setConfirmarSalida(false)}
        acciones={
          <>
            <Boton variante="secundario" onClick={() => setConfirmarSalida(false)}>
              {t.seguir}
            </Boton>
            <Boton variante="peligro" onClick={onCancelar}>
              {t.salirConfirmar}
            </Boton>
          </>
        }
      >
        <p>{t.salirTexto}</p>
      </HojaInferior>
    </form>
  );
}
