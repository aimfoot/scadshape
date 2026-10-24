// Long flat ceilings: a printer bridges a flat ceiling with strands stretched between the walls
// under it, and beyond about 20 mm they sag. On the mesh: flat, downward-facing patches above the bed;
// the walls holding one up are its edges where the surface goes on downwards. The bridge is twice the
// furthest any point of the patch is from such a wall (a 90 × 10 mm ceiling is a 10 mm bridge, as the
// slicer lays the strands the short way). When the ceiling is walled all round and nothing at all is
// under it down to the bed, the hollow is open at the bottom and closed at the top – a box upside
// down, or a cavity cut through its floor, a typical AI mistake.

import { FLAT, TOUCH, weld } from './floating';

export interface FlatCeiling {
  z: number;
  min: [number, number];
  max: [number, number];
  /** About how far the strands must bridge (mm). */
  span: number;
  /** Nothing under it down to the bed: the hollow is open at the bottom. */
  openBelow: boolean;
}

/** Bridges longer than this (mm) are reported. */
export const MAX_BRIDGE = 20;
/** A hollow open to the bed is only called one from this height (mm). */
const HOLLOW = 5;

/** Is the outer edge of a ceiling (its biggest loop of rim edges; the others are holes in it) all walls? */
function walledAllRound(rim: { a: number; b: number; wall: boolean; x: number; y: number }[]) {
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let r = v;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(v, r);
    return r;
  };
  for (const e of rim) {
    const a = find(e.a), b = find(e.b);
    parent.set(a, a);
    if (a !== b) parent.set(b, a);
  }
  const loops = new Map<number, { wall: boolean; min: number[]; max: number[] }>();
  for (const e of rim) {
    const r = find(e.a), l = loops.get(r) ?? { wall: true, min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    l.wall &&= e.wall;
    l.min = [Math.min(l.min[0], e.x), Math.min(l.min[1], e.y)];
    l.max = [Math.max(l.max[0], e.x), Math.max(l.max[1], e.y)];
    loops.set(r, l);
  }
  let outer: { wall: boolean; min: number[]; max: number[] } | null = null, size = -1;
  for (const l of loops.values()) {
    const s = (l.max[0] - l.min[0]) * (l.max[1] - l.min[1]);
    if (s > size) [outer, size] = [l, s];
  }
  return outer?.wall ?? false;
}

