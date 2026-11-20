/**
 * Cursor opaco de la auditoría: base64url de `[fecha, id]` del último elemento de la página.
 * La fecha va como texto con microsegundos (la de Postgres), así el orden (fecha, id) es estable
 * aunque varios registros compartan el mismo milisegundo.
 */
import { idSchema } from '@conecta/shared';
import { errores } from '../errores/error-api.js';

export interface PosicionCursor {
  fecha: string;
  id: string;
}

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function codificarCursor(posicion: PosicionCursor): string {
  return Buffer.from(JSON.stringify([posicion.fecha, posicion.id]), 'utf8').toString('base64url');
}

export function decodificarCursor(cursor: string): PosicionCursor {
  const invalido = () =>
    errores.datosInvalidos('La página pedida no es válida. Volvé a la primera página.', [
      { campo: 'cursor', mensaje: 'El cursor no es válido.' },
    ]);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw invalido();
  let valor: unknown;
  try {
    valor = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalido();
  }
  if (!Array.isArray(valor) || valor.length !== 2) throw invalido();
  const [fecha, id] = valor as unknown[];
  if (typeof fecha !== 'string' || !PATRON_FECHA.test(fecha)) throw invalido();
  const uuid = idSchema.safeParse(id);
  if (!uuid.success) throw invalido();
  return { fecha, id: uuid.data.toLowerCase() };
}
