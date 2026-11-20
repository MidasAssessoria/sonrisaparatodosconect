/** Une clases ignorando las vacías. */
export function cx(...clases: (string | false | null | undefined)[]): string {
  return clases.filter(Boolean).join(' ');
}

/** Hash estable (mismo nombre → mismo tono de avatar). */
export function hash(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

/** «Dra. Marta Acosta» → «MA». */
export function iniciales(nombre: string): string {
  return (nombre || '?')
    .replace(/^Dra?\.\s*/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0))
    .join('')
    .toUpperCase();
}

const SELECTOR_ENFOCABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Elementos enfocables con teclado dentro de `raiz`. */
export function enfocables(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE));
}
