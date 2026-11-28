/**
 * La firma de la anamnesis llega como `data:image/png;base64,…` (contrato: `crearAnamnesisSchema`,
 * que ya exige el prefijo y el alfabeto base64). Acá se decodifica y se verifica que el CONTENIDO
 * sea de verdad un PNG con un trazo, diga lo que diga el prefijo (revisión de seguridad del
 * Sprint 4):
 *
 *   - tamaño: 1 byte a `CATEGORIAS_ARCHIVO.firma_paciente.maxBytes` (300 KB);
 *   - firma de bytes PNG y estructura completa: bloques con su largo, tipo y CRC-32 correcto. Solo
 *     IHDR (primero, una vez), PLTE, tRNS, IDAT (seguidos) e IEND (último, vacío y nada después):
 *     ni bloques privados, ni críticos desconocidos, ni texto, ni APNG (acTL/fcTL/fdAT);
 *   - IHDR: hasta `MAXIMO_LADO_FIRMA` px por lado y `MAXIMO_PIXELES_FIRMA` en total, profundidad
 *     válida para el tipo de color, sin entrelazado (un lienzo nunca lo produce);
 *   - la imagen se descomprime con un tope de salida (`maxOutputLength`): una «bomba» de
 *     compresión falla al llegar al tope, sin ocupar más memoria. El largo descomprimido tiene que
 *     ser exactamente el que exige el IHDR;
 *   - se aplican los filtros de fila y se cuentan los píxeles con tinta (visibles: alfa > 0 y no
 *     casi blancos). Con menos de `MINIMO_PIXELES_TRAZO` la firma está vacía: un lienzo
 *     transparente o en blanco no es una firma.
 */
import { crc32, inflateSync } from 'node:zlib';
import { CATEGORIAS_ARCHIVO } from '@conecta/shared';

export const MAXIMO_BYTES_FIRMA = CATEGORIAS_ARCHIVO.firma_paciente.maxBytes;

/** Lado máximo, en píxeles (contrato: hasta 2000 × 2000). La web exporta 900 px de ancho. */
export const MAXIMO_LADO_FIRMA = 2_000;

/** Tope de píxeles: acota la memoria de la imagen descomprimida (hasta 16 MB en RGBA de 16 bits). */
export const MAXIMO_PIXELES_FIRMA = 2_000_000;

/**
 * Píxeles con tinta que hacen falta para que haya firma. Un trazo corto a 900 px de ancho deja
 * cientos; 50 descarta un lienzo vacío o un punto suelto.
 */
export const MINIMO_PIXELES_TRAZO = 50;

/** Un canal por encima de esto (de 255) cuenta como blanco: tinta blanca no se ve en papel. */
const UMBRAL_BLANCO = 240;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PREFIJO = 'data:image/png;base64,';
const BLOQUES_PERMITIDOS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/** Muestras por píxel según el tipo de color. */
const CANALES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

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

interface Cabecera {
  ancho: number;
  alto: number;
  profundidad: number;
  color: number;
}

interface Bloques {
  cabecera: Cabecera;
  paleta: Buffer | null;
  transparencia: Buffer | null;
  datos: Buffer;
}

const noPng = () => new FirmaInvalida('no_png');

function leerCabecera(datos: Buffer): Cabecera {
  if (datos.length !== 13) throw noPng();
  const ancho = datos.readUInt32BE(0);
  const alto = datos.readUInt32BE(4);
  const profundidad = datos[8] ?? 0;
  const color = datos[9] ?? 0;
  const valida =
    ancho >= 1 &&
    alto >= 1 &&
    ancho <= MAXIMO_LADO_FIRMA &&
    alto <= MAXIMO_LADO_FIRMA &&
    ancho * alto <= MAXIMO_PIXELES_FIRMA &&
    (PROFUNDIDADES[color] ?? []).includes(profundidad) &&
    datos[10] === 0 && // compresión
    datos[11] === 0 && // filtro
    datos[12] === 0; // sin entrelazado
  if (!valida) throw noPng();
  return { ancho, alto, profundidad, color };
}

