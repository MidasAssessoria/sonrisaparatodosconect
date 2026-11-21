/**
 * Lectura de archivos del almacén (el mismo que usa la API). El worker solo lee: nunca escribe,
 * borra ni firma URLs. La ubicación sale de la fila de app.archivo (leída con RLS), y se valida igual
 * que en la API antes de tocar el disco o Storage.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConfigWorker } from './config.js';

export interface Ubicacion {
  almacen: 'local' | 'supabase';
  bucket: string;
  ruta: string;
}

export interface LectorArchivos {
  /** Contenido del archivo, o null si no existe. Lanza si el almacén no responde. */
  leer(ubicacion: Ubicacion): Promise<Buffer | null>;
}

const PATRON_RUTA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[A-Za-z0-9._-]+)+$/;

function ubicacionValida({ bucket, ruta }: Ubicacion): boolean {
  return (
    /^[a-z0-9][a-z0-9._-]{0,62}$/.test(bucket) &&
    !bucket.includes('..') &&
    ruta.length <= 512 &&
    PATRON_RUTA.test(ruta) &&
    !ruta.split('/').some((s) => s === '.' || s === '..')
  );
}

export class ErrorDeUbicacion extends Error {
  override name = 'ErrorDeUbicacion';
}

export function crearLector(
  config: ConfigWorker,
  buscar: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): LectorArchivos {
  const raiz = path.resolve(config.archivos.directorio);
  return {
    async leer(ubicacion) {
      if (ubicacion.almacen !== config.archivos.almacen || !ubicacionValida(ubicacion)) {
        throw new ErrorDeUbicacion('Ubicación de archivo inválida para este worker.');
      }
      if (ubicacion.almacen === 'local') {
        const camino = path.resolve(raiz, ubicacion.bucket, ...ubicacion.ruta.split('/'));
        if (!camino.startsWith(raiz + path.sep)) throw new ErrorDeUbicacion('Fuera del almacén.');
        try {
          return await readFile(camino);
        } catch (error) {
          if ((error as { code?: unknown }).code === 'ENOENT') return null;
          throw error;
        }
      }
      const clave = config.supabaseSecretKey;
      if (!clave) throw new ErrorDeUbicacion('Falta SUPABASE_SECRET_KEY.');
      const camino = [ubicacion.bucket, ...ubicacion.ruta.split('/')]
        .map(encodeURIComponent)
        .join('/');
      const respuesta = await buscar(
        `${config.supabaseUrl}/storage/v1/object/authenticated/${camino}`,
        {
          method: 'GET',
          headers: { apikey: clave, Authorization: `Bearer ${clave}` },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (respuesta.status === 404 || respuesta.status === 400) {
        await respuesta.body?.cancel();
        return null;
      }
      if (!respuesta.ok) {
        await respuesta.body?.cancel();
        throw new Error(`Storage respondió ${String(respuesta.status)}.`);
      }
      return Buffer.from(await respuesta.arrayBuffer());
    },
  };
}
