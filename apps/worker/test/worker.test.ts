/**
 * Worker contra el Postgres del banco, con el rol app_worker: procesa archivo.verificar, reintenta
 * con espera creciente, respeta RLS, no registra datos personales y cierra en orden.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COLA_ARCHIVO_VERIFICAR, conContextoCliente, SCHEMA_COLA } from '@conecta/db';
import { crearClinicaDePrueba, urlCon, type ClinicaDePrueba } from '@conecta/db/pruebas';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { crearLector, type LectorArchivos } from '../src/almacen.js';
import { cargarConfig, type ConfigWorker } from '../src/config.js';
import type { DatoRegistro, Registro } from '../src/registro.js';
import { iniciarWorker, type Worker } from '../src/worker.js';

const BUCKET = 'conecta-privado';
const NOMBRE_PERSONAL = 'Radiografía de Juana Pérez.png';

interface Linea {
  nivel: string;
  evento: string;
  datos: Record<string, DatoRegistro>;
}

function registroEnMemoria(): Registro & { lineas: Linea[] } {
  const lineas: Linea[] = [];
  const agregar =
    (nivel: string) =>
    (evento: string, datos: Record<string, DatoRegistro> = {}) =>
      lineas.push({ nivel, evento, datos });
  return {
    lineas,
    info: agregar('info'),
    advertencia: agregar('advertencia'),
    error: agregar('error'),
  };
}

let admin: pg.Pool;
let productor: PgBoss;
let config: ConfigWorker;
let directorio: string;
let A: ClinicaDePrueba;
let B: ClinicaDePrueba;

async function esperar<T>(
  fn: () => Promise<T | undefined | null | false>,
  ms = 30_000,
): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await fn();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error('Se agotó la espera.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

interface EstadoTrabajo {
  state: string;
  retry_count: number;
  retry_backoff: boolean;
  retry_delay_max: number | null;
  output: { resultado?: string } | null;
}

async function trabajo(id: string): Promise<EstadoTrabajo | undefined> {
  const { rows } = await admin.query<EstadoTrabajo>(
    `select state::text as state, retry_count, retry_backoff, retry_delay_max, output
     from cola.job where id = $1`,
    [id],
  );
  return rows[0];
}

/** Archivo de prueba: fila en app.archivo (como administración) y, si se pide, el archivo en disco. */
async function crearArchivo(
  clinicaId: string,
  opciones: { escribir?: boolean } = {},
): Promise<{ id: string; camino: string; contenido: Buffer }> {
  const id = randomUUID();
  const contenido = randomBytes(64);
  const ruta = `${clinicaId}/${id}`;
  await conContextoCliente(
    admin,
    { clinicaId, usuarioId: randomUUID() },
    async (c) => {
      await c.query("select set_config('app.usuario_id', '', true)");
      await c.query(
        `insert into app.archivo (id, clinica_id, categoria, almacen, bucket, ruta, nombre_original,
                                  tipo, bytes, sha256)
         values ($1, $2, 'logo_clinica', 'local', $3, $4, $5, 'image/png', $6, $7)`,
        [
          id,
          clinicaId,
          BUCKET,
          ruta,
          NOMBRE_PERSONAL,
          contenido.length,
          createHash('sha256').update(contenido).digest('hex'),
        ],
      );
    },
    { verificarMembresia: false },
  );
  const camino = path.join(directorio, BUCKET, clinicaId, id);
  if (opciones.escribir !== false) {
    await mkdir(path.dirname(camino), { recursive: true });
    await writeFile(camino, contenido);
  }
  return { id, camino, contenido };
}

async function encolar(datos: object, opciones: object = {}): Promise<string> {
  const id = await productor.send(COLA_ARCHIVO_VERIFICAR.nombre, datos, opciones);
  if (!id) throw new Error('No se encoló.');
  return id;
}

async function conWorker<T>(
  fn: (worker: Worker, registro: ReturnType<typeof registroEnMemoria>) => Promise<T>,
  lector?: LectorArchivos,
): Promise<T> {
  const registro = registroEnMemoria();
  const worker = await iniciarWorker(config, registro, {
    sondeoSegundos: 0.5,
    ...(lector ? { lector } : {}),
  });
  try {
    return await fn(worker, registro);
  } finally {
    await worker.detener('fin de la prueba');
    // Mantenimiento y cola sin errores de privilegios (app_worker no es dueño de nada).
    expect(registro.lineas.filter((l) => l.evento === 'cola_error')).toEqual([]);
    // Nada personal en el registro.
    expect(JSON.stringify(registro.lineas)).not.toContain('Juana');
  }
}