/** Recorre los bloques (largo, tipo, CRC, orden) y junta lo necesario para leer la imagen. */
function leerBloques(b: Buffer): Bloques {
  if (b.length < FIRMA_PNG.length || !b.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG)) {
    throw noPng();
  }
  let i = FIRMA_PNG.length;
  let cabecera: Cabecera | null = null;
  let paleta: Buffer | null = null;
  let transparencia: Buffer | null = null;
  const idat: Buffer[] = [];
  let anterior = '';
  while (i + 12 <= b.length) {
    const largo = b.readUInt32BE(i);
    const tipo = b.toString('latin1', i + 4, i + 8);
    if (largo > b.length - i - 12 || !BLOQUES_PERMITIDOS.has(tipo)) throw noPng();
    const datos = b.subarray(i + 8, i + 8 + largo);
    if (crc32(b.subarray(i + 4, i + 8 + largo)) !== b.readUInt32BE(i + 8 + largo)) throw noPng();
    i += 12 + largo;

    if ((cabecera === null) !== (tipo === 'IHDR')) throw noPng(); // IHDR primero y una sola vez
    switch (tipo) {
      case 'IHDR':
        cabecera = leerCabecera(datos);
        break;
      case 'PLTE':
        if (paleta || transparencia || idat.length > 0) throw noPng();
        if (largo === 0 || largo % 3 !== 0 || largo / 3 > 256) throw noPng();
        paleta = datos;
        break;
      case 'tRNS':
        if (transparencia || idat.length > 0) throw noPng();
        transparencia = datos;
        break;
      case 'IDAT':
        if (idat.length > 0 && anterior !== 'IDAT') throw noPng(); // IDAT seguidos
        idat.push(datos);
        break;
      case 'IEND':
        if (largo !== 0 || i !== b.length || idat.length === 0 || !cabecera) throw noPng();
        if (cabecera.color === 3 && !paleta) throw noPng();
        return { cabecera, paleta, transparencia, datos: Buffer.concat(idat) };
    }
    anterior = tipo;
  }
  throw noPng();
}

/** Bytes por fila (sin el byte de filtro) y bytes por píxel para los filtros. */
function medidas(c: Cabecera): { fila: number; porPixel: number } {
  const bits = (CANALES[c.color] ?? 1) * c.profundidad;
  return { fila: Math.ceil((c.ancho * bits) / 8), porPixel: Math.max(1, bits / 8) };
}

/** Deshace los filtros de fila (0 a 4): devuelve las filas sin su byte de filtro. */
function desfiltrar(crudo: Buffer, c: Cabecera): Buffer {
  const { fila, porPixel } = medidas(c);
  const salida = Buffer.alloc(fila * c.alto);
  for (let y = 0; y < c.alto; y++) {
    const filtro = crudo[y * (fila + 1)] ?? 0;
    const origen = y * (fila + 1) + 1;
    const destino = y * fila;
    for (let x = 0; x < fila; x++) {
      const valor = crudo[origen + x] ?? 0;
      const a = x >= porPixel ? (salida[destino + x - porPixel] ?? 0) : 0;
      const arriba = y > 0 ? (salida[destino - fila + x] ?? 0) : 0;
      const diagonal = y > 0 && x >= porPixel ? (salida[destino - fila + x - porPixel] ?? 0) : 0;
      let prediccion: number;
      switch (filtro) {
        case 0:
          prediccion = 0;
          break;
        case 1:
          prediccion = a;
          break;
        case 2:
          prediccion = arriba;
          break;
        case 3:
          prediccion = (a + arriba) >> 1;
          break;
        case 4: {
          const p = a + arriba - diagonal;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - arriba);
          const pc = Math.abs(p - diagonal);
          prediccion = pa <= pb && pa <= pc ? a : pb <= pc ? arriba : diagonal;
          break;
        }
        default:
          throw noPng();
      }
      salida[destino + x] = (valor + prediccion) & 0xff;
    }
  }
  return salida;
}

/** Muestra `n` de la fila (en la profundidad del IHDR, sin normalizar). */
function muestra(filas: Buffer, inicioFila: number, n: number, profundidad: number): number {
  if (profundidad === 8) return filas[inicioFila + n] ?? 0;
  if (profundidad === 16) return filas.readUInt16BE(inicioFila + n * 2);
  const porByte = 8 / profundidad;
  const byte = filas[inicioFila + Math.floor(n / porByte)] ?? 0;
  const corrimiento = 8 - profundidad * ((n % porByte) + 1);
  return (byte >> corrimiento) & ((1 << profundidad) - 1);
}

