// Typsnitt för text() i OpenSCAD. Filerna ligger i dist/fonts/ (OFL-licens, se LICENSE.txt där)
// och skickas till motorn bara när koden använder dem.

export interface FontInfo {
  id: string;
  /** Namnet i listan. */
  label: string;
  /** Namnet i OpenSCAD (fontconfig). */
  family: string;
  file: string;
}

export const FONTS: FontInfo[] = [
  { id: 'sans', label: 'Liberation Sans', family: 'Liberation Sans', file: 'LiberationSans-Regular.ttf' },
  { id: 'bold', label: 'Liberation Sans Bold', family: 'Liberation Sans:style=Bold', file: 'LiberationSans-Bold.ttf' },
  { id: 'stencil', label: 'Allerta Stencil', family: 'Allerta Stencil', file: 'AllertaStencil-Regular.ttf' },
  { id: 'bebas', label: 'Bebas Neue', family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf' },
  { id: 'script', label: 'Pacifico', family: 'Pacifico', file: 'Pacifico-Regular.ttf' },
];

export const fontById = (id: string) => FONTS.find(f => f.id === id) ?? FONTS[0];

/** Typsnittsfiler som koden behöver: de som nämns, plus OpenSCADs standard (Liberation Sans) som reserv. */
export function fontsFor(src: string): string[] {
  if (!/\btext\s*\(/.test(src)) return [];
  return [...new Set([FONTS[0].file, ...FONTS.filter(f => src.includes(`"${f.family}"`)).map(f => f.file)])];
}
