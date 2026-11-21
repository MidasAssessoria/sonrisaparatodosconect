/**
 * Archivos privados: subida, URL firmada y descarga del almacén local.
 *
 * El permiso por categoría se exige SIEMPRE antes de entregar algo (ver contexto/acceso-archivo.ts):
 *   - subir: al llegar el campo `categoria`, `<modulo>:crear`; recién después se lee el archivo.
 *   - URL: se lee la fila en una transacción de SOLO LECTURA (RLS: solo la clínica del pedido; dada
 *     de baja = no existe → 404), se exige `<modulo>:ver` y la sede del archivo, y recién después,
 *     en otra transacción con el contexto completo, se firma y se audita.
 *   - descarga (almacén local): además del token firmado, se vuelve a comprobar en la base que quien
 *     pidió la URL siga siendo miembro activo, que su rol siga teniendo `<modulo>:ver` y la sede, y
 *     la descarga queda en auditoría (`ver` con `medio: descarga`).
 *
 * La subida de una imagen encola `archivo.verificar` con `app.encolar` en la misma transacción:
 * la base pone la clínica del contexto en el trabajo.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { archivo, encolar, registrarEvento, type TransaccionConecta } from '@conecta/db';
import {
  CATEGORIAS_ARCHIVO,
  subirArchivoCamposSchema,
  type Archivo,
  type CategoriaArchivo,
  type Modulo,
  type UrlArchivo,
} from '@conecta/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { ServicioBd } from '../base/servicio-bd.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import { idPedidoDe } from '../comun/pedido.js';
import { CONFIG, type Config } from '../config.js';
import type { AccesoPorCategoria } from '../contexto/acceso-archivo.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { mensajeSinPermiso } from '../contexto/mensajes.js';
import { errores } from '../errores/error-api.js';
import { erroresArchivo } from '../errores/restricciones/archivos.js';
import { validar } from '../errores/validacion.js';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from './almacen.js';
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

/**
 * Lo que puede hoy el usuario del contexto (su membresía activa en la clínica del contexto) sobre un
 * archivo: el permiso `<modulo>:ver` de su rol (activo) y la sede del archivo (vigente, y su rol ve
 * todas las sedes o la tiene asignada). Mismo criterio que el resolvedor de contexto.
 */
async function accesoActual(
  tx: TransaccionConecta,
  modulo: Modulo,
  sedeId: string | null,
): Promise<{ permiso: boolean; sede: boolean }> {
  const { rows } = await tx.execute<{ permiso: boolean; sede: boolean }>(sql`
    select
      (r.activo and exists (
        select 1 from app.rol_permiso p
        where p.clinica_id = m.clinica_id and p.rol_id = r.id and p.activo
          and p.modulo = ${modulo} and p.accion = 'ver')) as permiso,
      (${sedeId}::uuid is null or (
        exists (select 1 from app.sede s
                where s.clinica_id = m.clinica_id and s.id = ${sedeId}::uuid
                  and s.deleted_at is null)
        and (r.todas_las_sedes or m.sede_defecto_id = ${sedeId}::uuid or exists (
          select 1 from app.usuario_sede us
          where us.clinica_id = m.clinica_id and us.membresia_id = m.id
            and us.sede_id = ${sedeId}::uuid and us.activo)))) as sede
    from app.membresia m
    join app.rol r on r.clinica_id = m.clinica_id and r.id = m.rol_id
    where m.clinica_id = app.clinica_actual() and m.usuario_id = app.usuario_actual()
      and m.estado = 'activo'`);
  return rows[0] ?? { permiso: false, sede: false };
}

