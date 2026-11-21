/**
 * Traduce cualquier error a una respuesta `errorApiSchema`. Nunca deja salir SQL, trazas ni mensajes
 * de la base: los de Postgres se convierten por código y nombre de restricción (también los nombres
 * de regla que la base pone en `constraint`, ver `RESTRICCIONES_ACCESO` de `@conecta/db`).
 */
import { HttpException } from '@nestjs/common';
import {
  ErrorDeContexto,
  ErrorDeMembresia,
  RESTRICCIONES_COLA,
  type RestriccionAcceso,
} from '@conecta/db';
import type { ErrorApi as CuerpoErrorApi } from '@conecta/shared';
import type { DatoRegistro } from '../comun/registro.js';
import { ErrorApi, errores } from './error-api.js';
import { MENSAJES_ARCHIVOS } from './restricciones/archivos.js';
import { MENSAJES_CATALOGOS } from './restricciones/catalogos.js';
import { MENSAJES_COLA } from './restricciones/cola.js';
import { MENSAJES_LIMITES, MENSAJES_LIMITES_COLUMNAS } from './restricciones/limites.js';
import { MENSAJES_PERSONAL } from './restricciones/personal.js';
import { MENSAJES_PROFESIONALES } from './restricciones/profesionales.js';

export interface ErrorTraducido {
  estado: number;
  cuerpo: CuerpoErrorApi;
  /** Cabeceras que acompañan la respuesta (p. ej. `Retry-After`). */
  cabeceras?: Readonly<Record<string, string>>;
  /** Datos para el registro cuando el error es inesperado (sin mensajes ni valores). */
  registrar?: Record<string, DatoRegistro>;
}

interface ErrorPostgres {
  code: string;
  constraint?: string | undefined;
  message: string;
}

function esErrorPostgres(valor: unknown): valor is ErrorPostgres {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return typeof v['code'] === 'string' && /^[0-9A-Z]{5}$/.test(v['code']) && 'severity' in v;
}

/** Recorre la cadena de `cause` (Drizzle envuelve el error de `pg`). */
function* cadena(error: unknown): Generator<unknown> {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual; i++) {
    yield actual;
    actual = typeof actual === 'object' ? (actual as { cause?: unknown }).cause : undefined;
  }
}

function errorPostgresDe(error: unknown): ErrorPostgres | null {
  for (const e of cadena(error)) if (esErrorPostgres(e)) return e;
  return null;
}

/** Errores de red de Node al hablar con la base. */
const CODIGOS_RED = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
]);

/** Mensajes de `pg`/`pg-pool` cuando la conexión no se pudo abrir o se cortó (sin código). */
const MENSAJES_CONEXION =
  /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error|connection timeout/i;

/** Códigos de Postgres que dicen «la base no está disponible», no «tu pedido está mal». */
function esPostgresNoDisponible(codigo: string): boolean {
  return (
    codigo.startsWith('08') || // conexión
    codigo.startsWith('53') || // recursos (demasiadas conexiones, memoria, disco)
    codigo === '57P01' || // admin_shutdown
    codigo === '57P02' || // crash_shutdown
    codigo === '57P03' || // cannot_connect_now
    codigo === '57014' // query_canceled (statement_timeout)
  );
}

/** ¿La base de datos no responde (caída, sin conexiones, apagándose)? */
function esBaseNoDisponible(error: unknown): boolean {
  for (const e of cadena(error)) {
    if (esErrorPostgres(e)) return esPostgresNoDisponible(e.code);
    if (typeof e !== 'object' || e === null) continue;
    const codigo = (e as { code?: unknown }).code;
    if (typeof codigo === 'string' && CODIGOS_RED.has(codigo)) return true;
    if (e instanceof Error && MENSAJES_CONEXION.test(e.message)) return true;
  }
  return false;
}

/**
 * Único y FK que no tienen un mensaje propio responden lo mismo: con el id de un registro de otra
 * clínica, la base siempre dispara el FK compuesto (las únicas incluyen `clinica_id`), y la
 * respuesta no tiene que distinguir «eso ya existe» de «eso no existe».
 */
const MENSAJE_REFERENCIA =
  'No pudimos guardar el cambio: algún dato elegido ya está cargado o no está disponible en esta clínica. Recargá la página, revisá y probá de nuevo.';

/**
 * Reglas de acceso de la base (`app.proteger_acceso()`, sesiones, auditoría). Cada una con el
 * código del contrato y un mensaje que dice qué hacer, sin detalles internos.
 */
