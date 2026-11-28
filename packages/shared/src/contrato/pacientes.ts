import { z } from 'zod';

import { normalizarCi, normalizarRuc, normalizarTelefono } from '../documentos.js';
import { fechaHoraSchema, idSchema } from './comun.js';

/*
 * Pacientes (Sprint 3). Un paciente es de la clínica, no de una sede: lo ven todas sus sedes.
 *
 * Permisos:
 *   - `pacientes:ver/crear/editar` → datos personales, contacto, grupo familiar. Recepción los tiene.
 *   - `pacientes:anular` → desactivar y reactivar (nada se borra).
 *   - `ficha_clinica:ver` → además ve la nota interna. `ficha_clinica:editar` → carga alertas
 *     manuales y la nota interna. Recepción no ve la nota interna pero sí las alertas activas
 *     (las necesita en el mostrador: alergias, embarazo…).
 *   - Toda respuesta que trae la ficha completa (`GET`, `PATCH`, desactivar y reactivar de
 *     `/pacientes/:id`) queda en auditoría como `ver`, aunque el pedido no haya cambiado nada, y
 *     exige además `pacientes:ver` (revisión de seguridad del Sprint 3: un `PATCH {}` devolvía la
 *     ficha sin rastro).
 *   - El 409 de CI duplicada trae `existente` solo si quien pide tiene `pacientes:ver`; si no,
 *     solo el mensaje.
 *   - Una alerta inactiva nunca se devuelve (ni su texto) a quien no tiene `ficha_clinica:ver`.
 *   - Crear o editar un vínculo responde datos del familiar: exige además `pacientes:ver`.
 *     `PATCH /alertas/:id` responde el texto: exige `pacientes:ver` o `ficha_clinica:ver`.
 *
 * Datos (decisiones por defecto mientras el cliente no responda P4 y P6, ver docs/plan.md §7):
 *   - CI: solo dígitos; puede faltar (niños). Una CI que ya existe en la clínica NO bloquea: la API
 *     responde 409 `conflicto` con `detalles: [{ campo: 'ci' }]` y los datos del paciente que ya la
 *     tiene en `existente`, y para guardar igual hay que mandar `confirmarCiDuplicada: true`.
 *   - RUC con dígito verificador válido; teléfono en E.164 (se aceptan los formatos paraguayos).
 *   - «Pediátrico» = menor de `clinica.edad_pediatrica` años (12 por defecto), calculado por la API.
 *   - El saldo llega con los presupuestos (Sprint 8): hasta entonces no hay filtro «Con saldo».
 */

export const SEXOS = ['F', 'M'] as const;
export const IDIOMAS_PACIENTE = ['es', 'gn'] as const;
export const ORIGENES_PACIENTE = ['recepcion', 'online'] as const;

/**
 * Vínculos del grupo familiar. Se guardan en los dos sentidos: si A es `madre` de B, B queda como
 * `hijo` de A. El inverso de `hijo` es `madre` o `padre` según el sexo de quien está del otro lado
 * (si no se sabe, `otro`). `es_tutor_legal` y `es_responsable_pago` valen en un solo sentido
 * («A es tutor legal de B»).
 *
 * Sentido de `Relacion` (siempre vista desde el paciente de la ficha): `tipo` es lo que el FAMILIAR
 * es de este paciente. En la ficha de Ana, Mateo aparece como `hijo`; en la de Mateo, Ana aparece
 * como `madre`. Las marcas se ven desde los dos lados: `esTutorLegal`/`esResponsablePago` dicen lo
 * que este paciente es del familiar, y `familiarEsTutorLegal`/`familiarEsResponsablePago` lo que el
 * familiar es de este paciente (en la ficha de Mateo: `familiarEsTutorLegal = true` en la fila de Ana).
 */
export const TIPOS_RELACION = [
  'madre',
  'padre',
  'hijo',
  'hermano',
  'pareja',
  'abuelo',
  'nieto',
  'tutor',
  'tutelado',
  'otro',
] as const;
export type TipoRelacion = (typeof TIPOS_RELACION)[number];

const textoOpcional = (max: number) => z.string().trim().max(max).optional();
const ciSchema = z.string().transform((v, ctx) => {
  const ci = normalizarCi(v);
  if (ci === null) ctx.addIssue({ code: 'custom', message: 'La cédula va con 5 a 9 números.' });
  return ci ?? '';
});
const rucSchema = z.string().transform((v, ctx) => {
  const ruc = normalizarRuc(v);
  if (ruc === null)
    ctx.addIssue({
      code: 'custom',
      message: 'Revisá el RUC: va con guion y su dígito verificador.',
    });
  return ruc ?? '';
});
const telefonoSchema = z.string().transform((v, ctx) => {
  const tel = normalizarTelefono(v);
  if (tel === null)
    ctx.addIssue({
      code: 'custom',
      message: 'Escribí un teléfono válido, por ejemplo 0981 123 456.',
    });
  return tel ?? '';
});
const fechaSchema = z.iso.date();

