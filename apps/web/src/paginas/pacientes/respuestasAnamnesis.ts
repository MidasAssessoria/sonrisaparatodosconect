import {
  signosVitalesSchema,
  type Anamnesis,
  type Pregunta,
  type Respuesta,
} from '@conecta/shared';
import type { Textos } from '../../i18n/es.js';

/*
 * Lógica del formulario de anamnesis, sin pantalla: qué preguntas se muestran, con qué valores
 * arranca («Actualizar» parte de la vigente), cómo se arma cada respuesta para el contrato (solo
 * los campos de su tipo), qué respuestas no se pueden pasar a otro catálogo y en qué difieren dos
 * versiones.
 */

type TextosForm = Textos['pacientes']['formularioAnamnesis'];
type RespuestaGuardada = Anamnesis['respuestas'][number];

/** Lo que el formulario guarda de cada pregunta mientras se completa (todo como se tipeó). */
export interface ValorPregunta {
  /** `si_no`: `null` = sin responder. */
  si: boolean | null;
  opciones: string[];
  /** `multiple`: «Ninguna» marcada (se manda `opciones: []`). */
  ninguna: boolean;
  texto: string;
  numero: string;
  detalle: string;
}
export type ValoresFormulario = Record<string, ValorPregunta>;

export const VALOR_VACIO: ValorPregunta = {
  si: null,
  opciones: [],
  ninguna: false,
  texto: '',
  numero: '',
  detalle: '',
};

/** Respuesta que no se pudo pasar a este cuestionario (pregunta u opción que ya no existe). */
export interface Perdida {
  codigo: string;
  pregunta: string;
  respuesta: string;
  /** Alertas médicas que dejaba lo que se pierde. */
  alertas: string[];
}

export const CAMPOS_SIGNOS = ['presionSistolica', 'presionDiastolica', 'pulso', 'pesoKg'] as const;
export type CampoSigno = (typeof CAMPOS_SIGNOS)[number];
export type SignosTexto = Record<CampoSigno, string>;
export const SIGNOS_VACIOS: SignosTexto = {
  presionSistolica: '',
  presionDiastolica: '',
  pulso: '',
  pesoKg: '',
};

/**
 * La pregunta se muestra: activa y, si es de embarazo (`soloSexo: 'F'`), el sexo no es M (sin sexo
 * cargado, se pregunta).
 */
export function aplica(p: Pregunta, sexo: 'F' | 'M' | null): boolean {
  return p.activa && !(p.soloSexo === 'F' && sexo === 'M');
}

/** Preguntas del formulario, por sección y orden. */
export function preguntasDelFormulario(catalogo: Pregunta[], sexo: 'F' | 'M' | null): Pregunta[] {
  return catalogo
    .filter((p) => aplica(p, sexo))
    .sort((a, b) => a.seccion - b.seccion || a.orden - b.orden);
}

/** «61,5» o «61.5» → 61.5; vacío → `null`; texto que no es número → `NaN`. */
export function leerNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : Number.NaN;
}

const numeroATexto = (n: number) => String(n).replace('.', ',');

/** El detalle se muestra (y se manda) solo si la pregunta lo admite y hay algo marcado. */
export function muestraDetalle(p: Pregunta, v: ValorPregunta): boolean {
  if (!p.conDetalle) return false;
  if (p.tipo === 'si_no') return v.si === true;
  if (p.tipo === 'multiple') return v.opciones.length > 0;
  return false;
}

/** Hay algo escrito o marcado (lo que se perdería al cambiar de catálogo). */
function tieneValor(v: ValorPregunta): boolean {
  return (
    v.si !== null ||
    v.opciones.length > 0 ||
    v.ninguna ||
    v.texto.trim() !== '' ||
    v.numero.trim() !== ''
  );
}

/** Una respuesta del contrato con solo los campos de su tipo (para comparar y describir). */
export function respuestaDeGuardada(r: RespuestaGuardada): Respuesta {
  const base: Respuesta = { codigo: r.codigo };
  if (r.si !== undefined) base.si = r.si;
  if (r.opciones !== undefined) base.opciones = r.opciones;
  if (r.texto !== undefined) base.texto = r.texto;
  if (r.numero !== undefined) base.numero = r.numero;
  if (r.detalle !== undefined && r.detalle !== '') base.detalle = r.detalle;
  return base;
}

/** Valores del formulario a partir de una respuesta (precarga, o «Usar la de la versión N»). */
export function valorDeRespuesta(p: Pregunta, r: Respuesta | undefined): ValorPregunta {
  if (!r) return { ...VALOR_VACIO };
  const validas = new Set(p.opciones.map((o) => o.valor));
  const opciones = (r.opciones ?? []).filter((o) => validas.has(o));
  return {
    si: p.tipo === 'si_no' ? (r.si ?? null) : null,
    opciones,
    // Opción múltiple respondida sin nada marcado: «Ninguna».
    ninguna: p.tipo === 'multiple' && r.opciones !== undefined && r.opciones.length === 0,
    texto: r.texto ?? '',
    numero: r.numero !== undefined ? numeroATexto(r.numero) : '',
    detalle: r.detalle ?? '',
  };
}

