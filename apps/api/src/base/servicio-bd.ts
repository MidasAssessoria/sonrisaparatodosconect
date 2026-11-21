/**
 * Único punto de acceso a la base. El pool queda privado: toda consulta de negocio pasa por
 * `enContexto`, que abre la transacción y fija clínica, usuario e IP (RLS). `comoUsuario` es solo
 * para el paso previo a elegir clínica (listar las membresías propias).
 */
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  conContexto,
  conUsuario,
  crearPool,
  sinContexto,
  type TransaccionConecta,
} from '@conecta/db';
import type pg from 'pg';
import { CONFIG, type Config } from '../config.js';
import { REGISTRO, type Registro } from '../comun/registro.js';

export interface ContextoBd {
  /** Clínica de una membresía activa verificada por el guard; nunca del cuerpo ni de la ruta. */
  clinicaId: string;
  /** `sub` del JWT verificado. */
  usuarioId: string;
  ip: string | null;
}

@Injectable()
export class ServicioBd implements OnApplicationShutdown {
  private readonly pool: pg.Pool;
  private cerrado = false;

  constructor(@Inject(CONFIG) config: Config, @Inject(REGISTRO) registro: Registro) {
    this.pool = crearPool(config.databaseUrl, {
      application_name: 'conecta-api',
      max: config.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      alErrorInactivo: (error) => registro.advertencia('pool_error_inactivo', { tipo: error.name }),
    });
  }

  enContexto<T>(contexto: ContextoBd, fn: (tx: TransaccionConecta) => Promise<T>): Promise<T> {
    return conContexto(
      this.pool,
      { clinicaId: contexto.clinicaId, usuarioId: contexto.usuarioId, ip: contexto.ip },
      fn,
    );
  }

  comoUsuario<T>(
    usuarioId: string,
    ip: string | null,
    fn: (tx: TransaccionConecta) => Promise<T>,
  ): Promise<T> {
    return conUsuario(this.pool, usuarioId, fn, { ip });
  }

  /**
   * Transacción sin usuario ni clínica: SOLO para las rutas públicas de invitación, cuyas funciones
   * SECURITY DEFINER (`consultarInvitacion`, `aceptarInvitacion`) resuelven la clínica por el token.
   * Las tablas de negocio no devuelven nada en esta transacción.
   */
  sinContexto<T>(ip: string | null, fn: (tx: TransaccionConecta) => Promise<T>): Promise<T> {
    return sinContexto(this.pool, fn, { ip });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.cerrado) return;
    this.cerrado = true;
    await this.pool.end();
  }
}
