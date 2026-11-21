/**
 * Lectura del `multipart/form-data` de `POST /archivos` directamente del flujo del pedido (busboy),
 * sin pasar por el parser de cuerpos de Express:
 *
 *   - Campos: `categoria` y después `archivo` (la categoría define el permiso y el tamaño máximo,
 *     así que tiene que llegar antes; la web la agrega primero al FormData). Nada más.
 *   - Al llegar `categoria`, `alCategoria` comprueba el permiso y devuelve el máximo en bytes: sin
 *     permiso, el pedido termina ahí y el archivo no se lee.
 *   - El archivo se junta en memoria contando bytes: al pasar el máximo se deja de leer (se
 *     desconecta el flujo del parser y lo que queda se descarta sin guardar), se responde 413 con
 *     `Connection: close` y nada se escribe en el almacén.
 *   - Un segundo archivo, campos de más, sin archivo o un formulario roto → `datos_invalidos`.
 */
import busboy from 'busboy';
import type { Request } from 'express';
import { ErrorApi } from '../errores/error-api.js';
import { erroresArchivo } from '../errores/restricciones/archivos.js';

export interface SubidaLeida {
  /** Valor crudo del campo `categoria` (ya aceptado por `alCategoria`). */
  categoria: string;
  /** Nombre que mandó el navegador (sin sanear). */
  nombre: string | undefined;
  contenido: Buffer;
}

const LIMITES_FORMULARIO = {
  fields: 2,
  fieldSize: 256,
  fieldNameSize: 32,
  files: 1,
  parts: 3,
  headerPairs: 20,
};

/**
 * Lee la subida. `alCategoria(valor)` valida la categoría y el permiso (lanza `ErrorApi`) y
 * devuelve el tamaño máximo del archivo; `maximoGlobal` es el tope del parser (el máximo de todas las
 * categorías).
 */
export function leerSubida(
  req: Request,
  maximoGlobal: number,
  alCategoria: (valor: string) => number,
): Promise<SubidaLeida> {
  return new Promise<SubidaLeida>((resolver, rechazar) => {
    if (!/^multipart\/form-data\s*;/i.test(req.headers['content-type'] ?? '')) {
      rechazar(erroresArchivo.formato());
      return;
    }

    let analizador: busboy.Busboy;
    try {
      analizador = busboy({
        headers: req.headers,
        limits: { ...LIMITES_FORMULARIO, fileSize: maximoGlobal + 1 },
        defParamCharset: 'utf8',
      });
    } catch {
      rechazar(erroresArchivo.formato());
      return;
    }

    let terminado = false;
    let categoria: string | undefined;
    let limite = maximoGlobal;
    let archivo: { nombre: string | undefined; partes: Buffer[]; bytes: number } | undefined;
    let archivoCompleto = false;

    /** Termina con error: deja de leer y descarta el resto del pedido sin guardarlo. */
    const fallar = (error: unknown): void => {
      if (terminado) return;
      terminado = true;
      archivo = undefined;
      req.unpipe(analizador);
      analizador.removeAllListeners();
      analizador.on('error', () => undefined);
      req.resume();
      rechazar(error instanceof ErrorApi ? error : erroresArchivo.formato());
    };

    analizador.on('field', (nombre, valor, info) => {
      if (terminado) return;
      if (nombre !== 'categoria') return fallar(erroresArchivo.camposDeMas());
      if (categoria !== undefined) return fallar(erroresArchivo.camposDeMas());
      if (archivo !== undefined) return fallar(erroresArchivo.categoriaDespues());
      if (info.valueTruncated || info.nameTruncated) return fallar(erroresArchivo.formato());
      categoria = valor;
      try {
        limite = Math.min(alCategoria(valor), maximoGlobal);
      } catch (error) {
        fallar(error);
      }
    });

    analizador.on('file', (nombre, flujo, info) => {
      if (terminado) {
        flujo.resume();
        return;
      }
      if (nombre !== 'archivo') {
        flujo.resume();
        return fallar(erroresArchivo.camposDeMas());
      }
      if (categoria === undefined) {
        flujo.resume();
        return fallar(erroresArchivo.categoriaDespues());
      }
      const actual = { nombre: info.filename, partes: [] as Buffer[], bytes: 0 };
      archivo = actual;
      flujo.on('data', (trozo: Buffer) => {
        if (terminado) return;
        actual.bytes += trozo.length;
        if (actual.bytes > limite) {
          flujo.resume();
          fallar(erroresArchivo.demasiadoGrande(limite));
          return;
        }
        actual.partes.push(trozo);
      });
      flujo.on('limit', () => fallar(erroresArchivo.demasiadoGrande(limite)));
      flujo.on('end', () => {
        archivoCompleto = true;
      });
    });

    analizador.on('filesLimit', () => fallar(erroresArchivo.dosArchivos()));
    analizador.on('fieldsLimit', () => fallar(erroresArchivo.camposDeMas()));
    analizador.on('partsLimit', () => fallar(erroresArchivo.camposDeMas()));
    analizador.on('error', () => fallar(erroresArchivo.formato()));

    analizador.on('close', () => {
      if (terminado) return;
      if (categoria === undefined) return fallar(erroresArchivo.sinCategoria());
      if (archivo === undefined || !archivoCompleto) return fallar(erroresArchivo.sinArchivo());
      if (archivo.bytes === 0) return fallar(erroresArchivo.vacio());
      terminado = true;
      resolver({
        categoria,
        nombre: archivo.nombre,
        contenido: Buffer.concat(archivo.partes, archivo.bytes),
      });
    });

    req.on('aborted', () => fallar(erroresArchivo.formato()));
    req.pipe(analizador);
  });
}
