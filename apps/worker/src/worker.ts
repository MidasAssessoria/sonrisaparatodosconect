/**
 * Worker de la cola (pg-boss sobre el schema `cola`, con el rol app_worker).
 *
 *   - pg-boss no migra (`migrate: false`): si la versión de esquema no es la de 0014, no arranca.
 *   - Mantenimiento de pg-boss activo (vencimientos, reintentos, limpieza) sin reindexar ni guardar
 *     estadísticas (eso pide DDL, y app_worker no es dueño de nada).
 *   - Lecturas de app con su propio pool y solo la clínica del trabajo en el contexto (RLS).
 *   - `detener()`: cierre ordenado. Deja de tomar trabajos, espera el que está en curso (hasta
 *     `cierreMs`) y cierra los pools. Se puede llamar varias veces.
 */
import { COLA_ARCHIVO_VERIFICAR, crearPool, SCHEMA_COLA } from '@conecta/db';
import { PgBoss, type ConstructorOptions } from 'pg-boss';
import { crearLector, type LectorArchivos } from './almacen.js';
import type { ConfigWorker } from './config.js';
import { datosDeError, type Registro } from './registro.js';
import { verificarArchivo } from './verificar-archivo.js';

export interface Worker {
  /** Se resuelve cuando el worker terminó de cerrar. */
  cerrado: Promise<void>;
  detener(motivo: string): Promise<void>;
}

export interface OpcionesWorker {
  /** Lector del almacén (las pruebas pasan uno propio). */
  lector?: LectorArchivos;
  /** Segundos entre consultas a la cola. Por defecto 2. */
  sondeoSegundos?: number;
  /** Ajustes extra de pg-boss (pruebas). */
  boss?: Partial<ConstructorOptions>;
}

export async function iniciarWorker(
  config: ConfigWorker,
  registro: Registro,
  opciones: OpcionesWorker = {},
): Promise<Worker> {
  const pool = crearPool(config.databaseUrl, {
    application_name: 'conecta-worker',
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    alErrorInactivo: (error) => registro.advertencia('pool_error_inactivo', datosDeError(error)),
  });
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: SCHEMA_COLA,
    application_name: 'conecta-worker-cola',
    max: config.poolMax,
    migrate: false,
    createSchema: false,
    schedule: false,
    supervise: true,
    reindex: false,
    persistQueueStats: false,
    persistWarnings: false,
    instanceName: 'worker',
    openTelemetry: { enabled: false },
    ...opciones.boss,
  });
  boss.on('error', (error) => registro.error('cola_error', datosDeError(error)));
  boss.on('warning', () => registro.advertencia('cola_advertencia'));

  const lector = opciones.lector ?? crearLector(config);
  try {
    await boss.start();
    if (!(await boss.getQueue(COLA_ARCHIVO_VERIFICAR.nombre))) {
      throw new Error(`Falta la cola ${COLA_ARCHIVO_VERIFICAR.nombre}: aplicá las migraciones.`);
    }
    await boss.work(
      COLA_ARCHIVO_VERIFICAR.nombre,
      {
        batchSize: 1,
        localConcurrency: config.concurrencia,
        pollingIntervalSeconds: opciones.sondeoSegundos ?? 2,
      },
      async ([trabajo]) => {
        if (!trabajo) return null;
        try {
          return await verificarArchivo(trabajo, pool, lector, registro);
        } catch (error) {
          registro.advertencia('trabajo_fallido', {
            cola: COLA_ARCHIVO_VERIFICAR.nombre,
            trabajo: trabajo.id,
            intento: trabajo.retryCount + 1,
            ...datosDeError(error),
          });
          throw error;
        }
      },
    );
  } catch (error) {
    await boss.stop({ graceful: false, close: true }).catch(() => undefined);
    await pool.end().catch(() => undefined);
    throw error;
  }
  registro.info('worker_listo', { colas: COLA_ARCHIVO_VERIFICAR.nombre });

  let cierre: Promise<void> | null = null;
  let resolverCerrado: () => void = () => undefined;
  const cerrado = new Promise<void>((resolver) => {
    resolverCerrado = resolver;
  });

  return {
    cerrado,
    detener(motivo) {
      cierre ??= (async () => {
        registro.info('worker_cerrando', { motivo });
        try {
          await boss.stop({ graceful: true, close: true, timeout: config.cierreMs });
        } catch (error) {
          registro.error('worker_cierre_error', datosDeError(error));
        }
        await pool.end().catch(() => undefined);
        registro.info('worker_cerrado');
        resolverCerrado();
      })();
      return cierre;
    },
  };
}
