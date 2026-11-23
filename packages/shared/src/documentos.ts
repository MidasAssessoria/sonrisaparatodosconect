/**
 * Documentos y teléfonos de Paraguay. Lo usan la web (al tipear) y la API (al guardar), así las dos
 * puntas normalizan igual.
 */

/** Cédula de identidad: solo dígitos, de 5 a 9. «4.123.456» → «4123456». Devuelve null si no sirve. */
export function normalizarCi(texto: string): string | null {
  // Los ceros a la izquierda no cuentan: «01234» son 4 dígitos y no sirve (la base exige 5 a 9).
  const digitos = texto.replace(/[\s.-]/g, '').replace(/^0+(?=\d)/, '');
  return /^\d{5,9}$/.test(digitos) ? digitos : null;
}

/** Cédula para mostrar con puntos de miles: «4123456» → «4.123.456». */
export function formatoCi(ci: string): string {
  return ci.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Dígito verificador del RUC según la función de referencia de la SET (`pa_calcular_dv_11_A`):
 *   1. cada letra se reemplaza por su código ASCII escrito como dígitos («A» → «65»);
 *   2. sobre esa cadena de dígitos, de derecha a izquierda, pesos 2, 3, … 11 que vuelven a 2;
 *   3. resto = suma mod 11; dígito = 0 si el resto es 0 o 1, si no 11 − resto.
 * El caso con letras se reconstruyó de la referencia publicada y no se pudo contrastar con un RUC
 * real con letra: confirmarlo con uno antes de confiar en él (ver docs/plan.md, pendientes).
 */
export function digitoVerificadorRuc(base: string): number {
  const digitos = [...base.toUpperCase()]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0))))
    .join('');
  let total = 0;
  let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i--) {
    total += Number(digitos.charAt(i)) * peso;
    peso = peso === 11 ? 2 : peso + 1;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

/**
 * RUC con su dígito verificador: «80099999-1». Acepta con o sin puntos y espacios. Devuelve el RUC
 * normalizado («base-dv») o null si el formato no sirve, la base es cero o el dígito no coincide.
 */
export function normalizarRuc(texto: string): string | null {
  const limpio = texto.replace(/[\s.]/g, '').toUpperCase();
  const partes = /^([0-9A-Z]{3,9})-(\d)$/.exec(limpio);
  if (!partes?.[1] || partes[2] === undefined) return null;
  const base = partes[1].replace(/^0+(?=.)/, '');
  if (/^0+$/.test(base) || base.length < 3) return null;
  return digitoVerificadorRuc(base) === Number(partes[2]) ? `${base}-${partes[2]}` : null;
}

/**
 * Teléfono a formato internacional E.164. Los números paraguayos se aceptan como se escriben acá:
 * «0981 123 456», «981123456», «+595 981 123456», «595981123456», «00595 981 123456». Otro país,
 * con «+» o con «00». Devuelve null si no parece un teléfono.
 */
export function normalizarTelefono(texto: string): string | null {
  const recortado = texto.trim();
  let digitos = recortado.replace(/\D/g, '');
  let internacional = recortado.startsWith('+');
  if (!internacional && digitos.startsWith('00')) {
    digitos = digitos.slice(2);
    internacional = true;
  }
  let e164: string;
  if (internacional) e164 = `+${digitos}`;
  else if (digitos.startsWith('595')) e164 = `+${digitos}`;
  else if (digitos.startsWith('0')) e164 = `+595${digitos.slice(1)}`;
  else e164 = `+595${digitos}`;
  // Paraguay: 9 dígitos después del 595 en celulares (9xx), entre 7 y 9 en fijos.
  if (e164.startsWith('+595')) return /^\+595\d{7,9}$/.test(e164) ? e164 : null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/**
 * Teléfono para mostrar como se escribe en Paraguay: celular «0981 123 456», fijo de Asunción
 * «021 123 456», fijo del interior «0521 123 456»; otros países tal cual.
 */
export function formatoTelefono(e164: string): string {
  const celular = /^\+595(9\d{2})(\d{3})(\d{3})$/.exec(e164);
  if (celular) return `0${celular[1]} ${celular[2]} ${celular[3]}`;
  const fijo = /^\+595(\d{2,3})(\d{3})(\d{3,4})$/.exec(e164);
  if (fijo) return `0${fijo[1]} ${fijo[2]} ${fijo[3]}`;
  return e164;
}

/**
 * Texto para buscar sin distinguir mayúsculas, tildes ni puntuación («González, Ana» →
 * «gonzalez ana»; «O'Higgins» → «ohiggins»). La ñ se conserva: en español es otra letra («Peña» no
 * es «Pena»). Los números quedan sin ceros a la izquierda. La base normaliza igual
 * (`app.normalizar_busqueda`).
 */
export function normalizarBusqueda(texto: string): string {
  return (
    texto
      // NFC primero: una ñ pegada como «n» + tilde combinante pasa a ser una ñ.
      .normalize('NFC')
      .toLowerCase()
      .split('ñ')
      .map((parte) => parte.normalize('NFD').replace(/\p{Mn}/gu, ''))
      .join('ñ')
      // Grupos de dígitos separados por punto, guion o espacio son un solo número (CI, teléfono):
      // «4.123.456» → «4123456», «0981 123 456» → «0981123456».
      .replace(/(\d)[.\s-]+(?=\d)/g, '$1')
      // Apóstrofos (recto y tipográfico) y guiones dentro de palabras se pegan: «o'higgins».
      .replace(/['’`´-]/g, '')
      // Cualquier otra puntuación separa palabras.
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b0+(\d)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
