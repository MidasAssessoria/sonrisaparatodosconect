/**
 * Qué es un archivo según su CONTENIDO (nunca según la extensión ni lo que dice el navegador), su
 * tamaño en píxeles, y los nombres que se guardan y se devuelven al descargar.
 *
 *   PNG  89 50 4E 47 0D 0A 1A 0A, y el primer bloque es IHDR (ancho y alto).
 *   JPEG FF D8 FF, y un marcador SOF0..SOF15 (salvo DHT, JPG y DAC) con el alto y el ancho.
 *   WebP RIFF....WEBP con un bloque VP8, VP8L o VP8X (ancho y alto).
 *   PDF  %PDF-
 *
 * SVG no se reconoce en ninguna categoría (revisión de seguridad del Sprint 2): un SVG es texto que
 * puede ejecutar código, y ningún archivo del producto lo necesita. Cuenta como tipo desconocido.
 */

export type TipoDetectado = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export interface Analisis {
  tipo: TipoDetectado;
  ancho: number | null;
  alto: number | null;
}

/** El contenido no es de un tipo reconocido, o dice ser de un tipo y está roto. */
export class ContenidoInvalido extends Error {
  override name = 'ContenidoInvalido';
  constructor(readonly motivo: 'desconocido' | 'danado') {
    super(motivo);
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAXIMO_PIXELES_LADO = 30_000;

function dimensiones(ancho: number, alto: number): { ancho: number; alto: number } {
  if (ancho < 1 || alto < 1 || ancho > MAXIMO_PIXELES_LADO || alto > MAXIMO_PIXELES_LADO) {
    throw new ContenidoInvalido('danado');
  }
  return { ancho, alto };
}

function analizarPng(b: Buffer): Analisis {
  // Firma (8) + largo (4) + "IHDR" (4) + ancho (4) + alto (4).
  if (b.length < 33 || b.toString('latin1', 12, 16) !== 'IHDR')
    throw new ContenidoInvalido('danado');
  return { tipo: 'image/png', ...dimensiones(b.readUInt32BE(16), b.readUInt32BE(20)) };
}

function analizarJpeg(b: Buffer): Analisis {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new ContenidoInvalido('danado');
    const marcador = b[i + 1] ?? 0;
    if (marcador === 0xff) {
      i += 1; // relleno
      continue;
    }
    // Marcadores sin largo: TEM y RST0..RST7.
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) break; // fin de imagen o inicio de datos
    const largo = b.readUInt16BE(i + 2);
    if (largo < 2) throw new ContenidoInvalido('danado');
    const esSof =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc;
    if (esSof) {
      if (i + 9 > b.length) throw new ContenidoInvalido('danado');
      return { tipo: 'image/jpeg', ...dimensiones(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)) };
    }
    i += 2 + largo;
  }
  throw new ContenidoInvalido('danado');
}

function analizarWebp(b: Buffer): Analisis {
  if (b.length < 30) throw new ContenidoInvalido('danado');
  const bloque = b.toString('latin1', 12, 16);
  if (bloque === 'VP8 ') {
    // Cuadro clave: 3 bytes de etiqueta, firma 9D 01 2A, ancho y alto de 14 bits.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) throw new ContenidoInvalido('danado');
    return {
      tipo: 'image/webp',
      ...dimensiones(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff),
    };
  }
  if (bloque === 'VP8L') {
    if (b[20] !== 0x2f) throw new ContenidoInvalido('danado');
    const bits = b.readUInt32LE(21);
    return {
      tipo: 'image/webp',
      ...dimensiones((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1),
    };
  }
  if (bloque === 'VP8X') {
    const ancho = (b.readUIntLE(24, 3) & 0xffffff) + 1;
    const alto = (b.readUIntLE(27, 3) & 0xffffff) + 1;
    return { tipo: 'image/webp', ...dimensiones(ancho, alto) };
  }
  throw new ContenidoInvalido('danado');
}

/**
 * Detecta el tipo por el contenido y lee ancho y alto de las imágenes. Lanza `ContenidoInvalido`
 * (un SVG, como cualquier texto, es `desconocido`).
 */
export function analizarContenido(b: Buffer): Analisis {
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG)) return analizarPng(b);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return analizarJpeg(b);
  if (
    b.length >= 12 &&
    b.toString('latin1', 0, 4) === 'RIFF' &&
    b.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return analizarWebp(b);
  }
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') {
    return { tipo: 'application/pdf', ancho: null, alto: null };
  }
  throw new ContenidoInvalido('desconocido');
}

// ---------------------------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------------------------

/**
 * Nombre original que se guarda: sin carpetas, sin caracteres de control, NFC, recortado y de
 * hasta 255 caracteres. Nunca se usa para la ruta en el almacén (la ruta es `<clinica>/<uuid>`).
 */
export function sanearNombre(nombre: string | undefined): string {
  const base = (nombre ?? '').normalize('NFC').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const limpio = base.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').trim();
  const recortado = Array.from(limpio).slice(0, 200).join('');
  return recortado === '' || recortado === '.' || recortado === '..' ? 'archivo' : recortado;
}

/** `Content-Disposition: attachment` con el nombre saneado (ASCII de respaldo + RFC 5987). */
export function disposicionAdjunto(nombre: string): string {
  const saneado = sanearNombre(nombre);
  const ascii =
    saneado
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._ -]/g, '_')
      .trim() || 'archivo';
  const codificado = encodeURIComponent(saneado).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${codificado}`;
}