/** Cuenta píxeles con tinta (alfa > 0 y no casi blancos), hasta `tope`. */
function pixelesConTinta(filas: Buffer, c: Cabecera, b: Bloques, tope: number): number {
  const { fila } = medidas(c);
  const canales = CANALES[c.color] ?? 1;
  const maximo = (1 << c.profundidad) - 1;
  const a8 = (v: number) => Math.round((v * 255) / maximo);
  const trns = b.transparencia;
  let cuenta = 0;
  for (let y = 0; y < c.alto; y++) {
    const inicio = y * fila;
    for (let x = 0; x < c.ancho; x++) {
      const s = (k: number) => muestra(filas, inicio, x * canales + k, c.profundidad);
      let rgb: [number, number, number];
      let alfa = 255;
      switch (c.color) {
        case 0: {
          const gris = s(0);
          if (trns && trns.length >= 2 && gris === trns.readUInt16BE(0)) alfa = 0;
          const g = a8(gris);
          rgb = [g, g, g];
          break;
        }
        case 2: {
          const [r, g, bl] = [s(0), s(1), s(2)];
          if (
            trns &&
            trns.length >= 6 &&
            r === trns.readUInt16BE(0) &&
            g === trns.readUInt16BE(2) &&
            bl === trns.readUInt16BE(4)
          ) {
            alfa = 0;
          }
          rgb = [a8(r), a8(g), a8(bl)];
          break;
        }
        case 3: {
          const indice = s(0);
          const paleta = b.paleta;
          if (!paleta || indice * 3 + 2 >= paleta.length) throw noPng();
          rgb = [paleta[indice * 3] ?? 0, paleta[indice * 3 + 1] ?? 0, paleta[indice * 3 + 2] ?? 0];
          if (trns && indice < trns.length) alfa = trns[indice] ?? 255;
          break;
        }
        case 4: {
          const g = a8(s(0));
          rgb = [g, g, g];
          alfa = a8(s(1));
          break;
        }
        default: {
          rgb = [a8(s(0)), a8(s(1)), a8(s(2))];
          alfa = a8(s(3));
        }
      }
      const blanco = rgb.every((v) => v >= UMBRAL_BLANCO);
      if (alfa > 0 && !blanco && ++cuenta >= tope) return cuenta;
    }
  }
  return cuenta;
}

/** Verifica la imagen y lanza `FirmaInvalida` (`no_png` o `vacia`) si algo no cierra. */
function verificarImagen(b: Buffer): { ancho: number; alto: number } {
  const bloques = leerBloques(b);
  const c = bloques.cabecera;
  const { fila } = medidas(c);
  const esperado = (fila + 1) * c.alto;
  let crudo: Buffer;
  try {
    // Un byte más que lo esperado: si la salida llega al tope, sobran datos (o es una bomba).
    crudo = inflateSync(bloques.datos, { maxOutputLength: esperado + 1 });
  } catch {
    throw noPng();
  }
  if (crudo.length !== esperado) throw noPng();
  const filas = desfiltrar(crudo, c);
  if (pixelesConTinta(filas, c, bloques, MINIMO_PIXELES_TRAZO) < MINIMO_PIXELES_TRAZO) {
    throw new FirmaInvalida('vacia');
  }
  return { ancho: c.ancho, alto: c.alto };
}

/** Decodifica el `data:` URL de la firma y verifica que sea un PNG real con trazo (ver arriba). */
export function decodificarFirma(dataUrl: string): FirmaDecodificada {
  if (!dataUrl.startsWith(PREFIJO)) throw noPng();
  const base64 = dataUrl.slice(PREFIJO.length);
  if (base64.length === 0) throw new FirmaInvalida('vacia');
  // Cota antes de decodificar: 4 caracteres base64 son 3 bytes.
  if (Math.floor((base64.length * 3) / 4) - 2 > MAXIMO_BYTES_FIRMA) {
    throw new FirmaInvalida('grande');
  }
  const contenido = Buffer.from(base64, 'base64');
  // Base64 canónico (con o sin relleno): lo que no vuelve igual tenía bits o relleno de más.
  if (contenido.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '')) {
    throw noPng();
  }
  if (contenido.length === 0) throw new FirmaInvalida('vacia');
  if (contenido.length > MAXIMO_BYTES_FIRMA) throw new FirmaInvalida('grande');
  return { contenido, ...verificarImagen(contenido) };
}