export function flatCeilings(pos: Float32Array): FlatCeiling[] {
  const n = pos.length / 9;
  if (!n) return [];
  const { id, count } = weld(pos);
  const z = new Float64Array(count);
  for (let c = 0; c < id.length; c++) z[id[c]] = pos[c * 3 + 2];
  let bottom = Infinity;
  for (let v = 0; v < count; v++) bottom = Math.min(bottom, z[v]);

  // Flat triangles facing down, above the bed.
  const flat = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [id[t * 3], id[t * 3 + 1], id[t * 3 + 2]], p = t * 9;
    const up = (pos[p + 3] - pos[p]) * (pos[p + 7] - pos[p + 1]) - (pos[p + 4] - pos[p + 1]) * (pos[p + 6] - pos[p]);
    flat[t] = Number(up < 0 && Math.abs(z[a] - z[b]) <= FLAT && Math.abs(z[a] - z[c]) <= FLAT && z[a] - bottom > TOUCH);
  }
  // The flat triangles' edges → the triangles on them (only those edges: most of a model is not
  // ceiling), and flat triangles joined over shared edges into patches.
  const edges = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
  for (let t = 0; t < n; t++) if (flat[t]) for (let k = 0; k < 3; k++) edges.set(key(id[t * 3 + k], id[t * 3 + (k + 1) % 3]), []);
  if (!edges.size) return [];
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++) edges.get(key(id[t * 3 + k], id[t * 3 + (k + 1) % 3]))?.push(t);
  const parent = new Int32Array(n);
  for (let t = 0; t < n; t++) parent[t] = t;
  const find = (t: number) => {
    while (parent[t] !== t) t = parent[t] = parent[parent[t]];
    return t;
  };
  for (const list of edges.values()) {
    const f = list.filter(t => flat[t]);
    for (let i = 1; i < f.length; i++) {
      const a = find(f[0]), b = find(f[i]);
      if (a !== b && Math.abs(pos[f[0] * 9 + 2] - pos[f[i] * 9 + 2]) <= FLAT) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const patches = new Map<number, number[]>();
  for (let t = 0; t < n; t++) if (flat[t]) {
    const r = find(t), list = patches.get(r);
    if (list) list.push(t);
    else patches.set(r, [t]);
  }

  const out: FlatCeiling[] = [];
  for (const tris of patches.values()) {
    const h = pos[tris[0] * 9 + 2];
    // Its walls: patch edges where the surface beyond goes down.
    const inPatch = new Set(tris), walls: number[] = [];
    const rim: { a: number; b: number; wall: boolean; x: number; y: number }[] = [];
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const a = id[t * 3 + k], b = id[t * 3 + (k + 1) % 3];
        const beyond = edges.get(key(a, b))!.filter(o => o !== t);
        if (beyond.some(o => inPatch.has(o))) continue;
        const wall = beyond.some(o => [0, 1, 2].some(j => z[id[o * 3 + j]] < h - FLAT));
        if (wall) walls.push(pos[t * 9 + k * 3], pos[t * 9 + k * 3 + 1], pos[t * 9 + ((k + 1) % 3) * 3], pos[t * 9 + ((k + 1) % 3) * 3 + 1]);
        rim.push({ a, b, wall, x: pos[t * 9 + k * 3], y: pos[t * 9 + k * 3 + 1] });
      }
    if (!walls.length) continue; // held by nothing: a start in mid-air (floating.ts)
    // How far from the nearest wall, at points spread over the patch (about 1 mm apart, at most ~2000).
    let area = 0;
    const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
    for (const t of tris) {
      const p = t * 9;
      area += Math.abs((pos[p + 3] - pos[p]) * (pos[p + 7] - pos[p + 1]) - (pos[p + 4] - pos[p + 1]) * (pos[p + 6] - pos[p])) / 2;
      for (let k = 0; k < 9; k += 3) {
        min[0] = Math.min(min[0], pos[p + k]); min[1] = Math.min(min[1], pos[p + k + 1]);
        max[0] = Math.max(max[0], pos[p + k]); max[1] = Math.max(max[1], pos[p + k + 1]);
      }
    }
    // Too small to bridge far, even held at one end only (no point is further from a wall than the diagonal).
    if (2 * Math.hypot(max[0] - min[0], max[1] - min[1]) <= MAX_BRIDGE) continue;
    const step = Math.max(1, Math.sqrt(area / 2000));
    let reach = 0, far: [number, number] = [0, 0];
    const dist = (x: number, y: number) => {
      let d = Infinity;
      for (let w = 0; w < walls.length; w += 4) {
        const [ax, ay, bx, by] = [walls[w], walls[w + 1], walls[w + 2], walls[w + 3]];
        const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
        const s = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
        d = Math.min(d, Math.hypot(x - ax - s * dx, y - ay - s * dy));
      }
      return d;
    };
    const sample = (x: number, y: number) => {
      const d = dist(x, y);
      if (d > reach) [reach, far] = [d, [x, y]];
    };
    // A grid over the whole patch (each point once), plus each triangle's middle for the small ones.
    let s = step;
    while (((max[0] - min[0]) / s + 1) * ((max[1] - min[1]) / s + 1) > 4e6) s *= 2;
    const nx = Math.floor((max[0] - min[0]) / s) + 1, ny = Math.floor((max[1] - min[1]) / s) + 1;
    const done = new Uint8Array(nx * ny);
    for (const t of tris) {
      const p = t * 9;
      const [x0, y0, x1, y1, x2, y2] = [pos[p], pos[p + 1], pos[p + 3], pos[p + 4], pos[p + 6], pos[p + 7]];
      sample((x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3);
      const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!d) continue;
      for (let i = Math.ceil((Math.min(x0, x1, x2) - min[0]) / s); i * s + min[0] <= Math.max(x0, x1, x2); i++)
        for (let j = Math.ceil((Math.min(y0, y1, y2) - min[1]) / s); j * s + min[1] <= Math.max(y0, y1, y2); j++) {
          if (done[i * ny + j]) continue;
          const x = min[0] + i * s, y = min[1] + j * s;
          const u = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / d, v = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / d;
          if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
          done[i * ny + j] = 1;
          sample(x, y);
        }
    }
    if (2 * reach <= MAX_BRIDGE) continue;
    // Straight down from its middle: is anything in the way before the bed? Only for a real hollow,
    // walled all round: a plate raised a little on purpose (to print on supports) or a bridge over a
    // gap is not a box upside down.
    let openBelow = h - bottom >= HOLLOW && walledAllRound(rim);
    for (let t = 0; t < n && openBelow; t++) {
      const p = t * 9;
      if (Math.min(pos[p + 2], pos[p + 5], pos[p + 8]) >= h - TOUCH) continue;
      const [x0, y0, x1, y1, x2, y2] = [pos[p], pos[p + 1], pos[p + 3], pos[p + 4], pos[p + 6], pos[p + 7]];
      const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((far[0] - x0) * (y2 - y0) - (x2 - x0) * (far[1] - y0)) / d, v = ((x1 - x0) * (far[1] - y0) - (far[0] - x0) * (y1 - y0)) / d;
      openBelow = !(u >= 0 && v >= 0 && u + v <= 1);
    }
    out.push({ z: h, min, max, span: 2 * reach, openBelow });
  }
  return out.sort((a, b) => b.span - a.span);
}
