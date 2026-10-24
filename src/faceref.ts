// Sketch on a face: which sketch plane a tapped face lies in (base plane or slanted), the model's
// outline in a sketch plane (a reference to snap to in the sketch) and an offset expression that
// follows the feature that created the face (base planes only; a slanted face stays fixed in
// space).

import { activeCount, type Doc, type SketchFeature } from './doc';
import { parseExpr } from './expr';
import type { Vars } from './expr';
import type { Vec } from './sketch/geom';
import type { Plane } from './sketch/model';
import { add, cross, dot, extrudeSpan, extrudeFace, scale, sketchFrame, sub, toPlane, toWorld, unit, type Frame, type V3 } from './frame';
import type { FaceRef } from './features/common';
import type { ExtrudeFeature } from './features/extrude';
import { arcGeom } from './sketch/model';
import { ccwSweep } from './sketch/geom';

/** The plane's offset direction in the world (XY: +Z, XZ: −Y, YZ: +X; the same as model3d). */
const AXIS: Record<Plane, { i: 0 | 1 | 2; sign: 1 | -1; u: 0 | 1 | 2; v: 0 | 1 | 2 }> = {
  XY: { i: 2, sign: 1, u: 0, v: 1 },
  XZ: { i: 1, sign: -1, u: 0, v: 2 },
  YZ: { i: 0, sign: 1, u: 1, v: 2 },
};

export interface FacePlane {
  plane: Plane;
  offset: number;
  /** The face points along the plane's negative normal (e.g. an underside). */
  flipped: boolean;
}

/** Sketch plane for a face with normal `n` through the point `p`; null if the face is slanted. */
export function facePlane(n: [number, number, number], p: [number, number, number]): FacePlane | null {
  for (const plane of ['XY', 'XZ', 'YZ'] as Plane[]) {
    const a = AXIS[plane];
    const d = n[a.i] * a.sign;
    if (Math.abs(Math.abs(d) - 1) < 1e-3) return { plane, offset: tidy(p[a.i] * a.sign), flipped: d < 0 };
  }
  return null;
}

/** Round away float32 noise (the STL has 32-bit coordinates). */
const tidy = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

export interface Reference {
  /** The faces' boundary lines in the sketch's (u, v). */
  segments: [Vec, Vec][];
  /** Corners (where the edge changes direction) and centers of round holes/bosses. */
  snaps: Vec[];
}

/**
 * The outline of the model's faces that lie in the sketch plane: edges that only one of the flat
 * triangles has (inner diagonals cancel out).
 */
export function planeReference(positions: Float32Array, frame: Frame): Reference {
  const tol = 1e-3 + Math.hypot(...frame.o) * 1e-5;
  const key = (u: number, v: number) => `${Math.round(u * 1000)},${Math.round(v * 1000)}`;
  const edges = new Map<string, { a: Vec; b: Vec; n: number }>();
  for (let t = 0; t < positions.length; t += 9) {
    const pts: Vec[] = [];
    for (let k = 0; k < 3; k++) {
      const q = toPlane(frame, [positions[t + k * 3], positions[t + k * 3 + 1], positions[t + k * 3 + 2]]);
      if (Math.abs(q.w) > tol) break;
      pts.push({ x: q.x, y: q.y });
    }
    if (pts.length < 3) continue;
    for (let k = 0; k < 3; k++) {
      const p = pts[k], q = pts[(k + 1) % 3];
      const kp = key(p.x, p.y), kq = key(q.x, q.y);
      if (kp === kq) continue;
      const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const e = edges.get(id);
      if (e) e.n++;
      else edges.set(id, { a: p, b: q, n: 1 });
    }
  }
  const segments = [...edges.values()].filter(e => e.n === 1).map(e => [e.a, e.b] as [Vec, Vec]);
  return { segments, snaps: referenceSnaps(segments) };
}

/** Neighbouring facets with a smaller angle than this count as the same (round) surface. */
const SMOOTH = Math.cos((30 * Math.PI) / 180);

/**
 * The reference in a sketch: the outline in the plane (planeReference) plus the whole surface that
 * the plane touches, projected onto the plane. A round or slanted surface (cylinder wall, fillet,
 * cone) grows from the facets lying in the plane across smooth edges, but only on the side facing
 * the sketch; the outline is the surface's edges and the silhouette where it turns away.
 */
