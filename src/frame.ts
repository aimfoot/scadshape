// The sketch plane's placement in the world: origin o, axes u and v (the sketch's x and y) and the
// normal n = u × v. The base planes (XY, XZ, YZ with offset) and slanted faces (sketch on a face)
// give the same kind of frame, so the OpenSCAD code, the 3D view and the picking in 3D only need to
// know about it.

import { parseExpr, type Vars } from './expr';
import type { Doc } from './doc';
import type { ExtrudeFeature } from './features/extrude';
import type { SketchFeature } from './features/common';
import type { Vec } from './sketch/geom';
import type { Plane } from './sketch/model';

export type V3 = [number, number, number];
export interface Frame {
  o: V3;
  u: V3;
  v: V3;
  n: V3;
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const add = (...vs: V3[]): V3 => vs.reduce((s, a) => [s[0] + a[0], s[1] + a[1], s[2] + a[2]], [0, 0, 0] as V3);
export const unit = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));

/** The base planes (the same placement as PLANE_ROTATE + offset in model3d). */
export function planeFrame(plane: Plane, offset = 0): Frame {
  switch (plane) {
    case 'XY':
      return { o: [0, 0, offset], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
    case 'XZ':
      return { o: [0, -offset, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] };
    case 'YZ':
      return { o: [offset, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] };
  }
}

/** The sketch's offset as a number, 0 if it is missing or invalid. */
export const offsetValue = (sk: SketchFeature, vars?: Vars) => (sk.offset ? (parseExpr(sk.offset, vars).value ?? 0) : 0);

/**
 * The sketch's frame: a slanted face (computed from the extrude it comes from if the document is
 * given, otherwise sk.face) or a base plane, offset along the normal.
 */
export function sketchFrame(sk: SketchFeature, vars?: Vars, doc?: Doc, depth = 0): Frame {
  const off = offsetValue(sk, vars);
  if (!sk.face) return planeFrame(sk.plane, off);
  const fixed = (): Frame => ({ ...sk.face!, n: cross(sk.face!.u, sk.face!.v) });
  const base = (doc && resolveFaceRef(doc, sk, vars, depth)) || fixed();
  return { ...base, o: add(base.o, scale(base.n, off)) };
}

/** The sketch's (x, y) and distance w along the normal → the world. */
export const toWorld = (f: Frame, p: Vec, w = 0): V3 => add(f.o, scale(f.u, p.x), scale(f.v, p.y), scale(f.n, w));

/** World point → the sketch's (x, y) and distance from the plane. */
export function toPlane(f: Frame, q: V3): Vec & { w: number } {
  const d = sub(q, f.o);
  return { x: dot(d, f.u), y: dot(d, f.v), w: dot(d, f.n) };
}

/** OpenSCAD: place the sketch's xy plane on the frame. */
export function frameScad(f: Frame): string {
  const r = (x: number) => {
    const s = String(Math.round(x * 1e9) / 1e9);
    return s === '-0' ? '0' : s;
  };
  const row = (i: number) => `[${r(f.u[i])}, ${r(f.v[i])}, ${r(f.n[i])}, ${r(f.o[i])}]`;
  return `multmatrix([${row(0)}, ${row(1)}, ${row(2)}, [0, 0, 0, 1]]) `;
}

// ---- Faces from extrudes (sketch on a slanted face that follows the dimensions) -----------------

/** Canonical frame for a face with normal n: u horizontal along the face, v uphill (n = u × v). */
export function faceAxes(n: V3): { u: V3; v: V3 } {
  let u = cross([0, 0, 1], n);
  u = Math.hypot(...u) < 1e-6 ? [1, 0, 0] : unit(u);
  return { u, v: cross(n, u) };
}

/** The extrude's extent along the sketch normal [wa, wb], or null if the depth is invalid. */
export function extrudeSpan(f: ExtrudeFeature, vars?: Vars): [number, number] | null {
  const h = parseExpr(f.depth, vars).value;
  if (h === null || !(h > 0)) return null;
  return f.direction === 'reverse' ? [-h, 0] : f.direction === 'symmetric' ? [-h / 2, h / 2] : [0, h];
}

export interface ExtrudeFace {
  /** Normal (unsigned, i.e. before FaceRef.sign). */
  n: V3;
  /** Corners of a side face (P0 = A at wa, P1 = B at wa, P2 = B at wb, P3 = A at wb). */
  corners?: [V3, V3, V3, V3];
  /** A point in the end face (the sketch's origin moved to wa/wb). */
  point: V3;
}

/** The geometry of a face on an extrude, in the world. */
export function extrudeFace(fs: Frame, sk: SketchFeature, span: [number, number], key: { entity?: string; cap?: 'lo' | 'hi' }): ExtrudeFace | null {
  const [wa, wb] = span;
  if (key.cap) return { n: fs.n, point: add(fs.o, scale(fs.n, key.cap === 'lo' ? wa : wb)) };
  const e = key.entity ? sk.entities[key.entity] : undefined;
  if (!e || e.type !== 'line' || e.construction) return null;
  const p1 = sk.points[e.p1], p2 = sk.points[e.p2];
  if (!p1 || !p2) return null;
  const A = toWorld(fs, p1), B = toWorld(fs, p2);
  const ab = sub(B, A);
  if (Math.hypot(...ab) < 1e-9) return null;
  const n = unit(cross(ab, fs.n));
  const at = (p: V3, w: number) => add(p, scale(fs.n, w));
  return { n, corners: [at(A, wa), at(B, wa), at(B, wb), at(A, wb)], point: at(A, wa) };
}

/** Frame for an extrude face: canonical orientation; origin in the lower left corner (side face) or at the sketch's origin (end face). */
export function extrudeFaceFrame(g: ExtrudeFace, sign: 1 | -1): Frame {
  const n = scale(g.n, sign);
  const { u, v } = faceAxes(n);
  let o = g.point;
  if (g.corners) {
    let best: { x: number; y: number } | null = null;
    for (const c of g.corners) {
      const q = { x: dot(c, u), y: dot(c, v) };
      if (!best || q.y < best.y - 1e-6 || (Math.abs(q.y - best.y) <= 1e-6 && q.x < best.x)) {
        best = q;
        o = c;
      }
    }
  }
  return { o, u, v, n };
}

const MAX_DEPTH = 16;

/** Resolve a sketch's faceRef from the document (the extrude must come before the sketch and be active). */
function resolveFaceRef(doc: Doc, sk: SketchFeature, vars: Vars | undefined, depth: number): Frame | null {
  const ref = sk.faceRef;
  if (!ref || depth > MAX_DEPTH) return null;
  const at = doc.features.indexOf(sk);
  const fi = doc.features.findIndex(f => f.id === ref.feature);
  const f = doc.features[fi];
  if (!f || f.type !== 'extrude' || f.suppressed || (at >= 0 && fi > at)) return null;
  const parent = doc.features.find((g): g is SketchFeature => g.type === 'sketch' && g.id === f.sketch);
  if (!parent || parent.suppressed) return null;
  const span = extrudeSpan(f, vars);
  if (!span) return null;
  const g = extrudeFace(sketchFrame(parent, vars, doc, depth + 1), parent, span, ref);
  return g ? extrudeFaceFrame(g, ref.sign) : null;
}
