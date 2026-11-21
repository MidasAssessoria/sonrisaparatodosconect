/**
 * Archivos privados: subida, URL firmada y descarga del almacén local.
 *
 * El permiso por categoría se exige SIEMPRE antes de entregar algo (ver contexto/acceso-archivo.ts):
 *   - subir: al llegar el campo `categoria`, `<modulo>:crear`; recién después se lee el archivo.
 *   - URL: se lee la fila (RLS: solo la clínica del pedido; dada de baja = no existe → 404) y se
 *     exige `<modulo>:ver` y la sede del archivo antes de firmar y auditar.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { archivo, registrarEvento } from '@conecta/db';
import {
  CATEGORIAS_ARCHIVO,
  subirArchivoCamposSchema,
  type Archivo,
  type CategoriaArchivo,
  type UrlArchivo,
} from '@conecta/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { ServicioBd } from '../base/servicio-bd.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import { idPedidoDe } from '../comun/pedido.js';
import { CONFIG, type Config } from '../config.js';
import type { AccesoPorCategoria } from '../contexto/acceso-archivo.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { erroresArchivo } from '../errores/restricciones/archivos.js';
import { validar } from '../errores/validacion.js';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from './almacen.js';
import { ColaArchivos } from './cola-archivos.js';
import { analizarContenido, ContenidoInvalido, sanearNombre } from './contenido.js';
import { VIGENCIA_URL_SEGUNDOS, verificarToken } from './firma.js';
import { leerSubida } from './multipart.js';

/** El máximo de todas las categorías: tope del parser antes de conocer la categoría. */
const MAXIMO_GLOBAL = Math.max(...Object.values(CATEGORIAS_ARCHIVO).map((c) => c.maxBytes));

const columnas = {
  id: archivo.id,
  clinicaId: archivo.clinicaId,
  categoria: archivo.categoria,
  sedeId: archivo.sedeId,
  almacen: archivo.almacen,
  bucket: archivo.bucket,
  ruta: archivo.ruta,
  nombreOriginal: archivo.nombreOriginal,
  tipo: archivo.tipo,
};

export interface Descarga {
  contenido: Buffer;
  tipo: string;
  nombre: string;
}

