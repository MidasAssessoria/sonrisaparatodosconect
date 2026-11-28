import { z } from 'zod';

import { normalizarCi } from '../documentos.js';
import { fechaHoraSchema, idSchema } from './comun.js';
import { alertaMedicaSchema, TIPOS_ALERTA } from './pacientes.js';

/*
 * Anamnesis versionada y alerta médica (Sprint 4). Módulo de permisos: `ficha_clinica`.
 *
 *   - El cuestionario es un catálogo por clínica (`GET/PUT /anamnesis/preguntas`), con 5
 *     secciones. Cada pregunta trae, si corresponde, la alerta médica que genera una respuesta
 *     (las reglas viven en el catálogo: no hay otra tabla que mantener a mano). El catálogo nace
 *     con el cuestionario de la maqueta (referencia/maqueta/docs/02-pacientes-ficha.md).
 *   - Cada anamnesis es una VERSIÓN inmutable: «Actualizar» abre el formulario con las respuestas
 *     de la vigente y guarda la siguiente (versión anterior + 1). La base rechaza editarla o
 *     borrarla. Cada respuesta guarda una copia del texto de la pregunta, así una versión vieja se
 *     sigue leyendo igual aunque el catálogo cambie.
 *   - Para guardar hacen falta la firma (trazo dibujado en la pantalla, PNG) y la declaración de
 *     veracidad. Si el paciente es menor de `clinica.edad_tutor` (18 por defecto) firma un tutor:
 *     su nombre y CI son obligatorios. Se guarda quién registró la versión (usuario) y quién firmó.
 *   - La pregunta de embarazo/lactancia (`soloSexo: 'F'`) se muestra y se acepta solo si el sexo
 *     del paciente no es M (si el sexo no está cargado, se pregunta).
 *   - La ALERTA MÉDICA se calcula siempre de la versión vigente con las reglas del catálogo (no se
 *     guarda a mano). Si la respuesta trae detalle, se agrega entre paréntesis: «Alergia a la
 *     penicilina (urticaria con amoxicilina)». Aparece en la ficha del paciente
 *     (`Paciente.alertasMedicas`), cuenta para el filtro «Con alerta», y la ve quien tiene
 *     `pacientes:ver` (como las alertas manuales activas: recepción la necesita al recibir al
 *     paciente). El cuestionario completo, en cambio, solo con `ficha_clinica:ver`.
 *   - Ver una versión completa (`GET /pacientes/:id/anamnesis/:version`) queda en auditoría como
 *     `ver`.
 *
 * Permisos de las rutas: ver el cuestionario y las versiones `ficha_clinica:ver`; guardar una
 * versión `ficha_clinica:crear`; editar el catálogo `configuracion:editar`; historial
 * `pacientes:ver` (los eventos clínicos solo con `ficha_clinica:ver`).
 */

export const SECCIONES_ANAMNESIS = [
  { numero: 1, titulo: 'Motivo de consulta y síntomas' },
  { numero: 2, titulo: 'Antecedentes odontológicos' },
  { numero: 3, titulo: 'Hábitos' },
  { numero: 4, titulo: 'Antecedentes médicos' },
  { numero: 5, titulo: 'Datos complementarios' },
] as const;

export const TIPOS_PREGUNTA = ['si_no', 'multiple', 'texto', 'numero'] as const;
export type TipoPregunta = (typeof TIPOS_PREGUNTA)[number];

/** Alerta que genera una respuesta. `grupoAlergia` alimenta el cruce con recetas (Sprint 11). */
export const reglaAlertaSchema = z.object({
  tipo: z.enum(TIPOS_ALERTA),
  /** Texto de la alerta, p. ej. «Alergia a la penicilina». */
  texto: z.string().trim().min(3).max(120),
  gravedad: z.enum(['alta', 'media']).default('alta'),
  grupoAlergia: z
    .string()
    .trim()
    .regex(/^[a-z_]{3,40}$/)
    .nullable()
    .default(null),
});
export type ReglaAlerta = z.infer<typeof reglaAlertaSchema>;

export const opcionPreguntaSchema = z.object({
  /** Valor estable (no cambia aunque cambie la etiqueta). */
  valor: z.string().regex(/^[a-z0-9_]{1,40}$/),
  etiqueta: z.string().trim().min(1).max(80),
  /** Marcar esta opción genera esta alerta. */
  alerta: reglaAlertaSchema.nullable().default(null),
});

