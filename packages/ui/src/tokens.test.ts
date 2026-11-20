import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLORES, ESPACIOS, ESTILOS_TEXTO, RADIOS, SOMBRAS, TAMANOS, token } from './tokens.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8');

interface TokenJson {
  name: string;
  value: string;
}
interface TokensJson {
  color: { tokens: TokenJson[] };
  type: {
    families: Record<string, string>;
    groups: { styles: { name: string; fontSize: string; lineHeight: string }[] }[];
  };
  spacing: { tokens: TokenJson[] };
  radius: { tokens: TokenJson[] };
  shadow: { tokens: TokenJson[] };
  tamano: { tokens: TokenJson[] };
}

const json = JSON.parse(leer('origen/tokens.json')) as TokensJson;
const css = leer('src/estilos/tokens.css');

/** Valor declarado para `--nombre` dentro de :root. */
function variable(nombre: string): string | undefined {
  const m = new RegExp(`--${nombre}:\\s*([^;]+);`).exec(css);
  return m?.[1]?.trim();
}

const resolver = (v: string) => v.replace(/\{([a-z0-9-]+)\}/g, 'var(--$1)');

describe('tokens.css', () => {
  it('cada color de tokens.json existe con su valor', () => {
    for (const t of json.color.tokens) expect(variable(t.name), t.name).toBe(resolver(t.value));
  });

  it('espacio, radios, sombras y tamaños existen con su valor', () => {
    for (const grupo of [json.spacing, json.radius, json.shadow, json.tamano]) {
      for (const t of grupo.tokens) expect(variable(t.name), t.name).toBe(t.value);
    }
  });

  it('familias tipográficas y estilos de texto', () => {
    for (const [nombre, valor] of Object.entries(json.type.families)) {
      // Prettier normaliza las comillas: se comparan sin importar si son simples o dobles.
      expect(variable(`font-${nombre}`)?.replace(/'/g, '"')).toBe(valor);
    }
    for (const g of json.type.groups) {
      for (const s of g.styles) {
        const v = variable(`tipo-${s.name}`);
        expect(v, s.name).toContain(`${s.fontSize}/${s.lineHeight}`);
        expect(css).toContain(`.cn-texto-${s.name} {`);
      }
    }
  });

  it('el módulo TS tiene los mismos nombres', () => {
    expect(Object.keys(COLORES)).toEqual(json.color.tokens.map((t) => t.name));
    expect(Object.keys(ESPACIOS)).toEqual(json.spacing.tokens.map((t) => t.name));
    expect(Object.keys(RADIOS)).toEqual(json.radius.tokens.map((t) => t.name));
    expect(Object.keys(SOMBRAS)).toEqual(json.shadow.tokens.map((t) => t.name));
    expect(Object.keys(TAMANOS)).toEqual(json.tamano.tokens.map((t) => t.name));
    expect([...ESTILOS_TEXTO]).toEqual(
      json.type.groups.flatMap((g) => g.styles.map((s) => s.name)),
    );
    expect(token('turquesa')).toBe('var(--turquesa)');
  });

  it('los componentes solo usan variables definidas en tokens.css', () => {
    const componentes = leer('src/estilos/componentes.css') + leer('src/estilos/marco-app.css');
    const usadas = new Set([...componentes.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
    const propias = new Set(['cn-columnas']);
    for (const u of usadas) {
      if (!u || propias.has(u)) continue;
      expect(variable(u), `--${u}`).toBeDefined();
    }
  });
});

describe('fuentes', () => {
  it('se autoalojan con font-display: swap y sin pedir nada a Google Fonts', () => {
    const fuentes = leer('src/estilos/fuentes.css');
    expect(fuentes.match(/@font-face/g)).toHaveLength(2);
    expect(fuentes.match(/font-display: swap/g)).toHaveLength(2);
    for (const m of fuentes.matchAll(/url\('([^']+)'\)/g)) {
      const ruta = m[1] ?? '';
      expect(existsSync(join(raiz, 'src', 'estilos', ruta)), ruta).toBe(true);
    }
    const todo = ['estilos', 'tokens', 'componentes', 'marco-app', 'fuentes']
      .map((n) => leer(`src/estilos/${n}.css`))
      .join('\n');
    expect(todo).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});
