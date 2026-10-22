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
  // Orbitron-projektets egna statiska filer (v1.000), omodifierade: namnet är reserverat (OFL RFN),
  // så egna instanser ur Google-versionens variabla fil får inte heta Orbitron. Ingen Regular – Medium
  // heter "Orbitron" (stil Regular) i filen.
  { id: 'orbitron', label: 'Orbitron', family: 'Orbitron', file: 'Orbitron-Medium.ttf' },
  { id: 'orbitron-bold', label: 'Orbitron Bold', family: 'Orbitron:style=Bold', file: 'Orbitron-Bold.ttf' },
  { id: 'orbitron-black', label: 'Orbitron Black', family: 'Orbitron:style=Black', file: 'Orbitron-Black.ttf' },
];

export const fontById = (id: string) => FONTS.find(f => f.id === id) ?? FONTS[0];

const familyOf = (f: FontInfo) => f.family.split(':')[0];

/**
 * Typsnittsfiler som koden behöver: hela familjen när koden nämner den (t.ex. "Orbitron:style=Medium"
 * eller bara "Orbitron" – fontconfig väljer sedan vikten), plus OpenSCADs standard (Liberation Sans).
 */
export function fontsFor(src: string): string[] {
  if (!/\btext\s*\(/.test(src)) return [];
  return [...new Set([FONTS[0].file, ...FONTS.filter(f => src.includes(`"${familyOf(f)}`)).map(f => f.file)])];
}