export function sketchReference(positions: Float32Array, frame: Frame): Reference {
  const base = planeReference(positions, frame);
  const k = (p: Vec) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const sk = ([a, b]: [Vec, Vec]) => (k(a) < k(b) ? `${k(a)}|${k(b)}` : `${k(b)}|${k(a)}`);
  const surf = surfaceOutline(positions, frame);
  // On a round surface the facets in the plane are only a narrow strip: show the line of contact
  // instead of the strip's edges.
  const strip = new Set(surf.strip.map(sk));
  const segments = [...base.segments.filter(s => !strip.has(sk(s))), ...surf.outline];
  // The same edge can come from both: remove duplicates.
  const seen = new Set<string>();
  const uniq = segments.filter(([a, b]) => {
    const id = k(a) < k(b) ? `${k(a)}|${k(b)}` : `${k(b)}|${k(a)}`;
    if (seen.has(id) || k(a) === k(b)) return false;
    seen.add(id);
    return true;
  });
  return { segments: uniq, snaps: referenceSnaps(uniq) };
}

/**
 * The outline (in the plane's u, v) of the smooth surface that touches the plane, with the line of
 * contact; empty if no facet lies in the plane or the surface is flat. strip: the edges of the
 * facets in the plane.
 */
function smoothPatch(positions: Float32Array, frame: Frame) {
  const tol = 1e-3 + Math.hypot(...frame.o) * 1e-5;
  const nTri = positions.length / 9;
  const V = (t: number, k: number): V3 => [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]];
  const normals: V3[] = [];
  for (let t = 0; t < nTri; t++) {
    const a = V(t, 0);
    normals.push(unit(cross(sub(V(t, 1), a), sub(V(t, 2), a))));
  }
  // Start facets: in the plane. The surface's outside is determined by them (an underside points
  // along −normal).
  const seeds: number[] = [];
  let side = 0;
  for (let t = 0; t < nTri; t++) {
    let inPlane = true;
    for (let k = 0; k < 3 && inPlane; k++) if (Math.abs(toPlane(frame, V(t, k)).w) > tol) inPlane = false;
    const d = dot(normals[t], frame.n);
    if (!inPlane || Math.abs(d) < 0.999) continue;
    seeds.push(t);
    side += d;
  }
  if (!seeds.length) return null;
  const sn = scale(frame.n, side >= 0 ? 1 : -1);
  // Edges → facets (corners rounded so float32 noise does not split edges).
  const vk = (p: V3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const edges = new Map<string, number[]>();
  const edgeKey = (t: number, k: number) => {
    const a = vk(V(t, k)), b = vk(V(t, (k + 1) % 3));
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  for (let t = 0; t < nTri; t++)
    for (let k = 0; k < 3; k++) {
      const id = edgeKey(t, k);
      const list = edges.get(id);
      if (list) list.push(t);
      else edges.set(id, [t]);
    }
  const facing = (t: number) => dot(normals[t], sn) > 1e-3;
  const inPatch = new Set(seeds.filter(facing));
  const queue = [...inPatch];
  while (queue.length) {
    const t = queue.pop()!;
    for (let k = 0; k < 3; k++)
      for (const u of edges.get(edgeKey(t, k)) ?? []) {
        if (inPatch.has(u) || !facing(u) || dot(normals[t], normals[u]) < SMOOTH) continue;
        inPatch.add(u);
        queue.push(u);
      }
  }
  if (inPatch.size === seeds.length) return null; // only flat facets
  return { V, vk, edges, edgeKey, seeds, inPatch, sn };
}

/** How far (mm) the round surface falls away below the plane within the area box (the plane's u, v); 0 for a flat surface. */
export function surfaceDepth(positions: Float32Array, frame: Frame, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const patch = smoothPatch(positions, frame);
  if (!patch) return 0;
  let depth = 0;
  for (const t of patch.inPatch) {
    const q = [0, 1, 2].map(k => patch.V(t, k));
    const uv = q.map(p => toPlane(frame, p));
    if (Math.max(...uv.map(p => p.x)) < box.x0 || Math.min(...uv.map(p => p.x)) > box.x1) continue;
    if (Math.max(...uv.map(p => p.y)) < box.y0 || Math.min(...uv.map(p => p.y)) > box.y1) continue;
    for (const p of q) depth = Math.max(depth, -dot(sub(p, frame.o), patch.sn));
  }
  return Math.ceil(depth * 100) / 100;
}

function surfaceOutline(positions: Float32Array, frame: Frame): { outline: [Vec, Vec][]; strip: [Vec, Vec][] } {
  const patch = smoothPatch(positions, frame);
  if (!patch) return { outline: [], strip: [] };
  const { V, vk, edges, edgeKey, seeds, inPatch } = patch;
  const uv = (p: V3): Vec => {
    const q = toPlane(frame, p);
    return { x: q.x, y: q.y };
  };
  const out: [Vec, Vec][] = [];
  for (const t of inPatch)
    for (let k = 0; k < 3; k++) {
      const others = (edges.get(edgeKey(t, k)) ?? []).filter(u => u !== t && inPatch.has(u));
      if (others.length) continue;
      const a = uv(V(t, k)), b = uv(V(t, (k + 1) % 3));
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) out.push([a, b]);
    }
  // The line of contact: through the middle of the strip along its main direction, as long as the
  // strip.
  const strip: [Vec, Vec][] = [];
  const corners = new Map<string, Vec>(); // each corner once (shared corners would skew the direction)
  for (const t of seeds)
    for (let k = 0; k < 3; k++) {
      const a = uv(V(t, k));
      strip.push([a, uv(V(t, (k + 1) % 3))]);
      corners.set(vk(V(t, k)), a);
    }
  const pts = [...corners.values()];
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    sxx += (p.x - c.x) ** 2;
    syy += (p.y - c.y) ** 2;
    sxy += (p.x - c.x) * (p.y - c.y);
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  const along = pts.map(p => (p.x - c.x) * dir.x + (p.y - c.y) * dir.y);
  const at = (s: number): Vec => ({ x: c.x + dir.x * s, y: c.y + dir.y * s });
  if (Math.max(...along) - Math.min(...along) > 1e-6) out.push([at(Math.min(...along)), at(Math.max(...along))]);
  return { outline: out, strip };
}

