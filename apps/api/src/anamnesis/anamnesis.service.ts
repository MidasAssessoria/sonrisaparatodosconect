/**
 * Anamnesis versionada, catálogo de preguntas e historial del paciente (Sprint 4,
 * contrato/anamnesis.ts). Todo corre en `enContexto` (RLS por clínica) sobre las funciones de
 * `@conecta/db`; la base valida las respuestas contra el catálogo, el tutor, la firma y la versión
 * base, y la API traduce sus errores por nombre de regla y campo (`errorDeAnamnesis`).
 *
 * Guardar una versión (`POST /pacientes/:id/anamnesis`):
 *   1. Antes de abrir la transacción: además de `ficha_clinica:crear` (la ruta) exige
 *      `ficha_clinica:ver` (la base también lo exige, y la respuesta es la versión completa), y
 *      decodifica la firma verificando que sea un PNG real (`firma-png.ts`).
 *   2. En UNA transacción: registra el `archivo` `firma_paciente` del paciente (SHA-256, bytes,
 *      ancho, alto), encola su verificación, guarda la versión (`guardarAnamnesis`), la lee completa,
 *      firma la URL de la firma, deja `ver` en la auditoría y, como ÚLTIMO paso antes del COMMIT,
 *      sube el PNG al almacén.
 *
 *   Orden subida / commit (decisión): la subida va DENTRO de la transacción, después de que la base
 *   aceptó la versión y antes del COMMIT.
 *     - Nunca después del COMMIT: quedaría una anamnesis firmada cuyo PNG no existe si la subida
 *       falla (un registro legal sin su evidencia). Con la subida antes, si falla, la transacción se
 *       revierte entera: ni archivo, ni versión, ni número de versión gastado.
 *     - No antes de abrir la transacción: los rechazos frecuentes (validación, 409 de versión,
 *       permisos, paciente de otra clínica) ocurren en la base, y así no tocan el almacén.
 *     - Compensación: el objeto se borra solo si el error saltó ANTES del COMMIT (la base seguro no
 *       registró nada). Si falla el COMMIT mismo, el objeto queda y se registra
 *       (`firma_commit_dudoso`, solo ids): la versión puede haber quedado guardada (o estar
 *       confirmándose), y borrar su PNG sería perder la firma; un objeto sin fila, en cambio, es
 *       inalcanzable (no hay URL sin fila) y solo ocupa lugar. Lo mismo si el proceso muere entre
 *       la subida y el COMMIT. Costo: el bloqueo del paciente (`FOR NO KEY UPDATE` de
 *       `guardar_anamnesis`) dura también lo que tarda la subida (un PNG de hasta 300 KB).
 *
 * Lectura: la versión completa (`GET …/anamnesis/:version` y la respuesta del POST) deja `ver`
 * sobre la anamnesis y sobre el archivo de la firma (cada URL entregada queda en auditoría, como en
 * `GET /archivos/:id/url`). La alerta médica de la ficha la sirve el módulo de pacientes.
 *
 * Registro: nada clínico. Ni respuestas, ni alertas, ni la firma, ni nombres: solo ids y tipos.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  archivo,
  catalogoPreguntas,
  encolar,
  guardarAnamnesis,
  historialPaciente,
  listarAnamnesis,
  obtenerAnamnesis,
  paciente,
  reemplazarPreguntas,
  registrarEvento,
  type AnamnesisGuardada,
  type TransaccionConecta,
} from '@conecta/db';
import {
  anamnesisSchema,
  catalogoPreguntasSchema,
  paginaHistorialSchema,
  versionesAnamnesisSchema,
  type Anamnesis,
  type CrearAnamnesis,
  type Pregunta,
  type consultaHistorialSchema,
} from '@conecta/shared';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos, type Ubicacion } from '../archivos/almacen.js';
import { VIGENCIA_URL_SEGUNDOS } from '../archivos/firma.js';
import { ServicioBd } from '../base/servicio-bd.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import { tienePermiso, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { ErrorApi, errores } from '../errores/error-api.js';
import { errorDeAnamnesis, pacienteNoEncontrado } from '../errores/restricciones/anamnesis.js';
import { decodificarFirma, FirmaInvalida, type FirmaDecodificada } from './firma-png.js';

export type ConsultaHistorial = z.output<typeof consultaHistorialSchema>;
export type VersionPedida = number | 'vigente';

const versionNoEncontrada = () =>
  errores.noEncontrado(
    'No encontramos esa versión de la anamnesis. Volvé a la lista de versiones del paciente.',
  );

const NOMBRE_FIRMA = 'firma.png';

/** `firmaUrl` cuando la imagen de la firma no se puede entregar (ver `vista`). */
export const FIRMA_NO_DISPONIBLE = null;

