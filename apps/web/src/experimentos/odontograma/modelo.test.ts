import { describe, expect, it } from 'vitest';
import {
  canon,
  denticionDe,
  dientesDistintos,
  esFdiValido,
  fdisDe,
  info,
  nombreCara,
  normEstado,
  normM,
  orden,
} from './modelo.js';

describe('numeración FDI', () => {
  it('adulto: 32 dientes, cuadrantes 1 a 4, posiciones 1 a 8, de la derecha del paciente a la izquierda', () => {
    const fs = fdisDe('adulto');
    expect(fs).toHaveLength(32);
    expect(new Set(fs).size).toBe(32);
    expect(fs.every((f) => esFdiValido(f) && f >= 11 && f <= 48)).toBe(true);
    const o = orden(false);
    expect(o.sup).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(o.inf).toEqual([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]);
  });

  it('temporal: 20 dientes, cuadrantes 5 a 8, posiciones 1 a 5', () => {
    const fs = fdisDe('pediatrico');
    expect(fs).toHaveLength(20);
    const o = orden(true);
    expect(o.sup).toEqual([55, 54, 53, 52, 51, 61, 62, 63, 64, 65]);
    expect(o.inf).toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75]);
    expect(fs.every((f) => denticionDe(f) === 'pediatrico')).toBe(true);
  });

  it('valida el número', () => {
    for (const ok of [11, 18, 28, 38, 48, 51, 55, 65, 75, 85, '36', '51'])
      expect(esFdiValido(ok)).toBe(true);
    for (const mal of [10, 19, 29, 49, 50, 56, 66, 86, 90, 9, 100, 1.5, '08', '3', 'ab', '36 ', ''])
      expect(esFdiValido(mal)).toBe(false);
    expect(() => info(19)).toThrow(RangeError);
    expect(() => info(56)).toThrow(RangeError);
  });

  it('describe cada diente: tipo, arcada, lado y nombre', () => {
    const m = info(36);
    expect(m).toMatchObject({
      q: 3,
      p: 6,
      kind: 'mol',
      sup: false,
      der: false,
      ant: false,
      nino: false,
      nombre: 'Primer molar inferior izquierdo',
    });
    expect(info(11)).toMatchObject({
      kind: 'inc',
      sup: true,
      der: true,
      ant: true,
      nombre: 'Incisivo central superior derecho',
    });
    expect(info(13)).toMatchObject({ kind: 'can', ant: true });
    expect(info(24)).toMatchObject({ kind: 'pre', ant: false, sup: true, der: false });
    expect(info(53)).toMatchObject({
      kind: 'can',
      nino: true,
      nombre: 'Canino temporal superior derecho',
    });
    expect(info(84)).toMatchObject({ kind: 'mol', nino: true, sup: false, der: true });
    // medidas de la maqueta: [ancho M-D, ancho V-L, alto corona, largo raíz]
    expect([m.W, m.D, m.H, m.L]).toEqual([11.0, 10.4, 7.4, 13.5]);
  });

  it('nombra las caras según el diente', () => {
    expect(nombreCara(info(11), 0)).toBe('incisal');
    expect(nombreCara(info(36), 0)).toBe('oclusal');
    expect(nombreCara(info(16), 4)).toBe('palatina');
    expect(nombreCara(info(46), 4)).toBe('lingual');
    expect(nombreCara(info(46), 1)).toBe('mesial');
  });
});

describe('normM', () => {
  it('un diente sin datos queda sano', () => {
    expect(normM(undefined)).toEqual({ car: [], ext: false, per: false, mk: [], rea: [], mov: 0 });
    expect(normM('basura')).toEqual({ car: [], ext: false, per: false, mk: [], rea: [], mov: 0 });
  });

  it('descarta marcadores y caries inválidos y deja una caries por cara (la última)', () => {
    const m = normM({
      car: [
        { cl: 'I', cara: 'O' },
        { cl: 'VI', cara: 'O' },
        { cl: 'II', cara: 'X' },
        { cl: 'II', cara: 'M' },
        { cl: 'V', cara: 'M' },
      ],
      mk: ['corona', 'corona', 'dragon', 'movilidad'],
    });
    expect(m.car).toEqual([
      { cl: 'I', cara: 'O' },
      { cl: 'V', cara: 'M' },
    ]);
    expect(m.mk).toEqual(['corona', 'movilidad']);
  });

  it('«realizado» solo vale para hallazgos que existen, y «ausente» nunca tiene estado', () => {
    const m = normM({
      car: [{ cl: 'I', cara: 'O' }],
      ext: false,
      per: true,
      mk: ['ausente', 'corona'],
      rea: ['car:O', 'car:M', 'ext', 'per', 'ausente', 'corona', 'implante', 'per', 42],
    });
    expect(m.rea).toEqual(['car:O', 'per', 'corona']);
  });

  it('el grado de movilidad queda entre I y III, y en 0 sin movilidad', () => {
    expect(normM({ mk: ['movilidad'], mov: 7 }).mov).toBe(3);
    expect(normM({ mk: ['movilidad'], mov: 0 }).mov).toBe(1);
    expect(normM({ mk: ['movilidad'], mov: 'x' }).mov).toBe(1);
    expect(normM({ mk: ['movilidad'], mov: '2' }).mov).toBe(2);
    expect(normM({ mov: 2 }).mov).toBe(0);
  });

  it('canon no depende del orden', () => {
    const a = normM({
      car: [
        { cl: 'I', cara: 'O' },
        { cl: 'II', cara: 'M' },
      ],
      mk: ['corona', 'sellante'],
      rea: ['corona', 'car:O'],
    });
    const b = normM({
      car: [
        { cl: 'II', cara: 'M' },
        { cl: 'I', cara: 'O' },
      ],
      mk: ['sellante', 'corona'],
      rea: ['car:O', 'corona'],
    });
    expect(canon(a)).toBe(canon(b));
    expect(canon(a)).not.toBe(canon(normM({ ...b, rea: [] })));
  });

  it('normEstado quita fdi inválidos, de otra dentición y dientes sanos', () => {
    const e = normEstado(
      { 11: { ext: true }, 19: { ext: true }, 55: { per: true }, 36: {}, x: 1 },
      'adulto',
    );
    expect(Object.keys(e)).toEqual(['11']);
    expect(dientesDistintos(e, { 11: normM({ ext: true }), 21: normM({ per: true }) })).toEqual([
      21,
    ]);
  });
});