export interface SlantedFace {
  /** Nearest base plane (for the name). */
  plane: Plane;
  face: { o: V3; u: V3; v: V3 };
}

/**
 * Plane for a slanted face: the normal and position from all triangles in the same plane as the
 * tapped one (weighted by area – a single thin triangle gives an inaccurate normal). u runs
 * horizontally along the face, v up the slope and the normal points out of the body; origin in the
 * face's lower left corner.
 */
export function slantedFace(positions: Float32Array, n0: V3, p0: V3): SlantedFace {
  n0 = unit(n0);
  let ns: V3 = [0, 0, 0], cs: V3 = [0, 0, 0], area = 0;
  for (let t = 0; t < positions.length; t += 9) {
    const a: V3 = [positions[t], positions[t + 1], positions[t + 2]];
    const b: V3 = [positions[t + 3], positions[t + 4], positions[t + 5]];
    const c: V3 = [positions[t + 6], positions[t + 7], positions[t + 8]];
    const cr = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(...cr);
    if (len < 1e-12 || dot(cr, n0) / len < 0.9999) continue;
    const centroid = scale(add(a, b, c), 1 / 3);
    if (Math.abs(dot(sub(centroid, p0), n0)) > 0.01) continue;
    ns = add(ns, cr);
    cs = add(cs, scale(centroid, len));
    area += len;
  }
  const n = area > 0 ? unit(ns) : n0;
  const c = area > 0 ? scale(cs, 1 / area) : p0;
  let u = cross([0, 0, 1], n);
  u = Math.hypot(...u) < 1e-6 ? [1, 0, 0] : unit(u);
  const v = cross(n, u);
  // Origin: first in the face's plane through the centroid, then moved to the lower left corner.
  const o0 = c, frame = { o: o0, u, v, n };
  const ref = planeReference(positions, frame);
  const corners = ref.snaps.length ? ref.snaps : ref.segments.flat();
  let best: Vec | null = null;
  for (const q of corners) if (!best || q.y < best.y - 1e-6 || (Math.abs(q.y - best.y) <= 1e-6 && q.x < best.x)) best = q;
  const o = best ? toWorld(frame, best) : o0;
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
  const big = n.map(Math.abs);
  const plane: Plane = big[2] >= big[0] && big[2] >= big[1] ? 'XY' : big[1] >= big[0] ? 'XZ' : 'YZ';
  return { plane, face: { o: o.map(r4) as V3, u, v } };
}

