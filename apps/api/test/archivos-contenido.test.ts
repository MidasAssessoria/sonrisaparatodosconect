/** Unidad: tipo por contenido (SVG nunca), tamaño en píxeles, nombres y token firmado. */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analizarContenido, disposicionAdjunto, sanearNombre } from '../src/archivos/contenido.js';
import { firmarToken, verificarToken } from '../src/archivos/firma.js';
import { jpeg, PDF, png, SVG_LIMPIO, webp } from './archivos-ayudas.js';

describe('analizarContenido', () => {
  it('reconoce PNG, JPEG, WebP y PDF por el contenido', () => {
    expect(analizarContenido(png(640, 480))).toEqual({ tipo: 'image/png', ancho: 640, alto: 480 });
    expect(analizarContenido(jpeg(1024, 768))).toEqual({
      tipo: 'image/jpeg',
      ancho: 1024,
      alto: 768,
    });
    expect(analizarContenido(webp(16383, 1))).toEqual({
      tipo: 'image/webp',
      ancho: 16383,
      alto: 1,
    });
    expect(analizarContenido(PDF)).toEqual({ tipo: 'application/pdf', ancho: null, alto: null });
  });

  it('SVG no se reconoce nunca (ni el más inofensivo), y lo irreconocible se rechaza', () => {
    const svgs = [
      SVG_LIMPIO,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g><circle r="3"/></g></svg>'),
      Buffer.from('<svg><script>alert(1)</script></svg>'),
    ];
    for (const svg of svgs) expect(() => analizarContenido(svg)).toThrow('desconocido');
    expect(() => analizarContenido(Buffer.from('GIF89a......'))).toThrow('desconocido');
    expect(() => analizarContenido(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow('danado');
    expect(() => analizarContenido(png(0, 10))).toThrow('danado');
  });
});

describe('nombres', () => {
  it('sanearNombre quita carpetas, controles y marcas de dirección', () => {
    expect(sanearNombre('C:\\fakepath\\Logo Clínica.png')).toBe('Logo Clínica.png');
    expect(sanearNombre('../../etc/passwd')).toBe('passwd');
    expect(sanearNombre('a\u0000b\r\nc\u202e.png')).toBe('abc.png');
    expect(sanearNombre('')).toBe('archivo');
    expect(sanearNombre('..')).toBe('archivo');
    expect(Array.from(sanearNombre('x'.repeat(400))).length).toBe(200);
  });

  it('disposicionAdjunto: siempre attachment, con respaldo ASCII y UTF-8', () => {
    expect(disposicionAdjunto('Firma Núñez "x";.png')).toBe(
      `attachment; filename="Firma Nunez _x__.png"; filename*=UTF-8''Firma%20N%C3%BA%C3%B1ez%20%22x%22%3B.png`,
    );
  });
});

describe('token firmado', () => {
  const secreto = 'secreto-de-unidad-0123456789abcdef0123';
  const base = { archivoId: randomUUID(), clinicaId: randomUUID(), usuarioId: randomUUID() };
  const ahora = Date.now();
  const vence = Math.floor(ahora / 1000) + 300;

  it('ida y vuelta dentro de los 5 minutos', () => {
    const token = firmarToken(secreto, { ...base, venceEn: vence });
    expect(verificarToken(secreto, token, ahora)).toEqual({ ...base, venceEn: vence });
    // Un segundo después del vencimiento ya no sirve.
    expect(verificarToken(secreto, token, (vence + 1) * 1000)).toBeNull();
  });

  it('rechaza otro secreto, cambios, basura y vencimientos más allá del máximo', () => {
    const token = firmarToken(secreto, { ...base, venceEn: vence });
    expect(verificarToken(`${secreto}x`, token, ahora)).toBeNull();
    expect(
      verificarToken(secreto, firmarToken(secreto, { ...base, venceEn: vence + 600 }), ahora),
    ).toBeNull();
    const [parte, firma] = token.split('.') as [string, string];
    const otro = Buffer.from(
      JSON.stringify({ a: randomUUID(), c: base.clinicaId, u: base.usuarioId, e: vence }),
    ).toString('base64url');
    expect(verificarToken(secreto, `${otro}.${firma}`, ahora)).toBeNull();
    expect(verificarToken(secreto, `${parte}.${firma.slice(1)}`, ahora)).toBeNull();
    for (const malo of [undefined, 42, '', '.', 'a.b.c', `${parte}`, ['x']]) {
      expect(verificarToken(secreto, malo, ahora)).toBeNull();
    }
  });
});
