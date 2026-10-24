// Cuts that miss: a part taken away in difference() that doesn't touch the shape it is cut from, so
// it removes nothing – OpenSCAD renders it without a word. A typical AI mistake: text "engraved" on
// the outside of a ring but extruded outward from the surface, or cut into the ring's hole. Checked
// on the geometry: from the CSG export (modules and loops already evaluated), one extra render with
// two places per cut, far apart along x – the cut on its own, and the cut intersected with the shape
// it is cut from (the body minus the other cuts). A cut that has a shape of its own but leaves its
// intersection empty misses.

import { csgToScad, parseCsg, type CsgNode } from './convert/csg';

export interface CutTest {
  /** The cut in a few words: text("love"), cylinder(d = 18) … */
  what: string;
  /** Its leading primitive (text, cylinder …) and, for text, the string: to find its line in the code. */
  prim: string;
  text?: string;
}

/** Far enough apart that no model reaches the next place (mm). */
const SLOT = 1e5;
/** At most this many cuts per check (a honeycomb of holes has hundreds; the first ones tell). */
const MAX_TESTS = 40;
/** Up to this many cuts in one difference(), each is tested against the body minus the others. */
const MAX_OTHERS = 8;
const GROUPS = new Set(['group', 'union', 'color', 'render', 'children']);
/** Their children are 2D: a difference in there is of outlines, not of bodies. */
const FLAT = new Set(['linear_extrude', 'rotate_extrude', 'projection', 'roof']);
const PRIMS = new Set(['text', 'cube', 'cylinder', 'sphere', 'polyhedron', 'import', 'surface', 'square', 'circle', 'polygon']);

const empty = (n: CsgNode): boolean => (GROUPS.has(n.name) || n.name === 'multmatrix') && n.children.every(empty);

/** The cut in a few words, from its first primitive. */
function describe(n: CsgNode): Pick<CutTest, 'what' | 'prim' | 'text'> {
  const prims: CsgNode[] = [];
  const walk = (c: CsgNode) => {
    if (PRIMS.has(c.name)) prims.push(c);
    else c.children.forEach(walk);
  };
  walk(n);
  const p = prims[0];
  if (!p) return { what: `${n.name}()`, prim: n.name };
  const r = (k: string) => (typeof p.args[k] === 'number' ? Math.round((p.args[k] as number) * 100) / 100 : null);
  const more = prims.length > 1 ? ' …' : '';
  if (p.name === 'text') return { what: `text(${JSON.stringify(p.args.text)})${more}`, prim: 'text', text: String(p.args.text) };
  if (p.name === 'cylinder') {
    const d = r('r1') !== null && r('r1') === r('r2') ? `d = ${2 * r('r1')!}` : `r1 = ${r('r1')}, r2 = ${r('r2')}`;
    return { what: `cylinder(${d}, h = ${r('h')})${more}`, prim: 'cylinder' };
  }
  if (p.name === 'cube') {
    const s = Array.isArray(p.args.size) ? p.args.size.map(v => Math.round(Number(v) * 100) / 100).join(', ') : String(p.args.size);
    return { what: `cube([${s}])${more}`, prim: 'cube' };
  }
  if (p.name === 'sphere') return { what: `sphere(r = ${r('r')})${more}`, prim: 'sphere' };
  return { what: `${p.name}()${more}`, prim: p.name };
}

/** The test file for the cuts in a CSG export, or null when there is nothing to test. */
export function cutTests(csg: string): { scad: string; tests: CutTest[] } | null {
  const tests: CutTest[] = [];
  const parts: string[] = [];
  const walk = (n: CsgNode, flat: boolean) => {
    if (n.name === 'difference' && !flat && n.children.length > 1) {
      const [body, ...cuts] = n.children;
      const bodyScad = csgToScad(body), cutScad = cuts.map(c => csgToScad(c));
      cuts.forEach((c, i) => {
        if (tests.length >= MAX_TESTS || empty(c)) return;
        const k = tests.length;
        // What the cut is meant to cut: the body without the other cuts (text in a ring's hole is in
        // the body, not in the ring). With many cuts that costs too much: the body alone, which still
        // finds cuts outside the part.
        const others = cutScad.filter((_, j) => j !== i);
        const base = cuts.length <= MAX_OTHERS ? `difference() {\n${bodyScad}\n${others.join('\n')}\n}` : bodyScad;
        tests.push(describe(c));
        parts.push(`translate([${2 * k * SLOT}, 0, 0]) {\n${cutScad[i]}\n}`);
        parts.push(`translate([${(2 * k + 1) * SLOT}, 0, 0]) intersection() {\n${base}\n${cutScad[i]}\n}`);
      });
    }
    for (const c of n.children) walk(c, flat || FLAT.has(n.name));
  };
  let roots: CsgNode[];
  try {
    roots = parseCsg(csg);
  } catch {
    return null; // e.g. # or % modifiers in the export: not checked
  }
  for (const n of roots) walk(n, false);
  return tests.length ? { scad: parts.join('\n'), tests } : null;
}

/** The cuts that miss, from the rendered test file (its triangles). */
export function missedCuts(positions: Float32Array, tests: CutTest[]): CutTest[] {
  const filled = new Set<number>();
  for (let i = 0; i < positions.length; i += 3) filled.add(Math.round(positions[i] / SLOT));
  return tests.filter((_, k) => filled.has(2 * k) && !filled.has(2 * k + 1));
}

/** The line of the code a cut comes from, when it can be told: its text, or the only call of its primitive. */
export function cutLine(test: CutTest, src: string): number | null {
  const lines = src.split('\n');
  const code = (l: string) => l.replace(/\/\/.*$/, '');
  if (test.text !== undefined) {
    const lit = JSON.stringify(test.text);
    const i = lines.findIndex(l => code(l).includes(lit));
    if (i >= 0) return i + 1;
  }
  const re = new RegExp(`\\b${test.prim}\\s*\\(`);
  const hits = lines.flatMap((l, i) => (re.test(code(l)) ? [i + 1] : []));
  return hits.length === 1 ? hits[0] : null;
}