/** Corners and circle centers in an outline. */
function referenceSnaps(segments: [Vec, Vec][]): Vec[] {
  const key = (p: Vec) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const adj = new Map<string, { p: Vec; nb: Vec[] }>();
  for (const [p, q] of segments) {
    for (const [x, y] of [[p, q], [q, p]]) {
      const k = key(x);
      if (!adj.has(k)) adj.set(k, { p: x, nb: [] });
      adj.get(k)!.nb.push(y);
    }
  }
  const snaps: Vec[] = [];
  for (const { p, nb } of adj.values()) {
    if (nb.length !== 2) {
      snaps.push(p);
      continue;
    }
    const a1 = Math.atan2(p.y - nb[0].y, p.x - nb[0].x), a2 = Math.atan2(nb[1].y - p.y, nb[1].x - p.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > (20 * Math.PI) / 180) snaps.push(p);
  }
  // Closed loops with many points at the same distance from the middle = circles: snap to the
  // center.
  const seen = new Set<string>();
  for (const [k0, start] of adj) {
    if (seen.has(k0) || start.nb.length !== 2) continue;
    const loop: Vec[] = [];
    let prev: string | null = null, cur = k0, ok = true;
    while (true) {
      seen.add(cur);
      const node = adj.get(cur)!;
      if (node.nb.length !== 2) { ok = false; break; }
      loop.push(node.p);
      const next = node.nb.map(key).find(k => k !== prev) ?? null;
      if (next === null) { ok = false; break; }
      prev = cur;
      cur = next;
      if (cur === k0) break;
      if (seen.has(cur) || loop.length > 4096) { ok = false; break; }
    }
    if (!ok || loop.length < 12) continue;
    const c = { x: loop.reduce((s, p) => s + p.x, 0) / loop.length, y: loop.reduce((s, p) => s + p.y, 0) / loop.length };
    const rs = loop.map(p => Math.hypot(p.x - c.x, p.y - c.y));
    const r = rs.reduce((s, v) => s + v, 0) / rs.length;
    if (r > 0 && rs.every(v => Math.abs(v - r) < r * 0.01 + 1e-3)) snaps.push({ x: tidy(c.x), y: tidy(c.y) });
  }
  return snaps;
}

const isZero = (s: string) => {
  const r = parseExpr(s);
  return r.value === 0 && !r.uses.length;
};
/** "a + b" / "a - (b)" without needless zeros. */
const plus = (a: string, sign: '+' | '-', b: string) => {
  b = b.trim();
  const nb = sign === '-' && !/^[\p{L}\p{N}_.,]+$/u.test(b) ? `(${b})` : b;
  if (isZero(a)) return sign === '+' ? nb : `-${nb}`;
  return `${a.trim()} ${sign} ${nb}`;
};
const half = (d: string) => (/^[\p{L}\p{N}_.,]+$/u.test(d.trim()) ? `${d.trim()} / 2` : `(${d.trim()}) / 2`);

/**
 * Offset for a new sketch on the face: preferably an expression from the feature that created the
 * face (the sketch plane's offset ± the depth) so the sketch follows when the dimension changes,
 * otherwise the number.
 */
