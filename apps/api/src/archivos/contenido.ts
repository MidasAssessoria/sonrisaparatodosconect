/**
 * Qué es un archivo según su CONTENIDO (nunca según la extensión ni lo que dice el navegador), su
 * tamaño en píxeles, y los nombres que se guardan y se devuelven al descargar.
 *
 *   PNG  89 50 4E 47 0D 0A 1A 0A, y el primer bloque es IHDR (ancho y alto).
 *   JPEG FF D8 FF, y un marcador SOF0..SOF15 (salvo DHT, JPG y DAC) con el alto y el ancho.
 *   WebP RIFF....WEBP con un bloque VP8, VP8L o VP8X (ancho y alto).
 *   PDF  %PDF-
 *   SVG  texto UTF-8 cuyo primer elemento es <svg>. Solo en las categorías que lo aceptan.
 *
 * SVG: se RECHAZA (no se sanea) todo lo que puede ejecutar código o traer contenido de afuera:
 * DOCTYPE/ENTITY, <script>, <foreignObject>, <iframe>, <embed>, <object>, <handler>, <animate*>,
 * <set>, <use>/<image>/<a>/<feImage> con referencias que no sean internas (#id), cualquier atributo
 * on* (onload, onclick…), href/xlink:href que no sea «#id», «javascript:»/«data:» en cualquier lado,
 * y url(...) o @import que no apunten a «#id». Rechazar es más simple de verificar que sanear y un
 * logo legítimo no necesita nada de eso. Además, el SVG nunca se sirve en línea (ver la descarga).
 */

export type TipoDetectado =
  'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | 'image/svg+xml';

export interface Analisis {
  tipo: TipoDetectado;
  ancho: number | null;
  alto: number | null;
}

/** El contenido no es de un tipo reconocido, o dice ser de un tipo y está roto. */
export class ContenidoInvalido extends Error {
  override name = 'ContenidoInvalido';
  constructor(readonly motivo: 'desconocido' | 'danado' | 'svg_inseguro') {
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

// ---------------------------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------------------------

const ELEMENTOS_PROHIBIDOS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'handler',
  'listener',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'discard',
  'audio',
  'video',
  'canvas',
  'meta',
  'link',
  'base',
]);

const REFERENCIA_INTERNA = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;

/** Decodifica UTF-8 estricto; null si no es UTF-8 válido o trae caracteres de control. */
function textoUtf8(b: Buffer): string | null {
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto)) return null;
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/** ¿El texto empieza (tras declaración XML y comentarios) con un elemento <svg>? */
function pareceSvg(texto: string): boolean {
  let resto = texto.trimStart();
  if (resto.startsWith('<?xml')) {
    const fin = resto.indexOf('?>');
    if (fin < 0) return false;
    resto = resto.slice(fin + 2).trimStart();
  }
  while (resto.startsWith('<!--')) {
    const fin = resto.indexOf('-->');
    if (fin < 0) return false;
    resto = resto.slice(fin + 3).trimStart();
  }
  return /^<svg[\s>/]/i.test(resto) || /^<!doctype\s+svg/i.test(resto);
}

/** Recorre las etiquetas respetando las comillas de los atributos. */
function* etiquetas(texto: string): Generator<string> {
  let i = 0;
  while (i < texto.length) {
    const inicio = texto.indexOf('<', i);
    if (inicio < 0) return;
    let j = inicio + 1;
    let comilla: string | null = null;
    while (j < texto.length) {
      const c = texto[j];
      if (comilla) {
        if (c === comilla) comilla = null;
      } else if (c === '"' || c === "'") {
        comilla = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    yield texto.slice(inicio + 1, j);
    i = j + 1;
  }
}

const PATRON_ATRIBUTO = /([^\s=/]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

function svgSeguro(texto: string): boolean {
  const minusculas = texto.toLowerCase();
  if (
    minusculas.includes('<!doctype') ||
    minusculas.includes('<!entity') ||
    minusculas.includes('javascript:') ||
    minusculas.includes('vbscript:') ||
    /(?:^|[\s"'(=,;])data\s*:/.test(minusculas) ||
    minusculas.includes('@import') ||
    minusculas.includes('<?xml-stylesheet')
  ) {
    return false;
  }
  // url(...) solo hacia un id interno: url(#degrade).
  for (const m of minusculas.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/g)) {
    if (!REFERENCIA_INTERNA.test((m[2] ?? '').trim())) return false;
  }
  for (const etiqueta of etiquetas(texto)) {
    if (etiqueta.startsWith('!--') || etiqueta.startsWith('?') || etiqueta.startsWith('/')) {
      // Comentario, instrucción de proceso o cierre: igual revisamos el nombre de cierre.
      if (etiqueta.startsWith('/')) {
        const nombre = /^\/\s*([^\s>]+)/.exec(etiqueta)?.[1]?.toLowerCase() ?? '';
        if (ELEMENTOS_PROHIBIDOS.has(nombre.replace(/^.*:/, ''))) return false;
      }
      if (etiqueta.startsWith('?') && !/^\?xml[\s?]/i.test(etiqueta)) return false;
      continue;
    }
    if (etiqueta.startsWith('!')) {
      // CDATA u otra declaración.
      if (!etiqueta.startsWith('![CDATA[')) return false;
      continue;
    }
    const apertura = /^\s*([^\s/>]+)/.exec(etiqueta);
    const nombre = apertura?.[1]?.toLowerCase() ?? '';
    const local = nombre.replace(/^.*:/, '');
    if (ELEMENTOS_PROHIBIDOS.has(local)) return false;
    const atributos = etiqueta.slice(apertura?.[0].length ?? 0);
    for (const m of atributos.matchAll(PATRON_ATRIBUTO)) {
      const atributo = (m[1] ?? '').toLowerCase();
      const localAtributo = atributo.replace(/^.*:/, '');
      if (localAtributo.startsWith('on')) return false;
      if (localAtributo === 'href' || localAtributo === 'src') {
        const valor = (m[2] ?? '').replace(/^["']|["']$/g, '').trim();
        if (!REFERENCIA_INTERNA.test(valor)) return false;
      }
    }
  }
  return true;
}

/**
 * Detecta el tipo por el contenido y lee ancho y alto de las imágenes. `aceptaSvg`: si la categoría
 * acepta SVG (si no, un SVG cuenta como tipo no reconocido). Lanza `ContenidoInvalido`.
 */
export function analizarContenido(b: Buffer, aceptaSvg: boolean): Analisis {
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
  if (aceptaSvg) {
    const texto = textoUtf8(b);
    if (texto !== null && pareceSvg(texto)) {
      if (!svgSeguro(texto)) throw new ContenidoInvalido('svg_inseguro');
      return { tipo: 'image/svg+xml', ancho: null, alto: null };
    }
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
