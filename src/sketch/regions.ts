// Closed regions in a sketch, like in a CAD program: the curves are split where they cross each
// other, loose ends are cleaned away and every bounded face in the planar graph becomes a region.
// Separate components lying inside a face become holes (and islands in the holes material again).
// Construction geometry does not count.

import { arcPoints, ccwSweep, dist, normAngle, pointInPolygon, polar, signedArea, TAU, type Vec } from './geom';
import { arcGeom, type SketchData } from './model';

export interface Loop {
  pts: Vec[]; // closed polygon (the last point is not repeated), counterclockwise
  area: number; // absolute area, mm²
  entityIds: string[]; // curves that form the edge
  circle?: { c: Vec; r: number; fn?: number }; // a separate full circle
  component: number; // connected group of curves
  depth: number; // number of regions (in other components) that enclose this one
  parent: number; // index of the nearest enclosing region, −1 if none
}

const EPS = 1e-7;

/** A curve in parametric form: line t∈[0,1] between a and b, or arc θ = a0 + t·sweep. */
type Curve =
  | { id: string; kind: 'line'; a: Vec; b: Vec }
  | { id: string; kind: 'arc'; c: Vec; r: number; a0: number; sweep: number; closed: boolean; fn?: number };

function curveAt(cv: Curve, t: number): Vec {
  return cv.kind === 'line'
    ? { x: cv.a.x + (cv.b.x - cv.a.x) * t, y: cv.a.y + (cv.b.y - cv.a.y) * t }
    : polar(cv.c, cv.r, cv.a0 + cv.sweep * t);
}

/** Parameter for a point on an arc, or null if it lies outside the arc. */
function arcParam(cv: Extract<Curve, { kind: 'arc' }>, p: Vec): number | null {
  let s = normAngle(Math.atan2(p.y - cv.c.y, p.x - cv.c.x) - cv.a0);
  if (s > TAU - 1e-9) s = 0;
  const tol = 1e-9 + EPS / Math.max(cv.r, EPS);
  if (s <= cv.sweep + tol) return Math.min(1, s / cv.sweep);
  if (TAU - s < tol) return 0;
  return null;
}

function circleLine(c: Vec, r: number, a: Vec, b: Vec): { t: number; p: Vec }[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (A < EPS * EPS || disc < -1e-12 * A * r * r) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const ts = sq < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.filter(t => t >= -1e-9 && t <= 1 + 1e-9).map(t => ({ t: Math.min(1, Math.max(0, t)), p: { x: a.x + dx * t, y: a.y + dy * t } }));
}

function circleCircle(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * (c2.x - c1.x)) / d, my = c1.y + (a * (c2.y - c1.y)) / d;
  const ox = (h * (c2.y - c1.y)) / d, oy = (h * (c2.x - c1.x)) / d;
  return h < EPS ? [{ x: mx, y: my }] : [{ x: mx + ox, y: my - oy }, { x: mx - ox, y: my + oy }];
}

/** Intersections between two curves as parameter pairs. */
function intersect(p: Curve, q: Curve): { tp: number; tq: number; at: Vec }[] {
  if (p.kind === 'line' && q.kind === 'line') {
    const r = { x: p.b.x - p.a.x, y: p.b.y - p.a.y }, s = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) return []; // parallel
    const w = { x: q.a.x - p.a.x, y: q.a.y - p.a.y };
    const t = (w.x * s.y - w.y * s.x) / den, u = (w.x * r.y - w.y * r.x) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
    const tc = Math.min(1, Math.max(0, t));
    return [{ tp: tc, tq: Math.min(1, Math.max(0, u)), at: curveAt(p, tc) }];
  }
  if (p.kind === 'line' && q.kind === 'arc') return intersect(q, p).map(x => ({ tp: x.tq, tq: x.tp, at: x.at }));
  if (p.kind === 'arc' && q.kind === 'line')
    return circleLine(p.c, p.r, q.a, q.b).flatMap(({ t, p: pt }) => {
      const tp = arcParam(p, pt);
      return tp === null ? [] : [{ tp, tq: t, at: pt }];
    });
  const a = p as Extract<Curve, { kind: 'arc' }>, b = q as Extract<Curve, { kind: 'arc' }>;
  return circleCircle(a.c, a.r, b.c, b.r).flatMap(pt => {
    const tp = arcParam(a, pt), tq = arcParam(b, pt);
    return tp === null || tq === null ? [] : [{ tp, tq, at: pt }];
  });
}

interface SubEdge {
  u: number; // start vertex
  v: number; // end vertex
  pts: Vec[]; // polyline from u to v
  entity: string;
}
interface Half {
  edge: SubEdge;
  fwd: boolean;
  from: number;
  to: number;
  angle: number;
}

