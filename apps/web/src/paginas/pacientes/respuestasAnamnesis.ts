import {
  signosVitalesSchema,
  type Anamnesis,
  type Pregunta,
  type Respuesta,
} from '@conecta/shared';
import type { Textos } from '../../i18n/es.js';

/*
 * Lógica del formulario de anamnesis, sin pantalla: qué preguntas se muestran, con qué valores
 * arranca («Actualizar» parte de la vigente) y cómo se arma cada respuesta para el contrato (solo
 * los campos de su tipo).
 */

type TextosForm = Textos['pacientes']['formularioAnamnesis'];

/** Lo que el formulario guarda de cada pregunta mientras se completa (todo como se tipeó). */
export interface ValorPregunta {
  /** `si_no`: `null` = sin responder. */
  si: boolean | null;
  opciones: string[];
  texto: string;
  numero: string;
  detalle: string;
}
export type ValoresFormulario = Record<string, ValorPregunta>;

export const VALOR_VACIO: ValorPregunta = {
  si: null,
  opciones: [],
  texto: '',
  numero: '',
  detalle: '',
};

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

/** Valores con los que abre el formulario: vacíos, o los de la versión vigente. */
export function valoresIniciales(
  preguntas: Pregunta[],
  vigente: Anamnesis | null,
): ValoresFormulario {
  const previas = new Map((vigente?.respuestas ?? []).map((r) => [r.codigo, r]));
  const valores: ValoresFormulario = {};
  for (const p of preguntas) {
    const r = previas.get(p.codigo);
    // Solo las opciones que siguen existiendo en el catálogo.
    const validas = new Set(p.opciones.map((o) => o.valor));
    valores[p.codigo] = r
      ? {
          si: p.tipo === 'si_no' ? (r.si ?? null) : null,
          opciones: (r.opciones ?? []).filter((o) => validas.has(o)),
          texto: r.texto ?? '',
          numero: r.numero !== undefined ? numeroATexto(r.numero) : '',
          detalle: r.detalle ?? '',
        }
      : { ...VALOR_VACIO };
  }
  return valores;
}

/** El detalle se muestra (y se manda) solo si la pregunta lo admite y hay algo marcado. */
export function muestraDetalle(p: Pregunta, v: ValorPregunta): boolean {
  if (!p.conDetalle) return false;
  if (p.tipo === 'si_no') return v.si === true;
  if (p.tipo === 'multiple') return v.opciones.length > 0;
  return false;
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
    const v = valores[p.codigo] ?? VALOR_VACIO;
    const detalle = muestraDetalle(p, v) && v.detalle.trim() ? { detalle: v.detalle.trim() } : {};
    switch (p.tipo) {
      case 'si_no':
        if (v.si === null) {
          if (p.obligatoria) errores[p.codigo] = t.faltaRespuesta;
        } else respuestas.push({ codigo: p.codigo, si: v.si, ...detalle });
        break;
      case 'multiple':
        if (v.opciones.length === 0) {
          if (p.obligatoria) errores[p.codigo] = t.faltaOpcion;
        } else respuestas.push({ codigo: p.codigo, opciones: [...v.opciones], ...detalle });
        break;
      case 'texto': {
        const texto = v.texto.trim();
        if (!texto) {
          if (p.obligatoria) errores[p.codigo] = t.faltaRespuesta;
        } else respuestas.push({ codigo: p.codigo, texto });
        break;
      }
      case 'numero': {
        const n = leerNumero(v.numero);
        if (n === null) {
          if (p.obligatoria) errores[p.codigo] = t.faltaRespuesta;
        } else if (Number.isNaN(n)) {
          errores[p.codigo] = t.numeroInvalido;
        } else if ((p.minimo !== null && n < p.minimo) || (p.maximo !== null && n > p.maximo)) {
          errores[p.codigo] = t.numeroRango(p.minimo, p.maximo);
        } else respuestas.push({ codigo: p.codigo, numero: n });
        break;
      }
    }
  }
  return { respuestas, errores };
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