export function offsetExpr(doc: Doc, plane: Plane, value: number, vars: Vars): string {
  const active = doc.features.slice(0, activeCount(doc)).filter(f => !f.suppressed);
  const sketches = new Map(active.filter((f): f is SketchFeature => f.type === 'sketch').map(f => [f.id, f]));
  const cands: string[] = [];
  for (const f of [...active].reverse()) {
    if (f.type !== 'extrude') continue;
    const sk = sketches.get(f.sketch);
    if (!sk || sk.face || sk.plane !== plane) continue;
    const o = sk.offset ?? '0', d = f.depth;
    if (f.direction === 'normal') cands.push(plus(o, '+', d));
    else if (f.direction === 'reverse') cands.push(plus(o, '-', d));
    else cands.push(plus(o, '+', half(d)), plus(o, '-', half(d)));
    cands.push(o);
  }
  for (const sk of sketches.values()) if (!sk.face && sk.plane === plane && sk.offset) cands.push(sk.offset);
  const tol = 1e-3 + Math.abs(value) * 1e-5;
  for (const c of cands) {
    const r = parseExpr(c, vars);
    if (r.value !== null && Math.abs(r.value - value) < tol) return c;
  }
  return String(tidy(value)).replace('.', ',');
}

/**
 * Which extrude (side face from a line, or end face) a slanted face comes from, so the sketch can
 * follow the dimensions. Latest feature first; null if none fits (e.g. repeated copies, code
 * blocks) – then the sketch stays fixed in space.
 */
export function findFaceRef(doc: Doc, vars: Vars, n: V3, p: V3): FaceRef | null {
  n = unit(n);
  const active = doc.features.slice(0, activeCount(doc)).filter(f => !f.suppressed);
  for (const f of [...active].reverse()) {
    if (f.type !== 'extrude') continue;
    const sk = active.find((g): g is SketchFeature => g.type === 'sketch' && g.id === f.sketch);
    const span = sk && extrudeSpan(f, vars);
    if (!sk || !span) continue;
    const fs = sketchFrame(sk, vars, doc);
    const keys: { entity?: string; cap?: 'lo' | 'hi' }[] = [{ cap: 'lo' }, { cap: 'hi' }, ...Object.keys(sk.entities).map(entity => ({ entity }))];
    for (const key of keys) {
      const g = extrudeFace(fs, sk, span, key);
      if (!g) continue;
      const d = dot(g.n, n);
      if (Math.abs(d) < 0.9999) continue;
      if (Math.abs(dot(sub(p, g.point), g.n)) > 0.01) continue;
      if (g.corners) {
        // The hit must lie within the side face's rectangle.
        const [P0, P1, , P3] = g.corners;
        const a = sub(P1, P0), b = sub(P3, P0), q = sub(p, P0);
        const s = dot(q, a) / dot(a, a), t = dot(q, b) / dot(b, b);
        if (s < -1e-3 || s > 1 + 1e-3 || t < -1e-3 || t > 1 + 1e-3) continue;
      }
      return { feature: f.id, ...key, sign: d > 0 ? 1 : -1 };
    }
  }
  return null;
}

// ---- Round sides of extrudes (an extruded face that follows the cylinder) -----------------------

/** The round side that a circle/arc in an extrude sweeps out. inside: a hole (the face looks towards the center). */
export interface CurveRef {
  feature: string;
  entity: string;
  inside: boolean;
}

/** The circle's/arc's side in the sketch's frame: center, radius, angles (rad) and height along the normal. */
export interface CurveSide {
  sketch: SketchFeature;
  c: Vec;
  r: number;
  a0: number;
  sweep: number;
  span: [number, number];
  /** The circle's own segments, if set (see CircleE.fn). */
  fn?: number;
}

function curveSide(sk: SketchFeature, f: ExtrudeFeature, entity: string, vars?: Vars): CurveSide | null {
  const e = sk.entities[entity];
  const span = extrudeSpan(f, vars);
  if (!e || e.construction || e.type === 'line' || !span) return null;
  if (e.type === 'circle') return { sketch: sk, c: sk.points[e.c], r: e.r, a0: 0, sweep: 2 * Math.PI, span, fn: e.fn };
  const g = arcGeom(sk, e);
  return { sketch: sk, c: g.c, r: g.r, a0: g.a0, sweep: g.sweep, span };
}

