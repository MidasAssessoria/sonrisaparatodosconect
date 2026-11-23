import { describe, expect, it } from 'vitest';

import {
  digitoVerificadorRuc,
  formatoCi,
  formatoTelefono,
  normalizarBusqueda,
  normalizarCi,
  normalizarRuc,
  normalizarTelefono,
} from './documentos.js';

describe('cédula', () => {
  it('se guarda solo con dígitos y se muestra con puntos', () => {
    expect(normalizarCi('4.123.456')).toBe('4123456');
    expect(normalizarCi(' 4123456 ')).toBe('4123456');
    expect(normalizarCi('0412345')).toBe('412345');
    expect(normalizarCi('123')).toBeNull();
    expect(normalizarCi('01234')).toBeNull();
    expect(normalizarCi('4123456a')).toBeNull();
    expect(formatoCi('4123456')).toBe('4.123.456');
    expect(formatoCi('812345')).toBe('812.345');
  });
});

describe('RUC', () => {
  it('calcula el dígito verificador con el algoritmo módulo 11 de la SET', () => {
    // 8·9 + 0·8 + 0·7 + 9·6 + 9·5 + 9·4 + 9·3 + 9·2 = 252; 252 mod 11 = 10 → 11 − 10 = 1
    expect(digitoVerificadorRuc('80099999')).toBe(1);
    // Resto 0 o 1 → 0
    expect(digitoVerificadorRuc('5')).toBe(1); // 5·2 = 10 → 1
    expect(digitoVerificadorRuc('11')).toBe(6);
  });

  it('con letras, la letra entra como su código ASCII en dígitos (referencia de la SET)', () => {
    // «1234567A» → «123456765»: 5·2+6·3+7·4+6·5+5·6+4·7+3·8+2·9+1·10 = 196; 196 mod 11 = 9 → 2
    expect(digitoVerificadorRuc('1234567A')).toBe(2);
    expect(normalizarRuc('1234567a-2')).toBe('1234567A-2');
  });

  it('acepta el RUC solo con el dígito correcto', () => {
    expect(normalizarRuc('80.099.999-1')).toBe('80099999-1');
    expect(normalizarRuc('80099999-0')).toBeNull();
    expect(normalizarRuc('80099999')).toBeNull();
    expect(normalizarRuc('000-0')).toBeNull();
    // RUC de persona física = cédula + dígito
    const dv = digitoVerificadorRuc('4123456');
    expect(normalizarRuc(`4.123.456-${dv}`)).toBe(`4123456-${dv}`);
  });
});

describe('teléfono', () => {
  it('lleva los formatos paraguayos a E.164', () => {
    expect(normalizarTelefono('0981 123 456')).toBe('+595981123456');
    expect(normalizarTelefono('981123456')).toBe('+595981123456');
    expect(normalizarTelefono('+595 981 123456')).toBe('+595981123456');
    expect(normalizarTelefono('595981123456')).toBe('+595981123456');
    expect(normalizarTelefono('021 123 456')).toBe('+59521123456');
    expect(normalizarTelefono('+54 9 11 1234 5678')).toBe('+5491112345678');
    expect(normalizarTelefono('00595 981 123456')).toBe('+595981123456');
    expect(normalizarTelefono('0054 9 11 1234 5678')).toBe('+5491112345678');
    expect(normalizarTelefono('12')).toBeNull();
    expect(normalizarTelefono('0981 123 456 789 000')).toBeNull();
  });

  it('se muestra como se escribe en Paraguay', () => {
    expect(formatoTelefono('+595981123456')).toBe('0981 123 456');
    expect(formatoTelefono('+59521123456')).toBe('021 123 456');
    expect(formatoTelefono('+595521123456')).toBe('0521 123 456');
    expect(formatoTelefono('+5491112345678')).toBe('+5491112345678');
  });
});

describe('búsqueda', () => {
  it('ignora mayúsculas y tildes, pero no confunde la ñ', () => {
    expect(normalizarBusqueda('  González  Pérez ')).toBe('gonzalez perez');
    expect(normalizarBusqueda('ÁLVAREZ')).toBe('alvarez');
    expect(normalizarBusqueda('Peña')).toBe('peña');
    expect(normalizarBusqueda('Peña')).not.toBe(normalizarBusqueda('Pena'));
  });

  it('quita puntuación, une apóstrofos, arregla la ñ pegada y los ceros a la izquierda', () => {
    expect(normalizarBusqueda('Giménez, Ana')).toBe('gimenez ana');
    expect(normalizarBusqueda("O'Higgins")).toBe('ohiggins');
    expect(normalizarBusqueda('D’Andrea')).toBe('dandrea');
    expect(normalizarBusqueda('Peña')).toBe('peña');
    expect(normalizarBusqueda('04.123.456')).toBe('4123456');
    expect(normalizarBusqueda('0981 123 456')).toBe('981123456');
    expect(normalizarBusqueda('Ana 34')).toBe('ana 34');
    expect(normalizarBusqueda('Ñandutí')).toBe('ñanduti');
  });
});