/** Respuesta de una pregunta para el contrato, o el error que impide mandarla. */
export function armarRespuesta(
  p: Pregunta,
  v: ValorPregunta,
  t: TextosForm,
): { respuesta?: Respuesta; error?: string } {
  const detalle = muestraDetalle(p, v) && v.detalle.trim() ? { detalle: v.detalle.trim() } : {};
  const falta = (error: string) => (p.obligatoria ? { error } : {});
  switch (p.tipo) {
    case 'si_no':
      return v.si === null
        ? falta(t.faltaRespuesta)
        : { respuesta: { codigo: p.codigo, si: v.si, ...detalle } };
    case 'multiple':
      if (v.ninguna) return { respuesta: { codigo: p.codigo, opciones: [] } };
      return v.opciones.length === 0
        ? falta(t.faltaOpcion)
        : { respuesta: { codigo: p.codigo, opciones: [...v.opciones], ...detalle } };
    case 'texto': {
      const texto = v.texto.trim();
      return texto ? { respuesta: { codigo: p.codigo, texto } } : falta(t.faltaRespuesta);
    }
    case 'numero': {
      const n = leerNumero(v.numero);
      if (n === null) return falta(t.faltaRespuesta);
      if (Number.isNaN(n)) return { error: t.numeroInvalido };
      if ((p.minimo !== null && n < p.minimo) || (p.maximo !== null && n > p.maximo))
        return { error: t.numeroRango(p.minimo, p.maximo) };
      return { respuesta: { codigo: p.codigo, numero: n } };
    }
  }
}

/**
 * Respuestas para el contrato y errores por código de pregunta. Una pregunta sin responder no se
 * manda (salvo que sea obligatoria: entonces es un error).
 */
export function armarRespuestas(
  preguntas: Pregunta[],
  valores: ValoresFormulario,
  t: TextosForm,
): { respuestas: Respuesta[]; errores: Record<string, string> } {
  const respuestas: Respuesta[] = [];
  const errores: Record<string, string> = {};
  for (const p of preguntas) {
    const r = armarRespuesta(p, valores[p.codigo] ?? VALOR_VACIO, t);
    if (r.respuesta) respuestas.push(r.respuesta);
    if (r.error) errores[p.codigo] = r.error;
  }
  return { respuestas, errores };
}

/** Alertas médicas que deja una respuesta según las reglas del catálogo. */
export function alertasDe(p: Pregunta, r: Respuesta | undefined): string[] {
  if (!r) return [];
  if (p.tipo === 'si_no') return r.si && p.alertaSiSi ? [p.alertaSiSi.texto] : [];
  if (p.tipo === 'multiple') {
    const marcadas = new Set(r.opciones ?? []);
    return p.opciones.flatMap((o) => (o.alerta && marcadas.has(o.valor) ? [o.alerta.texto] : []));
  }
  return [];
}

/** «Sí», «Penicilina, Látex», «Ninguna», «2 veces»… con el detalle entre paréntesis. */
export function describirRespuesta(
  p: Pick<Pregunta, 'tipo' | 'unidad' | 'opciones'>,
  r: Respuesta | undefined,
  t: TextosForm,
  etiquetas?: string[],
): string {
  if (!r) return t.sinResponder;
  const marcadas = r.opciones ?? [];
  const nombres = () =>
    etiquetas ?? marcadas.map((v) => p.opciones.find((o) => o.valor === v)?.etiqueta ?? v);
  const texto =
    p.tipo === 'si_no'
      ? r.si
        ? t.si
        : t.no
      : p.tipo === 'multiple'
        ? marcadas.length
          ? nombres().join(', ')
          : t.ninguna
        : p.tipo === 'texto'
          ? (r.texto ?? '')
          : r.numero !== undefined
            ? `${numeroATexto(r.numero)}${p.unidad ? ` ${p.unidad}` : ''}`
            : '';
  return r.detalle ? `${texto} (${r.detalle})` : texto;
}

/** Misma respuesta (el orden de las opciones no importa). */
export function mismaRespuesta(a: Respuesta | undefined, b: Respuesta | undefined): boolean {
  const norma = (r: Respuesta | undefined) =>
    r
      ? JSON.stringify([
          r.si ?? null,
          r.opciones ? [...r.opciones].sort() : null,
          r.texto ?? null,
          r.numero ?? null,
          r.detalle ?? null,
        ])
      : 'null';
  return norma(a) === norma(b);
}

