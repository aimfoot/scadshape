// OpenSCAD-bibliotek som följer med appen (vendor/libraries/<namn>, paketerade av build.mjs till
// dist/libs/<namn>.json). Motorn får bara de bibliotek koden använder.

export interface Library {
  name: string;
  /** Känner igen kod som använder biblioteket (utöver include/use <namn/…>). */
  detect?: RegExp;
  /** Extra sökvägar i OPENSCADPATH, relativt /libraries (för bibliotekets egna includes). */
  paths?: string[];
}

export const LIBRARIES: Library[] = [
  { name: 'BOSL2' },
  { name: 'Round-Anything' },
  // dotSCAD som på servern: use <dotSCAD/src/line2d.scad>; src/ även som sökväg (dotSCADs egna exempel).
  { name: 'dotSCAD', paths: ['dotSCAD/src'] },
  // Gridfinitys huvudfiler inkluderar relativt (include <src/core/standard.scad>) – också när de klistras in.
  { name: 'gridfinity-rebuilt-openscad', detect: /<\s*src\/(core|helpers|external)\//, paths: ['gridfinity-rebuilt-openscad'] },
];

const uses = (src: string, lib: Library) =>
  new RegExp(`\\b(include|use)\\s*<\\s*${lib.name.replace(/[-]/g, '\\-')}/`).test(src) || !!lib.detect?.test(src);

/** Bibliotek som koden använder. */
export const librariesFor = (src: string): Library[] => LIBRARIES.filter(lib => uses(src, lib));
