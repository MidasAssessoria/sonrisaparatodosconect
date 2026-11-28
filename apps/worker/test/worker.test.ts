/**
 * Worker contra el Postgres del banco, con el rol app_worker: procesa archivo.verificar, reintenta
 * con espera creciente, respeta RLS, no registra datos personales y cierra en orden.
 *
 * Los trabajos se encolan como la API: con `encolar` (`app.encolar`, migración 0018) dentro de una
 * transacción con contexto de app_api; la base pone la clínica del contexto en el trabajo y el
 * worker la usa. Para probar la defensa en profundidad del worker, un «falsificador» (pg-boss como
 * administración, fuera de app.encolar) escribe trabajos que la API no puede escribir.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  COLA_ARCHIVO_VERIFICAR,
  conContexto,
  conContextoCliente,
  encolar as encolarEnTx,
  SCHEMA_COLA,
} from '@conecta/db';
import {
  CLAVES_DE_PRUEBA,
  crearClinicaDePrueba,
  urlCon,
  type ClinicaDePrueba,
} from '@conecta/db/pruebas';
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
/** Pool de app_api: encola como la API. */
let api: pg.Pool;
/** pg-boss como administración: escribe trabajos que app.encolar no deja escribir. */
let falsificador: PgBoss;
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

/** Encola como la API: `app.encolar` en una transacción con el contexto de esa clínica. */
async function encolar(clinica: ClinicaDePrueba, archivoId: string): Promise<string> {
  const id = await conContexto(
    api,
    { clinicaId: clinica.clinicaId, usuarioId: clinica.duenoId },
    (tx) => encolarEnTx(tx, COLA_ARCHIVO_VERIFICAR.nombre, { archivoId }),
  );
  if (!id) throw new Error('No se encoló.');
  return id;
}

/** Un trabajo escrito fuera de app.encolar (como administración), con cualquier dato. */
async function falsificar(datos: object): Promise<string> {
  const id = await falsificador.send(COLA_ARCHIVO_VERIFICAR.nombre, datos);
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
  // Contraseña fija: en CI otras suites usan el mismo Postgres y el mismo rol (ver CLAVES_DE_PRUEBA).
  const clave = CLAVES_DE_PRUEBA.worker;
  await admin.query(`alter role app_worker login password '${clave}'`);
  directorio = await mkdtemp(path.join(tmpdir(), 'conecta-worker-'));
  config = {
    ...cargarConfig({ NODE_ENV: 'test' }),
    databaseUrl: urlCon(urlApi, { usuario: 'app_worker', clave }),
    poolMax: 3,
    cierreMs: 10_000,
    archivos: { almacen: 'local', directorio },
  };
  api = new pg.Pool({ connectionString: urlApi, max: 2 });
  api.on('error', () => undefined);
  falsificador = new PgBoss({
    connectionString: urlAdmin,
    schema: SCHEMA_COLA,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
    max: 2,
    openTelemetry: { enabled: false },
  });
  falsificador.on('error', () => undefined);
  await falsificador.start();
  [A, B] = await Promise.all([crearClinicaDePrueba(admin), crearClinicaDePrueba(admin)]);
});

afterAll(async () => {
  await falsificador.stop({ graceful: false, close: true });
  await api.end();
  await admin.end();
  await rm(directorio, { recursive: true, force: true });
});

describe('worker: archivo.verificar', () => {
  it('relee el archivo, recalcula el SHA-256 y registra ok', async () => {
    const archivo = await crearArchivo(A.clinicaId);
    const id = await encolar(A, archivo.id);
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
    const id = await encolar(A, archivo.id);
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

  it('la API no puede encolar para otra clínica; un trabajo falsificado igual choca con RLS', async () => {
    const deA = await crearArchivo(A.clinicaId);
    // Desde el contexto de B, app.encolar no acepta un archivo de A (ni elegir otra clínica).
    await expect(encolar(B, deA.id)).rejects.toMatchObject({
      cause: { code: '22023', constraint: 'cola_datos_invalidos' },
    });
    await expect(
      conContexto(api, { clinicaId: B.clinicaId, usuarioId: B.duenoId }, (tx) =>
        encolarEnTx(tx, COLA_ARCHIVO_VERIFICAR.nombre, {
          archivoId: deA.id,
          clinicaId: A.clinicaId,
        } as { archivoId: string }),
      ),
    ).rejects.toMatchObject({ cause: { constraint: 'cola_datos_invalidos' } });
    // app_api no tiene nada en el schema cola.
    await expect(api.query('select id from cola.job limit 1')).rejects.toMatchObject({
      code: '42501',
    });
    // Defensa en profundidad del worker: trabajos escritos fuera de app.encolar.
    const id = await falsificar({ clinicaId: B.clinicaId, archivoId: deA.id });
    const invalido = await falsificar({ clinicaId: B.clinicaId, archivoId: '../../etc/passwd' });
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
    // Las opciones las pone app.encolar desde la cola; para la prueba se acorta la espera a 1 s
    // (como administración). El resto (espera creciente, tope) es el de la cola.
    const id = await encolar(A, archivo.id);
    expect(await trabajo(id)).toMatchObject({
      retry_backoff: COLA_ARCHIVO_VERIFICAR.opciones.retryBackoff,
      retry_delay_max: COLA_ARCHIVO_VERIFICAR.opciones.retryDelayMax,
    });
    await admin.query('update cola.job set retry_delay = 1, retry_limit = 3 where id = $1', [id]);
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
        // Solo frena el archivo de esta prueba: un trabajo que quedó de otra puede llegar antes.
        if (ubicacion.ruta.endsWith(archivo.id)) {
          avisarEmpezo();
          await suelto;
        }
        return real.leer(ubicacion);
      },
    };
    const id = await encolar(A, archivo.id);
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
    const archivo = await crearArchivo(A.clinicaId);
    let id: string | null = null;
    await expect(
      conContexto(api, { clinicaId: A.clinicaId, usuarioId: A.duenoId }, async (tx) => {
        id = await encolarEnTx(tx, COLA_ARCHIVO_VERIFICAR.nombre, { archivoId: archivo.id });
        throw new Error('revertir');
      }),
    ).rejects.toThrow('revertir');
    expect(id).toEqual(expect.any(String));
    expect(await trabajo(id ?? '')).toBeUndefined();
  });

  it('app.encolar guarda la clínica del contexto en el trabajo, y el worker lee con ella', async () => {
    const archivo = await crearArchivo(B.clinicaId);
    const id = await encolar(B, archivo.id);
    const { rows } = await admin.query<{ data: unknown }>(
      'select data from cola.job where id = $1',
      [id],
    );
    expect(rows[0]?.data).toEqual({ clinicaId: B.clinicaId, archivoId: archivo.id });
    await conWorker(async (_w, registro) => {
      const fin = await esperar(async () => {
        const t = await trabajo(id);
        return t?.state === 'completed' ? t : null;
      });
      expect(fin.output).toEqual({ resultado: 'ok' });
      expect(registro.lineas).toContainEqual(
        expect.objectContaining({
          evento: 'archivo_verificacion',
          datos: expect.objectContaining({ clinica: B.clinicaId, resultado: 'ok' }) as Record<
            string,
            DatoRegistro
          >,
        }),
      );
    });
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
