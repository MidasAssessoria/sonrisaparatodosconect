/**
 * La firma de la anamnesis llega como `data:image/png;base64,…` (contrato: `crearAnamnesisSchema`,
 * que ya exige el prefijo y el alfabeto base64). Acá se decodifica y se verifica que el CONTENIDO
 * sea de verdad un PNG, diga lo que diga el prefijo:
 *
 *   - tamaño: 1 byte a `CATEGORIAS_ARCHIVO.firma_paciente.maxBytes` (300 KB);
 *   - firma de bytes PNG (89 50 4E 47 0D 0A 1A 0A) y estructura completa: bloques con su largo,
 *     tipo de 4 letras ASCII y CRC-32 correcto; IHDR primero (13 bytes, ancho y alto dentro del
 *     límite, profundidad y tipo de color válidos), al menos un IDAT, IEND último y nada después.
 *
 * Un SVG, un JPEG, un HTML o cualquier otra cosa con el prefijo `image/png` no pasa: no empieza con
 * la firma PNG. No se decodifican los píxeles (no hace falta para guardarla y evita que una imagen
 * «bomba» de compresión consuma memoria): la imagen solo se entrega como descarga con `nosniff`.
 */
import { crc32 } from 'node:zlib';
import { CATEGORIAS_ARCHIVO } from '@conecta/shared';

export const MAXIMO_BYTES_FIRMA = CATEGORIAS_ARCHIVO.firma_paciente.maxBytes;

/** Lado máximo, en píxeles, de la imagen de una firma (una pantalla de tablet con densidad 3). */
export const MAXIMO_LADO_FIRMA = 8_000;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PREFIJO = 'data:image/png;base64,';

/** Profundidades válidas por tipo de color (especificación PNG, tabla 11.1). */
const PROFUNDIDADES: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

export type MotivoFirmaInvalida = 'vacia' | 'grande' | 'no_png';

export class FirmaInvalida extends Error {
  override name = 'FirmaInvalida';
  constructor(readonly motivo: MotivoFirmaInvalida) {
    super(motivo);
  }
}

export interface FirmaDecodificada {
  contenido: Buffer;
  ancho: number;
  alto: number;
}

/** Recorre los bloques del PNG y lanza `FirmaInvalida('no_png')` si algo no cierra. */
function verificarEstructura(b: Buffer): { ancho: number; alto: number } {
  if (b.length < FIRMA_PNG.length || !b.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG)) {
    throw new FirmaInvalida('no_png');
  }
  let i = FIRMA_PNG.length;
  let dimensiones: { ancho: number; alto: number } | null = null;
  let conDatos = false;
  let primero = true;
  while (i < b.length) {
    if (i + 12 > b.length) throw new FirmaInvalida('no_png');
    const largo = b.readUInt32BE(i);
    const tipo = b.toString('latin1', i + 4, i + 8);
    if (!/^[A-Za-z]{4}$/.test(tipo) || largo > b.length - i - 12) {
      throw new FirmaInvalida('no_png');
    }
    const datos = b.subarray(i + 8, i + 8 + largo);
    const crc = b.readUInt32BE(i + 8 + largo);
    if (crc32(b.subarray(i + 4, i + 8 + largo)) !== crc) throw new FirmaInvalida('no_png');

    if (primero) {
      if (tipo !== 'IHDR' || largo !== 13) throw new FirmaInvalida('no_png');
      const ancho = datos.readUInt32BE(0);
      const alto = datos.readUInt32BE(4);
      const profundidad = datos[8] ?? 0;
      const color = datos[9] ?? 0;
      const valido =
        ancho >= 1 &&
        alto >= 1 &&
        ancho <= MAXIMO_LADO_FIRMA &&
        alto <= MAXIMO_LADO_FIRMA &&
        (PROFUNDIDADES[color] ?? []).includes(profundidad) &&
        datos[10] === 0 && // compresión
        datos[11] === 0 && // filtro
        (datos[12] === 0 || datos[12] === 1); // entrelazado
      if (!valido) throw new FirmaInvalida('no_png');
      dimensiones = { ancho, alto };
      primero = false;
    } else if (tipo === 'IHDR') {
      throw new FirmaInvalida('no_png');
    }
    if (tipo === 'IDAT') conDatos = true;
    i += 12 + largo;
    if (tipo === 'IEND') {
      // IEND vacío, último, y nada después (nada escondido detrás de la imagen).
      if (largo !== 0 || i !== b.length || !conDatos || !dimensiones) {
        throw new FirmaInvalida('no_png');
      }
      return dimensiones;
    }
  }
  throw new FirmaInvalida('no_png');
}

/** Decodifica el `data:` URL de la firma y verifica que sea un PNG real (ver arriba). */
export function decodificarFirma(dataUrl: string): FirmaDecodificada {
  if (!dataUrl.startsWith(PREFIJO)) throw new FirmaInvalida('no_png');
  const base64 = dataUrl.slice(PREFIJO.length);
  if (base64.length === 0) throw new FirmaInvalida('vacia');
  // Cota antes de decodificar: 4 caracteres base64 son 3 bytes.
  if (Math.floor((base64.length * 3) / 4) - 2 > MAXIMO_BYTES_FIRMA) {
    throw new FirmaInvalida('grande');
  }
  const contenido = Buffer.from(base64, 'base64');
  // Base64 canónico (con o sin relleno): lo que no vuelve igual tenía bits o relleno de más.
  if (contenido.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
    throw new FirmaInvalida('no_png');
  }
  if (contenido.length === 0) throw new FirmaInvalida('vacia');
  if (contenido.length > MAXIMO_BYTES_FIRMA) throw new FirmaInvalida('grande');
  return { contenido, ...verificarEstructura(contenido) };
}
