/**
 * Errores de la anamnesis sin base: la verificación del PNG de la firma y la traducción de cada
 * regla de `RESTRICCIONES_ANAMNESIS` (lista exhaustiva) con su estado, código y campo.
 */
import { crc32, deflateSync } from 'node:zlib';
import { DEMO, RESTRICCIONES_ANAMNESIS } from '@conecta/db';
import { describe, expect, it } from 'vitest';
import {
  decodificarFirma,
  FirmaInvalida,
  MAXIMO_BYTES_FIRMA,
  MAXIMO_LADO_FIRMA,
  MINIMO_PIXELES_TRAZO,
} from '../src/anamnesis/firma-png.js';
import {
  errorDeAnamnesis,
  MENSAJE_CONFLICTO_CATALOGO,
  MENSAJE_CONFLICTO_VERSION,
  MENSAJES_ANAMNESIS,
} from '../src/errores/restricciones/anamnesis.js';
import { traducirError } from '../src/errores/traducir.js';
import {
  bloquePng,
  FIRMA_BYTES_PNG,
  ihdr,
  pngRgba,
  pngTransparente,
  pngTrazo,
} from './anamnesis-ayudas.js';
import { jpeg, png, SVG_LIMPIO } from './archivos-ayudas.js';

const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;

function motivo(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof FirmaInvalida) return error.motivo;
    throw error;
  }
}

/** Error como lo entrega node-postgres (con `severity`, `constraint` y `column`). */
function errorPg(codigo: string, restriccion: string | null, columna: string | null = null) {
  return Object.assign(new Error('mensaje de la base con datos'), {
    code: codigo,
    severity: 'ERROR',
    ...(restriccion ? { constraint: restriccion } : {}),
    ...(columna ? { column: columna } : {}),
  });
}

/** Un byte por canal: [r, g, b, a] de cada píxel de la fila, sin filtro. */
function filaRgba(pixeles: [number, number, number, number][]): Buffer {
  return Buffer.from(pixeles.flat());
}

/** Aplica el filtro `tipo` (0..4) a una fila RGBA de 8 bits, como un codificador PNG. */
function filtrar(tipo: number, fila: Buffer, previa: Buffer | null): Buffer {
  const salida = Buffer.alloc(fila.length + 1);
  salida[0] = tipo;
  for (let x = 0; x < fila.length; x++) {
    const a = x >= 4 ? (fila[x - 4] ?? 0) : 0;
    const b = previa ? (previa[x] ?? 0) : 0;
    const c = previa && x >= 4 ? (previa[x - 4] ?? 0) : 0;
    let pr = 0;
    if (tipo === 1) pr = a;
    else if (tipo === 2) pr = b;
    else if (tipo === 3) pr = (a + b) >> 1;
    else if (tipo === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    salida[x + 1] = ((fila[x] ?? 0) - pr) & 0xff;
  }
  return salida;
}

/** PNG RGBA 64 × 16 con `tinta` píxeles negros opacos, filas filtradas con 0..4 rotando. */
function pngFiltrado(tinta: number): Buffer {
  const ancho = 64;
  const alto = 16;
  const filas: Buffer[] = [];
  let previa: Buffer | null = null;
  let puestos = 0;
  for (let y = 0; y < alto; y++) {
    const pixeles: [number, number, number, number][] = [];
    for (let x = 0; x < ancho; x++) {
      const conTinta = (x + y) % 3 === 0 && puestos < tinta;
      if (conTinta) puestos++;
      // El fondo transparente lleva color: así un error al deshacer filtros se notaría.
      pixeles.push(conTinta ? [10, 10, 10, 255] : [200, 30, (x * 7) & 0xff, 0]);
    }
    const fila = filaRgba(pixeles);
    filas.push(filtrar(y % 5, fila, previa));
    previa = fila;
  }
  return Buffer.concat([
    FIRMA_BYTES_PNG,
    ihdr(ancho, alto),
    bloquePng('IDAT', deflateSync(Buffer.concat(filas))),
    bloquePng('IEND', Buffer.alloc(0)),
  ]);
}

/** PNG de paleta de 2 bits: índice 0 transparente (tRNS), 1 negro. */
function pngPaleta(tinta: number): Buffer {
  const ancho = 40;
  const alto = 10;
  const porFila = Math.ceil((ancho * 2) / 8);
  const crudo = Buffer.alloc((porFila + 1) * alto);
  let puestos = 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (puestos >= tinta) break;
      const byte = y * (porFila + 1) + 1 + Math.floor(x / 4);
      crudo[byte] = (crudo[byte] ?? 0) | (1 << (6 - 2 * (x % 4)));
      puestos++;
    }
  }
  return Buffer.concat([
    FIRMA_BYTES_PNG,
    ihdr(ancho, alto, 3, 2),
    bloquePng('PLTE', Buffer.from([255, 255, 255, 0, 0, 0])),
    bloquePng('tRNS', Buffer.from([0])),
    bloquePng('IDAT', deflateSync(crudo)),
    bloquePng('IEND', Buffer.alloc(0)),
  ]);
}

