/**
 * Postgres embebido para pruebas (Windows y Linux, sin Docker).
 *
 * `embedded-postgres` aporta los binarios y el initdb; el arranque y la parada se hacen con pg_ctl:
 * en Windows, el `stop()` de la librería mata el proceso con taskkill y deja hijos huérfanos
 * (p. ej. el bgwriter) que retienen los pipes de Node. pg_ctl hace un apagado ordenado y con -l el
 * servidor escribe en un archivo, sin pipes compartidos con este proceso.
 *
 * Cada corrida usa `<raiz>/pg-<pid>-<marca>/` y lo borra al terminar. Si una corrida anterior murió
 * sin limpiar, la próxima detiene su servidor y borra el directorio (solo si el proceso dueño ya
 * no existe, para no pisar otra corrida en paralelo).
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

interface Binarios {
  pg_ctl: string;
  initdb: string;
  postgres: string;
}

export interface PostgresEmbebido {
  puerto: number;
  usuario: string;
  clave: string;
  detener(): Promise<void>;
}

export interface OpcionesPostgresEmbebido {
  /** Directorio raíz de los datos. Por defecto `<cwd>/.pg-test`. */
  raiz?: string | undefined;
  registrar?: ((mensaje: string) => void) | undefined;
}

const ARCHIVO_DUENO = 'dueno.pid';

/** Rutas de pg_ctl/initdb/postgres del paquete de binarios que trae embedded-postgres. */
async function binarios(): Promise<Binarios> {
  const desdeAca = createRequire(import.meta.url);
  const desdeEmbebido = createRequire(desdeAca.resolve('embedded-postgres'));
  const so = process.platform === 'win32' ? 'windows' : process.platform;
  const paquete = `@embedded-postgres/${so}-${process.arch}`;
  let ruta: string;
  try {
    ruta = desdeEmbebido.resolve(paquete);
  } catch (error) {
    throw new Error(
      `No están los binarios de Postgres para esta plataforma (${paquete}). ` +
        'Corré pnpm install o definí DATABASE_URL_TEST.',
      { cause: error },
    );
  }
  return (await import(pathToFileURL(ruta).href)) as Binarios;
}