/**
 * Tipo de alerta manual: decide cómo se muestra (README del design system: alergias en coral,
 * condiciones —embarazo, anticoagulantes, diabetes…— en sol) y alimenta el cruce de alergias de las
 * recetas (Sprint 11).
 */
export const TIPOS_ALERTA = ['alergia', 'condicion'] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export const alertaManualSchema = z.object({
  id: idSchema,
  tipo: z.enum(TIPOS_ALERTA),
  texto: z.string(),
  activa: z.boolean(),
  creadaEn: fechaHoraSchema,
  creadaPor: z.string().nullable(),
});
export type AlertaManual = z.infer<typeof alertaManualSchema>;

/** Alerta médica derivada de la anamnesis vigente (Sprint 4, contrato/anamnesis.ts). */
export const alertaMedicaSchema = z.object({
  tipo: z.enum(TIPOS_ALERTA),
  /** Texto listo para mostrar, con el detalle entre paréntesis si lo hay. */
  texto: z.string(),
  gravedad: z.enum(['alta', 'media']),
  grupoAlergia: z.string().nullable(),
  /** Pregunta que la generó. */
  codigo: z.string(),
});
export type AlertaMedica = z.infer<typeof alertaMedicaSchema>;

export const relacionSchema = z.object({
  id: idSchema,
  familiar: z.object({ id: idSchema, nombre: z.string(), edad: z.number().int().nullable() }),
  tipo: z.enum(TIPOS_RELACION),
  /** Quien está en esta ficha es tutor legal del familiar. */
  esTutorLegal: z.boolean(),
  /** Quien está en esta ficha paga por el familiar. */
  esResponsablePago: z.boolean(),
  /** El familiar es tutor legal de quien está en esta ficha. */
  familiarEsTutorLegal: z.boolean(),
  /** El familiar paga por quien está en esta ficha. */
  familiarEsResponsablePago: z.boolean(),
});
export type Relacion = z.infer<typeof relacionSchema>;

/** Fila de la lista y del buscador. */
export const pacienteResumenSchema = z.object({
  id: idSchema,
  nombres: z.string(),
  apellidos: z.string().nullable(),
  ci: z.string().nullable(),
  sexo: z.enum(SEXOS).nullable(),
  telefono: z.string().nullable(),
  fechaNac: fechaSchema.nullable(),
  edad: z.number().int().nullable(),
  pediatrico: z.boolean(),
  /** Hay al menos una alerta manual activa (las médicas se suman con la anamnesis, Sprint 4). */
  conAlerta: z.boolean(),
  activo: z.boolean(),
});
export type PacienteResumen = z.infer<typeof pacienteResumenSchema>;

export const pacienteSchema = pacienteResumenSchema.extend({
  ruc: z.string().nullable(),
  sexo: z.enum(SEXOS).nullable(),
  email: z.string().nullable(),
  ciudad: z.string().nullable(),
  direccion: z.string().nullable(),
  idioma: z.enum(IDIOMAS_PACIENTE),
  aceptaWhatsapp: z.boolean(),
  origen: z.enum(ORIGENES_PACIENTE),
  /** Solo si quien pide tiene `ficha_clinica:ver`; si no, null. */
  notaInterna: z.string().nullable(),
  alertas: z.array(alertaManualSchema),
  /** Derivadas de la anamnesis vigente; vacías si no hay anamnesis. */
  alertasMedicas: z.array(alertaMedicaSchema),
  relaciones: z.array(relacionSchema),
  motivoBaja: z.string().nullable(),
  creadoEn: fechaHoraSchema,
});
export type Paciente = z.infer<typeof pacienteSchema>;

const camposPaciente = {
  nombres: z.string().trim().min(2, 'Poné el nombre.').max(80),
  apellidos: textoOpcional(80),
  ci: ciSchema.optional(),
  ruc: rucSchema.optional(),
  fechaNac: fechaSchema.optional(),
  sexo: z.enum(SEXOS).optional(),
  telefono: telefonoSchema.optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email('Escribí un correo válido.'))
    .optional(),
  ciudad: textoOpcional(80),
  direccion: textoOpcional(200),
  idioma: z.enum(IDIOMAS_PACIENTE).optional(),
  aceptaWhatsapp: z.boolean().optional(),
};

/** `POST /api/v1/pacientes` — `pacientes:crear`. Solo el nombre es obligatorio. Responde 201 con `Paciente`. */
export const crearPacienteSchema = z.object({
  ...camposPaciente,
  /** Guardar aunque la CI ya esté cargada en otro paciente de la clínica. */
  confirmarCiDuplicada: z.boolean().optional(),
});
export type CrearPaciente = z.infer<typeof crearPacienteSchema>;

/** Cuerpo del 409 por CI duplicada: `errorApiSchema` más el paciente que ya la tiene. */
export const ciDuplicadaSchema = z.object({
  codigo: z.literal('conflicto'),
  mensaje: z.string(),
  existente: pacienteResumenSchema,
});

/**
 * Una CI que ya tiene otro paciente responde el mismo 409 con `existente` que el alta.
 * `PATCH /api/v1/pacientes/:id` — `pacientes:editar` (y `ficha_clinica:editar` si trae
 * `notaInterna`). `null` borra el dato. Responde 200 con `Paciente`.
 */