describe('firma PNG', () => {
  it('acepta un PNG real con trazo y devuelve su tamaño', () => {
    const contenido = png(120, 40);
    expect(decodificarFirma(url(contenido))).toEqual({ contenido, ancho: 120, alto: 40 });
    // Sin relleno base64 también.
    expect(decodificarFirma(url(png(20, 5)).replace(/=+$/, '')).ancho).toBe(20);
    expect(decodificarFirma(url(pngTrazo())).ancho).toBe(300);
  });

  it('deshace los filtros de fila (0 a 4) antes de contar la tinta', () => {
    expect(motivo(() => decodificarFirma(url(pngFiltrado(MINIMO_PIXELES_TRAZO))))).toBeNull();
    expect(motivo(() => decodificarFirma(url(pngFiltrado(MINIMO_PIXELES_TRAZO - 1))))).toBe(
      'vacia',
    );
  });

  it('paleta con transparencia (tRNS) y profundidad de 2 bits', () => {
    expect(motivo(() => decodificarFirma(url(pngPaleta(MINIMO_PIXELES_TRAZO))))).toBeNull();
    expect(motivo(() => decodificarFirma(url(pngPaleta(MINIMO_PIXELES_TRAZO - 1))))).toBe('vacia');
  });

  it('firma vacía: lienzo transparente de 900 × 200, PNG 1×1 de la demo, blanco opaco', () => {
    expect(motivo(() => decodificarFirma(url(pngTransparente(900, 200))))).toBe('vacia');
    expect(motivo(() => decodificarFirma(`data:image/png;base64,${DEMO.firmaPngBase64}`))).toBe(
      'vacia',
    );
    expect(motivo(() => decodificarFirma(url(pngRgba(300, 100, () => [255, 255, 255, 255]))))).toBe(
      'vacia',
    );
    expect(motivo(() => decodificarFirma('data:image/png;base64,'))).toBe('vacia');
  });

  it('rechaza lo que no es PNG aunque el prefijo diga image/png', () => {
    expect(motivo(() => decodificarFirma(url(SVG_LIMPIO)))).toBe('no_png');
    expect(motivo(() => decodificarFirma(url(jpeg(10, 10))))).toBe('no_png');
    expect(motivo(() => decodificarFirma('data:image/svg+xml;base64,AAAA'))).toBe('no_png');
    expect(motivo(() => decodificarFirma(url(png(10, 10).subarray(0, 40))))).toBe('no_png');
  });

  it('rechaza bombas, lados grandes, bloques no permitidos, APNG e IDAT que no es zlib', () => {
    const negro = () => [0, 0, 0, 255] as [number, number, number, number];
    const bomba = Buffer.concat([
      FIRMA_BYTES_PNG,
      ihdr(8000, 8000),
      bloquePng('IDAT', deflateSync(Buffer.alloc(16 * 1024 * 1024), { level: 9 })),
      bloquePng('IEND', Buffer.alloc(0)),
    ]);
    expect(bomba.length).toBeLessThan(MAXIMO_BYTES_FIRMA);
    const inflado = pngRgba(10, 10, negro, {
      idat: deflateSync(Buffer.alloc(64 * 1024 * 1024), { level: 9 }),
    });
    const corto = pngRgba(10, 10, negro, { idat: deflateSync(Buffer.alloc(100)) });
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(1, 0);
    const casos: Buffer[] = [
      bomba,
      inflado,
      corto,
      pngRgba(MAXIMO_LADO_FIRMA + 1, 1, negro),
      pngRgba(60, 20, negro, { antesDeIdat: [bloquePng('acTL', actl)] }),
      pngRgba(60, 20, negro, { antesDeIdat: [bloquePng('prVt', Buffer.from('x'))] }),
      pngRgba(60, 20, negro, { antesDeIdat: [bloquePng('ZZZZ', Buffer.from('x'))] }),
      pngRgba(60, 20, negro, { antesDeIdat: [bloquePng('tEXt', Buffer.from('a\u0000b'))] }),
      pngRgba(60, 20, negro, { idat: Buffer.from('esto no es zlib') }),
      png(20, 10, 10), // con un bloque tEXt
    ];
    for (const caso of casos) expect(motivo(() => decodificarFirma(url(caso)))).toBe('no_png');
    // Entrelazado: un lienzo nunca lo produce.
    const entrelazado = Buffer.from(png(20, 10));
    entrelazado[28] = 1;
    entrelazado.writeUInt32BE(crc32(entrelazado.subarray(12, 29)), 29);
    expect(motivo(() => decodificarFirma(url(entrelazado)))).toBe('no_png');
  });

  it('grande', () => {
    expect(motivo(() => decodificarFirma(url(png(4, 4, MAXIMO_BYTES_FIRMA))))).toBe('grande');
  });
});

