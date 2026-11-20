/** Signo menos tipográfico (U+2212), no el guion. */
const MENOS = '−';

/**
 * Monto en guaraníes: `formatoGs(300000)` → «Gs. 300.000».
 * Punto de miles, sin decimales; negativos con «−» delante: «−Gs. 15.000».
 * Con `number` se redondea al entero más cercano; para montos de la base usá `bigint`.
 */
export function formatoGs(n: number | bigint): string {
  let v: bigint;
  if (typeof n === 'bigint') {
    v = n;
  } else {
    if (!Number.isFinite(n)) throw new RangeError(`Monto inválido: ${String(n)}`);
    v = BigInt(Math.round(n));
  }
  const negativo = v < 0n;
  const absoluto = (negativo ? -v : v).toString();
  const conPuntos = absoluto.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? MENOS : ''}Gs. ${conPuntos}`;
}