@Injectable()
export class ArchivosService {
  constructor(
    private readonly bd: ServicioBd,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
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
    const tipos: readonly string[] = CATEGORIAS_ARCHIVO[categoria].tipos;

    let analisis;
    try {
      analisis = analizarContenido(subida.contenido);
    } catch (error) {
      if (!(error instanceof ContenidoInvalido)) throw error;
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
        // Trabajo de verificación en la misma transacción (`app.encolar`, con la clínica del
        // contexto): si algo falla, no queda.
        if (esImagen) await encolar(tx, 'archivo.verificar', { archivoId: id });
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
    // 1. Antes del permiso: solo leer (transacción de solo lectura), para conocer la categoría.
    const lectura = acceso.contextoLectura;
    const fila = await this.bd.enLectura(lectura, async (tx) => {
      const [encontrada] = await tx
        .select(columnas)
        .from(archivo)
        .where(
          and(
            eq(archivo.id, id),
            eq(archivo.clinicaId, lectura.clinicaId),
            isNull(archivo.deletedAt),
          ),
        );
      return encontrada;
    });
    if (!fila) throw erroresArchivo.noEncontrado();

    // 2. El permiso del módulo de la categoría y la sede.
    const ctx = acceso.exigir(fila.categoria, 'ver', fila.sedeId);
    if (fila.almacen !== this.almacen.nombre) throw erroresArchivo.otroAlmacen();

    // 3. Con el contexto completo: firmar y auditar.
    return this.bd.enContexto(ctx, async (tx) => {
      // Segundos enteros: el vencimiento que se informa es el mismo que se firma.
      const venceEn = new Date((Math.floor(Date.now() / 1000) + VIGENCIA_URL_SEGUNDOS) * 1000);
      const url = await this.almacen.urlFirmada(
        {
          id: fila.id,
          clinicaId: fila.clinicaId,
          bucket: fila.bucket,
          ruta: fila.ruta,
          nombreOriginal: fila.nombreOriginal,
          usuarioId: ctx.usuarioId,
        },
        venceEn,
      );
      // La base toma el módulo (y la sede) de la fila; si el archivo se dio de baja entre la
      // lectura y acá, igual existe y queda registrado quién pidió la URL.
      await registrarEvento(tx, { accion: 'ver', entidad: 'archivo', entidadId: fila.id });
      return { url, venceEn: venceEn.toISOString() };
    });
  }

  /**
   * `GET /archivos/descarga?t=…` (solo almacén local). La autorización viaja en el token firmado,
   * pero no alcanza: en la misma transacción se vuelve a comprobar que quien pidió la URL siga
   * siendo miembro activo (`enContexto`), que su rol siga teniendo `<modulo>:ver` y la sede del
   * archivo, y que el archivo siga vigente en su clínica. La descarga queda en auditoría; si algo
   * falla después (p. ej. el archivo falta en el almacén), el registro se revierte con ella.
   */
  async descargar(token: unknown, ip: string | null): Promise<Descarga> {
    if (this.almacen.nombre !== 'local') {
      throw erroresArchivo.noEncontrado();
    }
    const datos = verificarToken(this.config.archivos.secretoFirma, token);
    if (!datos) throw erroresArchivo.enlaceInvalido();
    return this.bd.enContexto(
      { clinicaId: datos.clinicaId, usuarioId: datos.usuarioId, ip },
      async (tx) => {
        const [fila] = await tx
          .select(columnas)
          .from(archivo)
          .where(
            and(
              eq(archivo.id, datos.archivoId),
              eq(archivo.clinicaId, datos.clinicaId),
              isNull(archivo.deletedAt),
            ),
          );
        if (!fila || fila.almacen !== 'local') throw erroresArchivo.noEncontrado();
        const modulo = CATEGORIAS_ARCHIVO[fila.categoria].modulo;
        const acceso = await accesoActual(tx, modulo, fila.sedeId);
        if (!acceso.permiso) throw errores.sinPermiso(mensajeSinPermiso(modulo, 'ver'));
        if (!acceso.sede) throw errores.sedeNoPermitida();
        const contenido = await this.almacen.leer({ bucket: fila.bucket, ruta: fila.ruta });
        if (!contenido) throw erroresArchivo.noEncontrado();
        await registrarEvento(tx, {
          accion: 'ver',
          entidad: 'archivo',
          entidadId: fila.id,
          detalle: { medio: 'descarga' },
        });
        return { contenido, tipo: fila.tipo, nombre: fila.nombreOriginal };
      },
    );
  }
}