describe('traducción de errores de la anamnesis', () => {
  it('cada regla de RESTRICCIONES_ANAMNESIS tiene estado, código y campo', () => {
    const esperado: Record<string, [number, string, string | null]> = {
      configuracion_sin_permiso: [403, 'sin_permiso', null],
      anamnesis_catalogo_invalido: [400, 'datos_invalidos', 'preguntas'],
      anamnesis_pregunta_invalida: [400, 'datos_invalidos', 'preguntas.x1'],
      anamnesis_pregunta_repetida: [400, 'datos_invalidos', 'preguntas.x1'],
      anamnesis_conflicto_version: [409, 'conflicto', 'versionBase'],
      anamnesis_conflicto_catalogo: [409, 'conflicto', 'huellaCatalogo'],
      anamnesis_catalogo_lleno: [400, 'datos_invalidos', 'preguntas'],
      archivo_firma_en_uso: [409, 'conflicto', null],
      anamnesis_paciente_inactivo: [400, 'datos_invalidos', null],
      anamnesis_pregunta_desconocida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_respuesta_repetida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_respuesta_invalida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_opcion_desconocida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_numero_fuera_de_rango: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_obligatoria_sin_responder: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_pregunta_no_aplica: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_firmante_nombre: [400, 'datos_invalidos', 'firmante.nombre'],
      anamnesis_firmante_ci: [400, 'datos_invalidos', 'firmante.ci'],
      anamnesis_tutor_requerido: [400, 'datos_invalidos', 'firmante.esTutor'],
      anamnesis_tutor_sin_ci: [400, 'datos_invalidos', 'firmante.ci'],
      anamnesis_sin_firma: [400, 'datos_invalidos', 'firmaPng'],
      anamnesis_firma_invalida: [400, 'datos_invalidos', 'firmaPng'],
      anamnesis_sin_declaracion: [400, 'datos_invalidos', 'declaracionVeracidad'],
      anamnesis_signos_vitales: [400, 'datos_invalidos', 'signosVitales.pulso'],
      anamnesis_inmutable: [409, 'conflicto', null],
      historial_limite: [400, 'datos_invalidos', 'limite'],
    };
    expect(Object.keys(esperado).sort()).toEqual([...RESTRICCIONES_ANAMNESIS].sort());
    expect(Object.keys(MENSAJES_ANAMNESIS).sort()).toEqual([...RESTRICCIONES_ANAMNESIS].sort());
    for (const restriccion of RESTRICCIONES_ANAMNESIS) {
      const [estado, codigo, campo] = esperado[restriccion] ?? [0, '', null];
      // Columna como la manda la base cuando hay una (las de contrato fijo vienen igual).
      const columna = campo;
      for (const traducido of [
        errorDeAnamnesis(errorPg('22023', restriccion, columna)),
        (() => {
          const t = traducirError(errorPg('22023', restriccion, columna));
          return { estado: t.estado, codigo: t.cuerpo.codigo, detalles: t.cuerpo.detalles };
        })(),
      ]) {
        expect(traducido, restriccion).not.toBeNull();
        const t = traducido as { estado: number; codigo: string; detalles?: { campo: string }[] };
        expect({ r: restriccion, estado: t.estado, codigo: t.codigo }).toEqual({
          r: restriccion,
          estado,
          codigo,
        });
        expect(t.detalles?.[0]?.campo ?? null, restriccion).toBe(campo);
      }
    }
    const conflicto = errorDeAnamnesis(errorPg('40001', 'anamnesis_conflicto_version'));
    expect(conflicto?.message).toBe(MENSAJE_CONFLICTO_VERSION);
    const catalogo = errorDeAnamnesis(errorPg('40001', 'anamnesis_conflicto_catalogo'));
    expect(catalogo?.message).toBe(MENSAJE_CONFLICTO_CATALOGO);
  });

  it('en el contexto de la anamnesis: permiso, paciente, cursor y CHECK del catálogo', () => {
    expect(errorDeAnamnesis(errorPg('42501', 'ficha_clinica_sin_permiso'))).toMatchObject({
      estado: 403,
      codigo: 'sin_permiso',
    });
    expect(errorDeAnamnesis(errorPg('P0002', 'paciente_no_encontrado'))?.estado).toBe(404);
    expect(errorDeAnamnesis(errorPg('23503', 'archivo_paciente_fkey'))?.estado).toBe(404);
    const cursor = errorDeAnamnesis(errorPg('22023', 'cursor_invalido'));
    expect(cursor?.detalles?.[0]?.campo).toBe('cursor');
    expect(cursor?.message).toContain('historial');
    const check = errorDeAnamnesis(
      errorPg('23514', 'anamnesis_pregunta_tipo_campos', 'preguntas.encias'),
    );
    expect(check).toMatchObject({ estado: 400, codigo: 'datos_invalidos' });
    expect(check?.detalles?.[0]?.campo).toBe('preguntas.encias');
    // Lo que no es suyo sigue al traductor global; nunca se copia el mensaje de la base.
    expect(errorDeAnamnesis(errorPg('23505', 'sede_nombre_unico'))).toBeNull();
    expect(errorDeAnamnesis(new Error('otra cosa'))).toBeNull();
    for (const r of RESTRICCIONES_ANAMNESIS) {
      expect(errorDeAnamnesis(errorPg('22023', r))?.message).not.toContain('mensaje de la base');
    }
  });
});
