import {
  crearAnamnesisSchema,
  formatoCi,
  SECCIONES_ANAMNESIS,
  type Anamnesis,
  type Paciente,
  type Pregunta,
} from '@conecta/shared';
import { Boton, Campo, Chip, FirmaManuscrita, HojaInferior, Icono } from '@conecta/ui';
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CatalogoPreguntas } from '../../api/cliente.js';
import { ErrorConecta } from '../../api/errores.js';
import { AvisoPersistente, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { CasillaVerificacion, Segmento } from '../personal/componentes.js';
import {
  useGuardarAnamnesis,
  useRecargarPreguntas,
  useRecargarVersiones,
  useTraerVersion,
} from './consultasAnamnesis.js';
import { DiferenciasAnamnesis, filasDiferencias } from './DiferenciasAnamnesis.js';
import { nombreCompleto } from './formato.js';
import {
  armarRespuestas,
  armarSignos,
  CAMPOS_SIGNOS,
  muestraDetalle,
  pasarValores,
  preguntasDelFormulario,
  SIGNOS_VACIOS,
  VALOR_VACIO,
  valoresIniciales,
  type CampoSigno,
  type Perdida,
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
        // «Sin responder» deja limpiar una respuesta tocada por error.
        <Segmento<'si' | 'no' | ''>
          etiqueta={t.respuesta}
          valor={v.si === null ? '' : v.si ? 'si' : 'no'}
          opciones={[
            { valor: 'si', texto: t.si },
            { valor: 'no', texto: t.no },
            { valor: '', texto: t.sinResponder },
          ]}
          onCambio={(x) => onCambio({ ...v, si: x === '' ? null : x === 'si' })}
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
                  ninguna: false,
                  // Se mantiene el orden del catálogo.
                  opciones: p.opciones
                    .map((x) => x.valor)
                    .filter((x) => (x === o.valor ? m : v.opciones.includes(x))),
                })
              }
            />
          ))}
          {/* «Ninguna» es una respuesta (`opciones: []`); sin marcar nada es «sin responder». */}
          <CasillaVerificacion
            etiqueta={t.ninguna}
            marcada={v.ninguna}
            onCambio={(m) =>
              onCambio({
                ...v,
                ninguna: m,
                opciones: m ? [] : v.opciones,
                detalle: m ? '' : v.detalle,
              })
            }
          />
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