export function findLoops(sk: SketchData): { loops: Loop[]; inLoop: Set<string> } {
  // 1. Curves
  const curves: Curve[] = [];
  for (const [id, e] of Object.entries(sk.entities)) {
    if (e.construction) continue;
    if (e.type === 'line') {
      const a = sk.points[e.p1], b = sk.points[e.p2];
      if (dist(a, b) > EPS) curves.push({ id, kind: 'line', a, b });
    } else if (e.type === 'circle') {
      if (e.r > EPS) curves.push({ id, kind: 'arc', c: sk.points[e.c], r: e.r, a0: 0, sweep: TAU, closed: true, fn: e.fn });
    } else {
      const g = arcGeom(sk, e);
      if (g.r > EPS) curves.push({ id, kind: 'arc', c: g.c, r: g.r, a0: g.a0, sweep: g.sweep, closed: false });
    }
  }

  // 2. Split points per curve (end points + intersections)
  const verts: Vec[] = [];
  const vertexAt = (p: Vec) => {
    for (let i = 0; i < verts.length; i++) if (dist(verts[i], p) < 1e-6) return i;
    verts.push(p);
    return verts.length - 1;
  };
  const splits: { t: number; v: number }[][] = curves.map(cv =>
    cv.kind === 'arc' && cv.closed ? [] : [{ t: 0, v: vertexAt(curveAt(cv, 0)) }, { t: 1, v: vertexAt(curveAt(cv, 1)) }],
  );
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++)
      for (const x of intersect(curves[i], curves[j])) {
        const v = vertexAt(x.at);
        splits[i].push({ t: x.tp, v });
        splits[j].push({ t: x.tq, v });
      }

  // 3. Split the curves into sub-edges
  const edges: SubEdge[] = [];
  const standaloneCircles: number[] = [];
  const piece = (cv: Curve, t0: number, t1: number, u: number, v: number) => {
    let pts: Vec[];
    if (cv.kind === 'line') pts = [curveAt(cv, t0), curveAt(cv, t1)];
    else pts = arcPoints(cv.c, cv.r, cv.a0 + cv.sweep * t0, cv.sweep * (t1 - t0));
    pts[0] = verts[u];
    pts[pts.length - 1] = verts[v];
    if (u === v) {
      // Self-loop (e.g. a circle touching something at one point): split in the middle.
      const m = vertexAt(curveAt(cv, (t0 + t1) / 2));
      piece(cv, t0, (t0 + t1) / 2, u, m);
      piece(cv, (t0 + t1) / 2, t1, m, v);
      return;
    }
    edges.push({ u, v, pts, entity: cv.id });
  };
  curves.forEach((cv, i) => {
    const sp = splits[i].sort((a, b) => a.t - b.t);
    // Remove duplicates (the same vertex twice in a row).
    const uniq = sp.filter((s, k) => k === 0 || s.v !== sp[k - 1].v);
    if (cv.kind === 'arc' && cv.closed) {
      if (!uniq.length) return standaloneCircles.push(i);
      if (uniq.length > 1 && uniq[0].v === uniq[uniq.length - 1].v) uniq.pop();
      for (let k = 0; k < uniq.length; k++) {
        const a = uniq[k], b = uniq[(k + 1) % uniq.length];
        piece(cv, a.t, k + 1 < uniq.length ? b.t : b.t + 1, a.v, b.v);
      }
    } else for (let k = 0; k + 1 < uniq.length; k++) piece(cv, uniq[k].t, uniq[k + 1].t, uniq[k].v, uniq[k + 1].v);
  });

  // 4. Clean away loose ends (vertices with a single edge), repeatedly.
  let live = edges.filter(e => e.u !== e.v);
  for (;;) {
    const deg = new Map<number, number>();
    for (const e of live) for (const v of [e.u, e.v]) deg.set(v, (deg.get(v) ?? 0) + 1);
    const next = live.filter(e => deg.get(e.u)! > 1 && deg.get(e.v)! > 1);
    if (next.length === live.length) break;
    live = next;
  }

  // 5. Components (union-find over vertices)
  const parent = verts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of live) parent[find(e.u)] = find(e.v);

  // 6. Faces: walk around the half-edges; at each vertex take the edge closest clockwise from the
  // twin.
  const out = new Map<number, Half[]>();
  const halves: Half[] = [];
  for (const e of live)
    for (const fwd of [true, false]) {
      const pts = fwd ? e.pts : e.pts.slice().reverse();
      const h: Half = { edge: e, fwd, from: pts[0] === verts[e.u] && fwd ? e.u : fwd ? e.u : e.v, to: fwd ? e.v : e.u, angle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) };
      halves.push(h);
      if (!out.has(h.from)) out.set(h.from, []);
      out.get(h.from)!.push(h);
    }
  for (const list of out.values()) list.sort((a, b) => a.angle - b.angle);
  const twin = (h: Half) => out.get(h.to)!.find(x => x.edge === h.edge && x.fwd !== h.fwd)!;

  const loops: Omit<Loop, 'depth' | 'parent'>[] = [];
  const seen = new Set<Half>();
  for (const h0 of halves) {
    if (seen.has(h0)) continue;
    const face: Half[] = [];
    let h = h0;
    let guard = halves.length + 1;
    do {
      seen.add(h);
      face.push(h);
      const tw = twin(h);
      const list = out.get(h.to)!;
      h = list[(list.indexOf(tw) - 1 + list.length) % list.length];
    } while (h !== h0 && --guard > 0);
    const pts: Vec[] = [];
    for (const f of face) {
      const p = f.fwd ? f.edge.pts : f.edge.pts.slice().reverse();
      pts.push(...p.slice(0, -1));
    }
    const area = signedArea(pts);
    if (area > 1e-9) loops.push({ pts, area, entityIds: [...new Set(face.map(f => f.edge.entity))], component: find(face[0].from) });
  }
  for (const i of standaloneCircles) {
    const cv = curves[i] as Extract<Curve, { kind: 'arc' }>;
    const pts = arcPoints(cv.c, cv.r, 0, TAU);
    pts.pop();
    loops.push({ pts, area: Math.PI * cv.r * cv.r, entityIds: [cv.id], circle: { c: cv.c, r: cv.r, fn: cv.fn }, component: -1 - i });
  }

  // 7. Nesting between components: B lies in A if (a sample of) B's points lie in A.
  const nested: Loop[] = loops.map(l => ({ ...l, depth: 0, parent: -1 }));
  const contains = (a: Loop, b: Loop) => {
    if (a.component === b.component || a.area <= b.area) return false;
    const step = Math.max(1, Math.floor(b.pts.length / 16));
    for (let i = 0; i < b.pts.length; i += step) if (!pointInPolygon(b.pts[i], a.pts)) return false;
    return true;
  };
  for (let i = 0; i < nested.length; i++) {
    let parentArea = Infinity;
    for (let j = 0; j < nested.length; j++) {
      if (i === j || !contains(nested[j], nested[i])) continue;
      nested[i].depth++;
      if (nested[j].area < parentArea) {
        parentArea = nested[j].area;
        nested[i].parent = j;
      }
    }
  }
  const inLoop = new Set(nested.flatMap(l => l.entityIds));
  return { loops: nested, inLoop };
}