function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function borrarDirectorio(directorio: string): Promise<void> {
  // En Windows los archivos pueden quedar tomados un instante después de que el servidor se apaga.
  await rm(directorio, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

function detenerSincronico(bin: Binarios, datos: string): void {
  spawnSync(bin.pg_ctl, ['stop', '-D', datos, '-m', 'immediate', '-w', '-t', '20'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

/** Detiene y borra lo que dejaron corridas anteriores que terminaron mal. */
async function limpiarRestos(raiz: string, bin: Binarios): Promise<void> {
  let entradas: string[];
  try {
    entradas = await readdir(raiz);
  } catch {
    return;
  }
  for (const entrada of entradas) {
    if (!entrada.startsWith('pg-')) continue;
    const directorio = path.join(raiz, entrada);
    try {
      const pid = Number.parseInt(await readFile(path.join(directorio, ARCHIVO_DUENO), 'utf8'), 10);
      if (Number.isInteger(pid) && pid !== process.pid && procesoVivo(pid)) continue;
    } catch {
      // Sin archivo de dueño: es un resto de una corrida que falló al empezar.
    }
    const datos = path.join(directorio, 'datos');
    if (existsSync(path.join(datos, 'postmaster.pid'))) detenerSincronico(bin, datos);
    await borrarDirectorio(directorio).catch(() => undefined);
  }
}

async function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer();
    servidor.unref();
    servidor.on('error', rechazar);
    servidor.listen(0, '127.0.0.1', () => {
      const direccion = servidor.address();
      servidor.close(() => {
        if (direccion && typeof direccion === 'object') resolver(direccion.port);
        else rechazar(new Error('No se pudo obtener un puerto libre.'));
      });
    });
  });
}

/** Corre un binario con la salida a un archivo (sin pipes: el servidor hereda estos descriptores). */
async function ejecutar(
  binario: string,
  argumentos: string[],
  archivoSalida: string,
): Promise<number> {
  const descriptor = openSync(archivoSalida, 'a');
  try {
    return await new Promise<number>((resolver, rechazar) => {
      const hijo = spawn(binario, argumentos, {
        stdio: ['ignore', descriptor, descriptor],
        windowsHide: true,
      });
      hijo.on('error', rechazar);
      hijo.on('exit', (codigo) => resolver(codigo ?? 1));
    });
  } finally {
    closeSync(descriptor);
  }
}

function leerSiExiste(archivo: string): string {
  try {
    return readFileSync(archivo, 'utf8');
  } catch {
    return '';
  }
}

const CONFIGURACION = `
# --- @conecta/db: servidor efímero de pruebas ---
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
max_connections = 200
fsync = off
synchronous_commit = off
full_page_writes = off
timezone = 'UTC'
log_timezone = 'UTC'
`;

export async function iniciarPostgresEmbebido(
  opciones: OpcionesPostgresEmbebido = {},
): Promise<PostgresEmbebido> {
  const registrar = opciones.registrar ?? (() => undefined);
  const raiz = path.resolve(opciones.raiz ?? path.join(process.cwd(), '.pg-test'));
  const bin = await binarios();
  await mkdir(raiz, { recursive: true });
  await limpiarRestos(raiz, bin);

  const directorio = path.join(raiz, `pg-${process.pid}-${Date.now().toString(36)}`);
  const datos = path.join(directorio, 'datos');
  const archivoServidor = path.join(directorio, 'servidor.log');
  const archivoPgCtl = path.join(directorio, 'pg_ctl.log');
  await mkdir(directorio, { recursive: true });
  await writeFile(path.join(directorio, ARCHIVO_DUENO), String(process.pid));

  const usuario = 'postgres';
  const clave = randomBytes(18).toString('base64url');
  const mensajes: string[] = [];
  let corriendo = false;
  const alSalir = (): void => {
    if (corriendo) detenerSincronico(bin, datos);
  };

  try {
    const embebido = new EmbeddedPostgres({
      databaseDir: datos,
      user: usuario,
      password: clave,
      authMethod: 'scram-sha-256',
      persistent: true,
      initdbFlags: [
        '--encoding=UTF8',
        '--locale=C',
        '--locale-provider=builtin',
        '--builtin-locale=C.UTF-8',
        '--no-sync',
      ],
      onLog: (mensaje) => mensajes.push(mensaje),
      onError: (error) => mensajes.push(String(error)),
    });
    registrar('Postgres embebido: initdb…');
    try {
      await embebido.initialise();
    } catch (error) {
      throw new Error(`initdb falló:\n${mensajes.join('')}`, { cause: error });
    }
    await appendFile(path.join(datos, 'postgresql.conf'), CONFIGURACION);

    process.once('exit', alSalir);
    let puerto = 0;
    for (let intento = 1; ; intento++) {
      puerto = await puertoLibre();
      const codigo = await ejecutar(
        bin.pg_ctl,
        ['start', '-D', datos, '-w', '-t', '60', '-l', archivoServidor, '-o', `-p ${puerto}`],
        archivoPgCtl,
      );
      if (codigo === 0) break;
      // Puede que el puerto lo haya tomado otro proceso entre medio: se reintenta con otro.
      if (intento >= 3) {
        throw new Error(
          `pg_ctl start falló (código ${codigo}).\n${leerSiExiste(archivoPgCtl)}\n${leerSiExiste(archivoServidor)}`,
        );
      }
    }
    corriendo = true;
    registrar(`Postgres embebido escuchando en 127.0.0.1:${puerto}`);

    return {
      puerto,
      usuario,
      clave,
      async detener() {
        if (corriendo) {
          const codigo = await ejecutar(
            bin.pg_ctl,
            ['stop', '-D', datos, '-m', 'fast', '-w', '-t', '60'],
            archivoPgCtl,
          );
          if (codigo !== 0) detenerSincronico(bin, datos);
          corriendo = false;
        }
        process.removeListener('exit', alSalir);
        await borrarDirectorio(directorio);
      },
    };
  } catch (error) {
    alSalir();
    corriendo = false;
    process.removeListener('exit', alSalir);
    await borrarDirectorio(directorio).catch(() => undefined);
    throw error;
  }
}
