// Overhangs: faces pointing down more steeply than 45° from upright print onto nothing – each layer
// sticks out further than half a line width past the one under it, so without support it droops. On
// the mesh: triangles above the bed whose normal points down between 46° and nearly flat (flat ones
// are bridges, ceilings.ts), joined where they share a corner. A narrow ledge prints with little
// droop, so one only counts when it reaches out 2 mm or more: twice its area seen from below over
// its outline seen from below (a strip's width).

import { weld } from './floating';

export interface Overhang {
  min: [number, number, number];
  max: [number, number, number];
  /** Its area (mm²). */
  area: number;
  /** The steepest part, in degrees from upright (90 = flat). */
  angle: number;
  /** About how far it reaches out (mm). */
  reach: number;
}

/** Steeper than this (degrees from upright, with a degree to spare for faceted curves) needs support. */
export const MAX_OVERHANG = 45;
/** Pointing down more than this is flat: a bridge, not an overhang. */
const FLAT_NZ = 0.995;
/** Ledges reaching out less than this (mm) print with little droop. */
const MIN_REACH = 2;
/** Smaller than this (mm²) is not worth a word. */
const MIN_AREA = 1;
/** A triangle no higher than this (mm) above the bottom lies on the bed. */
const ON_BED = 0.01;

export function overhangs(pos: Float32Array): Overhang[] {
  const n = pos.length / 9;
  if (!n) return [];
  const { id, count } = weld(pos);
  let bottom = Infinity;
  for (let c = 2; c < pos.length; c += 3) bottom = Math.min(bottom, pos[c]);
  const steep = Math.sin(((MAX_OVERHANG + 1) * Math.PI) / 180);

  // The steep downward triangles above the bed, with their area and normal's z.
  const tris: number[] = [], area: number[] = [], nzs: number[] = [];
  for (let t = 0; t < n; t++) {
    const p = t * 9;
    if (Math.max(pos[p + 2], pos[p + 5], pos[p + 8]) <= bottom + ON_BED) continue;
    const ux = pos[p + 3] - pos[p], uy = pos[p + 4] - pos[p + 1], uz = pos[p + 5] - pos[p + 2];
    const vx = pos[p + 6] - pos[p], vy = pos[p + 7] - pos[p + 1], vz = pos[p + 8] - pos[p + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!l || nz / l < -FLAT_NZ || nz / l >= -steep) continue;
    tris.push(t);
    area.push(l / 2);
    nzs.push(nz / l);
  }
  if (!tris.length) return [];

  // Joined where they share a corner.
  const parent = new Int32Array(count).fill(-1);
  const find = (v: number) => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  for (const t of tris) for (let k = 0; k < 3; k++) if (parent[id[t * 3 + k]] < 0) parent[id[t * 3 + k]] = id[t * 3 + k];
  for (const t of tris) {
    const a = find(id[t * 3]);
    for (let k = 1; k < 3; k++) {
      const b = find(id[t * 3 + k]);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  tris.forEach((t, i) => {
    const r = find(id[t * 3]), list = groups.get(r);
    if (list) list.push(i);
    else groups.set(r, [i]);
  });

  const out: Overhang[] = [];
  for (const list of groups.values()) {
    let total = 0, below = 0, steepest = 0;
    for (const i of list) {
      total += area[i];
      below += area[i] * -nzs[i];
      steepest = Math.max(steepest, -nzs[i]);
    }
    if (total < MIN_AREA) continue;
    // Its outline seen from below: the edges only one of its triangles has.
    const edges = new Map<number, number>();
    const key = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
    for (const i of list) {
      const t = tris[i];
      for (let k = 0; k < 3; k++) {
        const e = key(id[t * 3 + k], id[t * 3 + (k + 1) % 3]);
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    let outline = 0;
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const i of list) {
      const t = tris[i], p = t * 9;
      for (let k = 0; k < 3; k++) {
        const a = p + k * 3, b = p + ((k + 1) % 3) * 3;
        if (edges.get(key(id[t * 3 + k], id[t * 3 + (k + 1) % 3])) === 1) outline += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1]);
        for (let j = 0; j < 3; j++) {
          min[j] = Math.min(min[j], pos[a + j]);
          max[j] = Math.max(max[j], pos[a + j]);
        }
      }
    }
    const reach = outline ? (2 * below) / outline : 0;
    if (reach < MIN_REACH) continue;
    out.push({ min, max, area: total, angle: (Math.asin(Math.min(1, steepest)) * 180) / Math.PI, reach });
  }
  return out.sort((a, b) => b.area - a.area);
}
