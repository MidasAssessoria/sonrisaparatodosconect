/** Ayudas de las pruebas de archivos: contenidos de prueba, subidas y lectura de la cola. */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import type pg from 'pg';
import type { Config } from '../src/config.js';
import type { Prueba } from './ayudas.js';

export const SECRETO_PRUEBA = 'secreto-de-pruebas-de-archivos-0123456789abcdef';
export const BUCKET_PRUEBA = 'conecta-privado';

/** Config de archivos con un directorio temporal propio. */
export async function configLocal(): Promise<{
  archivos: Config['archivos'];
  borrar: () => Promise<void>;
}> {
  const directorio = await mkdtemp(path.join(tmpdir(), 'conecta-archivos-'));
  return {
    archivos: {
      almacen: 'local',
      directorio,
      bucket: BUCKET_PRUEBA,
      secretoFirma: SECRETO_PRUEBA,
    },
    borrar: () => rm(directorio, { recursive: true, force: true }),
  };
}

/** Archivos guardados en disco para una clínica (rutas relativas al bucket). */
export async function archivosEnDisco(directorio: string, clinicaId: string): Promise<string[]> {
  try {
    return (await readdir(path.join(directorio, BUCKET_PRUEBA, clinicaId))).sort();
  } catch {
    return [];
  }
}

/**
 * Escribe en el almacén local el contenido de un archivo creado con `crearArchivoDePrueba` (bucket
 * `pruebas`), para que la descarga lo encuentre.
 */
export async function escribirEnDisco(
  directorio: string,
  archivo: { ruta: string },
  contenido: Buffer = png(4, 4),
): Promise<void> {
  const camino = path.join(directorio, 'pruebas', ...archivo.ruta.split('/'));
  await mkdir(path.dirname(camino), { recursive: true });
  await writeFile(camino, contenido);
}

function bloque(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** PNG válido (gris, 8 bits) de ancho × alto, con `relleno` bytes extra de comentario. */
export function png(ancho: number, alto: number, relleno = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 0; // escala de grises
  const filas = Buffer.alloc((ancho + 1) * alto, 0x80);
  for (let y = 0; y < alto; y++) filas[y * (ancho + 1)] = 0;
  const partes = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(filas)),
  ];
  if (relleno > 0) partes.push(bloque('tEXt', Buffer.alloc(relleno, 0x61)));
  partes.push(bloque('IEND', Buffer.alloc(0)));
  return Buffer.concat(partes);
}

/** JPEG mínimo con APP0 y SOF0 (alcanza para leer el tamaño). */
export function jpeg(ancho: number, alto: number): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    alto >> 8,
    alto & 0xff,
    ancho >> 8,
    ancho & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** WebP con bloque VP8X (alcanza para leer el tamaño). */
export function webp(ancho: number, alto: number): Buffer {
  const vp8x = Buffer.alloc(18);
  vp8x.write('VP8X', 0, 'latin1');
  vp8x.writeUInt32LE(10, 4);
  vp8x.writeUIntLE(ancho - 1, 12, 3);
  vp8x.writeUIntLE(alto - 1, 15, 3);
  const cuerpo = Buffer.concat([Buffer.from('WEBP', 'latin1'), vp8x]);
  const cabecera = Buffer.alloc(8);
  cabecera.write('RIFF', 0, 'latin1');
  cabecera.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([cabecera, cuerpo]);
}

export const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1');

export const SVG_LIMPIO = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 64 64">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#1A7F5A"/></linearGradient></defs>
  <rect width="64" height="64" fill="url(#g)"/>
  <use xlink:href="#g"/>
  <text x="4" y="40">Sonrisa</text>
</svg>`,
  'utf8',
);

/** Subida multipart: `categoria` primero y el archivo después (salvo que se pida otro orden). */
export function subir(
  prueba: Prueba,
  token: string,
  categoria: string | null,
  contenido: Buffer | null,
  opciones: { nombre?: string; tipoDeclarado?: string; clinica?: string } = {},
) {
  let pedido = prueba.pedir('post', '/archivos', {
    token,
    ...(opciones.clinica ? { clinica: opciones.clinica } : {}),
  });
  if (categoria !== null) pedido = pedido.field('categoria', categoria);
  if (contenido !== null) {
    pedido = pedido.attach('archivo', contenido, {
      filename: opciones.nombre ?? 'imagen.png',
      contentType: opciones.tipoDeclarado ?? 'image/png',
    });
  }
  return pedido;
}

export interface TrabajoEnCola {
  id: string;
  state: string;
  data: unknown;
}

/** Trabajos `archivo.verificar` de un archivo (leídos como administración). */
export async function trabajosDe(admin: pg.Pool, archivoId: string): Promise<TrabajoEnCola[]> {
  const { rows } = await admin.query<TrabajoEnCola>(
    `select id, state::text as state, data from cola.job
     where name = 'archivo.verificar' and data->>'archivoId' = $1`,
    [archivoId],
  );
  return rows;
}

/** Trabajos `archivo.verificar` de una clínica. */
export async function trabajosDeClinica(
  admin: pg.Pool,
  clinicaId: string,
): Promise<TrabajoEnCola[]> {
  const { rows } = await admin.query<TrabajoEnCola>(
    `select id, state::text as state, data from cola.job
     where name = 'archivo.verificar' and data->>'clinicaId' = $1`,
    [clinicaId],
  );
  return rows;
}