const codigoPreguntaSchema = z.string().regex(/^[a-z0-9_]{2,40}$/, 'Usá minúsculas, números y _.');

export const preguntaSchema = z.object({
  codigo: codigoPreguntaSchema,
  seccion: z.number().int().min(1).max(5),
  orden: z.number().int().min(0).max(999),
  texto: z.string().trim().min(3).max(200),
  tipo: z.enum(TIPOS_PREGUNTA),
  /** Solo `multiple`. */
  opciones: z.array(opcionPreguntaSchema).max(30).default([]),
  /** `si_no`: responder «sí» genera esta alerta. */
  alertaSiSi: reglaAlertaSchema.nullable().default(null),
  /** `si_no` y `multiple`: se puede agregar un detalle en texto libre. */
  conDetalle: z.boolean().default(false),
  /** `numero`: unidad y rango aceptado. */
  unidad: z.string().trim().max(20).nullable().default(null),
  minimo: z.number().nullable().default(null),
  maximo: z.number().nullable().default(null),
  /** `'F'`: la pregunta solo aplica si el sexo del paciente no es M. */
  soloSexo: z.literal('F').nullable().default(null),
  obligatoria: z.boolean().default(false),
  activa: z.boolean().default(true),
});
export type Pregunta = z.infer<typeof preguntaSchema>;

/**
 * `GET /api/v1/anamnesis/preguntas` — `ficha_clinica:ver`: el catálogo activo, ordenado (para el
 * formulario). `GET /api/v1/anamnesis/preguntas/catalogo` — `configuracion:editar`: el catálogo
 * completo, incluidas las inactivas, para el editor (Administración edita el cuestionario sin ver
 * fichas clínicas: el texto de las preguntas no es dato de ningún paciente).
 * `PUT /api/v1/anamnesis/preguntas` — `configuracion:editar`: reemplaza el catálogo. Los
 * códigos son estables: una pregunta que falta queda inactiva (no se borra) y se puede reactivar
 * mandándola de nuevo. Responde el catálogo completo, incluidas las inactivas.
 */
export const reemplazarPreguntasSchema = z.object({
  preguntas: z.array(preguntaSchema).min(1).max(200),
});
export const catalogoPreguntasSchema = z.object({ preguntas: z.array(preguntaSchema) });

/** Respuesta a una pregunta. Lleva solo los campos de su tipo. */
export const respuestaSchema = z.object({
  codigo: codigoPreguntaSchema,
  si: z.boolean().optional(),
  opciones: z
    .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
    .max(30)
    .optional(),
  texto: z.string().trim().max(1000).optional(),
  numero: z.number().optional(),
  detalle: z.string().trim().max(300).optional(),
});
export type Respuesta = z.infer<typeof respuestaSchema>;

/** Signos vitales tomados al registrar (numéricos; doc 14 punto 14). */
export const signosVitalesSchema = z.object({
  presionSistolica: z.number().int().min(50).max(260).nullable(),
  presionDiastolica: z.number().int().min(30).max(160).nullable(),
  pulso: z.number().int().min(20).max(250).nullable(),
  pesoKg: z.number().min(1).max(400).nullable(),
});

/**
 * `POST /api/v1/pacientes/:id/anamnesis` — `ficha_clinica:crear`. Guarda la versión siguiente y
 * responde 201 con la `Anamnesis` completa. Una pregunta obligatoria sin responder, una opción que
 * no existe, un número fuera de rango, la pregunta de embarazo para un paciente de sexo M, o un
 * menor sin tutor: 400 con `detalles` por campo (`respuestas.<codigo>`, `firmante.ci`…).
 * `versionBase`: la versión vigente que se abrió para actualizar (null si no había); si otra
 * persona guardó una versión en el medio, 409 `conflicto` («Otra persona actualizó la anamnesis
 * mientras la completabas…»), así nadie pisa sin saber.
 */