/** Number of curve ends (lines/arcs, not construction) per point: 1 = open end. */
export function endpointDegrees(sk: SketchData): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of Object.values(sk.entities)) {
    if (e.construction || e.type === 'circle') continue;
    for (const p of [e.p1, e.p2]) deg.set(p, (deg.get(p) ?? 0) + 1);
  }
  return deg;
}

export { ccwSweep };

// ---- Regions for features ------------------------------------------------------------
//
// Each loop gives a region: the loop minus the loops directly inside it (the holes). A region is
// identified in features by a point inside it (a "seed"), so the choice survives changes to the
// sketch as long as the point still lands in the region.

export interface Region {
  loop: number; // index in loops
  holes: number[];
  seed: Vec; // point guaranteed to be inside the region
  area: number;
  depth: number;
}

/** A point inside the polygon `outer` but outside `holes` (the widest span on a few sweeping lines). */
export function interiorPoint(outer: Vec[], holes: Vec[][]): Vec {
  const all = [outer, ...holes];
  const ys = outer.map(p => p.y);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best: Vec = outer[0];
  let bestW = -1;
  for (let k = 1; k <= 15; k++) {
    // Avoid exact corner heights with an irrational offset.
    const y = y0 + ((y1 - y0) * (k - 0.5 + 0.0137 * Math.SQRT2)) / 15.3;
    const xs: number[] = [];
    for (const poly of all)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bestW) {
        bestW = w;
        best = { x: (xs[i] + xs[i + 1]) / 2, y };
      }
    }
  }
  return best;
}

export function regionsOf(loops: Loop[]): Region[] {
  return loops.map((l, i) => {
    const holes = loops.map((h, j) => (h.parent === i ? j : -1)).filter(j => j >= 0);
    return {
      loop: i,
      holes,
      seed: interiorPoint(l.pts, holes.map(j => loops[j].pts)),
      area: l.area - holes.reduce((a, j) => a + loops[j].area, 0),
      depth: l.depth,
    };
  });
}

/** The region containing the point p (the smallest if several), or −1. */
export function regionAt(regions: Region[], loops: Loop[], p: Vec): number {
  let best = -1;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (!pointInPolygon(p, loops[r.loop].pts) || r.holes.some(h => pointInPolygon(p, loops[h].pts))) continue;
    if (best < 0 || r.area < regions[best].area) best = i;
  }
  return best;
}

/** Regions chosen by the seeds; null = default (everything that is material at even depth). */
export function selectRegions(regions: Region[], loops: Loop[], seeds: Vec[] | null): number[] {
  if (!seeds) return regions.map((r, i) => (r.depth % 2 === 0 ? i : -1)).filter(i => i >= 0);
  const out = new Set<number>();
  for (const s of seeds) {
    const i = regionAt(regions, loops, s);
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}