function errorDeFirma(error: FirmaInvalida): ErrorApi {
  switch (error.motivo) {
    case 'vacia':
      return errores.datosInvalidos(
        'Falta la firma. Pedile a quien firma que lo haga en la pantalla.',
        [{ campo: 'firmaPng', mensaje: 'Falta la firma.' }],
      );
    case 'grande':
      return errores.datosInvalidos(
        'La firma es demasiado grande (hasta 300 KB). Borrala y firmá de nuevo.',
        [{ campo: 'firmaPng', mensaje: 'Hasta 300 KB.' }],
      );
    case 'no_png':
      return errores.datosInvalidos(
        'La firma no es una imagen PNG válida. Borrala y firmá de nuevo en la pantalla.',
        [{ campo: 'firmaPng', mensaje: 'Tiene que ser el trazo de la firma en PNG.' }],
      );
  }
}

/** Traduce un error de la base de estas rutas; si no es uno de los suyos, sigue igual. */
function traducido(error: unknown): unknown {
  if (error instanceof ErrorApi) return error;
  return errorDeAnamnesis(error) ?? error;
}

@Injectable()
export class AnamnesisService {
  constructor(
    private readonly bd: ServicioBd,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(REGISTRO) private readonly registro: Registro,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Catálogo
  // -------------------------------------------------------------------------------------------

  /** `incluirInactivas`: el editor (`configuracion:editar`); si no, el formulario. */
  async preguntas(
    ctx: ContextoPedido,
    incluirInactivas: boolean,
  ): Promise<z.infer<typeof catalogoPreguntasSchema>> {
    const catalogo = await this.bd.enContexto(ctx, (tx) =>
      catalogoPreguntas(tx, { incluirInactivas }),
    );
    return catalogoPreguntasSchema.parse(catalogo);
  }

  async reemplazarPreguntas(
    ctx: ContextoPedido,
    preguntas: Pregunta[],
  ): Promise<z.infer<typeof catalogoPreguntasSchema>> {
    try {
      const catalogo = await this.bd.enContexto(ctx, (tx) => reemplazarPreguntas(tx, preguntas));
      return catalogoPreguntasSchema.parse(catalogo);
    } catch (error) {
      throw traducido(error);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Versiones
  // -------------------------------------------------------------------------------------------

  async versiones(
    ctx: ContextoPedido,
    pacienteId: string,
  ): Promise<z.infer<typeof versionesAnamnesisSchema>> {
    const datos = await this.bd.enContexto(ctx, async (tx) => {
      await this.exigirPaciente(tx, ctx, pacienteId);
      return listarAnamnesis(tx, pacienteId);
    });
    return versionesAnamnesisSchema.parse(datos);
  }

  /** Una versión completa, con la URL firmada de la firma; queda `ver` en la auditoría. */
  obtener(ctx: ContextoPedido, pacienteId: string, version: VersionPedida): Promise<Anamnesis> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.exigirPaciente(tx, ctx, pacienteId);
      const guardada = await obtenerAnamnesis(tx, pacienteId, version);
      if (!guardada) throw versionNoEncontrada();
      return this.vista(tx, ctx, guardada);
    });
  }

