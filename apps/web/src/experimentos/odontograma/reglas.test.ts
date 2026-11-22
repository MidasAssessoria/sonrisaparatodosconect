import { describe, expect, it } from 'vitest';
import { info, normM, type EstadoHallazgo, type Herramienta } from './modelo.js';
import {
  elegirClase,
  resolverToque,
  type CambioOdontograma,
  type PuntoCara,
  type ResultadoToque,
} from './reglas.js';

// regiones: 0 oclusal/incisal · 1 mesial · 2 distal · 3 vestibular · 4 lingual/palatina
const cara = (reg: number, t = 0.6, u = 0.1, w = 0.1): PuntoCara => ({ reg, t, u, w });
const OCLUSAL = cara(0, 0.95);

function cambio(r: ResultadoToque): CambioOdontograma {
  if (r.tipo !== 'cambio')
    throw new Error(`se esperaba un cambio y llegó un rechazo: ${r.mensaje}`);
  return r.evento;
}
function toque(
  actual: unknown,
  fdi: number,
  herramienta: Herramienta,
  p: PuntoCara | null = OCLUSAL,
  estadoNuevo: EstadoHallazgo = 'por_realizar',
  clase: 'auto' | 'I' | 'II' | 'III' | 'IV' | 'V' = 'auto',
) {
  return resolverToque(actual, info(fdi), { fdi, cara: p }, { herramienta, estadoNuevo, clase });
}

describe('elegirClase (doc 12 regla 2)', () => {
  it('posteriores: oclusal → I, proximal → II, cervical libre → V; fosa vestibular alta del molar → I', () => {
    const m = info(36);
    expect(elegirClase(m, cara(0))).toEqual({ cl: 'I', cara: 'O' });
    expect(elegirClase(m, cara(1))).toEqual({ cl: 'II', cara: 'M' });
    expect(elegirClase(m, cara(2))).toEqual({ cl: 'II', cara: 'D' });
    expect(elegirClase(m, cara(3, 0.2))).toEqual({ cl: 'V', cara: 'V' });
    expect(elegirClase(m, cara(4, 0.2))).toEqual({ cl: 'V', cara: 'L' });
    expect(elegirClase(m, cara(3, 0.6))).toEqual({ cl: 'I', cara: 'V' });
    // en el premolar no hay fosa vestibular: la cara libre es siempre V
    expect(elegirClase(info(14), cara(3, 0.6))).toEqual({ cl: 'V', cara: 'V' });
  });

  it('anteriores: proximal → III, o IV si toca el ángulo incisal; palatina → I; cervical → V', () => {
    const i = info(11);
    expect(elegirClase(i, cara(1, 0.5))).toEqual({ cl: 'III', cara: 'M' });
    expect(elegirClase(i, cara(2, 0.8))).toEqual({ cl: 'IV', cara: 'D' });
    expect(elegirClase(i, cara(0, 0.95, 0.4))).toEqual({ cl: 'IV', cara: 'M' });
    expect(elegirClase(i, cara(0, 0.95, -0.4))).toEqual({ cl: 'IV', cara: 'D' });
    expect(elegirClase(i, cara(4, 0.5))).toEqual({ cl: 'I', cara: 'L' });
    expect(elegirClase(i, cara(4, 0.2))).toEqual({ cl: 'V', cara: 'L' });
    expect(elegirClase(i, cara(3, 0.2))).toEqual({ cl: 'V', cara: 'V' });
  });

  it('clase elegida a mano: se rechaza la que no corresponde al diente', () => {
    expect(elegirClase(info(11), cara(1), 'II')).toEqual({
      error: 'La clase II es para premolares y molares',
    });
    expect(elegirClase(info(13), cara(1), 'II')).toEqual({
      error: 'La clase II es para premolares y molares',
    });
    expect(elegirClase(info(53), cara(1), 'II')).toEqual({
      error: 'La clase II es para premolares y molares',
    });
    expect(elegirClase(info(36), cara(1), 'III')).toEqual({
      error: 'La clase III es para incisivos y caninos',
    });
    expect(elegirClase(info(24), cara(2), 'IV')).toEqual({
      error: 'La clase IV es para incisivos y caninos',
    });
    expect(elegirClase(info(85), cara(1), 'IV')).toEqual({
      error: 'La clase IV es para incisivos y caninos',
    });
  });

  it('clase elegida a mano: se acepta la que corresponde y la cara sale del toque', () => {
    expect(elegirClase(info(55), cara(1), 'II')).toEqual({ cl: 'II', cara: 'M' });
    expect(elegirClase(info(36), cara(3, 0.6, 0.5), 'II')).toEqual({ cl: 'II', cara: 'M' });
    expect(elegirClase(info(36), cara(3, 0.6, -0.5), 'II')).toEqual({ cl: 'II', cara: 'D' });
    expect(elegirClase(info(12), cara(2), 'III')).toEqual({ cl: 'III', cara: 'D' });
    expect(elegirClase(info(11), cara(3), 'I')).toEqual({ cl: 'I', cara: 'L' });
    expect(elegirClase(info(46), cara(3), 'I')).toEqual({ cl: 'I', cara: 'V' });
    expect(elegirClase(info(46), cara(1), 'I')).toEqual({ cl: 'I', cara: 'O' });
    expect(elegirClase(info(46), cara(0, 0.9, 0, -0.3), 'V')).toEqual({ cl: 'V', cara: 'L' });
  });
});

