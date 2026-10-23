// Fonts for text() in OpenSCAD. The files are in dist/fonts/ (OFL licence, see LICENSE.txt there)
// and are only sent to the engine when the code uses them.

export interface FontInfo {
  id: string;
  /** The name in the list. */
  label: string;
  /** The name in OpenSCAD (fontconfig). */
  family: string;
  file: string;
}

export const FONTS: FontInfo[] = [
  { id: 'sans', label: 'Liberation Sans', family: 'Liberation Sans', file: 'LiberationSans-Regular.ttf' },
  { id: 'bold', label: 'Liberation Sans Bold', family: 'Liberation Sans:style=Bold', file: 'LiberationSans-Bold.ttf' },
  { id: 'serif', label: 'Liberation Serif', family: 'Liberation Serif', file: 'LiberationSerif-Regular.ttf' },
  { id: 'serif-bold', label: 'Liberation Serif Bold', family: 'Liberation Serif:style=Bold', file: 'LiberationSerif-Bold.ttf' },
  { id: 'mono', label: 'Liberation Mono', family: 'Liberation Mono', file: 'LiberationMono-Regular.ttf' },
  { id: 'stencil', label: 'Allerta Stencil', family: 'Allerta Stencil', file: 'AllertaStencil-Regular.ttf' },
  { id: 'bebas', label: 'Bebas Neue', family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf' },
  { id: 'script', label: 'Pacifico', family: 'Pacifico', file: 'Pacifico-Regular.ttf' },
  // The Orbitron project's own static files (v1.000), unmodified: the name is reserved (OFL RFN),
  // so self-made instances of Google's variable font may not be called Orbitron. There is no
  // Regular – Medium is named "Orbitron" (style Regular) in the file.
  { id: 'orbitron', label: 'Orbitron', family: 'Orbitron', file: 'Orbitron-Medium.ttf' },
  { id: 'orbitron-bold', label: 'Orbitron Bold', family: 'Orbitron:style=Bold', file: 'Orbitron-Bold.ttf' },
  { id: 'orbitron-black', label: 'Orbitron Black', family: 'Orbitron:style=Black', file: 'Orbitron-Black.ttf' },
];

export const fontById = (id: string) => FONTS.find(f => f.id === id) ?? FONTS[0];

const familyOf = (f: FontInfo) => f.family.split(':')[0];
/** The font families in the app. */
export const FAMILIES = [...new Set(FONTS.map(familyOf))];

/**
 * Font names code (often AI-written) asks for, and the family in the app used instead (fontconfig
 * aliases, fontsConf()). `same`: the same letter widths (Liberation is made for that), so the text
 * comes out the same size – no need to mention it.
 */
export const FONT_ALIASES: Record<string, { family: string; same: boolean }> = Object.fromEntries([
  ...['Arial', 'Helvetica', 'Arimo'].map(n => [n, { family: 'Liberation Sans', same: true }]),
  ...['Times New Roman', 'Times', 'Tinos'].map(n => [n, { family: 'Liberation Serif', same: true }]),
  ...['Courier New', 'Courier', 'Cousine'].map(n => [n, { family: 'Liberation Mono', same: true }]),
  ...['Helvetica Neue', 'Verdana', 'Tahoma', 'Segoe UI', 'Calibri', 'Roboto', 'Open Sans', 'Noto Sans', 'DejaVu Sans', 'Ubuntu', 'FreeSans', 'Sans', 'sans-serif', 'Arial Black', 'Impact']
    .map(n => [n, { family: 'Liberation Sans', same: false }]),
  ...['Georgia', 'Cambria', 'Noto Serif', 'DejaVu Serif', 'FreeSerif', 'Serif', 'serif'].map(n => [n, { family: 'Liberation Serif', same: false }]),
  ...['Consolas', 'Menlo', 'Monaco', 'DejaVu Sans Mono', 'Roboto Mono', 'FreeMono', 'Monospace', 'monospace'].map(n => [n, { family: 'Liberation Mono', same: false }]),
]);
/** The alias for a font name (case does not matter, as in fontconfig), or null. */
export const fontAlias = (name: string) => Object.entries(FONT_ALIASES).find(([n]) => n.toLowerCase() === name.trim().toLowerCase())?.[1] ?? null;

/** The engine's fontconfig file: the app's fonts, and the aliases. */
export const FONTS_CONF = `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>/fonts</dir>\n${Object.entries(FONT_ALIASES)
  .map(([n, a]) => `<alias binding="same"><family>${n}</family><prefer><family>${a.family}</family></prefer></alias>`)
  .join('\n')}\n</fontconfig>\n`;

/**
 * Font files the code needs: the whole family when the code names it (e.g. "Orbitron:style=Medium"
 * or just "Orbitron" – fontconfig then picks the weight) or a name with an alias ("Arial:style=Bold"
 * → Liberation Sans), plus OpenSCAD's default (Liberation Sans).
 */
export function fontsFor(src: string): string[] {
  if (!/\btext\s*\(/.test(src)) return [];
  const named = new Set([...src.matchAll(/"([^":]+)/g)].map(m => fontAlias(m[1])?.family ?? m[1].trim()));
  return [...new Set([FONTS[0].file, ...FONTS.filter(f => named.has(familyOf(f))).map(f => f.file)])];
}
