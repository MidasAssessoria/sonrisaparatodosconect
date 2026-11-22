/**
 * Conexión y contexto de transacción.
 *
 * Toda consulta de negocio corre dentro de `conContexto`: abre una transacción, fija
 * `app.clinica_id`, `app.usuario_id` y `app.ip` con `set_config(..., true)` (equivale a SET LOCAL,
 * se borra al terminar la transacción) usando parámetros, vuelve a comprobar la membresía (ver
 * abajo), ejecuta `fn` y hace commit o rollback.
 *
 * Seguridad: las políticas RLS confían en ese contexto. Quien llama tiene que haber verificado
 * antes el JWT (el `sub` es el usuario): app_api puede fijar cualquier clínica. Por defecto,
 * `conContexto` comprueba además, dentro de la misma transacción y con bloqueo compartido de la
 * fila, que la membresía del usuario en esa clínica está activa y la clínica también; si no, lanza
 * `ErrorDeMembresia` antes de ejecutar `fn`. El bloqueo hace que una desactivación concurrente
 * espere a que la operación termine (o que la operación falle si la desactivación llegó antes).
 * Nunca uses `set_config(..., false)`: con un pool, el valor quedaría pegado a la conexión y lo
 * vería la próxima petición.
 */
import { isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { esquema, type Esquema } from './esquema.js';

export type BaseDeDatos = NodePgDatabase<Esquema>;
/** Transacción de Drizzle que reciben `conContexto` y `conUsuario`. */
export type TransaccionConecta = Parameters<Parameters<BaseDeDatos['transaction']>[0]>[0];

export interface ContextoSesion {
  /** Clínica activa, tomada de una membresía activa verificada por la API. */
  clinicaId: string;
  /** `sub` del JWT verificado (= `app.usuario.id`). */
  usuarioId: string;
  /** IP de la petición, para la auditoría. */
  ip?: string | null | undefined;
}

export class ErrorDeContexto extends Error {
  override name = 'ErrorDeContexto';
}

/**
 * Por qué `conContexto` no dejó operar:
 * - `sin_membresia`: el usuario no tiene membresía en esa clínica (o la clínica no existe).
 * - `membresia_inactiva`: la tiene, pero no está activa (pendiente o inactiva).
 * - `clinica_inactiva`: la clínica está dada de baja.
 */
export type MotivoErrorDeMembresia = 'sin_membresia' | 'membresia_inactiva' | 'clinica_inactiva';

/**
 * La comprobación de membresía de `conContexto`/`conContextoCliente` falló. La transacción ya se
 * revirtió y `fn` no llegó a ejecutarse. Para la API es un 403 `sin_membresia`.
 */
export class ErrorDeMembresia extends Error {
  override name = 'ErrorDeMembresia';
  constructor(readonly motivo: MotivoErrorDeMembresia) {
    super(
      motivo === 'clinica_inactiva'
        ? 'La clínica del contexto está dada de baja.'
        : motivo === 'membresia_inactiva'
          ? 'La membresía del usuario en la clínica del contexto no está activa.'
          : 'El usuario no tiene membresía en la clínica del contexto.',
    );
  }
}

export interface OpcionesContexto {
  /** Nivel de aislamiento, modo de acceso, etc. de la transacción. */
  config?: PgTransactionConfig | undefined;
  /**
   * Por defecto `true`: antes de `fn`, comprueba con `FOR SHARE` que la membresía del usuario en la
   * clínica está activa y la clínica también, y si no lanza `ErrorDeMembresia`.
   * `false` solo para scripts de administración y fábricas de prueba que fijan un contexto sin
   * membresía (p. ej. antes de que exista la clínica). La API nunca lo apaga.
   */
  verificarMembresia?: boolean | undefined;
}

/**
 * Comprobación de membresía dentro de la transacción. `FOR SHARE OF m`: hasta el final de la
 * transacción, nadie puede cambiar esa membresía (una desactivación concurrente espera).
 */
const SQL_VERIFICAR_MEMBRESIA = `select m.estado, c.activo as clinica_activa
  from app.membresia m join app.clinica c on c.id = m.clinica_id
  where m.clinica_id = app.clinica_actual() and m.usuario_id = app.usuario_actual()
  for share of m`;

type FilaVerificacion = {
  estado: string;
  clinica_activa: boolean;
};

function exigirMembresiaActiva(fila: FilaVerificacion | undefined): void {
  if (!fila) throw new ErrorDeMembresia('sin_membresia');
  if (!fila.clinica_activa) throw new ErrorDeMembresia('clinica_inactiva');
  if (fila.estado !== 'activo') throw new ErrorDeMembresia('membresia_inactiva');
}

export interface OpcionesPool extends Omit<pg.PoolConfig, 'connectionString'> {
  /**
   * Errores de conexiones inactivas del pool (p. ej. la base se reinició). Sin este manejador el
   * evento `error` del pool tiraría el proceso; por defecto se ignoran (el pool descarta la conexión).
   */
  alErrorInactivo?: (error: Error) => void;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crearPool(url: string, opciones: OpcionesPool = {}): pg.Pool {
  const { alErrorInactivo, ...config } = opciones;
  const pool = new pg.Pool({ application_name: 'conecta', ...config, connectionString: url });
  pool.on('error', alErrorInactivo ?? (() => undefined));
  return pool;
}

const instancias = new WeakMap<pg.Pool, BaseDeDatos>();

/** Instancia de Drizzle sobre el pool (una por pool). Para consultas, usá `conContexto`. */
export function baseDeDatos(pool: pg.Pool): BaseDeDatos {
  let db = instancias.get(pool);
  if (!db) {
    db = drizzle(pool, { schema: esquema });
    instancias.set(pool, db);
  }
  return db;
}

function uuidValido(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !PATRON_UUID.test(valor)) {
    throw new ErrorDeContexto(`${campo} tiene que ser un UUID.`);
  }
  return valor.toLowerCase();
}

function ipValida(valor: string | null | undefined): string {
  if (valor === undefined || valor === null || valor === '') return '';
  if (isIP(valor) === 0) throw new ErrorDeContexto('La IP del contexto no es válida.');
  return valor;
}

interface ValoresContexto {
  clinicaId: string;
  usuarioId: string;
  ip: string;
}

function valoresDe(contexto: ContextoSesion): ValoresContexto {
  return {
    clinicaId: uuidValido(contexto.clinicaId, 'clinicaId'),
    usuarioId: uuidValido(contexto.usuarioId, 'usuarioId'),
    ip: ipValida(contexto.ip),
  };
}

/**
 * Ejecuta `fn` en una transacción con el contexto de clínica y usuario fijado.
 * Por defecto, antes de `fn` comprueba la membresía activa (ver `OpcionesContexto`) y si no lanza
 * `ErrorDeMembresia`. Commit si `fn` termina bien; rollback si lanza. Las transacciones anidadas
 * (`tx.transaction`) usan savepoints y conservan el contexto.
 */
export async function conContexto<T>(
  pool: pg.Pool,
  contexto: ContextoSesion,
  fn: (tx: TransaccionConecta) => Promise<T>,
  opciones: OpcionesContexto = {},
): Promise<T> {
  const valores = valoresDe(contexto);
  return baseDeDatos(pool).transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.clinica_id', ${valores.clinicaId}, true),
      set_config('app.usuario_id', ${valores.usuarioId}, true),
      set_config('app.ip', ${valores.ip}, true)`);
    if (opciones.verificarMembresia !== false) {
      const resultado = await tx.execute<FilaVerificacion>(sql.raw(SQL_VERIFICAR_MEMBRESIA));
      exigirMembresiaActiva(resultado.rows[0]);
    }
    return fn(tx);
  }, opciones.config);
}

/**
 * Como `conContexto` pero solo con usuario, sin clínica: para el paso del login que lista
 * «mis clínicas» (membresías propias y clínicas con membresía activa) antes de elegir una.
 * Sin clínica en el contexto, las tablas de negocio no devuelven nada.
 */
export async function conUsuario<T>(
  pool: pg.Pool,
  usuarioId: string,
  fn: (tx: TransaccionConecta) => Promise<T>,
  opciones: { ip?: string | null | undefined; config?: PgTransactionConfig } = {},
): Promise<T> {
  const usuario = uuidValido(usuarioId, 'usuarioId');
  const ip = ipValida(opciones.ip);
  return baseDeDatos(pool).transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.clinica_id', '', true),
      set_config('app.usuario_id', ${usuario}, true),
      set_config('app.ip', ${ip}, true)`);
    return fn(tx);
  }, opciones.config);
}