describe('resolverToque: caries', () => {
  it('marca la caries con la clase de la cara; el mismo toque la quita', () => {
    const a = cambio(toque(undefined, 36, 'caries'));
    expect(a).toMatchObject({
      fdi: '36',
      tipo: 'caries',
      cara: 'O',
      clase: 'I',
      estado: 'por_realizar',
      accion: 'agregar',
      efectos: [],
    });
    expect(a.marca).toEqual({
      car: [{ cl: 'I', cara: 'O' }],
      ext: false,
      per: false,
      mk: [],
      rea: [],
      mov: 0,
    });
    expect(a.mensaje).toBe('36 · caries clase I, cara oclusal');
    const b = cambio(toque(a.marca, 36, 'caries'));
    expect(b).toMatchObject({
      tipo: 'caries',
      cara: 'O',
      clase: 'I',
      accion: 'quitar',
      estado: 'por_realizar',
    });
    expect(b.marca).toBeNull();
  });

  it('una cara tiene a lo sumo una caries: otra clase en la misma cara reemplaza a la anterior', () => {
    const antes = { car: [{ cl: 'I', cara: 'L' }] };
    const r = cambio(toque(antes, 11, 'caries', cara(4, 0.2)));
    expect(r).toMatchObject({ tipo: 'caries', clase: 'V', cara: 'L', accion: 'agregar' });
    expect(r.efectos).toEqual([
      { tipo: 'caries', cara: 'L', clase: 'I', estado: 'por_realizar', accion: 'quitar' },
    ]);
    expect(r.marca?.car).toEqual([{ cl: 'V', cara: 'L' }]);
  });

  it('nace «realizado» si así está el interruptor', () => {
    const r = cambio(toque(undefined, 16, 'caries', OCLUSAL, 'realizado'));
    expect(r.estado).toBe('realizado');
    expect(r.marca?.rea).toEqual(['car:O']);
    expect(r.mensaje).toContain('(realizado)');
  });

  it('se rechaza en diente con extracción, ausente, fuera de la corona o con clase que no corresponde', () => {
    expect(toque({ ext: true }, 36, 'caries')).toEqual({
      tipo: 'rechazo',
      fdi: '36',
      mensaje: '36: está marcado para extracción',
    });
    expect(toque({ mk: ['ausente'] }, 36, 'caries')).toEqual({
      tipo: 'rechazo',
      fdi: '36',
      mensaje: '36: diente ausente',
    });
    expect(toque(undefined, 36, 'caries', null)).toMatchObject({
      tipo: 'rechazo',
      mensaje: '36: tocá la corona del diente para marcar la caries',
    });
    expect(toque(undefined, 11, 'caries', cara(1), 'por_realizar', 'II')).toEqual({
      tipo: 'rechazo',
      fdi: '11',
      mensaje: 'La clase II es para premolares y molares',
    });
  });
});

