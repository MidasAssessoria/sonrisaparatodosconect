/** Ayudas de las pruebas de anamnesis (Sprint 4). Las generales están en `ayudas.ts`. */
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { anamnesisSchema, catalogoPreguntasSchema, type Anamnesis } from '@conecta/shared';
import { png } from './archivos-ayudas.js';
import { comoSistema, segun, type Prueba } from './ayudas.js';

/** `data:` URL de un PNG (por defecto, uno válido de 40 × 20). */
export function firmaDataUrl(contenido: Buffer = png(40, 20)): string {
  return `data:image/png;base64,${contenido.toString('base64')}`;
}

/** Bloque PNG con su largo y su CRC. */
export function bloquePng(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

export const FIRMA_BYTES_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR (sin entrelazado). */
export function ihdr(ancho: number, alto: number, color = 6, profundidad = 8): Buffer {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(ancho, 0);
  d.writeUInt32BE(alto, 4);
  d[8] = profundidad;
  d[9] = color;
  return bloquePng('IHDR', d);
}

/**
 * PNG RGBA de 8 bits armado a mano: `pixel(x, y)` devuelve [r, g, b, a]. `antesDeIdat` y
 * `idat` permiten meter bloques de más o un IDAT a medida (para las pruebas de rechazo).
 */
export function pngRgba(
  ancho: number,
  alto: number,
  pixel: (x: number, y: number) => [number, number, number, number],
  opciones: { antesDeIdat?: Buffer[]; idat?: Buffer } = {},
): Buffer {
  const filas = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const inicio = y * (ancho * 4 + 1);
    filas[inicio] = 0;
    for (let x = 0; x < ancho; x++) {
      const [r, g, b, a] = pixel(x, y);
      filas.set([r, g, b, a], inicio + 1 + x * 4);
    }
  }
  return Buffer.concat([
    FIRMA_BYTES_PNG,
    ihdr(ancho, alto),
    ...(opciones.antesDeIdat ?? []),
    bloquePng('IDAT', opciones.idat ?? deflateSync(filas)),
    bloquePng('IEND', Buffer.alloc(0)),
  ]);
}

/** Trazo negro sobre fondo transparente (como exporta la web): una franja de 3 px. */
export function pngTrazo(ancho = 300, alto = 100): Buffer {
  return pngRgba(ancho, alto, (x, y) =>
    Math.abs(y - Math.floor((x * alto) / ancho)) <= 1 ? [20, 20, 30, 255] : [0, 0, 0, 0],
  );
}

/** Lienzo vacío: todo transparente. */
export function pngTransparente(ancho = 900, alto = 200): Buffer {
  return pngRgba(ancho, alto, () => [0, 0, 0, 0]);
}

/** Ruido opaco (no se comprime): para pasar del tamaño máximo con un PNG válido. */
export function pngRuido(ancho: number, alto: number): Buffer {
  const ruido = randomBytes(ancho * alto * 3);
  return pngRgba(ancho, alto, (x, y) => {
    const i = (y * ancho + x) * 3;
    return [ruido[i] ?? 0, ruido[i + 1] ?? 0, ruido[i + 2] ?? 0, 255];
  });
}

/** Huella del cuestionario activo, como la recibe el formulario. */
export async function huellaDe(prueba: Prueba, token: string): Promise<string> {
  const respuesta = await prueba.pedir('get', '/anamnesis/preguntas', { token }).expect(200);
  return segun(catalogoPreguntasSchema, respuesta.body).huella;
}

/** Cuerpo de `POST /pacientes/:id/anamnesis` válido para un adulto, con lo que se pise. */
export function cuerpoAnamnesis(
  huellaCatalogo: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    versionBase: null,
    huellaCatalogo,
    respuestas: [],
    firmante: { nombre: 'Ana Benítez', ci: null, esTutor: false },
    firmaPng: firmaDataUrl(),
    declaracionVeracidad: true,
    ...extra,
  };
}

/** Respuesta con alergia a la penicilina y su detalle (genera una alerta médica). */
export const ALERGIA_PENICILINA = {
  codigo: 'alergias',
  opciones: ['penicilina'],
  detalle: 'urticaria con amoxicilina',
};

/** Guarda una versión por la API (201) y la devuelve validada contra el contrato. */
export async function guardarApi(
  prueba: Prueba,
  token: string,
  pacienteId: string,
  extra: Record<string, unknown> = {},
): Promise<Anamnesis> {
  const huella = await huellaDe(prueba, token);
  const respuesta = await prueba.pedir('post', `/pacientes/${pacienteId}/anamnesis`, {
    token,
    cuerpo: cuerpoAnamnesis(huella, extra),
  });
  if (respuesta.status !== 201)
    throw new Error(`Guardar: ${String(respuesta.status)} ${JSON.stringify(respuesta.body)}`);
  return segun(anamnesisSchema, respuesta.body);
}

/** Archivos `firma_paciente` de un paciente (como administración). */
export async function firmasDe(
  prueba: Prueba,
  clinicaId: string,
  pacienteId: string,
): Promise<{ id: string; ruta: string; sha256: string; bytes: string }[]> {
  const { rows } = await comoSistema<{ id: string; ruta: string; sha256: string; bytes: string }>(
    prueba.admin,
    clinicaId,
    `select id, ruta, sha256, bytes::text as bytes from app.archivo
     where clinica_id = $1 and paciente_id = $2 and categoria = 'firma_paciente'`,
    [clinicaId, pacienteId],
  );
  return rows;
}

/** Versiones guardadas de un paciente (como administración). */
export async function versionesDe(
  prueba: Prueba,
  clinicaId: string,
  pacienteId: string,
): Promise<number[]> {
  const { rows } = await comoSistema<{ version: number }>(
    prueba.admin,
    clinicaId,
    'select version from app.anamnesis where clinica_id = $1 and paciente_id = $2 order by version',
    [clinicaId, pacienteId],
  );
  return rows.map((r) => r.version);
}

/** Token de la URL firmada del almacén local (`…/archivos/descarga?t=<token>`). */
export function tokenDeUrl(url: string): string {
  const token = new URL(url).searchParams.get('t');
  if (!token) throw new Error('La URL no trae token.');
  return token;
}

/** Vencimiento (segundos desde la época) que lleva un token del almacén local. */
export function vencimientoDe(token: string): number {
  const [parte] = token.split('.');
  const datos = JSON.parse(Buffer.from(parte ?? '', 'base64url').toString('utf8')) as {
    e: number;
  };
  return datos.e;
}