const MENSAJES_ACCESO: Record<RestriccionAcceso, () => ErrorApi> = {
  acceso_sin_actor: () =>
    errores.sinPermiso('Para hacer este cambio tenés que ingresar con tu usuario.'),
  acceso_sin_membresia: () =>
    errores.sinMembresia(
      'Para cambiar personal o roles tenés que ser miembro activo de esta clínica. Pedile a quien la administra que te habilite.',
    ),
  acceso_sin_permiso: () =>
    errores.sinPermiso(
      'Tu rol no tiene el permiso que hace falta para este cambio. Pedile acceso a quien administra la clínica.',
    ),
  acceso_propio: () =>
    errores.sinPermiso(
      'No podés cambiar tu propio acceso (tu membresía, tus sedes, tu rol ni sus permisos). Pedíselo a otra persona con permiso.',
    ),
  acceso_rol_dueno: () =>
    errores.sinPermiso(
      'Solo un dueño puede cambiar el acceso de otro dueño, y el rol Dueño/a no se modifica.',
    ),
  membresia_nace_pendiente: () =>
    errores.conflicto(
      'Una invitación queda pendiente hasta que la persona la acepta. Esperá a que la acepte y probá de nuevo.',
    ),
  rol_sistema: () =>
    errores.conflicto('Los roles de sistema ya vienen con la clínica. Creá un rol propio.'),
  membresia_ultimo_dueno: () =>
    errores.conflicto(
      'La clínica no puede quedarse sin dueño. Dale el rol Dueño/a a otra persona antes de hacer este cambio.',
    ),
  rol_dueno_activo: () =>
    errores.conflicto('El rol Dueño/a no se puede desactivar: la clínica se quedaría sin dueño.'),
  sesion_ajena: () => errores.noAutenticado('Tu sesión no es válida. Ingresá de nuevo.'),
  auditoria_sin_clinica: () =>
    errores.conflicto(
      'Este cambio no quedaría registrado en ninguna clínica. Elegí la clínica en la que trabajás y probá de nuevo.',
    ),
};

/**
 * Mensajes por restricción de datos: lo que la persona tiene que corregir. Algunos usan el mensaje
 * de la base para repetir un dato validado (p. ej. la lista de permisos que sobran, ver
 * restricciones/limites.ts); ninguno lo copia tal cual.
 */
const MENSAJES_RESTRICCION: Record<string, (error: ErrorPostgres) => ErrorApi> = {
  ...MENSAJES_ACCESO,
  // Revisión del Sprint 2: límites de quien administra (0015) y cola (0018).
  ...MENSAJES_LIMITES,
  ...MENSAJES_LIMITES_COLUMNAS,
  ...MENSAJES_COLA,
  // Sprint 2: un archivo por módulo, para que cada módulo agregue los suyos sin pisar a otro.
  ...MENSAJES_PERSONAL,
  ...MENSAJES_PROFESIONALES,
  ...MENSAJES_CATALOGOS,
  ...MENSAJES_ARCHIVOS,
  sede_nombre_unico: () => errores.conflicto('Ya hay una sede con ese nombre. Elegí otro nombre.'),
  sillon_nombre_unico: () =>
    errores.conflicto('Esa sede ya tiene un sillón activo con ese nombre. Elegí otro nombre.'),
  sede_horario_rango_check: () =>
    errores.datosInvalidos('La hora de cierre tiene que ser posterior a la de apertura.'),
  sede_color_check: () => errores.datosInvalidos('Elegí un color válido (por ejemplo, #1A7F5A).'),
};

/**
 * Restricciones que, si saltan, son un error de la API (no del pedido): se responden con su mensaje
 * y además se registran (sin el mensaje de la base).
 */
const RESTRICCIONES_INESPERADAS: ReadonlySet<string> = new Set(RESTRICCIONES_COLA);

function traducirPostgres(error: ErrorPostgres): ErrorApi | null {
  const porRestriccion =
    error.constraint && Object.hasOwn(MENSAJES_RESTRICCION, error.constraint)
      ? MENSAJES_RESTRICCION[error.constraint]
      : undefined;
  if (porRestriccion) return porRestriccion(error);
  if (esPostgresNoDisponible(error.code)) return errores.servicioNoDisponible();
  switch (error.code) {
    case '23505':
    case '23503':
      return errores.conflicto(MENSAJE_REFERENCIA);
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
    case '22001':
      return errores.datosInvalidos(
        'Algún dato no tiene el formato esperado. Revisalo y probá de nuevo.',
      );
    case '42501':
      // Una fila de otra clínica es invisible: para quien pregunta, no existe.
      if (/row-level security/i.test(error.message)) return errores.noEncontrado();
      return errores.sinPermiso('Esa operación no está permitida sobre este registro.');
    case '40001':
    case '40P01':
    case '55P03':
      return errores.conflicto(
        'Otra persona estaba cambiando lo mismo en este momento. Probá de nuevo.',
      );
    default:
      return null;
  }
}