/**
 * Transacción SIN usuario ni clínica (contexto vacío): para las rutas públicas de invitación
 * (`consultarInvitacion`, `aceptarInvitacion`), cuyas funciones resuelven la clínica por el token.
 * Las tablas de negocio no devuelven nada en esta transacción. `ip` queda para la auditoría.
 */
export async function sinContexto<T>(
  pool: pg.Pool,
  fn: (tx: TransaccionConecta) => Promise<T>,
  opciones: { ip?: string | null | undefined; config?: PgTransactionConfig } = {},
): Promise<T> {
  const ip = ipValida(opciones.ip);
  return baseDeDatos(pool).transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.clinica_id', '', true),
      set_config('app.usuario_id', '', true),
      set_config('app.ip', ${ip}, true)`);
    return fn(tx);
  }, opciones.config);
}

export interface MembresiaActiva {
  membresiaId: string;
  rolId: string;
  sedeDefectoId: string | null;
}

/**
 * Paso previo a `conContexto`: confirma que el usuario (el `sub` del JWT ya verificado) tiene una
 * membresía activa en una clínica activa. Devuelve null si no. La API tiene que fijar el contexto
 * solo cuando esto devuelve una membresía: es la frontera de confianza que la base no puede ver.
 */
export async function buscarMembresiaActiva(
  pool: pg.Pool,
  usuarioId: string,
  clinicaId: string,
): Promise<MembresiaActiva | null> {
  const clinica = uuidValido(clinicaId, 'clinicaId');
  return conUsuario(pool, usuarioId, async (tx) => {
    // Con solo el usuario en el contexto, RLS deja ver sus membresías y las clínicas donde está activo.
    const resultado = await tx.execute<{
      membresia_id: string;
      rol_id: string;
      sede_defecto_id: string | null;
    }>(sql`select m.id as membresia_id, m.rol_id, m.sede_defecto_id
           from app.membresia m join app.clinica c on c.id = m.clinica_id
           where m.clinica_id = ${clinica} and m.usuario_id = app.usuario_actual()
             and m.estado = 'activo' and c.activo`);
    const fila = resultado.rows[0];
    return fila
      ? { membresiaId: fila.membresia_id, rolId: fila.rol_id, sedeDefectoId: fila.sede_defecto_id }
      : null;
  });
}

/**
 * Variante con el cliente de `pg` crudo (para pg-boss, scripts y pruebas). Mismo contrato que
 * `conContexto`: transacción, contexto con parámetros, comprobación de membresía (salvo
 * `verificarMembresia: false`), commit o rollback.
 */
export async function conContextoCliente<T>(
  pool: pg.Pool,
  contexto: ContextoSesion,
  fn: (cliente: pg.PoolClient) => Promise<T>,
  opciones: Pick<OpcionesContexto, 'verificarMembresia'> = {},
): Promise<T> {
  const valores = valoresDe(contexto);
  const cliente = await pool.connect();
  let conexionRota: Error | undefined;
  try {
    await cliente.query('BEGIN');
    await cliente.query(
      `select set_config('app.clinica_id', $1, true),
              set_config('app.usuario_id', $2, true),
              set_config('app.ip', $3, true)`,
      [valores.clinicaId, valores.usuarioId, valores.ip],
    );
    if (opciones.verificarMembresia !== false) {
      const verificacion = await cliente.query<FilaVerificacion>(SQL_VERIFICAR_MEMBRESIA);
      exigirMembresiaActiva(verificacion.rows[0]);
    }
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('ROLLBACK');
    } catch (errorRollback) {
      conexionRota =
        errorRollback instanceof Error ? errorRollback : new Error(String(errorRollback));
    }
    throw error;
  } finally {
    // Si el ROLLBACK falló, la conexión se descarta en vez de volver al pool.
    cliente.release(conexionRota);
  }
}