export const editarPacienteSchema = z.object({
  nombres: camposPaciente.nombres.optional(),
  apellidos: z.string().trim().max(80).nullable().optional(),
  ci: ciSchema.nullable().optional(),
  ruc: rucSchema.nullable().optional(),
  fechaNac: fechaSchema.nullable().optional(),
  sexo: z.enum(SEXOS).nullable().optional(),
  telefono: telefonoSchema.nullable().optional(),
  email: camposPaciente.email.unwrap().nullable().optional(),
  ciudad: z.string().trim().max(80).nullable().optional(),
  direccion: z.string().trim().max(200).nullable().optional(),
  idioma: z.enum(IDIOMAS_PACIENTE).optional(),
  aceptaWhatsapp: z.boolean().optional(),
  notaInterna: z.string().trim().max(2000).nullable().optional(),
  confirmarCiDuplicada: z.boolean().optional(),
});
export type EditarPaciente = z.infer<typeof editarPacienteSchema>;

export const FILTROS_PACIENTES = ['todos', 'pediatricos', 'con_alerta', 'inactivos'] as const;

/**
 * `GET /api/v1/pacientes` — `pacientes:ver`. Orden: apellidos, nombres. `q` busca por nombre (sin
 * tildes ni mayúsculas), CI (sin puntos) o teléfono (cualquier formato).
 */
export const consultaPacientesSchema = z.object({
  q: z.string().trim().max(80).optional(),
  filtro: z.enum(FILTROS_PACIENTES).default('todos'),
  cursor: z.string().max(1000).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});
export type ConsultaPacientes = z.infer<typeof consultaPacientesSchema>;
export const paginaPacientesSchema = z.object({
  items: z.array(pacienteResumenSchema),
  siguienteCursor: z.string().nullable(),
});

/**
 * `GET /api/v1/buscar?q=` — `pacientes:ver`. Buscador global de la barra superior: hasta 6
 * pacientes activos, los que mejor coinciden primero. Responde en menos de 300 ms con 20.000
 * pacientes. Con menos de 2 caracteres devuelve una lista vacía.
 */
export const consultaBuscarSchema = z.object({ q: z.string().trim().max(80).default('') });
export const resultadoBuscarSchema = z.object({ pacientes: z.array(pacienteResumenSchema) });

/** `POST /api/v1/pacientes/:id/desactivar` — `pacientes:anular`, cuerpo `bajaSchema`. Responde `Paciente`. */
/** `POST /api/v1/pacientes/:id/reactivar` — `pacientes:anular`. Responde `Paciente`. */
/* (Las dos rutas de arriba no tienen cuerpo propio más allá de `bajaSchema` en desactivar.) */

/**
 * `POST /api/v1/pacientes/:id/relaciones` — `pacientes:editar`. Crea el vínculo y su espejo en la
 * misma transacción. Responde 201 con la `Relacion` vista desde el paciente de la ruta.
 * `DELETE /api/v1/relaciones/:id` — `pacientes:editar`, sin cuerpo: da de baja el vínculo y su
 * espejo (204). `:id` es el de cualquiera de los dos lados.
 */
export const crearRelacionSchema = z.object({
  familiarId: idSchema,
  tipo: z.enum(TIPOS_RELACION),
  esTutorLegal: z.boolean().default(false),
  esResponsablePago: z.boolean().default(false),
  /** Marcas del otro lado: desde la ficha de Mateo se puede marcar que Ana es su tutora. */
  familiarEsTutorLegal: z.boolean().default(false),
  familiarEsResponsablePago: z.boolean().default(false),
});
export type CrearRelacion = z.infer<typeof crearRelacionSchema>;

/**
 * `PATCH /api/v1/relaciones/:id` — `pacientes:editar`. Cambia las marcas de un vínculo activo, vistas
 * desde el lado `:id` (el id de cualquiera de los dos lados). El tipo no se edita: se quita el
 * vínculo y se carga otro. Responde 200 con la `Relacion` vista desde ese lado.
 */
export const editarRelacionSchema = z.object({
  esTutorLegal: z.boolean().optional(),
  esResponsablePago: z.boolean().optional(),
  familiarEsTutorLegal: z.boolean().optional(),
  familiarEsResponsablePago: z.boolean().optional(),
});
export type EditarRelacion = z.infer<typeof editarRelacionSchema>;

/**
 * `POST /api/v1/pacientes/:id/alertas` — `ficha_clinica:editar`. Responde 201 con la alerta.
 * `PATCH /api/v1/alertas/:id` — `ficha_clinica:editar`: activar o desactivar (no se borra).
 * Responde 200 con la `AlertaManual`. Quien no tiene `ficha_clinica:ver` recibe solo las activas.
 */
export const crearAlertaSchema = z.object({
  tipo: z.enum(TIPOS_ALERTA),
  texto: z.string().trim().min(3, 'Escribí la alerta.').max(200),
});
export const editarAlertaSchema = z.object({ activa: z.boolean() });