  /** Guarda la versión siguiente (ver el orden de la subida arriba). */
  async crear(ctx: ContextoPedido, pacienteId: string, datos: CrearAnamnesis): Promise<Anamnesis> {
    if (!tienePermiso(ctx, 'ficha_clinica', 'ver')) {
      throw errores.sinPermiso(
        'Para guardar la anamnesis tu rol tiene que poder ver y cargar la ficha clínica. Pedíselo a un odontólogo o pedile acceso a quien administra la clínica.',
      );
    }
    let firma: FirmaDecodificada;
    try {
      firma = decodificarFirma(datos.firmaPng);
    } catch (error) {
      if (error instanceof FirmaInvalida) throw errorDeFirma(error);
      throw error;
    }

    const archivoId = randomUUID();
    const ubicacion: Ubicacion = {
      bucket: this.almacen.bucket,
      ruta: `${ctx.clinicaId}/${archivoId}`,
    };
    const sha256 = createHash('sha256').update(firma.contenido).digest('hex');
    // El PNG no va a la base: va como archivo, y la base recibe su id.
    const resto: Omit<CrearAnamnesis, 'firmaPng'> = {
      versionBase: datos.versionBase,
      huellaCatalogo: datos.huellaCatalogo,
      respuestas: datos.respuestas,
      signosVitales: datos.signosVitales,
      firmante: datos.firmante,
      declaracionVeracidad: datos.declaracionVeracidad,
    };
    let intentoSubir = false;
    let terminado = false;

    try {
      const creada = await this.bd.enContexto(ctx, async (tx) => {
        await tx.insert(archivo).values({
          id: archivoId,
          clinicaId: ctx.clinicaId,
          categoria: 'firma_paciente',
          pacienteId,
          almacen: this.almacen.nombre,
          bucket: ubicacion.bucket,
          ruta: ubicacion.ruta,
          nombreOriginal: NOMBRE_FIRMA,
          tipo: 'image/png',
          bytes: firma.contenido.length,
          ancho: firma.ancho,
          alto: firma.alto,
          sha256,
        });
        await encolar(tx, 'archivo.verificar', { archivoId });
        const { version } = await guardarAnamnesis(tx, pacienteId, {
          ...resto,
          firmaArchivoId: archivoId,
        });
        const guardada = await obtenerAnamnesis(tx, pacienteId, version);
        // No pasa: la base la acaba de guardar en esta transacción y quien guarda la ve.
        if (!guardada) throw errores.interno();
        const vista = await this.vista(tx, ctx, guardada);
        // Último paso antes del COMMIT: si la subida falla, se revierte todo.
        intentoSubir = true;
        try {
          await this.almacen.guardar(ubicacion, firma.contenido, 'image/png');
        } catch (error) {
          this.registro.error('firma_subida_fallida', {
            archivo: archivoId,
            tipo: error instanceof Error ? error.name : typeof error,
          });
          throw errores.servicioNoDisponible(
            'No pudimos guardar la firma en este momento. No se guardó nada: probá de nuevo en un momento.',
          );
        }
        terminado = true;
        return vista;
      });
      return creada;
    } catch (error) {
      if (intentoSubir) await this.compensar(archivoId, ubicacion, terminado);
      throw traducido(error);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Historial
  // -------------------------------------------------------------------------------------------

  async historial(
    ctx: ContextoPedido,
    pacienteId: string,
    consulta: ConsultaHistorial,
  ): Promise<z.infer<typeof paginaHistorialSchema>> {
    try {
      const pagina = await this.bd.enContexto(ctx, async (tx) => {
        await this.exigirPaciente(tx, ctx, pacienteId);
        return historialPaciente(tx, pacienteId, {
          cursor: consulta.cursor ?? null,
          limite: consulta.limite,
        });
      });
      return paginaHistorialSchema.parse(pagina);
    } catch (error) {
      throw traducido(error);
    }
  }

  // -------------------------------------------------------------------------------------------

  /**
   * La versión con la URL firmada de la firma, y `ver` (anamnesis y archivo) en la auditoría.
   *
   * Si el archivo de la firma no se puede entregar (dado de baja por una corrección de datos, la
   * base ya no deja hacerlo por la API: `archivo_firma_en_uso`; o guardado en otro almacén), la
   * versión sale igual con `firmaUrl` = `null` (FIRMA_NO_DISPONIBLE): nunca una URL que da 404. El
   * contrato exige una cadena; la web muestra «la firma no carga» (ver el reporte del Sprint 4).
   */
  private async vista(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    guardada: AnamnesisGuardada,
  ): Promise<Anamnesis> {
    const [fila] = await tx
      .select({
        id: archivo.id,
        clinicaId: archivo.clinicaId,
        almacen: archivo.almacen,
        bucket: archivo.bucket,
        ruta: archivo.ruta,
        nombreOriginal: archivo.nombreOriginal,
        deletedAt: archivo.deletedAt,
      })
      .from(archivo)
      .where(and(eq(archivo.clinicaId, ctx.clinicaId), eq(archivo.id, guardada.firmaArchivoId)));
    await registrarEvento(tx, { accion: 'ver', entidad: 'anamnesis', entidadId: guardada.id });
    const motivo = !fila
      ? 'sin_fila'
      : fila.deletedAt
        ? 'dada_de_baja'
        : fila.almacen !== this.almacen.nombre
          ? 'otro_almacen'
          : null;
    if (!fila || motivo) {
      this.registro.advertencia('anamnesis_firma_no_disponible', {
        anamnesis: guardada.id,
        archivo: guardada.firmaArchivoId,
        motivo,
      });
      return anamnesisSchema.parse({ ...guardada, firmaUrl: FIRMA_NO_DISPONIBLE });
    }
    // Segundos enteros: el vencimiento firmado es el mismo que en `GET /archivos/:id/url`.
    const venceEn = new Date((Math.floor(Date.now() / 1000) + VIGENCIA_URL_SEGUNDOS) * 1000);
    const firmaUrl = await this.almacen.urlFirmada(
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
    await registrarEvento(tx, {
      accion: 'ver',
      entidad: 'archivo',
      entidadId: fila.id,
      detalle: { medio: 'anamnesis' },
    });
    // `anamnesisSchema` no tiene `firmaArchivoId`: el parse lo saca (solo sale la URL).
    return anamnesisSchema.parse({ ...guardada, firmaUrl });
  }

  /**
   * Después de una transacción fallida que llegó a subir la firma. Solo si el error saltó ANTES
   * del COMMIT (`terminado` = false) es seguro que la base no registró nada, y el objeto se borra.
   * Si saltó en el COMMIT, no se borra: puede que la versión sí haya quedado (o se esté
   * confirmando, y una consulta de control todavía no la vería). Queda en el registro, sin datos
   * clínicos, para revisarlo a mano.
   */
  private async compensar(
    archivoId: string,
    ubicacion: Ubicacion,
    terminado: boolean,
  ): Promise<void> {
    if (terminado) {
      this.registro.advertencia('firma_commit_dudoso', { archivo: archivoId });
      return;
    }
    await this.almacen.borrar(ubicacion).catch((error: unknown) => {
      this.registro.error('archivo_compensacion_fallida', {
        archivo: archivoId,
        tipo: error instanceof Error ? error.name : typeof error,
      });
    });
  }

  private async exigirPaciente(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
  ): Promise<void> {
    const [fila] = await tx
      .select({ id: paciente.id })
      .from(paciente)
      .where(and(eq(paciente.clinicaId, ctx.clinicaId), eq(paciente.id, id)));
    if (!fila) throw pacienteNoEncontrado();
  }
}
