/**
 * Traduce cualquier error a una respuesta `errorApiSchema`. Nunca deja salir SQL, trazas ni mensajes
 * de la base: los de Postgres se convierten por código y nombre de restricción.
 */
import { HttpException } from '@nestjs/common';
import { ErrorDeContexto } from '@conecta/db';
import type { ErrorApi as CuerpoErrorApi } from '@conecta/shared';
import type { DatoRegistro } from '../comun/registro.js';
import { ErrorApi, errores } from './error-api.js';

export interface ErrorTraducido {
  estado: number;
  cuerpo: CuerpoErrorApi;
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

/** Busca el error de Postgres en la cadena de `cause` (Drizzle envuelve el de `pg`). */
function errorPostgresDe(error: unknown): ErrorPostgres | null {
  let actual: unknown = error;
  for (let i = 0; i < 5 && actual; i++) {
    if (esErrorPostgres(actual)) return actual;
    actual = (actual as { cause?: unknown }).cause;
  }
  return null;
}

/** Mensajes por restricción: lo que la persona tiene que corregir. */
const MENSAJES_RESTRICCION: Record<string, ErrorApi> = {
  sede_nombre_unico: errores.conflicto('Ya hay una sede con ese nombre. Elegí otro nombre.'),
  sillon_nombre_unico: errores.conflicto(
    'Esa sede ya tiene un sillón activo con ese nombre. Elegí otro nombre.',
  ),
  sede_horario_rango_check: errores.datosInvalidos(
    'La hora de cierre tiene que ser posterior a la de apertura.',
  ),
  sede_color_check: errores.datosInvalidos('Elegí un color válido (por ejemplo, #1A7F5A).'),
};

function traducirPostgres(error: ErrorPostgres): ErrorApi | null {
  const porRestriccion = error.constraint ? MENSAJES_RESTRICCION[error.constraint] : undefined;
  if (porRestriccion) return porRestriccion;
  switch (error.code) {
    case '23505':
      return errores.conflicto('Ya existe un registro con esos datos. Revisá y probá de nuevo.');
    case '23503':
      return errores.conflicto(
        'Algo de lo que elegiste ya no existe o no está disponible. Recargá la página y probá de nuevo.',
      );
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
      return errores.conflicto('Esa operación no está permitida sobre este registro.');
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

export function traducirError(error: unknown): ErrorTraducido {
  if (error instanceof ErrorApi) return { estado: error.estado, cuerpo: error.cuerpo() };

  const cuerpo = traducirCuerpo(error);
  if (cuerpo) return cuerpo;

  if (error instanceof HttpException) return traducirHttp(error);

  if (error instanceof ErrorDeContexto) {
    return {
      estado: 400,
      cuerpo: errores.datosInvalidos('El pedido tiene datos de contexto inválidos.').cuerpo(),
    };
  }

  const pg = errorPostgresDe(error);
  if (pg) {
    const traducido = traducirPostgres(pg);
    if (traducido) return { estado: traducido.estado, cuerpo: traducido.cuerpo() };
    return {
      estado: 500,
      cuerpo: errores.interno().cuerpo(),
      registrar: { tipo: 'postgres', codigoPg: pg.code, restriccion: pg.constraint ?? null },
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
