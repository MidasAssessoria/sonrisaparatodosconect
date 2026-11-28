import { z } from 'zod';

import { fechaHoraSchema, idSchema } from './comun.js';

/*
 * Archivos privados. Nunca hay URL pública ni permanente: la API guarda el archivo en un
 * almacenamiento privado y entrega URLs firmadas que vencen en 5 minutos como máximo, después de
 * comprobar el permiso del módulo dueño del archivo. Cada URL entregada queda en auditoría como
 * `ver`.
 *
 * Cada categoría define a qué módulo pertenece el archivo (y por lo tanto qué permiso hace falta
 * para subirlo —`crear`— y para verlo —`ver`—), qué tipos acepta y cuánto puede pesar. Las
 * categorías clínicas (radiografías, fotos, firmas de pacientes) llegan con sus sprints.
 */

export const CATEGORIAS_ARCHIVO = {
  /** Firma escaneada o dibujada de un profesional (recetas y consentimientos, Sprint 11). */
  firma_profesional: {
    modulo: 'personal',
    tipos: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
  },
  /** Trazo de la firma de un paciente o su tutor (anamnesis, consentimientos). La guarda la API. */
  firma_paciente: {
    modulo: 'ficha_clinica',
    tipos: ['image/png'],
    maxBytes: 300 * 1024,
  },
  /** Logo de la clínica para documentos impresos. */
  logo_clinica: {
    modulo: 'configuracion',
    tipos: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytes: 2 * 1024 * 1024,
  },
} as const;
export type CategoriaArchivo = keyof typeof CATEGORIAS_ARCHIVO;
export const NOMBRES_CATEGORIA_ARCHIVO = Object.keys(CATEGORIAS_ARCHIVO) as [
  CategoriaArchivo,
  ...CategoriaArchivo[],
];

/**
 * `POST /api/v1/archivos` — `multipart/form-data` con los campos `categoria` y `archivo`. El
 * permiso es `<modulo de la categoría>:crear`. La API comprueba el tipo real por el contenido (no
 * por la extensión ni por lo que diga el navegador), el tamaño, calcula el SHA-256 y, en
 * imágenes, el ancho y el alto.
 *
 * El campo `categoria` tiene que ir ANTES que `archivo` en el formulario: la API exige el permiso
 * apenas lo lee, antes de aceptar un solo byte del archivo. SVG no se acepta en ninguna categoría
 * (revisión de seguridad del Sprint 2).
 */
/** Categorías que guarda la propia API (no se suben por `POST /archivos`). */
export const CATEGORIAS_ARCHIVO_INTERNAS = ['firma_paciente'] as const;
export const CATEGORIAS_ARCHIVO_SUBIBLES = NOMBRES_CATEGORIA_ARCHIVO.filter(
  (c) => !(CATEGORIAS_ARCHIVO_INTERNAS as readonly string[]).includes(c),
) as [CategoriaArchivo, ...CategoriaArchivo[]];

export const subirArchivoCamposSchema = z.object({
  categoria: z.enum(CATEGORIAS_ARCHIVO_SUBIBLES),
});

export const archivoSchema = z.object({
  id: idSchema,
  categoria: z.enum(NOMBRES_CATEGORIA_ARCHIVO),
  nombreOriginal: z.string(),
  tipo: z.string(),
  bytes: z.number().int(),
  ancho: z.number().int().nullable(),
  alto: z.number().int().nullable(),
  sha256: z.string(),
  subidoEn: fechaHoraSchema,
});
export type Archivo = z.infer<typeof archivoSchema>;

/**
 * `GET /api/v1/archivos/:id/url` — permiso `<modulo de la categoría>:ver`. `url` es absoluta (la
 * API la arma con su propio origen o con la de Storage) y se usa tal cual. La descarga vuelve a
 * comprobar membresía y permiso, y queda en auditoría.
 */
export const urlArchivoSchema = z.object({
  url: z.string(),
  venceEn: fechaHoraSchema,
});
export type UrlArchivo = z.infer<typeof urlArchivoSchema>;
