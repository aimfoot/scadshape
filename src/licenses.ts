// Allt som följer med appen och dess licenser ("Om scadshape", src/ui/about.ts). Texterna ligger i
// dist/licenses/ (vendor/licenses/ via tools/licenses.sh, plus LICENSE-filerna som build.mjs kopierar).
// OpenSCAD-WASM:ens innehåll: github.com/openscad/openscad-wasm, Makefile.

import type { Key } from './i18n';

export type Part = { name: string; version?: string; license: string; url: string; files: string[] };

/** Var scadshapes källkod finns (tom = inte publicerad än, länken visas inte). */
export const SOURCE_URL = '';

const L = (f: string) => `licenses/${f}.txt`;
const GPL3 = L('GPL-3.0-or-later'), LGPL3 = L('LGPL-3.0-or-later'), LGPL21 = L('LGPL-2.1-or-later');

export const SCADSHAPE_LICENSE = GPL3;

export const PARTS: { group: Key; parts: Part[] }[] = [
  {
    group: 'about.group.engine',
    parts: [
      { name: 'OpenSCAD', version: '2026.10.15 (WebAssembly)', license: 'GPL-2.0-or-later', url: 'https://openscad.org', files: [L('openscad')] },
      { name: 'CGAL', version: '6.0.3', license: 'GPL-3.0-or-later / LGPL-3.0-or-later', url: 'https://www.cgal.org', files: [L('cgal'), GPL3, LGPL3] },
      { name: 'Manifold', license: 'Apache-2.0', url: 'https://github.com/elalish/manifold', files: [L('manifold')] },
      { name: 'Clipper2', license: 'BSL-1.0', url: 'https://github.com/AngusJohnson/Clipper2', files: [L('clipper2')] },
      { name: 'lib3mf', version: '2.3.2', license: 'BSD-2-Clause', url: 'https://github.com/3MFConsortium/lib3mf', files: [L('lib3mf')] },
      { name: 'Boost', license: 'BSL-1.0', url: 'https://www.boost.org', files: [L('BSL-1.0')] },
      { name: 'Eigen', version: '5.0.1', license: 'MPL-2.0', url: 'https://eigen.tuxfamily.org', files: [L('MPL-2.0')] },
      { name: 'GMP', license: 'LGPL-3.0-or-later', url: 'https://gmplib.org', files: [LGPL3, GPL3] },
      { name: 'MPFR', license: 'LGPL-3.0-or-later', url: 'https://www.mpfr.org', files: [LGPL3, GPL3] },
      { name: 'double-conversion', version: '3.4.0', license: 'BSD-3-Clause', url: 'https://github.com/google/double-conversion', files: [L('double-conversion')] },
      { name: 'JSON for Modern C++', license: 'MIT', url: 'https://github.com/nlohmann/json', files: [L('nlohmann-json')] },
    ],
  },
  {
    group: 'about.group.text',
    parts: [
      { name: 'FreeType', version: '2.14.3', license: 'FTL', url: 'https://freetype.org', files: [L('freetype')] },
      { name: 'HarfBuzz', version: '14.3.0', license: 'MIT', url: 'https://harfbuzz.github.io', files: [L('harfbuzz')] },
      { name: 'Fontconfig', version: '2.18.2', license: 'MIT', url: 'https://www.freedesktop.org/wiki/Software/fontconfig/', files: [L('fontconfig')] },
      { name: 'GLib', license: 'LGPL-2.1-or-later', url: 'https://gitlab.gnome.org/GNOME/glib', files: [LGPL21] },
      { name: 'cairo', version: '1.18.4', license: 'LGPL-2.1 / MPL-1.1', url: 'https://www.cairographics.org', files: [L('cairo'), LGPL21] },
      { name: 'libffi', version: '3.7.1', license: 'MIT', url: 'https://sourceware.org/libffi/', files: [L('libffi')] },
      { name: 'Expat', version: '2.8.2', license: 'MIT', url: 'https://libexpat.github.io', files: [L('expat')] },
      { name: 'libxml2', version: '2.15.3', license: 'MIT', url: 'https://gitlab.gnome.org/GNOME/libxml2', files: [L('libxml2')] },
    ],
  },
  {
    group: 'about.group.files',
    parts: [
      { name: 'libzip', version: '1.11.4', license: 'BSD-3-Clause', url: 'https://libzip.org', files: [L('libzip')] },
      { name: 'zlib', version: '1.3.2', license: 'Zlib', url: 'https://zlib.net', files: [L('zlib')] },
      { name: 'liblzma', license: 'Public domain', url: 'https://tukaani.org/xz/', files: [L('liblzma')] },
    ],
  },
  {
    group: 'about.group.app',
    parts: [
      { name: 'planegcs (FreeCAD)', version: '1.3.0', license: 'LGPL-2.1-or-later', url: 'https://github.com/Salusoft89/planegcs', files: [L('planegcs')] },
      { name: 'three.js', version: '0.186.1', license: 'MIT', url: 'https://threejs.org', files: [L('three')] },
    ],
  },
  {
    group: 'about.group.libs',
    parts: [
      { name: 'BOSL2', version: '2.0.766', license: 'BSD-2-Clause', url: 'https://github.com/BelfrySCAD/BOSL2', files: [L('lib-BOSL2')] },
      { name: 'Round-Anything', license: 'MIT', url: 'https://github.com/Irev-Dev/Round-Anything', files: [L('lib-Round-Anything')] },
      { name: 'dotSCAD', version: '3.3', license: 'LGPL-3.0', url: 'https://github.com/JustinSDK/dotSCAD', files: [L('lib-dotSCAD'), GPL3] },
      { name: 'gridfinity-rebuilt-openscad', license: 'MIT', url: 'https://github.com/kennetek/gridfinity-rebuilt-openscad', files: [L('lib-gridfinity-rebuilt-openscad')] },
    ],
  },
  {
    group: 'about.group.fonts',
    parts: [
      { name: 'Liberation Sans, Allerta Stencil, Bebas Neue, Pacifico', license: 'OFL-1.1', url: 'https://openfontlicense.org', files: ['fonts/LICENSE.txt'] },
    ],
  },
];