describe('resolverToque: interruptores', () => {
  it('extracción y periodontal: tocar agrega, tocar de nuevo quita', () => {
    const a = cambio(toque(undefined, 28, 'extraccion_indicada'));
    expect(a).toMatchObject({
      tipo: 'extraccion_indicada',
      accion: 'agregar',
      estado: 'por_realizar',
    });
    expect(a.marca?.ext).toBe(true);
    const b = cambio(toque(a.marca, 28, 'extraccion_indicada'));
    expect(b).toMatchObject({ accion: 'quitar' });
    expect(b.marca).toBeNull();
    const p = cambio(toque({ per: true, rea: ['per'] }, 42, 'periodontal'));
    expect(p).toMatchObject({ tipo: 'periodontal', accion: 'quitar', estado: 'realizado' });
  });

  it('la extracción limpia las caries del diente (y lo informa como efecto)', () => {
    const r = cambio(
      toque(
        {
          car: [
            { cl: 'I', cara: 'O' },
            { cl: 'II', cara: 'M' },
          ],
          rea: ['car:M'],
        },
        46,
        'extraccion_indicada',
      ),
    );
    expect(r.efectos).toEqual([
      { tipo: 'caries', cara: 'O', clase: 'I', estado: 'por_realizar', accion: 'quitar' },
      { tipo: 'caries', cara: 'M', clase: 'II', estado: 'realizado', accion: 'quitar' },
    ]);
    expect(r.marca).toEqual({ car: [], ext: true, per: false, mk: [], rea: [], mov: 0 });
  });

  it('los marcadores son interruptores y llevan estado', () => {
    for (const h of [
      'corona',
      'implante',
      'endodoncia',
      'protesis',
      'sellante',
      'lesion_periapical',
      'fractura',
      'reabsorcion',
      'fistula',
    ] as const) {
      const a = cambio(toque(undefined, 21, h, null, 'realizado'));
      expect(a).toMatchObject({ tipo: h, accion: 'agregar', estado: 'realizado' });
      const b = cambio(toque(a.marca, 21, h, null));
      expect(b).toMatchObject({ tipo: h, accion: 'quitar', estado: 'realizado' });
      expect(b.marca).toBeNull();
    }
  });

  it('movilidad sube I → II → III y al cuarto toque se quita', () => {
    const g1 = cambio(toque(undefined, 31, 'movilidad', null));
    expect(g1).toMatchObject({ tipo: 'movilidad', grado: 1, accion: 'agregar', efectos: [] });
    expect(g1.marca?.mov).toBe(1);
    const g2 = cambio(toque(g1.marca, 31, 'movilidad', null));
    expect(g2).toMatchObject({ grado: 2, accion: 'agregar' });
    expect(g2.efectos).toEqual([
      { tipo: 'movilidad', grado: 1, estado: 'por_realizar', accion: 'quitar' },
    ]);
    const g3 = cambio(toque(g2.marca, 31, 'movilidad', null));
    expect(g3).toMatchObject({ grado: 3, accion: 'agregar', mensaje: '31 · movilidad grado III' });
    const g4 = cambio(toque(g3.marca, 31, 'movilidad', null));
    expect(g4).toMatchObject({
      grado: 3,
      accion: 'quitar',
      efectos: [],
      mensaje: '31 · movilidad quitada',
    });
    expect(g4.marca).toBeNull();
  });

  it('subir de grado conserva el estado del hallazgo', () => {
    const r = cambio(
      toque(
        { mk: ['movilidad'], mov: 1, rea: ['movilidad'] },
        41,
        'movilidad',
        null,
        'por_realizar',
      ),
    );
    expect(r).toMatchObject({ grado: 2, estado: 'realizado' });
    expect(r.marca?.rea).toEqual(['movilidad']);
  });

  it('«ausente» limpia caries, extracción y periodontal, no tiene estado y conserva los demás marcadores', () => {
    const antes = {
      car: [{ cl: 'I', cara: 'O' }],
      ext: true,
      per: true,
      mk: ['corona'],
      rea: ['per'],
    };
    const r = cambio(toque(antes, 46, 'ausente', null, 'realizado'));
    expect(r).toMatchObject({ tipo: 'ausente', accion: 'agregar', estado: null });
    expect(r.efectos).toEqual([
      { tipo: 'caries', cara: 'O', clase: 'I', estado: 'por_realizar', accion: 'quitar' },
      { tipo: 'extraccion_indicada', estado: 'por_realizar', accion: 'quitar' },
      { tipo: 'periodontal', estado: 'realizado', accion: 'quitar' },
    ]);
    expect(r.marca).toEqual({
      car: [],
      ext: false,
      per: false,
      mk: ['corona', 'ausente'],
      rea: [],
      mov: 0,
    });
    // en el diente ausente no se marca extracción ni periodontal; un segundo toque quita «ausente»
    expect(toque(r.marca, 46, 'extraccion_indicada')).toMatchObject({
      tipo: 'rechazo',
      mensaje: '46: diente ausente',
    });
    expect(toque(r.marca, 46, 'periodontal')).toMatchObject({ tipo: 'rechazo' });
    const q = cambio(toque(r.marca, 46, 'ausente', null));
    expect(q).toMatchObject({ tipo: 'ausente', accion: 'quitar', estado: null });
    expect(q.marca?.mk).toEqual(['corona']);
  });

  it('«sano» quita todo: el primer hallazgo es el cambio principal y el resto van como efectos', () => {
    const r = cambio(
      toque(
        { car: [{ cl: 'V', cara: 'V' }], per: true, mk: ['movilidad', 'fistula'], mov: 2 },
        36,
        'sano',
      ),
    );
    expect(r).toMatchObject({ herramienta: 'sano', tipo: 'caries', cara: 'V', accion: 'quitar' });
    expect(r.efectos.map((e) => [e.tipo, e.accion, e.grado])).toEqual([
      ['periodontal', 'quitar', undefined],
      ['movilidad', 'quitar', 2],
      ['fistula', 'quitar', undefined],
    ]);
    expect(r.marca).toBeNull();
    expect(toque(undefined, 36, 'sano')).toMatchObject({
      tipo: 'rechazo',
      mensaje: '36: ya está sin marcas',
    });
  });

  it('acepta un diente sin normalizar y devuelve uno normalizado', () => {
    const r = cambio(
      toque(
        {
          car: [
            { cl: 'I', cara: 'O' },
            { cl: 'I', cara: 'O' },
          ],
          mk: ['basura'],
          rea: ['ext'],
        },
        26,
        'sellante',
        null,
      ),
    );
    expect(r.marca).toEqual(normM({ car: [{ cl: 'I', cara: 'O' }], mk: ['sellante'] }));
  });
});
