// Sketch → OpenSCAD (2D). Profiles at even depth become material, their direct children (odd depth)
// are subtracted: union(material_i − holes_i).

import { segmentsFor } from './geom';
import type { Loop, Region } from './regions';

const num = (n: number) => {
  const s = (Math.round(n * 1e4) / 1e4).toString();
  return s === '-0' ? '0' : s;
};

function loopScad(l: Loop): string {
  if (l.circle) {
    const { c, r } = l.circle;
    const circ = `circle(r = ${num(r)}, $fn = ${segmentsFor(r, Math.PI * 2)});`;
    return c.x === 0 && c.y === 0 ? circ : `translate([${num(c.x)}, ${num(c.y)}]) ${circ}`;
  }
  return `polygon([${l.pts.map(p => `[${num(p.x)}, ${num(p.y)}]`).join(', ')}]);`;
}

/** 2D code for chosen regions (loop minus holes), or null if nothing is chosen. */
export function selectedRegionsScad(loops: Loop[], regions: Region[], selected: number[], indent = '  '): string | null {
  const parts = selected.map(i => {
    const r = regions[i];
    const l = loops[r.loop];
    if (!r.holes.length) return indent + loopScad(l);
    return (
      `${indent}difference() {\n${indent}  ${loopScad(l)}\n` +
      r.holes.map(h => `${indent}  ${loopScad(loops[h])}\n`).join('') +
      `${indent}}`
    );
  });
  return parts.length ? parts.join('\n') : null;
}

/** 2D code for all closed profiles, or null if there are none. */
export function regionsScad(loops: Loop[], indent = '  '): string | null {
  const parts: string[] = [];
  loops.forEach((l, i) => {
    if (l.depth % 2) return;
    const holes = loops.filter(h => h.parent === i);
    if (!holes.length) parts.push(indent + loopScad(l));
    else
      parts.push(
        `${indent}difference() {\n${indent}  ${loopScad(l)}\n` +
          holes.map(h => `${indent}  ${loopScad(h)}\n`).join('') +
          `${indent}}`,
      );
  });
  return parts.length ? parts.join('\n') : null;
}
