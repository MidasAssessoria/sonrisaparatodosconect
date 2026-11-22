import {
  crearPacienteSchema,
  editarPacienteSchema,
  formatoCi,
  formatoTelefono,
  type CrearPaciente,
  type EditarPaciente,
  type Paciente,
} from '@conecta/shared';
import { Campo } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ErrorConecta, mensajeDeError } from '../../api/errores.js';
import { MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { CasillaVerificacion } from '../personal/componentes.js';

/** Campos de texto del formulario, en el orden en que se muestran. */
const CAMPOS_TEXTO = [
  'nombres',
  'apellidos',
  'ci',
  'ruc',
  'fechaNac',
  'telefono',
  'email',
  'ciudad',
  'direccion',
] as const;
type CampoTexto = (typeof CAMPOS_TEXTO)[number];

export interface ValoresPaciente {
  textos: Record<CampoTexto, string>;
  sexo: '' | 'F' | 'M';
  idioma: 'es' | 'gn';
  aceptaWhatsapp: boolean;
}

/** Valores iniciales: vacíos (alta) o los del paciente, como se escriben a mano. */
export function valoresDe(p?: Paciente): ValoresPaciente {
  return {
    textos: {
      nombres: p?.nombres ?? '',
      apellidos: p?.apellidos ?? '',
      ci: p?.ci ? formatoCi(p.ci) : '',
      ruc: p?.ruc ?? '',
      fechaNac: p?.fechaNac ?? '',
      telefono: p?.telefono ? formatoTelefono(p.telefono) : '',
      email: p?.email ?? '',
      ciudad: p?.ciudad ?? '',
      direccion: p?.direccion ?? '',
    },
    sexo: p?.sexo ?? '',
    idioma: p?.idioma ?? 'es',
    aceptaWhatsapp: p?.aceptaWhatsapp ?? false,
  };
}

type Errores = Partial<Record<CampoTexto, string>>;
type TextosPacientes = ReturnType<typeof useTextos>['pacientes'];

/** Mensaje en voseo para un problema del esquema del contrato. */
function mensajeIssue(t: TextosPacientes, campo: string, issue: z.core.$ZodIssue): string {
  if (campo === 'fechaNac') return t.errores.fechaNac;
  if (issue.code === 'too_big') return t.errores.largo(Number(issue.maximum));
  return issue.message;
}

/**
 * Valida un campo con el esquema del contrato (el mismo que aplica la API). Vacío no es error,
 * salvo el nombre.
 */
function errorDeCampo(t: TextosPacientes, campo: CampoTexto, valor: string): string | undefined {
  const v = valor.trim();
  const esquema = crearPacienteSchema.shape[campo] as z.ZodType;
  if (!v && campo !== 'nombres') return undefined;
  const r = esquema.safeParse(v);
  if (r.success) return undefined;
  const issue = r.error.issues[0];
  return issue ? mensajeIssue(t, campo, issue) : t.errores.revisar;
}

function erroresDe(t: TextosPacientes, error: z.ZodError): Errores {
  const errores: Errores = {};
  for (const issue of error.issues) {
    const campo = String(issue.path[0] ?? '');
    if ((CAMPOS_TEXTO as readonly string[]).includes(campo) && !errores[campo as CampoTexto]) {
      errores[campo as CampoTexto] = mensajeIssue(t, campo, issue);
    }
  }
  return errores;
}

/** Datos del alta: solo lo cargado, ya normalizado por el esquema del contrato. */
function datosAlta(
  t: TextosPacientes,
  v: ValoresPaciente,
): { ok: true; datos: CrearPaciente } | { ok: false; errores: Errores } {
  const entrada: Record<string, unknown> = {
    idioma: v.idioma,
    aceptaWhatsapp: v.aceptaWhatsapp,
  };
  for (const campo of CAMPOS_TEXTO) {
    const texto = v.textos[campo].trim();
    if (texto || campo === 'nombres') entrada[campo] = texto;
  }
  if (v.sexo) entrada['sexo'] = v.sexo;
  const r = crearPacienteSchema.safeParse(entrada);
  return r.success ? { ok: true, datos: r.data } : { ok: false, errores: erroresDe(t, r.error) };
}

/**
 * Datos de la edición: solo lo que cambió. Un campo que se vació manda `null` (la API borra el
 * dato); el nombre no se puede vaciar.
 */
function datosEdicion(
  t: TextosPacientes,
  v: ValoresPaciente,
  p: Paciente,
): { ok: true; datos: EditarPaciente } | { ok: false; errores: Errores } {
  const entrada: Record<string, unknown> = {};
  for (const campo of CAMPOS_TEXTO) {
    const texto = v.textos[campo].trim();
    const original = p[campo];
    if (!texto) {
      if (campo === 'nombres') entrada[campo] = texto;
      else if (original !== null) entrada[campo] = null;
      continue;
    }
    entrada[campo] = texto;
  }
  if ((v.sexo || null) !== p.sexo) entrada['sexo'] = v.sexo || null;
  if (v.idioma !== p.idioma) entrada['idioma'] = v.idioma;
  if (v.aceptaWhatsapp !== p.aceptaWhatsapp) entrada['aceptaWhatsapp'] = v.aceptaWhatsapp;
  const r = editarPacienteSchema.safeParse(entrada);
  if (!r.success) return { ok: false, errores: erroresDe(t, r.error) };
  // Lo que normalizado queda igual que antes (p. ej. la CI con puntos) no viaja.
  const datos: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(r.data)) {
    if (valor !== undefined && valor !== p[clave as keyof Paciente]) datos[clave] = valor;
  }
  return { ok: true, datos: datos };
}

