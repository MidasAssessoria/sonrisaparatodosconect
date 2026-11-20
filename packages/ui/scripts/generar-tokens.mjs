// Genera src/estilos/tokens.css y src/tokens.ts a partir de origen/tokens.json.
// Uso: `node scripts/generar-tokens.mjs` (escribe) o `--verificar` (falla si están desactualizados).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_JSON = join(raiz, 'origen', 'tokens.json');
const RUTA_CSS = join(raiz, 'src', 'estilos', 'tokens.css');
const RUTA_TS = join(raiz, 'src', 'tokens.ts');

const AVISO =
  'Archivo generado por scripts/generar-tokens.mjs desde origen/tokens.json. No lo edites a mano.';

/** `{tinta}` → `var(--tinta)` */
function valorCss(valor) {
  return String(valor).replace(/\{([a-z0-9-]+)\}/g, 'var(--$1)');
}

function familiaCss(familia) {
  return `var(--font-${familia})`;
}

/** Lee tokens.json y devuelve las listas normalizadas. */
export function leerTokens() {
  const t = JSON.parse(readFileSync(RUTA_JSON, 'utf8'));
  const colores = t.color.tokens.map((x) => ({ nombre: x.name, valor: x.value, uso: x.usage }));
  const familias = Object.entries(t.type.families).map(([nombre, valor]) => ({ nombre, valor }));
  const tipos = t.type.groups.flatMap((g) =>
    g.styles.map((s) => ({
      nombre: s.name,
      familia: g.family,
      tamano: s.fontSize,
      interlineado: s.lineHeight,
      peso: s.fontWeight,
      espaciado: s.letterSpacing ?? null,
      uso: s.usage,
    })),
  );
  const simples = (seccion) =>
    t[seccion].tokens.map((x) => ({ nombre: x.name, valor: x.value, uso: x.usage }));
  return {
    colores,
    familias,
    tipos,
    espacios: simples('spacing'),
    radios: simples('radius'),
    sombras: simples('shadow'),
    tamanos: simples('tamano'),
  };
}

export function generarCss(tk) {
  const l = [];
  l.push(`/* ${AVISO} */`, '', ':root {', '  color-scheme: light;', '');
  l.push('  /* Color (tema claro) */');
  for (const c of tk.colores) l.push(`  --${c.nombre}: ${valorCss(c.valor)};`);
  l.push('', '  /* Familias */');
  for (const f of tk.familias) l.push(`  --font-${f.nombre}: ${f.valor};`);
  l.push('', '  /* Estilos de texto: --tipo-<nombre> es un shorthand de `font`. */');
  for (const s of tk.tipos) {
    l.push(
      `  --tipo-${s.nombre}: ${s.peso} ${s.tamano}/${s.interlineado} ${familiaCss(s.familia)};`,
    );
    l.push(`  --tipo-${s.nombre}-tamano: ${s.tamano};`);
    l.push(`  --tipo-${s.nombre}-interlineado: ${s.interlineado};`);
    l.push(`  --tipo-${s.nombre}-peso: ${s.peso};`);
    l.push(`  --tipo-${s.nombre}-espaciado: ${s.espaciado ?? 'normal'};`);
  }
  l.push('', '  /* Espacio */');
  for (const x of tk.espacios) l.push(`  --${x.nombre}: ${x.valor};`);
  l.push('', '  /* Radios */');
  for (const x of tk.radios) l.push(`  --${x.nombre}: ${x.valor};`);
  l.push('', '  /* Sombras */');
  for (const x of tk.sombras) l.push(`  --${x.nombre}: ${x.valor};`);
  l.push('', '  /* Tamaños */');
  for (const x of tk.tamanos) l.push(`  --${x.nombre}: ${x.valor};`);
  l.push('}', '');
  l.push('/* Clases de texto: .cn-texto-<nombre> aplica el estilo del token. */');
  for (const s of tk.tipos) {
    const extra = s.espaciado ? ` letter-spacing: ${s.espaciado}; text-transform: uppercase;` : '';
    l.push(`.cn-texto-${s.nombre} { font: var(--tipo-${s.nombre});${extra} }`);
  }
  l.push('');
  return l.join('\n');
}

function lista(items) {
  return items.map((x) => `  '${x.nombre}',`).join('\n');
}

function mapa(items) {
  return items.map((x) => `  '${x.nombre}': ${JSON.stringify(x.valor)},`).join('\n');
}

export function generarTs(tk) {
  return `// ${AVISO}

/** Colores del tema claro (valor resuelto en tokens.json; las referencias quedan como \`{otro}\`). */
export const COLORES = {
${mapa(tk.colores)}
} as const;
export type TokenColor = keyof typeof COLORES;

export const ESPACIOS = {
${mapa(tk.espacios)}
} as const;
export type TokenEspacio = keyof typeof ESPACIOS;

export const RADIOS = {
${mapa(tk.radios)}
} as const;
export type TokenRadio = keyof typeof RADIOS;

export const SOMBRAS = {
${mapa(tk.sombras)}
} as const;
export type TokenSombra = keyof typeof SOMBRAS;

export const TAMANOS = {
${mapa(tk.tamanos)}
} as const;
export type TokenTamano = keyof typeof TAMANOS;

/** Estilos de texto: variable \`--tipo-<nombre>\` y clase \`.cn-texto-<nombre>\`. */
export const ESTILOS_TEXTO = [
${lista(tk.tipos)}
] as const;
export type TokenTexto = (typeof ESTILOS_TEXTO)[number];

export type NombreToken = TokenColor | TokenEspacio | TokenRadio | TokenSombra | TokenTamano;

/** \`token('turquesa')\` → \`'var(--turquesa)'\`, para estilos en línea. */
export function token(nombre: NombreToken): string {
  return \`var(--\${nombre})\`;
}

/** \`tipo('titulo-seccion')\` → \`'var(--tipo-titulo-seccion)'\`, valor para \`font\`. */
export function tipo(nombre: TokenTexto): string {
  return \`var(--tipo-\${nombre})\`;
}
`;
}

/** Formatea con la configuración de Prettier del repo (así `pnpm format` no cambia nada). */
async function formatear(codigo, ruta) {
  try {
    const prettier = await import('prettier');
    const opciones = (await prettier.resolveConfig(ruta)) ?? {};
    return await prettier.format(codigo, { ...opciones, filepath: ruta });
  } catch {
    return codigo;
  }
}

const tk = leerTokens();
const css = await formatear(generarCss(tk), RUTA_CSS);
const ts = await formatear(generarTs(tk), RUTA_TS);

if (process.argv.includes('--verificar')) {
  const leer = (r) => {
    try {
      return readFileSync(r, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      return '';
    }
  };
  if (leer(RUTA_CSS) !== css || leer(RUTA_TS) !== ts) {
    console.error(
      'Los tokens generados están desactualizados. Corré `pnpm --filter @conecta/ui tokens`.',
    );
    process.exit(1);
  }
} else {
  writeFileSync(RUTA_CSS, css);
  writeFileSync(RUTA_TS, ts);
  console.log('Tokens generados: src/estilos/tokens.css y src/tokens.ts');
}