/** Respuestas que no se pudieron pasar al cuestionario de ahora (con las alertas que dejaban). */
function AvisoPerdidas({ titulo, perdidas }: { titulo: string; perdidas: Perdida[] }) {
  const t = useTextos().pacientes.formularioAnamnesis;
  return (
    <div className="w-aviso-atencion" role="status">
      <Icono nombre="alerta" tamano={22} />
      <div className="w-aviso-atencion__cuerpo">
        <p className="w-aviso-atencion__titulo">{titulo}</p>
        <ul className="w-anam-perdidas">
          {perdidas.map((x) => (
            <li key={`${x.codigo}-${x.respuesta}`}>
              <span>{t.perdida(x.pregunta, x.respuesta)}</span>
              {x.alertas.length ? (
                <span className="w-chips">
                  {x.alertas.map((a) => (
                    <Chip key={a} tono="atencion" icono="alerta">
                      {t.dejabaAlerta(a)}
                    </Chip>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="w-aviso-atencion__texto">{t.perdidasTexto}</p>
      </div>
    </div>
  );
}

/* ---------- Firmante ---------- */

interface Firmante {
  esTutor: boolean;
  nombre: string;
  ci: string;
  /** Familiar elegido del grupo (para marcar el botón), o `null`. */
  familiarId: string | null;
  /** La CI salió del vínculo (en modo paciente no se muestra). */
  ciDelVinculo: boolean;
}

const FIRMANTE_TUTOR_VACIO: Firmante = {
  esTutor: true,
  familiarId: null,
  nombre: '',
  ci: '',
  ciDelVinculo: false,
};

function QuienFirma({
  paciente,
  requiereTutor,
  modoPaciente,
  firmante,
  errores,
  base,
  onCambio,
}: {
  paciente: Paciente;
  requiereTutor: boolean;
  modoPaciente: boolean;
  firmante: Firmante;
  errores: Errores;
  base: string;
  onCambio: (f: Firmante) => void;
}) {
  const textos = useTextos().pacientes;
  const t = textos.formularioAnamnesis;
  const tutores = paciente.relaciones.filter((r) => r.familiarEsTutorLegal);
  const nombrePaciente = nombreCompleto(paciente);
  const errorFirmante = errores['firmante.esTutor'] ?? errores['firmante'];
  const sinCi = firmante.familiarId !== null && !firmante.ciDelVinculo;
  // En modo paciente la cédula de un familiar no se muestra: se usa sin verla.
  const ciOculta = modoPaciente && firmante.ciDelVinculo;

  /** Elegir un tutor del grupo familiar completa su nombre y su CI (las trae el vínculo). */
  function elegirTutor(r: Paciente['relaciones'][number]) {
    const { id, nombre, ci } = r.familiar;
    onCambio({
      esTutor: true,
      familiarId: id,
      nombre,
      ci: ci ? formatoCi(ci) : '',
      ciDelVinculo: !!ci,
    });
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
              onClick={() => onCambio(FIRMANTE_TUTOR_VACIO)}
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
          onChange={(e) =>
            // Otro nombre ya no es el familiar elegido: su cédula no le corresponde.
            onCambio({
              ...firmante,
              nombre: e.target.value,
              familiarId: null,
              ...(firmante.ciDelVinculo ? { ci: '', ciDelVinculo: false } : {}),
            })
          }
          error={errores['firmante.nombre']}
        />
        {ciOculta ? (
          <p className="w-secundario" id={idCampo(base, 'firmante.ci')}>
            {t.ciDelGrupo}
          </p>
        ) : (
          <Campo
            id={idCampo(base, 'firmante.ci')}
            etiqueta={t.ciTutor}
            requerido
            inputMode="numeric"
            autoComplete="off"
            maxLength={15}
            value={firmante.ci}
            onChange={(e) => onCambio({ ...firmante, ci: e.target.value, ciDelVinculo: false })}
            ayuda={sinCi ? t.sinCiEnFicha : t.ciTutorAyuda}
            error={errores['firmante.ci']}
          />
        )}
      </div>
      {ciOculta && errores['firmante.ci'] ? (
        <ErrorPregunta id={`${base}-ci-error`} texto={errores['firmante.ci']} />
      ) : null}
    </>
  );

  return (
    <div className="w-anam-firmante" id={idCampo(base, 'firmante.esTutor')} tabIndex={-1}>
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
                  ? FIRMANTE_TUTOR_VACIO
                  : {
                      esTutor: false,
                      familiarId: null,
                      nombre: nombrePaciente,
                      ci: '',
                      ciDelVinculo: false,
                    },
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
      {/* El error de quién firma (p. ej. «es menor: firma un tutor») va acá, no solo en el resumen. */}
      <ErrorPregunta id={`${base}-firmante-error`} texto={errorFirmante} />
    </div>
  );
}

/* ---------- Formulario ---------- */

export interface FormularioAnamnesisProps {
  paciente: Paciente;
  /** Catálogo activo (con su huella) con el que se arma el formulario. */
  catalogo: CatalogoPreguntas;
  /** Versión vigente al abrir (precarga y `versionBase`), o `null` si es la primera. */
  vigente: Anamnesis | null;
  requiereTutor: boolean;
  /** Lo completa el paciente en la tablet: sin enlaces ni datos de otros (CI de familiares). */
  modoPaciente?: boolean;
  onGuardada: (a: Anamnesis) => void;
  onCancelar: () => void;
}

interface AvisoPerdida {
  titulo: string;
  perdidas: Perdida[];
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
  modoPaciente = false,
  onGuardada,
  onCancelar,
}: FormularioAnamnesisProps) {
  const textos = useTextos().pacientes;
  const t = textos.formularioAnamnesis;
  const base = useId();
  const unaVez = useEnvioUnico();
  const guardarVersion = useGuardarAnamnesis(paciente.id);
  const recargarVersiones = useRecargarVersiones(paciente.id);
  const traerVersion = useTraerVersion(paciente.id);
  const recargarPreguntas = useRecargarPreguntas();
  const refResumen = useRef<HTMLDivElement>(null);

  const [cuestionario, setCuestionario] = useState<CatalogoPreguntas>(catalogo);
  const preguntas = useMemo(
    () => preguntasDelFormulario(cuestionario.preguntas, paciente.sexo),
    [cuestionario, paciente.sexo],
  );
  const [inicio] = useState(() => valoresIniciales(preguntas, vigente, t));
  const [valores, setValores] = useState<ValoresFormulario>(inicio.valores);
  const [avisosPerdida, setAvisosPerdida] = useState<AvisoPerdida[]>(() =>
    inicio.perdidas.length && vigente
      ? [{ titulo: t.perdidasApertura(vigente.version), perdidas: inicio.perdidas }]
      : [],
  );
  const [signos, setSignos] = useState<SignosTexto>(SIGNOS_VACIOS);
  const nombrePaciente = nombreCompleto(paciente);
  const [firmante, setFirmante] = useState<Firmante>(
    requiereTutor
      ? FIRMANTE_TUTOR_VACIO
      : { esTutor: false, familiarId: null, nombre: nombrePaciente, ci: '', ciDelVinculo: false },
  );
  const [firma, setFirma] = useState<string | null>(null);
  const [declaro, setDeclaro] = useState(false);
  const [versionBase, setVersionBase] = useState<number | null>(vigente?.version ?? null);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<unknown>(null);
  /** 409 por versión: la versión que guardó otra persona, para comparar. */
  const [otraVersion, setOtraVersion] = useState<Anamnesis | null>(null);
  const [revisado, setRevisado] = useState(false);
  const [errorConflicto, setErrorConflicto] = useState<{
    error: unknown;
    reintentar: () => void;
  } | null>(null);
  const [avisoCuestionario, setAvisoCuestionario] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [tocado, setTocado] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  const tocar = () => setTocado(true);
  const quitarError = (...claves: string[]) =>
    setErrores((e) => {
      if (!claves.some((c) => c in e)) return e;
      const resto = { ...e };
      for (const c of claves) delete resto[c];
      return resto;
    });

  const diferencias = otraVersion ? filasDiferencias(preguntas, otraVersion, valores, t) : [];

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
      'firmante.esTutor',
      'firmante.nombre',
      'firmante.ci',
      'firmaPng',
      'declaracionVeracidad',
      'revisionDiferencias',
    ];
    const etiquetas: Record<string, string> = {
      ...Object.fromEntries(preguntas.map((p) => [`r:${p.codigo}`, p.texto])),
      ...Object.fromEntries(CAMPOS_SIGNOS.map((c) => [`s:${c}`, etiquetaSigno[c]])),
      'firmante.esTutor': t.quienFirma,
      'firmante.nombre': firmante.esTutor ? t.nombreTutor : t.quienFirma,
      'firmante.ci': t.ciTutor,
      firmaPng: t.firmaGenerica,
      declaracionVeracidad: t.declaracion,
      revisionDiferencias: t.diferenciasEtiqueta,
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

  /**
   * Vuelve a pedir el cuestionario y pasa lo escrito: lo que ya no tiene dónde ir se avisa (con
   * las alertas que dejaba), no se pierde callado.
   */
  async function actualizarCuestionario(motivo: string) {
    setTrabajando(true);
    setErrorConflicto(null);
    try {
      const nuevo = await recargarPreguntas();
      const nuevas = preguntasDelFormulario(nuevo.preguntas, paciente.sexo);
      const r = pasarValores(preguntas, nuevas, valores, t);
      setCuestionario(nuevo);
      setValores(r.valores);
      setErrores({});
      if (r.perdidas.length) {
        setAvisosPerdida((a) => [...a, { titulo: t.perdidasActualizacion, perdidas: r.perdidas }]);
      }
      setAvisoCuestionario(motivo);
    } catch (e) {
      setErrorConflicto({ error: e, reintentar: () => void actualizarCuestionario(motivo) });
    } finally {
      setTrabajando(false);
    }
  }

  /** 409 por versión: trae la que guardó la otra persona para comparar antes de volver a guardar. */
  async function traerVersionNueva() {
    setTrabajando(true);
    setErrorConflicto(null);
    try {
      const n = await recargarVersiones();
      if (n === null) return;
      const a = await traerVersion(n);
      setVersionBase(n);
      setOtraVersion(a);
      setRevisado(false);
    } catch (e) {
      setErrorConflicto({ error: e, reintentar: () => void traerVersionNueva() });
    } finally {
      setTrabajando(false);
    }
  }

  async function guardar() {
    setErrorGeneral(null);
    const r = armarRespuestas(preguntas, valores, t);
    const s = armarSignos(signos, t);
    const nuevos: Errores = {};
    for (const [codigo, m] of Object.entries(r.errores)) nuevos[`r:${codigo}`] = m;
    for (const [campo, m] of Object.entries(s.errores)) if (m) nuevos[`s:${campo}`] = m;
    if (diferencias.length && !revisado) nuevos['revisionDiferencias'] = t.faltaRevisar;

    const cuerpo = {
      versionBase,
      huellaCatalogo: cuestionario.huella,
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
        // Los dos 409 se distinguen por el campo: el cuestionario cambió, u otra versión.
        if (e.detalles[0]?.campo === 'huellaCatalogo') {
          await actualizarCuestionario(t.cuestionarioCambio);
        } else {
          await traerVersionNueva();
        }
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
        <p className="w-secundario">{modoPaciente ? t.instruccionPaciente : t.pasarTablet}</p>
        <div>
          <Boton
            variante="fantasma"
            icono="sincronizar"
            cargando={trabajando && !otraVersion}
            onClick={() => void unaVez(() => actualizarCuestionario(t.cuestionarioActualizado))}
          >
            {t.actualizarCuestionario}
          </Boton>
        </div>
      </header>

      {avisoCuestionario ? (
        <div className="w-aviso-atencion w-aviso-neutro" role="status">
          <Icono nombre="info" tamano={22} />
          <div className="w-aviso-atencion__cuerpo">
            <p className="w-aviso-atencion__titulo">{avisoCuestionario}</p>
          </div>
        </div>
      ) : null}
      {avisosPerdida.map((a, i) => (
        <AvisoPerdidas key={i} titulo={a.titulo} perdidas={a.perdidas} />
      ))}

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
          modoPaciente={modoPaciente}
          firmante={firmante}
          errores={errores}
          base={base}
          onCambio={(f) => {
            tocar();
            quitarError('firmante.nombre', 'firmante.ci', 'firmante.esTutor', 'firmante');
            setFirmante(f);
          }}
        />
        <div id={idCampo(base, 'firmaPng')} tabIndex={-1}>
          {/* Siempre dibujada: la firma escrita con el teclado espera la respuesta de P5. */}
          <FirmaManuscrita
            etiqueta={nombreFirma ? t.firma(nombreFirma) : t.firmaGenerica}
            valor={firma}
            permitirTeclado={false}
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

      {otraVersion ? (
        <DiferenciasAnamnesis
          version={otraVersion}
          filas={diferencias}
          revisado={revisado}
          error={errores['revisionDiferencias']}
          idRevisado={idCampo(base, 'revisionDiferencias')}
          onRevisado={(r) => {
            setRevisado(r);
            quitarError('revisionDiferencias');
          }}
          onUsar={(codigo, valor) => {
            tocar();
            quitarError(`r:${codigo}`);
            setValores((vs) => ({ ...vs, [codigo]: valor }));
          }}
        />
      ) : null}
      {errorConflicto ? (
        <MensajeError error={errorConflicto.error} onReintentar={errorConflicto.reintentar} />
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
      {errorGeneral && !lista.length ? <MensajeError error={errorGeneral} /> : null}

      <div className="w-botonera w-anam-formulario__acciones">
        <Boton
          variante="secundario"
          onClick={() => (tocado || modoPaciente ? setConfirmarSalida(true) : onCancelar())}
        >
          {t.cancelar}
        </Boton>
        <Boton
          type="submit"
          variante="primario"
          tamano="lg"
          cargando={guardando || (trabajando && !!otraVersion)}
        >
          {t.guardar}
        </Boton>
      </div>

      <HojaInferior
        abierta={confirmarSalida}
        titulo={modoPaciente ? t.salirTituloPaciente : t.salirTitulo}
        onCerrar={() => setConfirmarSalida(false)}
        acciones={
          <>
            <Boton variante="secundario" onClick={() => setConfirmarSalida(false)}>
              {t.seguir}
            </Boton>
            <Boton variante="peligro" onClick={onCancelar}>
              {modoPaciente ? t.salirConfirmarPaciente : t.salirConfirmar}
            </Boton>
          </>
        }
      >
        <p>{modoPaciente ? t.salirTextoPaciente : t.salirTexto}</p>
      </HojaInferior>
    </form>
  );
}
