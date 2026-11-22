/**
 * Documentos y teléfonos de Paraguay. Lo usan la web (al tipear) y la API (al guardar), así las dos
 * puntas normalizan igual.
 */

/** Cédula de identidad: solo dígitos, de 5 a 9. «4.123.456» → «4123456». Devuelve null si no sirve. */
export function normalizarCi(texto: string): string | null {
  const digitos = texto.replace(/[\s.-]/g, '');
  return /^\d{5,9}$/.test(digitos) ? digitos.replace(/^0+(?=\d)/, '') : null;
}

/** Cédula para mostrar con puntos de miles: «4123456» → «4.123.456». */
export function formatoCi(ci: string): string {
  return ci.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Dígito verificador del RUC según el algoritmo de la SET (módulo 11, pesos de 2 a 11 de derecha a
 * izquierda; las letras cuentan por su código ASCII). Resto 0 o 1 → 0; si no, 11 − resto.
 */
export function digitoVerificadorRuc(base: string): number {
  let total = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    const caracter = base.charAt(i).toUpperCase();
    const valor = /\d/.test(caracter) ? Number(caracter) : caracter.charCodeAt(0);
    total += valor * peso;
    peso = peso === 11 ? 2 : peso + 1;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

/**
 * RUC con su dígito verificador: «80099999-1». Acepta con o sin puntos y espacios. Devuelve el RUC
 * normalizado («base-dv») o null si el formato no sirve o el dígito no coincide.
 */
export function normalizarRuc(texto: string): string | null {
  const limpio = texto.replace(/[\s.]/g, '').toUpperCase();
  const partes = /^([0-9A-Z]{3,9})-(\d)$/.exec(limpio);
  if (!partes?.[1] || partes[2] === undefined) return null;
  const base = partes[1].replace(/^0+(?=.)/, '');
  return digitoVerificadorRuc(base) === Number(partes[2]) ? `${base}-${partes[2]}` : null;
}

/**
 * Teléfono a formato internacional E.164. Los números paraguayos se aceptan como se escriben acá:
 * «0981 123 456», «981123456», «+595 981 123456», «595981123456». Otro país solo con «+».
 * Devuelve null si no parece un teléfono.
 */
export function normalizarTelefono(texto: string): string | null {
  const conMas = texto.trim().startsWith('+');
  const digitos = texto.replace(/\D/g, '');
  let e164: string;
  if (conMas) e164 = `+${digitos}`;
  else if (digitos.startsWith('595')) e164 = `+${digitos}`;
  else if (digitos.startsWith('0')) e164 = `+595${digitos.slice(1)}`;
  else e164 = `+595${digitos}`;
  // Paraguay: 9 dígitos después del 595 en celulares (9xx), entre 7 y 9 en fijos.
  if (e164.startsWith('+595')) return /^\+595\d{7,9}$/.test(e164) ? e164 : null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** Teléfono para mostrar: «+595981123456» → «0981 123 456»; otros países tal cual. */
export function formatoTelefono(e164: string): string {
  const py = /^\+595(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return py ? `0${py[1]} ${py[2]} ${py[3]}` : e164;
}

/**
 * Texto para buscar sin distinguir mayúsculas ni tildes («González» → «gonzalez»). La ñ se
 * conserva: en español es otra letra («Peña» no es «Pena»).
 */
export function normalizarBusqueda(texto: string): string {
  // La ñ (y la Ñ) se separa en n + tilde al descomponer: se protege antes y se repone después.
  return texto
    .toLowerCase()
    .split('ñ')
    .map((parte) => parte.normalize('NFD').replace(/\p{Mn}/gu, ''))
    .join('ñ')
    .replace(/\s+/g, ' ')
    .trim();
}
