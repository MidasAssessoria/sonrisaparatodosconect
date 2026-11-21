/**
 * Productor de la cola (pg-boss) dentro de la API. Encola en la MISMA transacción que el cambio de
 * negocio: `send(nombre, datos, { db: fromDrizzle(tx, sql) })` ejecuta el INSERT del trabajo con la
 * conexión de la transacción de `conContexto` (la del pedido). Si la transacción se revierte, el
 * trabajo no queda; si se confirma, el worker lo ve recién después del COMMIT.
 *
 * La instancia de pg-boss de la API es solo productora: `migrate: false` (el esquema lo crea la
 * migración 0014), sin mantenimiento, sin cron y sin registrarse como instancia. Se arranca la
 * primera vez que hace falta (consulta `cola.version` y `cola.queue` con un pool propio de 2
 * conexiones de app_api) y se detiene al cerrar la app. Nada de los trabajos va a los registros.
 */
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  COLA_ARCHIVO_VERIFICAR,
  SCHEMA_COLA,
  type TrabajoVerificarArchivo,
  type TransaccionConecta,
} from '@conecta/db';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { CONFIG, type Config } from '../config.js';
import { REGISTRO, type Registro } from '../comun/registro.js';

function datosDeError(error: unknown): { tipo: string; codigo: string | null } {
  const codigo = (error as { code?: unknown } | null)?.code;
  return {
    tipo: error instanceof Error ? error.name : typeof error,
    codigo: typeof codigo === 'string' ? codigo : null,
  };
}

@Injectable()
export class ColaArchivos implements OnApplicationShutdown {
  #arranque: Promise<PgBoss> | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(REGISTRO) private readonly registro: Registro,
  ) {}

  private iniciar(): Promise<PgBoss> {
    if (!this.#arranque) {
      const boss = new PgBoss({
        connectionString: this.config.databaseUrl,
        schema: SCHEMA_COLA,
        application_name: 'conecta-api-cola',
        max: 2,
        migrate: false,
        createSchema: false,
        supervise: false,
        schedule: false,
        registerInstance: false,
        persistWarnings: false,
        openTelemetry: { enabled: false },
      });
      boss.on('error', (error) => this.registro.error('cola_error', datosDeError(error)));
      boss.on('warning', () => this.registro.advertencia('cola_advertencia'));
      this.#arranque = boss.start().then(
        () => boss,
        async (error: unknown) => {
          this.#arranque = null;
          await boss.stop({ graceful: false, close: true }).catch(() => undefined);
          throw error;
        },
      );
    }
    return this.#arranque;
  }

  /** Encola `archivo.verificar` dentro de la transacción `tx`. */
  async encolarVerificacion(
    tx: TransaccionConecta,
    trabajo: TrabajoVerificarArchivo,
  ): Promise<void> {
    const boss = await this.iniciar();
    const id = await boss.send(
      COLA_ARCHIVO_VERIFICAR.nombre,
      { clinicaId: trabajo.clinicaId, archivoId: trabajo.archivoId },
      { db: fromDrizzle(tx, sql) },
    );
    if (!id) throw new Error('La cola no aceptó el trabajo.');
  }

  async onApplicationShutdown(): Promise<void> {
    const arranque = this.#arranque;
    this.#arranque = null;
    if (!arranque) return;
    const boss = await arranque.catch(() => null);
    await boss?.stop({ graceful: false, close: true });
  }
}