beforeAll(async () => {
  const { urlAdmin, urlApi } = inject('conectaDb');
  admin = new pg.Pool({ connectionString: urlAdmin, max: 3 });
  admin.on('error', () => undefined);
  // LOGIN y contraseña de app_worker: fuera de las migraciones, como los de app_api.
  const clave = randomBytes(18).toString('base64url');
  await admin.query(`alter role app_worker login password '${clave}'`);
  directorio = await mkdtemp(path.join(tmpdir(), 'conecta-worker-'));
  config = {
    ...cargarConfig({ NODE_ENV: 'test' }),
    databaseUrl: urlCon(urlApi, { usuario: 'app_worker', clave }),
    poolMax: 3,
    cierreMs: 10_000,
    archivos: { almacen: 'local', directorio },
  };
  // Productor como la API: app_api, solo encola.
  productor = new PgBoss({
    connectionString: urlApi,
    schema: SCHEMA_COLA,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
    max: 2,
    openTelemetry: { enabled: false },
  });
  productor.on('error', () => undefined);
  await productor.start();
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
});

afterAll(async () => {
  await productor.stop({ graceful: false, close: true });
  await admin.end();
  await rm(directorio, { recursive: true, force: true });
});

describe('worker: archivo.verificar', () => {
  it('relee el archivo, recalcula el SHA-256 y registra ok', async () => {
    const archivo = await crearArchivo(A.clinicaId);
    const id = await encolar({ clinicaId: A.clinicaId, archivoId: archivo.id });
    await conWorker(async (_w, registro) => {
      const fin = await esperar(async () => {
        const t = await trabajo(id);
        return t?.state === 'completed' ? t : null;
      });
      expect(fin.output).toEqual({ resultado: 'ok' });
      expect(registro.lineas).toContainEqual({
        nivel: 'info',
        evento: 'archivo_verificacion',
        datos: expect.objectContaining({
          trabajo: id,
          clinica: A.clinicaId,
          archivo: archivo.id,
          resultado: 'ok',
        }) as Record<string, DatoRegistro>,
      });
    });
  });

  it('contenido cambiado: distinto, como error y sin reintentos', async () => {
    const archivo = await crearArchivo(A.clinicaId);
    await writeFile(archivo.camino, Buffer.concat([archivo.contenido, Buffer.from('x')]));
    const id = await encolar({ clinicaId: A.clinicaId, archivoId: archivo.id });
    await conWorker(async (_w, registro) => {
      const fin = await esperar(async () => {
        const t = await trabajo(id);
        return t?.state === 'completed' ? t : null;
      });
      expect(fin).toMatchObject({ retry_count: 0, output: { resultado: 'distinto' } });
      expect(
        registro.lineas.some((l) => l.nivel === 'error' && l.datos['resultado'] === 'distinto'),
      ).toBe(true);
    });
  });

  it('respeta RLS: un archivo de otra clínica no existe para el trabajo', async () => {
    const deA = await crearArchivo(A.clinicaId);
    const id = await encolar({ clinicaId: B.clinicaId, archivoId: deA.id });
    const invalido = await encolar({ clinicaId: B.clinicaId, archivoId: '../../etc/passwd' });
    await conWorker(async () => {
      const fin = await esperar(async () => {
        const t = await trabajo(id);
        return t?.state === 'completed' ? t : null;
      });
      expect(fin.output).toEqual({ resultado: 'no_encontrado' });
      const otro = await esperar(async () => {
        const t = await trabajo(invalido);
        return t?.state === 'completed' ? t : null;
      });
      expect(otro.output).toEqual({ resultado: 'invalido' });
    });
  });

  it('si el archivo falta en el almacén, reintenta con espera creciente y termina cuando aparece', async () => {
    const archivo = await crearArchivo(A.clinicaId, { escribir: false });
    // retryDelay de 1 s para la prueba; el resto (espera creciente, tope) viene de la cola.
    const id = await encolar(
      { clinicaId: A.clinicaId, archivoId: archivo.id },
      { retryDelay: 1, retryLimit: 3 },
    );
    expect(await trabajo(id)).toMatchObject({
      retry_backoff: COLA_ARCHIVO_VERIFICAR.opciones.retryBackoff,
      retry_delay_max: COLA_ARCHIVO_VERIFICAR.opciones.retryDelayMax,
    });
    await conWorker(async (_w, registro) => {
      await esperar(async () => {
        const t = await trabajo(id);
        return t && t.retry_count >= 1 ? t : null;
      });
      expect(
        registro.lineas.some(
          (l) =>
            l.evento === 'archivo_verificacion_reintento' &&
            l.datos['motivo'] === 'falta_en_almacen',
        ),
      ).toBe(true);
      await mkdir(path.dirname(archivo.camino), { recursive: true });
      await writeFile(archivo.camino, archivo.contenido);
      const fin = await esperar(async () => {
        const t = await trabajo(id);
        return t?.state === 'completed' ? t : null;
      });
      expect(fin.output).toEqual({ resultado: 'ok' });
      expect(fin.retry_count).toBeGreaterThanOrEqual(1);
    });
  });

  it('cierre ordenado: termina el trabajo en curso antes de cerrar', async () => {
    const archivo = await crearArchivo(A.clinicaId);
    const real = crearLector(config);
    let avisarEmpezo: () => void = () => undefined;
    const empezo = new Promise<void>((r) => (avisarEmpezo = r));
    let soltar: () => void = () => undefined;
    const suelto = new Promise<void>((r) => (soltar = r));
    const lento: LectorArchivos = {
      async leer(ubicacion) {
        avisarEmpezo();
        await suelto;
        return real.leer(ubicacion);
      },
    };
    const id = await encolar({ clinicaId: A.clinicaId, archivoId: archivo.id });
    await conWorker(async (worker) => {
      await empezo;
      let cerro = false;
      const cierre = worker.detener('SIGTERM').then(() => {
        cerro = true;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(cerro).toBe(false);
      expect((await trabajo(id))?.state).toBe('active');
      soltar();
      await cierre;
      await worker.cerrado;
      expect(await trabajo(id)).toMatchObject({ state: 'completed', output: { resultado: 'ok' } });
      // detener() otra vez no hace nada nuevo.
      await worker.detener('SIGINT');
    }, lento);
  });

  it('encolar en una transacción revertida no deja el trabajo', async () => {
    const api = new pg.Pool({ connectionString: inject('conectaDb').urlApi, max: 1 });
    const cliente = await api.connect();
    try {
      await cliente.query('BEGIN');
      const id = await productor.send(
        COLA_ARCHIVO_VERIFICAR.nombre,
        { clinicaId: A.clinicaId, archivoId: randomUUID() },
        { db: { executeSql: (texto, valores) => cliente.query(texto, valores) } },
      );
      expect(id).toEqual(expect.any(String));
      await cliente.query('ROLLBACK');
      expect(await trabajo(id ?? '')).toBeUndefined();
    } finally {
      cliente.release();
      await api.end();
    }
  });
});

describe('pg-boss con app_worker', () => {
  it('el mantenimiento (vencimientos, limpieza, conteos) corre sin privilegios de dueño', async () => {
    const errores: unknown[] = [];
    const boss = new PgBoss({
      connectionString: config.databaseUrl,
      schema: SCHEMA_COLA,
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: true,
      reindex: false,
      persistQueueStats: false,
      persistWarnings: false,
      max: 2,
      openTelemetry: { enabled: false },
    });
    boss.on('error', (e) => errores.push(e));
    await boss.start();
    try {
      await boss.supervise(COLA_ARCHIVO_VERIFICAR.nombre);
      expect((await boss.getInstances()).length).toBeGreaterThanOrEqual(1);
    } finally {
      await boss.stop({ graceful: false, close: true });
    }
    expect(errores).toEqual([]);
  });

  it('la versión de esquema es la de 0014 y app_worker no puede cambiar la estructura', async () => {
    const { rows } = await admin.query<{ version: number }>('select version from cola.version');
    expect(rows[0]?.version).toBe(46);
    const c = new pg.Client({ connectionString: config.databaseUrl });
    await c.connect();
    try {
      await expect(c.query('alter table cola.job_common add column x int')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await c.end();
    }
  });
});
