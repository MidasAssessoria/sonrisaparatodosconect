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
 *     - Lo que queda: si el COMMIT falla después de subir, el objeto se borra (compensación) solo
 *       si es seguro que la base no lo registró; ante un COMMIT ambiguo (se cortó la conexión) se
 *       comprueba en otra transacción y, si no se puede saber, el objeto queda: un objeto sin fila
 *       es inalcanzable (no hay URL sin fila) y solo ocupa lugar, mientras que borrar el PNG de una
 *       versión que sí quedó guardada sería perder la firma. Lo mismo si el proceso muere entre la
 *       subida y el COMMIT. Costo: el bloqueo del paciente (`FOR NO KEY UPDATE` de
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
    const preguntas = await this.bd.enContexto(ctx, (tx) =>
      catalogoPreguntas(tx, { incluirInactivas }),
    );
    return catalogoPreguntasSchema.parse({ preguntas });
  }

  async reemplazarPreguntas(
    ctx: ContextoPedido,
    preguntas: Pregunta[],
  ): Promise<z.infer<typeof catalogoPreguntasSchema>> {
    try {
      const catalogo = await this.bd.enContexto(ctx, (tx) => reemplazarPreguntas(tx, preguntas));
      return catalogoPreguntasSchema.parse({ preguntas: catalogo });
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
      if (intentoSubir) await this.compensar(ctx, archivoId, ubicacion, terminado);
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

  /** La versión con la URL firmada de la firma, y `ver` (anamnesis y archivo) en la auditoría. */
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
      })
      .from(archivo)
      .where(and(eq(archivo.clinicaId, ctx.clinicaId), eq(archivo.id, guardada.firmaArchivoId)));
    // La base exige que la firma exista (FK) y sea de este paciente: si falta, es un error nuestro.
    if (!fila || fila.almacen !== this.almacen.nombre) {
      this.registro.error('anamnesis_firma_inaccesible', {
        anamnesis: guardada.id,
        archivo: guardada.firmaArchivoId,
        motivo: fila ? 'otro_almacen' : 'sin_fila',
      });
      throw errores.interno();
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
    await registrarEvento(tx, { accion: 'ver', entidad: 'anamnesis', entidadId: guardada.id });
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
   * Después de una transacción fallida que llegó a subir la firma. Si el error saltó antes del
   * COMMIT (`terminado` = false) la base no registró nada y el objeto se borra. Si saltó en el
   * COMMIT, puede que la base sí lo haya guardado: se borra solo si otra transacción confirma que
   * el archivo no existe; si no se puede saber, queda (ver la cabecera).
   */
  private async compensar(
    ctx: ContextoPedido,
    archivoId: string,
    ubicacion: Ubicacion,
    terminado: boolean,
  ): Promise<void> {
    let borrar = !terminado;
    if (terminado) {
      try {
        const filas = await this.bd.enContexto(ctx, (tx) =>
          tx
            .select({ id: archivo.id })
            .from(archivo)
            .where(and(eq(archivo.clinicaId, ctx.clinicaId), eq(archivo.id, archivoId))),
        );
        borrar = filas.length === 0;
      } catch {
        this.registro.advertencia('firma_compensacion_omitida', { archivo: archivoId });
        return;
      }
    }
    if (!borrar) return;
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