/**
 * Valores con los que abre el formulario: vacíos, o los de la versión vigente. Lo que respondió
 * la vigente a preguntas u opciones que ya no están en el cuestionario se devuelve como pérdida
 * (para avisarlo: no se descarta callado).
 */
export function valoresIniciales(
  preguntas: Pregunta[],
  vigente: Anamnesis | null,
  t: TextosForm,
): { valores: ValoresFormulario; perdidas: Perdida[] } {
  const valores: ValoresFormulario = {};
  for (const p of preguntas) valores[p.codigo] = { ...VALOR_VACIO };
  const perdidas: Perdida[] = [];
  for (const g of vigente?.respuestas ?? []) {
    const r = respuestaDeGuardada(g);
    const p = preguntas.find((x) => x.codigo === g.codigo);
    const alertasVigente = (vigente?.alertasMedicas ?? [])
      .filter((a) => a.codigo === g.codigo)
      .map((a) => a.texto);
    if (!p || p.tipo !== g.tipo) {
      perdidas.push({
        codigo: g.codigo,
        pregunta: g.pregunta,
        respuesta: describirRespuesta(
          { tipo: g.tipo, unidad: g.unidad, opciones: [] },
          r,
          t,
          g.etiquetas,
        ),
        alertas: alertasVigente,
      });
      continue;
    }
    valores[p.codigo] = valorDeRespuesta(p, r);
    if (p.tipo === 'multiple') {
      const validas = new Set(p.opciones.map((o) => o.valor));
      const sacadas = (g.opciones ?? []).filter((o) => !validas.has(o));
      if (sacadas.length) {
        const quedan = new Set(alertasDe(p, r));
        perdidas.push({
          codigo: g.codigo,
          pregunta: g.pregunta,
          respuesta: sacadas.map((o) => g.etiquetas[(g.opciones ?? []).indexOf(o)] ?? o).join(', '),
          alertas: alertasVigente.filter((a) => !quedan.has(a)),
        });
      }
    }
  }
  return { valores, perdidas };
}

/**
 * Pasa lo escrito a un cuestionario nuevo: se conserva lo de las preguntas que siguen (mismo
 * código y tipo) y las opciones que siguen existiendo; el resto vuelve como pérdida.
 */
export function pasarValores(
  viejas: Pregunta[],
  nuevas: Pregunta[],
  valores: ValoresFormulario,
  t: TextosForm,
): { valores: ValoresFormulario; perdidas: Perdida[] } {
  const salida: ValoresFormulario = {};
  for (const p of nuevas) salida[p.codigo] = { ...VALOR_VACIO };
  const perdidas: Perdida[] = [];
  for (const vieja of viejas) {
    const v = valores[vieja.codigo];
    if (!v || !tieneValor(v)) continue;
    const r = armarRespuesta(vieja, v, t).respuesta;
    const nueva = nuevas.find((x) => x.codigo === vieja.codigo);
    if (!nueva || nueva.tipo !== vieja.tipo) {
      perdidas.push({
        codigo: vieja.codigo,
        pregunta: vieja.texto,
        respuesta: describirRespuesta(vieja, r, t),
        alertas: alertasDe(vieja, r),
      });
      continue;
    }
    const validas = new Set(nueva.opciones.map((o) => o.valor));
    const quedan = v.opciones.filter((o) => validas.has(o));
    salida[nueva.codigo] = { ...v, opciones: quedan };
    const sacadas = v.opciones.filter((o) => !validas.has(o));
    if (sacadas.length) {
      perdidas.push({
        codigo: vieja.codigo,
        pregunta: vieja.texto,
        respuesta: sacadas
          .map((o) => vieja.opciones.find((x) => x.valor === o)?.etiqueta ?? o)
          .join(', '),
        alertas: vieja.opciones.flatMap((o) =>
          o.alerta && sacadas.includes(o.valor) ? [o.alerta.texto] : [],
        ),
      });
    }
  }
  return { valores: salida, perdidas };
}

/** Signos vitales que se completaron, validados con el contrato. */
export function armarSignos(
  signos: SignosTexto,
  t: TextosForm,
): { signos: Partial<Record<CampoSigno, number>>; errores: Partial<Record<CampoSigno, string>> } {
  const salida: Partial<Record<CampoSigno, number>> = {};
  const errores: Partial<Record<CampoSigno, string>> = {};
  for (const campo of CAMPOS_SIGNOS) {
    const n = leerNumero(signos[campo]);
    if (n === null) continue;
    if (Number.isNaN(n)) {
      errores[campo] = t.numeroInvalido;
      continue;
    }
    const r = signosVitalesSchema.shape[campo].safeParse(n);
    if (r.success && r.data !== null) salida[campo] = r.data;
    else {
      const regla = signosVitalesSchema.shape[campo].unwrap();
      errores[campo] = t.numeroRango(regla.minValue, regla.maxValue);
    }
  }
  return { signos: salida, errores };
}
