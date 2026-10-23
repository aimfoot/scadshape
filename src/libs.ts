// OpenSCAD libraries bundled with the app (vendor/libraries/<name>, packaged by build.mjs to
// dist/libs/<name>.json). The engine only gets the libraries the code uses.

export interface Library {
  name: string;
  /** Recognises code that uses the library (in addition to include/use <name/…>). */
  detect?: RegExp;
  /** Extra paths in OPENSCADPATH, relative to /libraries (for the library's own includes). */
  paths?: string[];
}

export const LIBRARIES: Library[] = [
  { name: 'BOSL2' },
  { name: 'Round-Anything' },
  // dotSCAD as on the server: use <dotSCAD/src/line2d.scad>; src/ also as a path (dotSCAD's own
  // examples).
  { name: 'dotSCAD', paths: ['dotSCAD/src'] },
  // Gridfinity's main files include relatively (include <src/core/standard.scad>) – also when
  // pasted.
  { name: 'gridfinity-rebuilt-openscad', detect: /<\s*src\/(core|helpers|external)\//, paths: ['gridfinity-rebuilt-openscad'] },
];

const uses = (src: string, lib: Library) =>
  new RegExp(`\\b(include|use)\\s*<\\s*${lib.name.replace(/[-]/g, '\\-')}/`).test(src) || !!lib.detect?.test(src);

/** Libraries the code uses. */
export const librariesFor = (src: string): Library[] => LIBRARIES.filter(lib => uses(src, lib));
