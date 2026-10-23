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

/**
 * Font files the code needs: the whole family when the code names it (e.g. "Orbitron:style=Medium"
 * or just "Orbitron" – fontconfig then picks the weight), plus OpenSCAD's default (Liberation
 * Sans).
 */
export function fontsFor(src: string): string[] {
  if (!/\btext\s*\(/.test(src)) return [];
  return [...new Set([FONTS[0].file, ...FONTS.filter(f => src.includes(`"${familyOf(f)}`)).map(f => f.file)])];
}