/** Errores de los parsers de Express (cuerpo demasiado grande, JSON roto, codificación). */
function traducirCuerpo(error: unknown): ErrorTraducido | null {
  if (typeof error !== 'object' || error === null) return null;
  const tipo = (error as { type?: unknown }).type;
  if (typeof tipo !== 'string') return null;
  switch (tipo) {
    case 'entity.too.large':
      return {
        estado: 413,
        cuerpo: errores
          .datosInvalidos('Mandaste demasiados datos en un solo pedido. Achicá el contenido.')
          .cuerpo(),
      };
    case 'entity.parse.failed':
      return {
        estado: 400,
        cuerpo: errores
          .datosInvalidos('Los datos no llegaron en un JSON válido. Revisá el formato.')
          .cuerpo(),
      };
    case 'encoding.unsupported':
    case 'charset.unsupported':
    case 'entity.verify.failed':
    case 'request.aborted':
    case 'request.size.invalid':
    case 'stream.encoding.set':
    case 'parameters.too.many':
      return {
        estado: 400,
        cuerpo: errores
          .datosInvalidos('No pudimos leer los datos del pedido. Mandalos como JSON en UTF-8.')
          .cuerpo(),
      };
    default:
      return null;
  }
}

function traducirHttp(error: HttpException): ErrorTraducido {
  const estado = error.getStatus();
  const mapa: Record<number, ErrorApi> = {
    400: errores.datosInvalidos('El pedido no es válido. Revisá los datos y probá de nuevo.'),
    401: errores.noAutenticado(),
    403: errores.sinPermiso(),
    404: errores.noEncontrado('Esa dirección no existe en la API. Revisá la ruta.'),
    405: errores.noEncontrado('Esa dirección no existe en la API. Revisá la ruta.'),
    413: errores.datosInvalidos(
      'Mandaste demasiados datos en un solo pedido. Achicá el contenido.',
    ),
  };
  const traducido = mapa[estado];
  if (traducido) return { estado, cuerpo: traducido.cuerpo() };
  return {
    estado: estado >= 500 ? estado : 400,
    cuerpo: (estado >= 500
      ? errores.interno()
      : errores.datosInvalidos('El pedido no es válido.')
    ).cuerpo(),
    ...(estado >= 500 ? { registrar: { tipo: 'HttpException', estado } } : {}),
  };
}

function desdeErrorApi(error: ErrorApi): ErrorTraducido {
  return {
    estado: error.estado,
    cuerpo: error.cuerpo(),
    ...(error.cabeceras ? { cabeceras: error.cabeceras } : {}),
  };
}

export function traducirError(error: unknown): ErrorTraducido {
  if (error instanceof ErrorApi) return desdeErrorApi(error);

  const cuerpo = traducirCuerpo(error);
  if (cuerpo) return cuerpo;

  if (error instanceof HttpException) return traducirHttp(error);

  if (error instanceof ErrorDeMembresia) {
    return desdeErrorApi(
      error.motivo === 'clinica_inactiva'
        ? errores.sinMembresia(
            'Esta clínica está dada de baja. Si creés que es un error, hablá con quien la administra.',
          )
        : errores.sinMembresia(),
    );
  }

  if (error instanceof ErrorDeContexto) {
    return {
      estado: 400,
      cuerpo: errores.datosInvalidos('El pedido tiene datos de contexto inválidos.').cuerpo(),
    };
  }

  const pg = errorPostgresDe(error);
  if (pg) {
    const traducido = traducirPostgres(pg);
    if (traducido) {
      return {
        ...desdeErrorApi(traducido),
        ...(traducido.estado === 503
          ? { registrar: { tipo: 'base_no_disponible', codigoPg: pg.code } }
          : {}),
        ...(pg.constraint && RESTRICCIONES_INESPERADAS.has(pg.constraint)
          ? { registrar: { tipo: 'postgres', codigoPg: pg.code, restriccion: pg.constraint } }
          : {}),
      };
    }
    return {
      estado: 500,
      cuerpo: errores.interno().cuerpo(),
      registrar: { tipo: 'postgres', codigoPg: pg.code, restriccion: pg.constraint ?? null },
    };
  }

  if (esBaseNoDisponible(error)) {
    return {
      ...desdeErrorApi(errores.servicioNoDisponible()),
      registrar: { tipo: 'base_no_disponible', codigoPg: null },
    };
  }

  // Solo el nombre de la clase y los marcos de la traza: el mensaje (que puede ocupar varias
  // líneas, como el de Drizzle con la consulta y sus parámetros) nunca se registra.
  const nombre = error instanceof Error ? error.name : typeof error;
  const traza =
    error instanceof Error && error.stack
      ? error.stack
          .split('\n')
          .filter((linea) => /^\s+at /.test(linea))
          .slice(0, 8)
          .join('\n')
      : null;
  return {
    estado: 500,
    cuerpo: errores.interno().cuerpo(),
    registrar: { tipo: nombre, traza },
  };
}
