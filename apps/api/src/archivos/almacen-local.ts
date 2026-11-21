/**
 * Almacén local (desarrollo y pruebas): `<directorio>/<bucket>/<clinica_id>/<uuid>`, archivos con
 * permisos 0600. La URL firmada es de la propia API: `/api/v1/archivos/descarga?t=<token>` (relativa
 * a la API; la web le antepone la dirección de la API), con el token HMAC de `firma.ts`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PREFIJO_API } from '../app.js';
import {
  bucketValido,
  rutaValida,
  type AlmacenArchivos,
  type ArchivoParaUrl,
  type Ubicacion,
} from './almacen.js';
import { firmarToken } from './firma.js';

export const RUTA_DESCARGA = `/${PREFIJO_API}/archivos/descarga`;

export class AlmacenLocal implements AlmacenArchivos {
  readonly nombre = 'local' as const;
  private readonly raiz: string;

  constructor(
    directorio: string,
    readonly bucket: string,
    private readonly secretoFirma: string,
  ) {
    this.raiz = path.resolve(directorio);
  }

  /** Camino en disco, siempre dentro de la raíz (si no, lanza). */
  camino({ bucket, ruta }: Ubicacion): string {
    if (!bucketValido(bucket) || !rutaValida(ruta)) {
      throw new Error('Ubicación de archivo inválida.');
    }
    const camino = path.resolve(this.raiz, bucket, ...ruta.split('/'));
    if (!camino.startsWith(this.raiz + path.sep)) throw new Error('Ubicación de archivo inválida.');
    return camino;
  }

  async guardar(ubicacion: Ubicacion, contenido: Buffer): Promise<void> {
    const camino = this.camino(ubicacion);
    await mkdir(path.dirname(camino), { recursive: true, mode: 0o700 });
    await writeFile(camino, contenido, { flag: 'wx', mode: 0o600 });
  }

  async leer(ubicacion: Ubicacion): Promise<Buffer | null> {
    try {
      return await readFile(this.camino(ubicacion));
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return null;
      throw error;
    }
  }

  async borrar(ubicacion: Ubicacion): Promise<void> {
    await rm(this.camino(ubicacion), { force: true });
  }

  urlFirmada(archivo: ArchivoParaUrl, venceEn: Date): Promise<string> {
    const token = firmarToken(this.secretoFirma, {
      archivoId: archivo.id,
      clinicaId: archivo.clinicaId,
      usuarioId: archivo.usuarioId,
      venceEn: Math.floor(venceEn.getTime() / 1000),
    });
    return Promise.resolve(`${RUTA_DESCARGA}?t=${token}`);
  }
}