@Injectable()
export class ArchivosService {
  constructor(
    private readonly bd: ServicioBd,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    private readonly cola: ColaArchivos,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REGISTRO) private readonly registro: Registro,
  ) {}

  async subir(acceso: AccesoPorCategoria, req: Request): Promise<Archivo> {
    let ctx: ContextoPedido | undefined;
    let pedida: CategoriaArchivo | undefined;
    const subida = await leerSubida(req, MAXIMO_GLOBAL, (valor) => {
      pedida = validar(subirArchivoCamposSchema, { categoria: valor }).categoria;
      ctx = acceso.exigir(pedida, 'crear');
      return CATEGORIAS_ARCHIVO[pedida].maxBytes;
    });
    if (!ctx || !pedida) throw erroresArchivo.sinCategoria();
    const contexto = ctx;
    const categoria = pedida;
    const reglas = CATEGORIAS_ARCHIVO[categoria];
    const tipos: readonly string[] = reglas.tipos;

    let analisis;
    try {
      analisis = analizarContenido(subida.contenido, tipos.includes('image/svg+xml'));
    } catch (error) {
      if (!(error instanceof ContenidoInvalido)) throw error;
      if (error.motivo === 'svg_inseguro') throw erroresArchivo.svgInseguro();
      if (error.motivo === 'danado') throw erroresArchivo.danado();
      throw erroresArchivo.tipoNoPermitido(categoria);
    }
    if (!tipos.includes(analisis.tipo)) throw erroresArchivo.tipoNoPermitido(categoria);

    const id = randomUUID();
    const ubicacion = { bucket: this.almacen.bucket, ruta: `${contexto.clinicaId}/${id}` };
    const sha256 = createHash('sha256').update(subida.contenido).digest('hex');
    const nombreOriginal = sanearNombre(subida.nombre);
    const esImagen = analisis.tipo.startsWith('image/');

    await this.almacen.guardar(ubicacion, subida.contenido, analisis.tipo);
    try {
      const fila = await this.bd.enContexto(contexto, async (tx) => {
        const [creada] = await tx
          .insert(archivo)
          .values({
            id,
            clinicaId: contexto.clinicaId,
            categoria,
            almacen: this.almacen.nombre,
            bucket: ubicacion.bucket,
            ruta: ubicacion.ruta,
            nombreOriginal,
            tipo: analisis.tipo,
            bytes: subida.contenido.length,
            ancho: analisis.ancho,
            alto: analisis.alto,
            sha256,
          })
          .returning({ id: archivo.id, createdAt: archivo.createdAt });
        if (!creada) throw new Error('El alta del archivo no devolvió la fila.');
        // Trabajo de verificación en la misma transacción: si algo falla, no queda.
        if (esImagen) {
          await this.cola.encolarVerificacion(tx, { clinicaId: contexto.clinicaId, archivoId: id });
        }
        return creada;
      });
      return {
        id: fila.id,
        categoria,
        nombreOriginal,
        tipo: analisis.tipo,
        bytes: subida.contenido.length,
        ancho: analisis.ancho,
        alto: analisis.alto,
        sha256,
        subidoEn: fila.createdAt.toISOString(),
      };
    } catch (error) {
      // Compensación: la base no registró el archivo, así que el archivo escrito no puede quedar.
      await this.almacen.borrar(ubicacion).catch((errorBorrado: unknown) => {
        this.registro.error('archivo_compensacion_fallida', {
          pedido: idPedidoDe(req),
          archivo: id,
          tipo: errorBorrado instanceof Error ? errorBorrado.name : typeof errorBorrado,
        });
      });
      throw error;
    }
  }

  async url(acceso: AccesoPorCategoria, id: string): Promise<UrlArchivo> {
    const ctxBd = acceso.contextoBd;
    return this.bd.enContexto(ctxBd, async (tx) => {
      const [fila] = await tx
        .select(columnas)
        .from(archivo)
        .where(
          and(
            eq(archivo.id, id),
            eq(archivo.clinicaId, ctxBd.clinicaId),
            isNull(archivo.deletedAt),
          ),
        );
      if (!fila) throw erroresArchivo.noEncontrado();
      acceso.exigir(fila.categoria, 'ver', fila.sedeId);
      if (fila.almacen !== this.almacen.nombre) throw erroresArchivo.otroAlmacen();

      // Segundos enteros: el vencimiento que se informa es el mismo que se firma.
      const venceEn = new Date((Math.floor(Date.now() / 1000) + VIGENCIA_URL_SEGUNDOS) * 1000);
      const url = await this.almacen.urlFirmada(
        {
          id: fila.id,
          clinicaId: fila.clinicaId,
          bucket: fila.bucket,
          ruta: fila.ruta,
          nombreOriginal: fila.nombreOriginal,
          usuarioId: ctxBd.usuarioId,
        },
        venceEn,
      );
      // La base toma el módulo (y la sede) de la fila.
      await registrarEvento(tx, { accion: 'ver', entidad: 'archivo', entidadId: fila.id });
      return { url, venceEn: venceEn.toISOString() };
    });
  }

  /**
   * `GET /archivos/descarga?t=…` (solo almacén local). La autorización viaja en el token firmado;
   * además se vuelve a comprobar la membresía activa de quien pidió la URL y que el archivo siga
   * vigente en su clínica.
   */
  async descargar(token: unknown, ip: string | null): Promise<Descarga> {
    if (this.almacen.nombre !== 'local') {
      throw erroresArchivo.noEncontrado();
    }
    const datos = verificarToken(this.config.archivos.secretoFirma, token);
    if (!datos) throw erroresArchivo.enlaceInvalido();
    const fila = await this.bd.enContexto(
      { clinicaId: datos.clinicaId, usuarioId: datos.usuarioId, ip },
      async (tx) => {
        const [encontrada] = await tx
          .select(columnas)
          .from(archivo)
          .where(
            and(
              eq(archivo.id, datos.archivoId),
              eq(archivo.clinicaId, datos.clinicaId),
              isNull(archivo.deletedAt),
            ),
          );
        return encontrada;
      },
    );
    if (!fila || fila.almacen !== 'local') throw erroresArchivo.noEncontrado();
    const contenido = await this.almacen.leer({ bucket: fila.bucket, ruta: fila.ruta });
    if (!contenido) throw erroresArchivo.noEncontrado();
    return { contenido, tipo: fila.tipo, nombre: fila.nombreOriginal };
  }
}