/** Errores por campo que mandó la API (`detalles`), para mostrarlos al lado del campo. */
function erroresDeApi(error: unknown): Errores {
  const errores: Errores = {};
  if (error instanceof ErrorConecta && error.codigo === 'datos_invalidos') {
    for (const d of error.detalles) {
      if ((CAMPOS_TEXTO as readonly string[]).includes(d.campo)) {
        errores[d.campo as CampoTexto] = d.mensaje;
      }
    }
  }
  return errores;
}

/**
 * Formulario de paciente (alta y edición). Solo el nombre es obligatorio. Valida en vivo con los
 * esquemas del contrato: el error aparece al salir del campo y se actualiza mientras se corrige.
 */
export function FormularioPaciente({
  id,
  paciente,
  onEnviar,
  onSinCambios,
  error,
}: {
  id: string;
  /** Sin paciente: alta. Con paciente: edición (manda solo lo que cambió). */
  paciente?: Paciente;
  onEnviar: (datos: CrearPaciente | EditarPaciente) => void;
  onSinCambios?: () => void;
  /** Error del último envío (que no sea la CI duplicada, que se muestra aparte). */
  error?: unknown;
}) {
  const t = useTextos().pacientes;
  const [valores, setValores] = useState<ValoresPaciente>(() => valoresDe(paciente));
  const [tocados, setTocados] = useState<Partial<Record<CampoTexto, boolean>>>({});
  const [errores, setErrores] = useState<Errores>({});
  const api = erroresDeApi(error);

  const cambiarTexto = (campo: CampoTexto, valor: string) => {
    setValores((v) => ({ ...v, textos: { ...v.textos, [campo]: valor } }));
    if (tocados[campo]) setErrores((e) => ({ ...e, [campo]: errorDeCampo(t, campo, valor) }));
  };
  const salirDe = (campo: CampoTexto) => {
    setTocados((tc) => ({ ...tc, [campo]: true }));
    setErrores((e) => ({ ...e, [campo]: errorDeCampo(t, campo, valores.textos[campo]) }));
  };

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = paciente ? datosEdicion(t, valores, paciente) : datosAlta(t, valores);
    if (!r.ok) {
      setErrores(r.errores);
      setTocados(Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, true])));
      return;
    }
    setErrores({});
    if (paciente && Object.keys(r.datos).length === 0) {
      onSinCambios?.();
      return;
    }
    onEnviar(r.datos);
  }

  const texto = (
    campo: CampoTexto,
    etiqueta: string,
    extra: {
      tipo?: 'text' | 'email' | 'tel' | 'date';
      ayuda?: string;
      requerido?: boolean;
      autoComplete?: string;
      inputMode?: 'numeric' | 'tel' | 'email' | 'text';
      max?: string;
    } = {},
  ) => (
    <Campo
      etiqueta={etiqueta}
      tipo={extra.tipo ?? 'text'}
      value={valores.textos[campo]}
      onChange={(e) => cambiarTexto(campo, e.target.value)}
      onBlur={() => salirDe(campo)}
      error={errores[campo] ?? api[campo]}
      {...(extra.ayuda ? { ayuda: extra.ayuda } : {})}
      {...(extra.requerido ? { requerido: true } : {})}
      {...(extra.autoComplete ? { autoComplete: extra.autoComplete } : {})}
      {...(extra.inputMode ? { inputMode: extra.inputMode } : {})}
      {...(extra.max ? { max: extra.max } : {})}
    />
  );

  const hayApi = error !== undefined && error !== null && Object.keys(api).length === 0;

  return (
    <form id={id} className="w-formulario w-form-paciente" onSubmit={enviar} noValidate>
      {paciente ? null : <p className="w-secundario">{t.alta.texto}</p>}
      <div className="w-form-paciente__fila">
        {texto('nombres', t.campos.nombres, { requerido: true, autoComplete: 'off' })}
        {texto('apellidos', t.campos.apellidos, { autoComplete: 'off' })}
      </div>
      <div className="w-form-paciente__fila">
        {texto('ci', t.campos.ci, { ayuda: t.campos.ciAyuda, inputMode: 'numeric' })}
        {texto('fechaNac', t.campos.fechaNac, {
          tipo: 'date',
          max: new Date().toISOString().slice(0, 10),
        })}
      </div>
      <div className="w-form-paciente__fila">
        {texto('telefono', t.campos.telefono, {
          tipo: 'tel',
          ayuda: t.campos.telefonoAyuda,
          inputMode: 'tel',
        })}
        <Campo
          etiqueta={t.campos.sexo}
          tipo="select"
          value={valores.sexo}
          opciones={[
            { valor: '', texto: t.campos.sexoSinDato },
            { valor: 'F', texto: t.campos.sexoF },
            { valor: 'M', texto: t.campos.sexoM },
          ]}
          onChange={(e) => setValores((v) => ({ ...v, sexo: e.target.value as '' | 'F' | 'M' }))}
        />
      </div>
      <div className="w-form-paciente__fila">
        {texto('email', t.campos.email, { tipo: 'email', inputMode: 'email' })}
        {texto('ruc', t.campos.ruc, { ayuda: t.campos.rucAyuda })}
      </div>
      <div className="w-form-paciente__fila">
        {texto('ciudad', t.campos.ciudad)}
        {texto('direccion', t.campos.direccion)}
      </div>
      <Campo
        etiqueta={t.campos.idioma}
        tipo="select"
        value={valores.idioma}
        ayuda={t.campos.idiomaAyuda}
        opciones={[
          { valor: 'es', texto: t.campos.idiomaEs },
          { valor: 'gn', texto: t.campos.idiomaGn },
        ]}
        onChange={(e) => setValores((v) => ({ ...v, idioma: e.target.value as 'es' | 'gn' }))}
      />
      <CasillaVerificacion
        etiqueta={t.campos.aceptaWhatsapp}
        marcada={valores.aceptaWhatsapp}
        onCambio={(m) => setValores((v) => ({ ...v, aceptaWhatsapp: m }))}
      />
      {hayApi ? <MensajeError texto={mensajeDeError(error)} /> : null}
    </form>
  );
}
