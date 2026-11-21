/**
 * Supabase Storage (bucket privado) por su API REST, con la clave secreta del proyecto
 * (`SUPABASE_SECRET_KEY`, solo en el servidor). Sin clave, todo responde 503
 * `servicio_no_disponible`. La clave nunca va a registros ni respuestas: los errores se reducen al
 * estado HTTP.
 *
 *   subir     POST   /storage/v1/object/<bucket>/<ruta>          (x-upsert: false)
 *   leer      GET    /storage/v1/object/authenticated/<bucket>/<ruta>
 *   borrar    DELETE /storage/v1/object/<bucket>                 { prefixes: [ruta] }
 *   firmar    POST   /storage/v1/object/sign/<bucket>/<ruta>     { expiresIn } → { signedURL }
 *
 * La URL firmada lleva `download=<nombre>` para que Storage responda como adjunto.
 *
 * Verificado solo contra un falso (ver test/archivos-supabase.test.ts). Contra un Supabase real
 * queda por comprobar: que el bucket exista y sea privado, el formato de `signedURL`, que la clave
 * nueva (`sb_secret_…`) sirva en `apikey` + `Authorization`, el `download` y el vencimiento.
 */
import type { AlmacenArchivos, ArchivoParaUrl, Ubicacion } from './almacen.js';
import { bucketValido, rutaValida } from './almacen.js';
import { sanearNombre } from './contenido.js';
import { erroresArchivo } from '../errores/restricciones/archivos.js';

const TIEMPO_MAXIMO_MS = 15_000;

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export class AlmacenSupabase implements AlmacenArchivos {
  readonly nombre = 'supabase' as const;
  private readonly base: string;

  constructor(
    supabaseUrl: string,
    private readonly clave: string | undefined,
    readonly bucket: string,
    private readonly buscar: Buscar = (url, init) => fetch(url, init),
  ) {
    this.base = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1`;
  }

  private cabeceras(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.clave) throw erroresArchivo.almacenNoConfigurado();
    return { apikey: this.clave, Authorization: `Bearer ${this.clave}`, ...extra };
  }

  private camino({ bucket, ruta }: Ubicacion): string {
    if (!bucketValido(bucket) || !rutaValida(ruta))
      throw new Error('Ubicación de archivo inválida.');
    return `${encodeURIComponent(bucket)}/${ruta.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async pedir(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.buscar(url, { ...init, signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
    } catch {
      throw erroresArchivo.almacenNoConfigurado();
    }
  }

  async guardar(ubicacion: Ubicacion, contenido: Buffer, tipo: string): Promise<void> {
    const respuesta = await this.pedir(`${this.base}/object/${this.camino(ubicacion)}`, {
      method: 'POST',
      headers: this.cabeceras({
        'Content-Type': tipo,
        'x-upsert': 'false',
        'cache-control': 'no-store',
      }),
      body: new Uint8Array(contenido),
    });
    await respuesta.body?.cancel();
    if (!respuesta.ok) throw erroresArchivo.almacenNoConfigurado();
  }

  async leer(ubicacion: Ubicacion): Promise<Buffer | null> {
    const respuesta = await this.pedir(
      `${this.base}/object/authenticated/${this.camino(ubicacion)}`,
      { method: 'GET', headers: this.cabeceras() },
    );
    if (respuesta.status === 404 || respuesta.status === 400) {
      await respuesta.body?.cancel();
      return null;
    }
    if (!respuesta.ok) {
      await respuesta.body?.cancel();
      throw erroresArchivo.almacenNoConfigurado();
    }
    return Buffer.from(await respuesta.arrayBuffer());
  }

  async borrar(ubicacion: Ubicacion): Promise<void> {
    this.camino(ubicacion);
    const respuesta = await this.pedir(
      `${this.base}/object/${encodeURIComponent(ubicacion.bucket)}`,
      {
        method: 'DELETE',
        headers: this.cabeceras({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [ubicacion.ruta] }),
      },
    );
    await respuesta.body?.cancel();
    if (!respuesta.ok) throw erroresArchivo.almacenNoConfigurado();
  }

  async urlFirmada(archivo: ArchivoParaUrl, venceEn: Date): Promise<string> {
    const segundos = Math.max(1, Math.floor((venceEn.getTime() - Date.now()) / 1000));
    const respuesta = await this.pedir(`${this.base}/object/sign/${this.camino(archivo)}`, {
      method: 'POST',
      headers: this.cabeceras({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: segundos }),
    });
    if (!respuesta.ok) {
      await respuesta.body?.cancel();
      throw erroresArchivo.almacenNoConfigurado();
    }
    const cuerpo = (await respuesta.json().catch(() => null)) as { signedURL?: unknown } | null;
    const firmada = cuerpo?.signedURL;
    if (
      typeof firmada !== 'string' ||
      !firmada.startsWith('/object/sign/') ||
      !firmada.includes('token=')
    ) {
      throw erroresArchivo.almacenNoConfigurado();
    }
    return `${this.base}${firmada}&download=${encodeURIComponent(sanearNombre(archivo.nombreOriginal))}`;
  }
}