/** Which extruded circle's/arc's side a hit (point p, normal n) lies on, or null. */
export function findCurveRef(doc: Doc, vars: Vars, n: V3, p: V3): CurveRef | null {
  n = unit(n);
  const active = doc.features.slice(0, activeCount(doc)).filter(f => !f.suppressed);
  for (const f of [...active].reverse()) {
    if (f.type !== 'extrude') continue;
    const sk = active.find((g): g is SketchFeature => g.type === 'sketch' && g.id === f.sketch);
    if (!sk) continue;
    const fs = sketchFrame(sk, vars, doc);
    if (Math.abs(dot(n, fs.n)) > 0.05) continue; // the side is perpendicular to the sketch
    const q = toPlane(fs, p);
    for (const entity of Object.keys(sk.entities)) {
      const side = curveSide(sk, f, entity, vars);
      if (!side) continue;
      if (q.w < side.span[0] - 0.01 || q.w > side.span[1] + 0.01) continue;
      const d = Math.hypot(q.x - side.c.x, q.y - side.c.y);
      if (Math.abs(d - side.r) > 0.02 + side.r * 1e-3) continue;
      if (side.sweep < 2 * Math.PI - 1e-9 && ccwSweep(side.a0, Math.atan2(q.y - side.c.y, q.x - side.c.x)) > side.sweep + 0.02) continue;
      const radial = { x: (q.x - side.c.x) / (d || 1), y: (q.y - side.c.y) / (d || 1) };
      const nIn = radial.x * dot(n, fs.u) + radial.y * dot(n, fs.v);
      return { feature: f.id, entity, inside: nIn < 0 };
    }
  }
  return null;
}

/** A round side that a sketch plane touches along a line: its axis in the world (point a, unit direction axis). */
export interface TangentSide extends CurveSide {
  a: V3;
  axis: V3;
}

/**
 * The round side of an extruded circle/arc (before `before`) that the plane `fr` touches along a
 * line, where the points `at` (in the plane) lie: e.g. text sketched on a cylinder wall. Null if
 * the plane does not touch one there.
 */
export function tangentSide(doc: Doc, fr: Frame, at: Vec[], vars: Vars | undefined, before: string): TangentSide | null {
  const bi = doc.features.findIndex(f => f.id === before);
  const active = doc.features.slice(0, bi >= 0 ? Math.min(bi, activeCount(doc)) : activeCount(doc)).filter(f => !f.suppressed);
  for (const f of [...active].reverse()) {
    if (f.type !== 'extrude') continue;
    const sk = active.find((g): g is SketchFeature => g.type === 'sketch' && g.id === f.sketch);
    if (!sk) continue;
    const fs = sketchFrame(sk, vars, doc);
    if (Math.abs(dot(fr.n, fs.n)) > 1e-6) continue; // the axis must lie in the plane
    for (const entity of Object.keys(sk.entities)) {
      const side = curveSide(sk, f, entity, vars);
      if (!side) continue;
      const a = toWorld(fs, side.c);
      const dist = dot(sub(fr.o, a), fr.n);
      if (Math.abs(Math.abs(dist) - side.r) > 0.01 + side.r * 1e-4) continue;
      // The line of contact, as an angle in the circle's sketch, must be on the arc.
      const touch = toPlane(fs, add(a, scale(fr.n, dist)));
      if (side.sweep < 2 * Math.PI - 1e-9 && ccwSweep(side.a0, Math.atan2(touch.y - side.c.y, touch.x - side.c.x)) > side.sweep + 0.02) continue;
      // The points must be along the side, not beyond its ends.
      const w = at.map(p => toPlane(fs, toWorld(fr, p)).w);
      if (w.some(x => x < side.span[0] - 0.01 || x > side.span[1] + 0.01)) continue;
      return { ...side, a, axis: fs.n };
    }
  }
  return null;
}

/** Resolve a CurveRef (the extrude must be active and come before `before`, if given). */
export function resolveCurveRef(doc: Doc, ref: CurveRef, vars: Vars | undefined, before?: string): CurveSide | null {
  const fi = doc.features.findIndex(f => f.id === ref.feature);
  const f = doc.features[fi];
  if (!f || f.type !== 'extrude' || f.suppressed || fi >= activeCount(doc)) return null;
  const bi = before ? doc.features.findIndex(g => g.id === before) : -1;
  if (bi >= 0 && fi > bi) return null;
  const sk = doc.features.find((g): g is SketchFeature => g.type === 'sketch' && g.id === f.sketch);
  if (!sk || sk.suppressed) return null;
  return curveSide(sk, f, ref.entity, vars);
}
