import { CATEGORIAS_ARCHIVO, type CategoriaArchivo } from '@conecta/shared';
import { ErrorApi, errores } from '../error-api.js';

/**
 * Mensajes para las restricciones de la base del módulo archivos (nombre en `constraint`).
 * Cada una con el código del contrato y un mensaje en voseo que dice qué hacer. La API arma la
 * fila (ruta, tipo, tamaño, SHA-256): si una de estas salta es un error nuestro, no del archivo,
 * pero el mensaje igual le dice a la persona qué puede hacer.
 */
export const MENSAJES_ARCHIVOS: Record<string, () => ErrorApi> = {
  archivo_categoria_check: () =>
    errores.datosInvalidos('Esa categoría de archivo no existe. Elegí una de la lista.'),
  archivo_nombre_original_check: () =>
    errores.datosInvalidos(
      'El nombre del archivo no es válido. Cambiale el nombre y subilo de nuevo.',
    ),
  archivo_tipo_check: () =>
    errores.datosInvalidos(
      'No pudimos reconocer el tipo del archivo. Subí una imagen PNG, JPEG o WebP.',
    ),
  archivo_bytes_check: () =>
    errores.datosInvalidos('El archivo está vacío. Elegí otro archivo y probá de nuevo.'),
  archivo_ancho_check: () =>
    errores.datosInvalidos('La imagen parece dañada. Abrila, guardala de nuevo y subila otra vez.'),
  archivo_alto_check: () =>
    errores.datosInvalidos('La imagen parece dañada. Abrila, guardala de nuevo y subila otra vez.'),
  archivo_sha256_check: () => subidaFallida(),
  archivo_ruta_check: () => subidaFallida(),
  archivo_ruta_key: () => subidaFallida(),
  archivo_bucket_check: () => subidaFallida(),
  archivo_almacen_check: () => subidaFallida(),
  archivo_sede_fkey: () =>
    errores.conflicto(
      'Esa sede no está disponible en esta clínica. Elegí otra sede y probá de nuevo.',
    ),
  archivo_baja_check: () =>
    errores.datosInvalidos('Para dar de baja un archivo escribí el motivo.'),
};

function subidaFallida(): ErrorApi {
  return errores.conflicto('No pudimos guardar el archivo. Probá de nuevo en un momento.');
}

function megas(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${String(mb)} MB` : `${mb.toFixed(1).replace('.', ',')} MB`;
}

const NOMBRE_TIPO: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/svg+xml': 'SVG',
  'application/pdf': 'PDF',
};

function tiposDe(categoria: CategoriaArchivo): string {
  const nombres = CATEGORIAS_ARCHIVO[categoria].tipos.map((t) => NOMBRE_TIPO[t] ?? t);
  return nombres.length === 1
    ? (nombres[0] ?? '')
    : `${nombres.slice(0, -1).join(', ')} o ${nombres[nombres.length - 1] ?? ''}`;
}

/** Errores de la subida y la descarga de archivos. */
export const erroresArchivo = {
  /** 415: el contenido no es de un tipo que la categoría acepta (diga lo que diga el navegador). */
  tipoNoPermitido: (categoria: CategoriaArchivo) =>
    new ErrorApi(
      415,
      'datos_invalidos',
      `Ese tipo de archivo no se acepta acá. Subí un archivo ${tiposDe(categoria)}.`,
      [{ campo: 'archivo', mensaje: `Tiene que ser ${tiposDe(categoria)}.` }],
    ),
  /** 413, y se corta la conexión: el resto del archivo no se lee. */
  demasiadoGrande: (maxBytes: number) =>
    new ErrorApi(
      413,
      'datos_invalidos',
      `El archivo pesa más de ${megas(maxBytes)}. Achicalo o elegí otro y probá de nuevo.`,
      [{ campo: 'archivo', mensaje: `Puede pesar hasta ${megas(maxBytes)}.` }],
      { Connection: 'close' },
    ),
  danado: () =>
    errores.datosInvalidos(
      'El archivo parece dañado o incompleto. Abrilo, guardalo de nuevo y subilo otra vez.',
      [{ campo: 'archivo', mensaje: 'No se pudo leer.' }],
    ),
  svgInseguro: () =>
    errores.datosInvalidos(
      'Ese SVG trae scripts, enlaces o contenido externo, y no lo podemos aceptar. Exportalo como SVG simple o subí un PNG.',
      [{ campo: 'archivo', mensaje: 'El SVG tiene contenido no permitido.' }],
    ),
  vacio: () =>
    errores.datosInvalidos('El archivo está vacío. Elegí otro archivo y probá de nuevo.', [
      { campo: 'archivo', mensaje: 'Está vacío.' },
    ]),
  sinArchivo: () =>
    errores.datosInvalidos('Falta el archivo. Elegí uno y probá de nuevo.', [
      { campo: 'archivo', mensaje: 'Completá este dato.' },
    ]),
  sinCategoria: () =>
    errores.datosInvalidos('Falta la categoría del archivo. Elegila y probá de nuevo.', [
      { campo: 'categoria', mensaje: 'Completá este dato.' },
    ]),
  dosArchivos: () =>
    errores.datosInvalidos('Mandá un solo archivo por vez.', [
      { campo: 'archivo', mensaje: 'Va un solo archivo.' },
    ]),
  /** La categoría define el permiso y el tamaño: tiene que llegar antes que el archivo. */
  categoriaDespues: () =>
    errores.datosInvalidos(
      'Mandá el campo «categoria» antes que el archivo (en ese orden, en el mismo formulario).',
      [{ campo: 'categoria', mensaje: 'Tiene que ir antes del archivo.' }],
    ),
  camposDeMas: () => errores.datosInvalidos('Mandá solo los campos «categoria» y «archivo».'),
  formato: () =>
    errores.datosInvalidos(
      'No pudimos leer el archivo. Mandalo como formulario (multipart/form-data) con los campos «categoria» y «archivo».',
    ),
  noEncontrado: () =>
    errores.noEncontrado(
      'No encontramos ese archivo. Puede que se haya dado de baja: volvé a la lista.',
    ),
  enlaceInvalido: () =>
    errores.sinPermiso(
      'El enlace del archivo venció o no es válido. Volvé a abrir el archivo desde la aplicación.',
    ),
  almacenNoConfigurado: () =>
    errores.servicioNoDisponible(
      'El almacenamiento de archivos no está disponible en este momento. Probá de nuevo más tarde; si sigue pasando, avisá a soporte.',
    ),
  otroAlmacen: () =>
    errores.servicioNoDisponible(
      'Ese archivo está guardado en un almacenamiento que este servidor no usa. Avisá a soporte.',
    ),
};
