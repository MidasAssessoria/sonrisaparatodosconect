// Archivo generado por scripts/generar-tokens.mjs desde origen/tokens.json. No lo edites a mano.

/** Colores del tema claro (valor resuelto en tokens.json; las referencias quedan como `{otro}`). */
export const COLORES = {
  crema: '#fff7e9',
  blanco: '#ffffff',
  'fondo-suave': '#f1eff6',
  borde: '#d9d3e6',
  'borde-control': '#847e99',
  tinta: '#232036',
  'tinta-suave': '#5e5a72',
  'sobre-tinta': '#ffffff',
  turquesa: '#18bfb0',
  'turquesa-texto': '#0b7a70',
  'turquesa-suave': '#ddf5f2',
  'sobre-turquesa': '{tinta}',
  coral: '#ff5d5d',
  'coral-texto': '#b83236',
  'coral-suave': '#ffe6e3',
  sol: '#ffc23c',
  'sol-texto': '#8a5b00',
  'sol-suave': '#fff0cc',
  cielo: '#2e9bec',
  'cielo-texto': '#1769aa',
  'cielo-suave': '#e1f0fc',
  uva: '#8b5cf6',
  'uva-texto': '#6d3fd6',
  'uva-suave': '#eee7fe',
  rosa: '#ff7bb0',
  'rosa-texto': '#b02a66',
  'rosa-suave': '#ffe6f0',
  foco: '{turquesa-texto}',
  'clinico-caries': '#16161a',
  'clinico-extraccion': '#1a5fb4',
  'clinico-periodontal': '#d7262b',
} as const;
export type TokenColor = keyof typeof COLORES;

export const ESPACIOS = {
  'espacio-1': '4px',
  'espacio-2': '8px',
  'espacio-3': '12px',
  'espacio-4': '16px',
  'espacio-5': '20px',
  'espacio-6': '24px',
  'espacio-8': '32px',
  'espacio-12': '48px',
} as const;
export type TokenEspacio = keyof typeof ESPACIOS;

export const RADIOS = {
  'radio-sm': '8px',
  'radio-control': '12px',
  'radio-tarjeta': '16px',
  'radio-hoja': '24px',
  'radio-pill': '9999px',
} as const;
export type TokenRadio = keyof typeof RADIOS;

export const SOMBRAS = {
  'sombra-1': '0 1px 2px #2320360d, 0 2px 6px #2320360f',
  'sombra-2': '0 4px 12px #23203614, 0 16px 32px -8px #23203626',
} as const;
export type TokenSombra = keyof typeof SOMBRAS;

export const TAMANOS = {
  'toque-minimo': '44px',
  control: '48px',
  'control-grande': '56px',
  'barra-lateral': '248px',
  'barra-inferior': '64px',
  'contenido-max': '1200px',
} as const;
export type TokenTamano = keyof typeof TAMANOS;

/** Estilos de texto: variable `--tipo-<nombre>` y clase `.cn-texto-<nombre>`. */
export const ESTILOS_TEXTO = [
  'titulo-pagina',
  'titulo-pagina-movil',
  'titulo-seccion',
  'titulo-tarjeta',
  'numero',
  'cuerpo',
  'cuerpo-fuerte',
  'boton',
  'etiqueta',
  'secundario',
  'pequeno',
  'sobretitulo',
] as const;
export type TokenTexto = (typeof ESTILOS_TEXTO)[number];

export type NombreToken = TokenColor | TokenEspacio | TokenRadio | TokenSombra | TokenTamano;

/** `token('turquesa')` → `'var(--turquesa)'`, para estilos en línea. */
export function token(nombre: NombreToken): string {
  return `var(--${nombre})`;
}

/** `tipo('titulo-seccion')` → `'var(--tipo-titulo-seccion)'`, valor para `font`. */
export function tipo(nombre: TokenTexto): string {
  return `var(--tipo-${nombre})`;
}