export const crearAnamnesisSchema = z
  .object({
    versionBase: z.number().int().min(1).nullable(),
    respuestas: z.array(respuestaSchema).max(200),
    signosVitales: signosVitalesSchema.partial().default({}),
    firmante: z.object({
      nombre: z.string().trim().min(3, 'Escribí el nombre de quien firma.').max(120),
      ci: z
        .string()
        .transform((v, ctx) => {
          const ci = normalizarCi(v);
          if (ci === null)
            ctx.addIssue({ code: 'custom', message: 'La cédula va con 5 a 9 números.' });
          return ci ?? '';
        })
        .nullable()
        .default(null),
      esTutor: z.boolean(),
    }),
    /** Trazo de la firma: `data:image/png;base64,…`, hasta 300 KB. */
    firmaPng: z
      .string()
      .max(420_000, 'La firma es demasiado grande.')
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, 'Falta la firma.'),
    declaracionVeracidad: z.literal(true, {
      error: 'Marcá «Declaro que la información es verdadera».',
    }),
  })
  .refine((v) => !v.firmante.esTutor || v.firmante.ci !== null, {
    message: 'Escribí la cédula del tutor o tutora.',
    path: ['firmante', 'ci'],
  });
export type CrearAnamnesis = z.infer<typeof crearAnamnesisSchema>;

export const respuestaGuardadaSchema = respuestaSchema.extend({
  /** Copia del texto de la pregunta al guardar. */
  pregunta: z.string(),
  seccion: z.number().int(),
  tipo: z.enum(TIPOS_PREGUNTA),
  /** Etiquetas de las opciones marcadas, también copiadas. */
  etiquetas: z.array(z.string()).default([]),
  /** Unidad de una pregunta `numero`, copiada al guardar. */
  unidad: z.string().nullable().default(null),
});

export const anamnesisResumenSchema = z.object({
  version: z.number().int(),
  fecha: fechaHoraSchema,
  registradaPor: z.string().nullable(),
  firmante: z.object({ nombre: z.string(), esTutor: z.boolean() }),
  /** Cuántas alertas médicas dejó esta versión. */
  alertas: z.number().int(),
});

export const anamnesisSchema = anamnesisResumenSchema.extend({
  id: idSchema,
  pacienteId: idSchema,
  firmante: z.object({ nombre: z.string(), ci: z.string().nullable(), esTutor: z.boolean() }),
  respuestas: z.array(respuestaGuardadaSchema),
  signosVitales: signosVitalesSchema,
  alertasMedicas: z.array(alertaMedicaSchema),
  /** URL firmada de la imagen de la firma (vence en 5 minutos). */
  firmaUrl: z.string(),
  esVigente: z.boolean(),
});
export type Anamnesis = z.infer<typeof anamnesisSchema>;

/**
 * `GET /api/v1/pacientes/:id/anamnesis` — `ficha_clinica:ver`: versiones de la más nueva a la más
 * vieja. `GET /api/v1/pacientes/:id/anamnesis/:version` — `ficha_clinica:ver`: una versión (la
 * vigente con `vigente` en lugar del número), auditada como `ver`.
 */
export const versionesAnamnesisSchema = z.object({
  versiones: z.array(anamnesisResumenSchema),
  /** Datos para armar el formulario: el paciente es menor (firma un tutor). El sexo sale de la ficha. */
  requiereTutor: z.boolean(),
});

/**
 * `GET /api/v1/pacientes/:id/historial` — `pacientes:ver`. Línea de tiempo del paciente, del más
 * nuevo al más viejo, con cursor. Sin `ficha_clinica:ver` no aparecen los eventos clínicos
 * (anamnesis, alertas). Cada evento enlaza a su origen; los sprints siguientes suman tipos
 * (turnos, presupuestos, recetas…).
 */
export const TIPOS_EVENTO_HISTORIAL = [
  'alta',
  'datos_editados',
  'baja',
  'reactivacion',
  'anamnesis',
  'alerta_creada',
  'alerta_desactivada',
  'vinculo_agregado',
  'vinculo_quitado',
] as const;
export const eventoHistorialSchema = z.object({
  tipo: z.enum(TIPOS_EVENTO_HISTORIAL),
  fecha: fechaHoraSchema,
  /** Frase lista para mostrar, sin datos clínicos para quien no ve la ficha. */
  descripcion: z.string(),
  autor: z.string().nullable(),
  /** Para enlazar: versión de anamnesis, id de alerta o de familiar. */
  referencia: z.string().nullable(),
});
export const consultaHistorialSchema = z.object({
  cursor: z.string().max(400).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(30),
});
export const paginaHistorialSchema = z.object({
  eventos: z.array(eventoHistorialSchema),
  siguienteCursor: z.string().nullable(),
});
