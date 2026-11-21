/**
 * Almacenamiento privado de archivos. Nunca hay URL pública ni permanente: solo URLs firmadas que
 * vencen en 5 minutos como máximo. La implementación sale de `config.archivos.almacen`:
 *   - `local` (desarrollo y pruebas): disco, URL firmada propia (`almacen-local.ts`).
 *   - `supabase`: Supabase Storage con la clave secreta, bucket privado (`almacen-supabase.ts`).
 *
 * La ruta dentro del bucket es siempre `<clinica_id>/<uuid>`: nunca el nombre original.
 */
import type { AlmacenArchivo } from '@conecta/db';

export const ALMACEN_ARCHIVOS = Symbol('ALMACEN_ARCHIVOS');

/** Dónde está un archivo (columnas `bucket` y `ruta` de `app.archivo`). */
export interface Ubicacion {
  bucket: string;
  ruta: string;
}

/** Lo que hace falta para firmar la URL de un archivo. */
export interface ArchivoParaUrl extends Ubicacion {
  id: string;
  clinicaId: string;
  /** Nombre original (saneado al descargar). */
  nombreOriginal: string;
  /** Quien pide la URL (la descarga local vuelve a comprobar su membresía). */
  usuarioId: string;
}

export interface AlmacenArchivos {
  readonly nombre: AlmacenArchivo;
  /** Bucket donde se guardan los archivos nuevos. */
  readonly bucket: string;
  /** Guarda un archivo nuevo. Falla si ya existe algo en esa ruta. */
  guardar(ubicacion: Ubicacion, contenido: Buffer, tipo: string): Promise<void>;
  /** Contenido del archivo, o null si no existe. */
  leer(ubicacion: Ubicacion): Promise<Buffer | null>;
  /** Borra el archivo (compensación de una subida fallida). No falla si no existe. */
  borrar(ubicacion: Ubicacion): Promise<void>;
  /** URL firmada que vence en `venceEn` (como máximo 5 minutos desde ahora). */
  urlFirmada(archivo: ArchivoParaUrl, venceEn: Date): Promise<string>;
}

const PATRON_RUTA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[A-Za-z0-9._-]+)+$/;

/** Defensa en profundidad (la base ya lo exige): ruta `<clinica>/...` sin `.` ni `..`. */
export function rutaValida(ruta: string): boolean {
  return (
    ruta.length <= 512 &&
    PATRON_RUTA.test(ruta) &&
    !ruta.split('/').some((segmento) => segmento === '.' || segmento === '..')
  );
}

export function bucketValido(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket) && !bucket.includes('..');
}
