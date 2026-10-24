// .scad → document with sketches and features. OpenSCAD runs the file and exports the CSG tree
// (modules, loops and variables evaluated); here bodies that are prisms (cube, cylinder,
// linear_extrude) become a sketch on the XY/XZ/YZ plane + Extrude, and the rest become code blocks
// (features/code.ts) so the model is complete.
//
// The tree's boolean structure is flattened into the tree order (add/remove/intersect). That is
// exact only if a subtraction does not reach bodies that were added before it – this is checked
// with bounding boxes, and otherwise that part becomes a code block.

import { emptyDoc, newFeature, newSketch, type Doc } from '../doc';
import type { Op } from '../features/common';
import { newId, ORIGIN, type Plane, type SketchData } from '../sketch/model';
import { csgToScad, parseCsg, type CsgNode, type CsgValue } from './csg';
import { ParamLinker } from './params';

export interface ConvertEngine {
  /** Run the code and return the CSG export. */
  csg(src: string): Promise<string>;
  /** Render 2D code and return the SVG export. */
  svg(src: string): Promise<string>;
}

export interface ConvertResult {
  doc: Doc;
  sketches: number;
  extrudes: number;
  revolves: number;
  codeBlocks: number;
  /** Variables read from the code, and how many dimensions/depths/offsets use them. */
  params: number;
  linked: number;
}

type Vec = { x: number; y: number };
type V3 = [number, number, number];
type Mat = number[][]; // 4×4

// ---- Matrices and boxes ----------------------------------------------------------------------

const I4: Mat = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const mul = (a: Mat, b: Mat): Mat => a.map(r => [0, 1, 2, 3].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j] + r[3] * b[3][j]));
const apply = (m: Mat, p: V3): V3 => [0, 1, 2].map(i => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]) as V3;
const dir = (m: Mat, v: V3): V3 => [0, 1, 2].map(i => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V3;
const isIdentity = (m: Mat) => m.every((r, i) => r.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-12));
const asMat = (v: CsgValue): Mat => (v as number[][]).map(r => r.map(Number));

interface Box {
  min: V3;
  max: V3;
}
const INF_BOX: Box = { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] };
const boxOf = (pts: V3[]): Box => ({
  min: [0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))) as V3,
  max: [0, 1, 2].map(i => Math.max(...pts.map(p => p[i]))) as V3,
});
const unionBox = (bs: Box[]): Box | null =>
  bs.length ? { min: [0, 1, 2].map(i => Math.min(...bs.map(b => b.min[i]))) as V3, max: [0, 1, 2].map(i => Math.max(...bs.map(b => b.max[i]))) as V3 } : null;
const overlaps = (a: Box, b: Box, eps = 1e-6) => [0, 1, 2].every(i => a.min[i] < b.max[i] - eps && b.min[i] < a.max[i] - eps);
/** The box for a local box [lo, hi] after the transformation m. */
const transformBox = (m: Mat, lo: V3, hi: V3): Box => {
  const pts: V3[] = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) pts.push(apply(m, [x, y, z]));
  return boxOf(pts);
};

const num = (v: CsgValue | undefined, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vec3 = (v: CsgValue | undefined): V3 => (Array.isArray(v) ? [num(v[0]), num(v[1]), num(v[2])] : [num(v), num(v), num(v)]);
const vec2 = (v: CsgValue | undefined): [number, number] => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [num(v), num(v)]);
const GROUPS = new Set(['group', 'union', 'color', 'render', 'children']);

/** The cylinder's/circle's radii (r, r1/r2 or d). */
function radii(n: CsgNode): [number, number] {
  const a = n.args;
  if (a.r1 !== undefined || a.r2 !== undefined) return [num(a.r1, 1), num(a.r2, 1)];
  if (a.d !== undefined) return [num(a.d) / 2, num(a.d) / 2];
  return [num(a.r, 1), num(a.r, 1)];
}

/** Bounding box for a 3D node (null = unknown). */
function bbox3(n: CsgNode, m: Mat): Box | null {
  const a = n.args;
  switch (n.name) {
    case 'cube': {
      const s = vec3(a.size ?? n.pos[0] ?? 1);
      const c = a.center === true;
      return transformBox(m, c ? [-s[0] / 2, -s[1] / 2, -s[2] / 2] : [0, 0, 0], c ? [s[0] / 2, s[1] / 2, s[2] / 2] : s);
    }
    case 'cylinder': {
      const r = Math.max(...radii(n)), h = num(a.h, 1), c = a.center === true;
      return transformBox(m, [-r, -r, c ? -h / 2 : 0], [r, r, c ? h / 2 : h]);
    }
    case 'sphere': {
      const r = a.d !== undefined ? num(a.d) / 2 : num(a.r, 1);
      return transformBox(m, [-r, -r, -r], [r, r, r]);
    }
    case 'polyhedron': {
      const pts = (a.points ?? n.pos[0]) as number[][] | undefined;
      return pts?.length ? boxOf(pts.map(p => apply(m, [p[0], p[1], p[2]]))) : null;
    }
    case 'linear_extrude': {
      const b = unionBox2(n.children, I3);
      if (!b) return null;
      const h = num(a.height ?? n.pos[0], 100), c = a.center === true;
      const sc = Math.max(1, ...vec2(a.scale ?? 1));
      let [x0, y0, x1, y1] = [b.x0 * sc, b.y0 * sc, b.x1 * sc, b.y1 * sc];
      if (num(a.twist)) {
        const r = Math.max(...[x0, x1].flatMap(x => [y0, y1].map(y => Math.hypot(x, y))));
        [x0, y0, x1, y1] = [-r, -r, r, r];
      }
      return transformBox(m, [x0, y0, c ? -h / 2 : 0], [x1, y1, c ? h / 2 : h]);
    }
    case 'rotate_extrude': {
      const b = unionBox2(n.children, I3);
      if (!b) return null;
      const r = Math.max(Math.abs(b.x0), Math.abs(b.x1));
      return transformBox(m, [-r, -r, b.y0], [r, r, b.y1]);
    }
    case 'multmatrix':
      return allKnown(n.children, mul(m, asMat(n.pos[0] ?? a.m)));
    case 'difference':
      return n.children[0] ? bbox3(n.children[0], m) : null;
    case 'intersection': {
      const bs = n.children.map(c => bbox3(c, m));
      if (bs.some(b => !b)) return unionBox(bs.filter((b): b is Box => !!b));
      return bs.reduce((acc, b) => ({ min: [0, 1, 2].map(i => Math.max(acc!.min[i], b!.min[i])) as V3, max: [0, 1, 2].map(i => Math.min(acc!.max[i], b!.max[i])) as V3 }), bs[0]);
    }
    case 'minkowski': {
      const bs = n.children.map(c => bbox3(c, I4));
      if (bs.some(b => !b) || !bs.length) return null;
      const s = bs.reduce((acc, b) => ({ min: [0, 1, 2].map(i => acc!.min[i] + b!.min[i]) as V3, max: [0, 1, 2].map(i => acc!.max[i] + b!.max[i]) as V3 }));
      return transformBox(m, s!.min, s!.max);
    }
    default:
      if (GROUPS.has(n.name) || n.name === 'hull') return allKnown(n.children, m);
      return null;
  }
}
/** A node with no shape in it: empty groups, such as the one BOSL2's cube() and cylinder() leave for attachments. */
const empty = (n: CsgNode): boolean => (GROUPS.has(n.name) || n.name === 'multmatrix') && n.children.every(empty);
/** The box for all children (those with no shape left out), or null if any is unknown. */
function allKnown(children: CsgNode[], m: Mat): Box | null {
  const bs = children.filter(c => !empty(c)).map(c => bbox3(c, m));
  return bs.some(b => !b) ? null : unionBox(bs as Box[]);
}

// ---- 2D -----------------------------------------------------------------------------------

/** 2D affine transform: x' = a·x + b·y + tx, y' = c·x + d·y + ty. */
type Aff = { a: number; b: number; c: number; d: number; tx: number; ty: number };
const I3: Aff = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const affOf = (m: Mat): Aff => ({ a: m[0][0], b: m[0][1], c: m[1][0], d: m[1][1], tx: m[0][3], ty: m[1][3] });
const affMul = (p: Aff, q: Aff): Aff => ({
  a: p.a * q.a + p.b * q.c, b: p.a * q.b + p.b * q.d, c: p.c * q.a + p.d * q.c, d: p.c * q.b + p.d * q.d,
  tx: p.a * q.tx + p.b * q.ty + p.tx, ty: p.c * q.tx + p.d * q.ty + p.ty,
});
const affApply = (t: Aff, p: Vec): Vec => ({ x: t.a * p.x + t.b * p.y + t.tx, y: t.c * p.x + t.d * p.y + t.ty });
/** Uniform scaling without shear (circles stay circles)? Returns the scale. */
const uniformScale = (t: Aff) => {
  const s1 = Math.hypot(t.a, t.c), s2 = Math.hypot(t.b, t.d);
  return Math.abs(s1 - s2) < 1e-9 * Math.max(1, s1) && Math.abs(t.a * t.b + t.c * t.d) < 1e-9 * Math.max(1, s1 * s2) ? s1 : null;
};
/** Do the axes stay axes (rectangles stay rectangles)? */
const axisAligned = (t: Aff) => (Math.abs(t.b) < 1e-12 && Math.abs(t.c) < 1e-12) || (Math.abs(t.a) < 1e-12 && Math.abs(t.d) < 1e-12);

type Shape =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'circle'; c: Vec; r: number }
  | { kind: 'loop'; pts: Vec[]; text?: true } // polygon (arcs are found when the sketch is built); text: one of many glyph outlines
  | { kind: 'rhull'; centers: Vec[]; r: number }; // convex hull of equal circles (rounded box)

interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const box2 = (pts: Vec[]): Box2 => ({ x0: Math.min(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), x1: Math.max(...pts.map(p => p.x)), y1: Math.max(...pts.map(p => p.y)) });
function shapeBox(s: Shape): Box2 {
  switch (s.kind) {
    case 'rect':
      return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
    case 'circle':
      return { x0: s.c.x - s.r, y0: s.c.y - s.r, x1: s.c.x + s.r, y1: s.c.y + s.r };
    case 'loop':
      return box2(s.pts);
    case 'rhull': {
      const b = box2(s.centers);
      return { x0: b.x0 - s.r, y0: b.y0 - s.r, x1: b.x1 + s.r, y1: b.y1 + s.r };
    }
  }
}
const disjoint2 = (a: Box2, b: Box2, eps = 1e-6) => a.x1 <= b.x0 + eps || b.x1 <= a.x0 + eps || a.y1 <= b.y0 + eps || b.y1 <= a.y0 + eps;
const inside2 = (inner: Box2, outer: Box2, eps = 1e-6) => inner.x0 > outer.x0 + eps && inner.y0 > outer.y0 + eps && inner.x1 < outer.x1 - eps && inner.y1 < outer.y1 - eps;

/** The box for 2D nodes (for 3D boxes); null = unknown. */
function bbox2(n: CsgNode, t: Aff): Box2 | null {
  const sh = shapes2d(n, t);
  if (sh) return unionBox2Shapes(sh);
  switch (n.name) {
    case 'offset': {
      const b = unionBox2(n.children, t);
      const r = Math.abs(num(n.args.r ?? n.args.delta));
      return b && { x0: b.x0 - r, y0: b.y0 - r, x1: b.x1 + r, y1: b.y1 + r };
    }
    case 'multmatrix':
      return unionBox2(n.children, affMul(t, affOf(asMat(n.pos[0] ?? n.args.m))));
    case 'difference':
      return n.children[0] ? bbox2(n.children[0], t) : null;
    default:
      if (GROUPS.has(n.name) || n.name === 'hull' || n.name === 'intersection') return unionBox2(n.children, t);
      return null;
  }
}
function unionBox2(children: CsgNode[], t: Aff): Box2 | null {
  const bs = children.map(c => bbox2(c, t));
  if (!bs.length || bs.some(b => !b)) return null;
  return unionBox2Shapes([], bs as Box2[]);
}
function unionBox2Shapes(shapes: Shape[], extra: Box2[] = []): Box2 | null {
  const bs = [...shapes.map(shapeBox), ...extra];
  return bs.length ? { x0: Math.min(...bs.map(b => b.x0)), y0: Math.min(...bs.map(b => b.y0)), x1: Math.max(...bs.map(b => b.x1)), y1: Math.max(...bs.map(b => b.y1)) } : null;
}

/** Regular polygon that OpenSCAD draws a circle with few segments as ($fn < 16 is often intentional, e.g. a hexagon). */
const ngon = (c: Vec, r: number, n: number): Vec[] => Array.from({ length: n }, (_, i) => ({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) }));
const fnOf = (n: CsgNode) => num(n.args.$fn);

/** Put a shape through an affine transform (null if it can no longer be described exactly). */
function mapShape(s: Shape, t: Aff): Shape | null {
  switch (s.kind) {
    case 'rect': {
      const pts = [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y0 }, { x: s.x1, y: s.y1 }, { x: s.x0, y: s.y1 }].map(p => affApply(t, p));
      if (!axisAligned(t)) return { kind: 'loop', pts };
      const b = box2(pts);
      return { kind: 'rect', ...b };
    }
    case 'circle': {
      const k = uniformScale(t);
      return k === null ? null : { kind: 'circle', c: affApply(t, s.c), r: s.r * k };
    }
    case 'loop':
      return { ...s, pts: s.pts.map(p => affApply(t, p)) };
    case 'rhull': {
      const k = uniformScale(t);
      return k === null ? null : { kind: 'rhull', centers: s.centers.map(p => affApply(t, p)), r: s.r * k };
    }
  }
}

/** 2D subtree → exact shapes, or null if OpenSCAD has to draw it (offset, text, overlap …). */
function shapes2d(n: CsgNode, t: Aff): Shape[] | null {
  const a = n.args;
  const mapAll = (ss: Shape[]) => {
    const out = ss.map(s => mapShape(s, t));
    return out.some(s => !s) ? null : (out as Shape[]);
  };
  switch (n.name) {
    case 'square': {
      const [sx, sy] = vec2(a.size ?? n.pos[0] ?? 1);
      const c = a.center === true;
      return mapAll([{ kind: 'rect', x0: c ? -sx / 2 : 0, y0: c ? -sy / 2 : 0, x1: c ? sx / 2 : sx, y1: c ? sy / 2 : sy }]);
    }
    case 'circle': {
      const r = radii(n)[0];
      const fn = fnOf(n);
      if (fn >= 3 && fn < 16) return mapAll([{ kind: 'loop', pts: ngon({ x: 0, y: 0 }, r, fn) }]);
      return mapAll([{ kind: 'circle', c: { x: 0, y: 0 }, r }]);
    }
    case 'polygon': {
      const pts = ((a.points ?? n.pos[0]) as number[][]).map(p => ({ x: p[0], y: p[1] }));
      const paths = (a.paths ?? n.pos[1]) as number[][] | null | undefined;
      const loops = paths ? paths.map(path => path.map(i => pts[i])) : [pts];
      return mapAll(loops.filter(l => l.length >= 3).map(l => ({ kind: 'loop', pts: l })));
    }
    case 'multmatrix':
      return shapes2dAll(n.children, affMul(t, affOf(asMat(n.pos[0] ?? a.m))), true);
    case 'difference': {
      const [first, ...rest] = n.children;
      const outer = first && shapes2d(first, t);
      if (!outer || outer.length !== 1) return null;
      const holes = shapes2dAll(rest, t, true);
      if (!holes) return null;
      const ob = shapeBox(outer[0]);
      // The holes must lie inside and not touch each other – then they become holes in the sketch's
      // region.
      if (!holes.every(h => inside2(shapeBox(h), ob))) return null;
      return [...outer, ...holes];
    }
    case 'hull': {
      const parts = shapes2dAll(n.children, t, false);
      if (!parts?.length) return null;
      if (parts.every(p => p.kind === 'circle') && parts.every(p => Math.abs((p as { r: number }).r - (parts[0] as { r: number }).r) < 1e-9)) {
        return [{ kind: 'rhull', centers: parts.map(p => (p as { c: Vec }).c), r: (parts[0] as { r: number }).r }];
      }
      if (parts.every(p => p.kind === 'loop' || p.kind === 'rect'))
        return [{ kind: 'loop', pts: convexHull(parts.flatMap(p => (p.kind === 'rect' ? [{ x: p.x0, y: p.y0 }, { x: p.x1, y: p.y0 }, { x: p.x1, y: p.y1 }, { x: p.x0, y: p.y1 }] : (p as { pts: Vec[] }).pts))) }];
      return null;
    }
    default:
      if (GROUPS.has(n.name)) return shapes2dAll(n.children, t, true);
      return null;
  }
}
/** All children's shapes; with `disjoint` they must not overlap (otherwise OpenSCAD draws them). */
function shapes2dAll(children: CsgNode[], t: Aff, disjoint: boolean): Shape[] | null {
  const out: Shape[] = [];
  for (const c of children) {
    const s = shapes2d(c, t);
    if (!s) return null;
    out.push(...s);
  }
  if (disjoint) {
    const bs = out.map(shapeBox);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (!disjoint2(bs[i], bs[j])) return null;
  }
  return out;
}

function convexHull(ps: Vec[]): Vec[] {
  const p = [...ps].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [], upper: Vec[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]; // counterclockwise
}

/** Loops from OpenSCAD's SVG export (y is negated there). */
export function svgLoops(svg: string): Vec[][] {
  const loops: Vec[][] = [];
  for (const m of svg.matchAll(/\bd="([^"]*)"/g))
    for (const sub of m[1].split(/[Mm]/)) {
      const pts = [...sub.matchAll(/(-?[\d.]+(?:e[-+]?\d+)?),(-?[\d.]+(?:e[-+]?\d+)?)/gi)].map(q => ({ x: Number(q[1]), y: -Number(q[2]) || 0 }));
      if (pts.length >= 3) loops.push(pts);
    }
  return loops;
}

// ---- Plan ----------------------------------------------------------------------------------

/** World point → (u, v, w) in a sketch plane (the same as planeFrame in frame.ts, in reverse). */
const toPlane: Record<Plane, (p: V3) => V3> = {
  XY: p => [p[0], p[1], p[2]],
  XZ: p => [p[0], p[2], -p[1]],
  YZ: p => [p[1], p[2], p[0]],
};
const PLANE_BY_AXIS: Plane[] = ['YZ', 'XZ', 'XY']; // the normal's axis x, y, z

interface Frame {
  plane: Plane;
  /** Local 2D (x, y) → the plane's (u, v). */
  aff: Aff;
  /** The plane's w for local z = 0, and how much w changes per local z unit (sign = direction). */
  w0: number;
  dw: number;
}
/** Is the local z axis parallel to a world axis? Then local xy lies in one of the sketch planes. */
function frameOf(m: Mat): Frame | null {
  const ez = dir(m, [0, 0, 1]);
  const k = [0, 1, 2].reduce((best, i) => (Math.abs(ez[i]) > Math.abs(ez[best]) ? i : best), 0);
  const L = Math.hypot(...ez);
  if (L < 1e-12 || [0, 1, 2].some(i => i !== k && Math.abs(ez[i]) > 1e-9 * L)) return null;
  const ex = dir(m, [1, 0, 0]), ey = dir(m, [0, 1, 0]);
  if (Math.abs(ex[k]) > 1e-9 * Math.hypot(...ex) || Math.abs(ey[k]) > 1e-9 * Math.hypot(...ey)) return null; // shear
  const plane = PLANE_BY_AXIS[k];
  const P = toPlane[plane];
  const o = P(apply(m, [0, 0, 0])), px = P(ex), py = P(ey), pz = P(ez);
  return { plane, aff: { a: px[0], b: py[0], c: px[1], d: py[1], tx: o[0], ty: o[1] }, w0: o[2], dw: pz[2] };
}

// ---- Tools ----------------------------------------------------------------------------------

type Tool =
  | { kind: 'prism'; plane: Plane; offset: number; depth: number; direction: 'normal' | 'reverse' | 'symmetric'; shapes: Shape[]; op: Op }
  /** Body of revolution (cone, sphere): profile in the plane + axis (construction line, or the sketch's Y/X axis). */
  | { kind: 'revolve'; plane: Plane; offset: number; profile: Vec[]; arc?: { c: Vec; from: number; to: number }; axis: [Vec, Vec]; op: Op }
  | { kind: 'code'; code: string; op: Op };

class Converter {
  tools: Tool[] = [];
  /** Boxes for what has been added so far (to see whether a subtraction reaches them). */
  added: Box[] = [];
  constructor(private engine: ConvertEngine) {}

  private code(n: CsgNode, m: Mat, op: Op) {
    const src = csgToScad(n);
    this.tools.push({ kind: 'code', code: isIdentity(m) ? src : `multmatrix(${JSON.stringify(m)}) {\n${src.replace(/^/gm, '  ')}\n}`, op });
    if (op === 'add') this.added.push(bbox3(n, m) ?? INF_BOX);
  }

  async walk(n: CsgNode, m: Mat, op: Op): Promise<void> {
    if (n.name === 'multmatrix') {
      const mm = mul(m, asMat(n.pos[0] ?? n.args.m));
      for (const c of n.children) await this.walk(c, mm, op);
      return;
    }
    if (GROUPS.has(n.name)) {
      if (op === 'intersect' && n.children.length > 1) return this.code(n, m, op); // an intersection with a union is not intersections in sequence
      // A union is the same in any order: take differences and intersections first, so their
      // subtractions do not reach bodies that would otherwise have been added before them.
      const first = (c: CsgNode) => (c.name === 'difference' || c.name === 'intersection' ? 0 : 1);
      const kids = op === 'add' ? [...n.children].sort((a, b) => first(a) - first(b)) : n.children;
      for (const c of kids) await this.walk(c, m, op);
      return;
    }
    if (n.name === 'difference' && op === 'add' && n.children.length) {
      const before = this.added.length, mark = this.tools.length;
      const prior = this.added.slice(0, before);
      const [first, ...rest] = n.children;
      await this.walk(first, m, 'add');
      for (const c of rest) {
        if (empty(c)) continue;
        const b = bbox3(c, m) ?? INF_BOX;
        if (prior.some(p => overlaps(p, b))) {
          // Would cut into something added earlier → the whole difference as code.
          this.tools.length = mark;
          this.added.length = before;
          return this.code(n, m, op);
        }
        await this.walk(c, m, 'remove');
      }
      return;
    }
    if (n.name === 'intersection' && op === 'add' && !this.added.length && n.children.length) {
      const [first, ...rest] = n.children;
      await this.walk(first, m, 'add');
      for (const c of rest) await this.walk(c, m, 'intersect');
      return;
    }
    if (await this.prism(n, m, op)) return;
    const rev = this.revolveOf(n, m);
    if (rev) {
      this.tools.push({ ...rev, op });
      if (op === 'add') this.added.push(bbox3(n, m) ?? INF_BOX);
      return;
    }
    this.code(n, m, op);
  }

  /** Cone (cylinder with different radii) or sphere with its axis along a world axis → profile + Revolve. */
  private revolveOf(n: CsgNode, m: Mat): Omit<Extract<Tool, { kind: 'revolve' }>, 'op'> | null {
    if (n.name !== 'cylinder' && n.name !== 'sphere') return null;
    const ez = dir(m, [0, 0, 1]), ex = dir(m, [1, 0, 0]), ey = dir(m, [0, 1, 0]);
    const k = [0, 1, 2].reduce((best, i) => (Math.abs(ez[i]) > Math.abs(ez[best]) ? i : best), 0);
    const L = Math.hypot(...ez), sx = Math.hypot(...ex), sy = Math.hypot(...ey);
    if ([0, 1, 2].some(i => i !== k && Math.abs(ez[i]) > 1e-9 * L) || Math.abs(sx - sy) > 1e-9 * sx) return null;
    if (Math.abs(ex[k]) > 1e-9 * sx || Math.abs(ey[k]) > 1e-9 * sy) return null;
    if (fnOf(n) >= 3 && fnOf(n) < 16) return null; // pyramid – not a body of revolution
    // The plane that contains the axis: Z → XZ (axis = v), Y → XY (v), X → XY (u).
    const plane: Plane = k === 2 ? 'XZ' : 'XY';
    const axisIsV = k !== 0;
    const P = toPlane[plane];
    // (radial, axial) → (u, v); mirrored when the axis is u.
    const uv = (rad: number, ax: number): Vec => (axisIsV ? { x: rad, y: ax } : { x: ax, y: rad });
    const at = (z: number) => P(apply(m, [0, 0, z]));
    const radial = (p: V3) => (axisIsV ? p[0] : p[1]), axial = (p: V3) => (axisIsV ? p[1] : p[0]);
    if (n.name === 'cylinder') {
      const [r1, r2] = radii(n);
      const h = num(n.args.h, 1), c = n.args.center === true;
      const A = at(c ? -h / 2 : 0), B = at(c ? h / 2 : h);
      const rad0 = radial(A), a0 = axial(A), a1 = axial(B);
      const profile = [uv(rad0, a0), uv(rad0 + r1 * sx, a0), uv(rad0 + r2 * sx, a1), uv(rad0, a1)].filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 1e-9);
      return { kind: 'revolve', plane, offset: A[2], profile, axis: [uv(rad0, a0), uv(rad0, a1)] };
    }
    const r = (n.args.d !== undefined ? num(n.args.d) / 2 : num(n.args.r, 1)) * sx;
    const C = at(0);
    const rad0 = radial(C), ac = axial(C);
    // Half circle on the radial side, from one end of the axis to the other.
    const lo = uv(rad0, ac - r), hi = uv(rad0, ac + r);
    const mid = uv(rad0 + r, ac), cc = uv(rad0, ac);
    const ccw = (lo.x - cc.x) * (mid.y - cc.y) - (lo.y - cc.y) * (mid.x - cc.x) > 0;
    return { kind: 'revolve', plane, offset: C[2], profile: ccw ? [lo, hi] : [hi, lo], arc: { c: cc, from: 0, to: 1 }, axis: [lo, hi] };
  }

  /** Cube, cylinder, linear_extrude or a hull of those → sketch + extrude. */
  private async prism(n: CsgNode, m: Mat, op: Op): Promise<boolean> {
    const p = await this.prismOf(n, m);
    if (!p) return false;
    this.tools.push({ ...p, op });
    if (op === 'add') this.added.push(bbox3(n, m) ?? INF_BOX);
    return true;
  }

  private async prismOf(n: CsgNode, m: Mat): Promise<Omit<Extract<Tool, { kind: 'prism' }>, 'op' | 'kind'> & { kind: 'prism' } | null> {
    const a = n.args;
    let local: Shape[] | null = null;
    let z0 = 0, z1 = 0;
    if (n.name === 'cube') {
      const s = vec3(a.size ?? n.pos[0] ?? 1);
      const c = a.center === true;
      local = [{ kind: 'rect', x0: c ? -s[0] / 2 : 0, y0: c ? -s[1] / 2 : 0, x1: c ? s[0] / 2 : s[0], y1: c ? s[1] / 2 : s[1] }];
      [z0, z1] = c ? [-s[2] / 2, s[2] / 2] : [0, s[2]];
    } else if (n.name === 'cylinder') {
      const [r1, r2] = radii(n);
      if (Math.abs(r1 - r2) > 1e-12 || r1 <= 0) return null; // cone: code
      const h = num(a.h, 1), c = a.center === true, fn = fnOf(n);
      local = [fn >= 3 && fn < 16 ? { kind: 'loop', pts: ngon({ x: 0, y: 0 }, r1, fn) } : { kind: 'circle', c: { x: 0, y: 0 }, r: r1 }];
      [z0, z1] = c ? [-h / 2, h / 2] : [0, h];
    } else if (n.name === 'linear_extrude') {
      if (num(a.twist)) return null;
      const sc = vec2(a.scale ?? 1);
      if (Math.abs(sc[0] - 1) > 1e-12 || Math.abs(sc[1] - 1) > 1e-12) return null;
      const h = num(a.height ?? n.pos[0], 100), c = a.center === true;
      local = shapes2dAll(n.children, I3, true) ?? (await this.rendered(n.children));
      [z0, z1] = c ? [-h / 2, h / 2] : [0, h];
    } else if (n.name === 'hull') {
      // Hull of prisms with the same plane and height (e.g. four cylinders → rounded box).
      const parts = await Promise.all(n.children.map(c => this.flatPrisms(c, m)));
      if (!parts.length || parts.some(p => !p)) return null;
      const all = parts.flat() as NonNullable<Awaited<ReturnType<typeof this.prismOf>>>[];
      const ref = all[0];
      if (!all.every(p => p.plane === ref.plane && Math.abs(p.offset - ref.offset) < 1e-9 && Math.abs(p.depth - ref.depth) < 1e-9 && p.direction === ref.direction)) return null;
      const shapes = all.flatMap(p => p.shapes);
      let hullShape: Shape;
      if (shapes.every(s => s.kind === 'circle') && shapes.every(s => Math.abs((s as { r: number }).r - (shapes[0] as { r: number }).r) < 1e-9))
        hullShape = { kind: 'rhull', centers: shapes.map(s => (s as { c: Vec }).c), r: (shapes[0] as { r: number }).r };
      else if (shapes.every(s => s.kind !== 'circle' && s.kind !== 'rhull'))
        hullShape = { kind: 'loop', pts: convexHull(shapes.flatMap(s => (s.kind === 'rect' ? [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y0 }, { x: s.x1, y: s.y1 }, { x: s.x0, y: s.y1 }] : (s as { pts: Vec[] }).pts))) };
      else return null;
      return { ...ref, shapes: [hullShape] };
    } else return null;
    if (!local?.length) return null;
    const f = frameOf(m);
    if (!f) return null;
    const shapes = local.map(s => mapShape(s, f.aff));
    if (shapes.some(s => !s)) return null;
    // w along the normal for z0 and z1.
    const wa = f.w0 + f.dw * z0, wb = f.w0 + f.dw * z1;
    const depth = Math.abs(wb - wa);
    if (depth < 1e-9) return null;
    const centered = Math.abs(z0 + z1) < 1e-12 && z0 !== 0;
    const direction = centered ? 'symmetric' : wb > wa ? 'normal' : 'reverse';
    return { kind: 'prism', plane: f.plane, offset: centered ? f.w0 : wa, depth, direction, shapes: shapes as Shape[] };
  }

  /** A node that (after transformations and groups) is only prisms. */
  private async flatPrisms(n: CsgNode, m: Mat): Promise<NonNullable<Awaited<ReturnType<Converter['prismOf']>>>[] | null> {
    if (n.name === 'multmatrix') return this.flatAll(n.children, mul(m, asMat(n.pos[0] ?? n.args.m)));
    if (GROUPS.has(n.name)) return this.flatAll(n.children, m);
    const p = await this.prismOf(n, m);
    return p ? [p] : null;
  }
  private async flatAll(children: CsgNode[], m: Mat) {
    const out: NonNullable<Awaited<ReturnType<Converter['prismOf']>>>[] = [];
    for (const c of children) {
      const p = await this.flatPrisms(c, m);
      if (!p) return null;
      out.push(...p);
    }
    return out;
  }

  /** 2D that OpenSCAD has to draw (offset, text, overlap …) → loops. */
  private async rendered(children: CsgNode[]): Promise<Shape[] | null> {
    // Fine resolution where $fn is not set (text, offset …) – the arcs are then found in the
    // points. The CSG export writes $fa/$fs on every node, so they are changed in the nodes.
    const fine = (n: CsgNode): CsgNode => ({
      ...n,
      args: num(n.args.$fn) ? n.args : { ...n.args, ...('$fa' in n.args ? { $fa: 2 } : {}), ...('$fs' in n.args ? { $fs: 0.1 } : {}) },
      children: n.children.map(fine),
    });
    const src = children.map(c => csgToScad(fine(c))).join('\n');
    try {
      const loops = svgLoops(await this.engine.svg(src));
      const hasText = (n: CsgNode): boolean => n.name === 'text' || n.children.some(hasText);
      const text = children.some(hasText) ? { text: true as const } : {};
      return loops.length ? loops.map(pts => ({ kind: 'loop', pts, ...text })) : null;
    } catch {
      return null;
    }
  }
}

// ---- Sketches -------------------------------------------------------------------------------

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6).replace('.', ',');

/** Arcs in a polygon: runs of ≥ 4 points on the same circle (rounded corners, offset). */
function fitSegments(pts: Vec[]): ({ kind: 'line'; a: number; b: number } | { kind: 'arc'; a: number; b: number; c: Vec; ccw: boolean })[] {
  const n = pts.length;
  const size = Math.max(...pts.map(p => Math.hypot(p.x - pts[0].x, p.y - pts[0].y)), 1e-9);
  const circle = (a: Vec, b: Vec, c: Vec) => {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
    const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
    return { c: { x: ux, y: uy }, r: Math.hypot(a.x - ux, a.y - uy) };
  };
  const turn = (i: number) => {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    return Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y));
  };
  // Start at a transition (where the segment length or the turn changes most), so no arc is split
  // by the start.
  const len = (i: number) => Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
  let start = 0, bestJump = -1;
  for (let i = 0; i < n; i++) {
    const a = len((i - 1 + n) % n), b = len(i);
    const j = Math.abs(Math.log(Math.max(a, 1e-12) / Math.max(b, 1e-12))) + Math.abs(turn(i) - turn((i - 1 + n) % n));
    if (j > bestJump) [bestJump, start] = [j, i];
  }
  const P = (k: number) => pts[(start + k) % n];
  const out: ReturnType<typeof fitSegments> = [];
  let i = 0;
  while (i < n) {
    let best = 0;
    if (i + 3 <= n) {
      const c0 = circle(P(i), P(i + 1), P(i + 2));
      // One step in an arc: about as long as the first, and a small turn in the same direction.
      const seg = Math.hypot(P(i + 1).x - P(i).x, P(i + 1).y - P(i).y);
      const turnAt = (k: number) => turn((start + k) % n);
      const t0 = turnAt(i + 1);
      const step = (k: number) => {
        const s = Math.hypot(P(k + 1).x - P(k).x, P(k + 1).y - P(k).y);
        const tk = turnAt(k);
        return s < seg * 1.5 + 1e-9 && s > seg / 1.5 - 1e-9 && Math.sign(tk) === Math.sign(t0) && Math.abs(tk) < 0.61 && Math.abs(tk) > 1e-3 && Math.abs(tk) < 2 * Math.abs(t0) + 1e-6 && Math.abs(tk) > Math.abs(t0) / 2 - 1e-6;
      };
      if (c0 && c0.r < size * 2 && Math.abs(t0) < 0.61 && Math.abs(t0) > 1e-3 && step(i + 1)) {
        const tol = Math.max(1e-4, c0.r * 2e-3);
        let j = i + 2;
        while (j + 1 <= n) {
          const q = P(j + 1);
          if (Math.abs(Math.hypot(q.x - c0.c.x, q.y - c0.c.y) - c0.r) > tol || !step(j)) break;
          j++;
          if (j === n) break;
        }
        if (j - i >= 3) best = j - i; // at least three segments
        if (best) {
          const a = P(i), b = P(i + 1), e = P(i + best);
          const ccw = (a.x - c0.c.x) * (b.y - c0.c.y) - (a.y - c0.c.y) * (b.x - c0.c.x) > 0;
          // Center on the perpendicular bisector of the end points: both then lie exactly on the
          // radius (the points from OpenSCAD are rounded, and the sketch's regions require the arc
          // to reach its end point).
          let c = c0.c;
          const L = Math.hypot(e.x - a.x, e.y - a.y);
          if (L > 1e-9) {
            const mx = (a.x + e.x) / 2, my = (a.y + e.y) / 2, nx = -(e.y - a.y) / L, ny = (e.x - a.x) / L;
            const k = (c.x - mx) * nx + (c.y - my) * ny;
            c = { x: mx + k * nx, y: my + k * ny };
          }
          out.push({ kind: 'arc', a: (start + i) % n, b: (start + i + best) % n, c, ccw });
          i += best;
          continue;
        }
      }
    }
    out.push({ kind: 'line', a: (start + i) % n, b: (start + i + 1) % n });
    i++;
  }
  return out;
}

/** A point that could place a shape along one axis: its coordinate, and the point id (made on demand). */
type AnchorCand = { v: number; p: () => string };

/**
 * The sketch builder's choices (which point places a shape …). Recorded in the first conversion and
 * replayed when the code is converted again with a variable nudged, so both documents have the same
 * structure and their values can be compared one by one.
 */
class Choices {
  private log: number[] = [];
  private at = -1;
  replay() {
    this.at = 0;
  }
  pick(choose: () => number): number {
    if (this.at < 0) {
      const v = choose();
      this.log.push(v);
      return v;
    }
    return this.log[this.at++] ?? choose();
  }
}

class SketchBuilder {
  constructor(private sk: SketchData, private linker: ParamLinker, private choices: Choices) {}
  private pt(p: Vec) {
    const id = newId(this.sk, 'p');
    this.sk.points[id] = { x: p.x, y: p.y };
    return id;
  }
  private line(a: string, b: string, c?: 'horizontal' | 'vertical') {
    const id = newId(this.sk, 'e');
    this.sk.entities[id] = { type: 'line', p1: a, p2: b };
    if (c) this.sk.constraints.push({ id: newId(this.sk, 'c'), type: c, e: id });
    return id;
  }
  private arc(c: Vec, a: string, b: string, ccw: boolean) {
    const id = newId(this.sk, 'e');
    this.sk.entities[id] = { type: 'arc', c: this.pt(c), p1: ccw ? a : b, p2: ccw ? b : a };
    return id;
  }
  private con(c: object) {
    this.sk.constraints.push({ id: newId(this.sk, 'c'), ...c } as SketchData['constraints'][number]);
  }
  /** A dimension from the origin to point p along one axis (or "in line with the origin" for 0). */
  fixAxis(axis: 'x' | 'y', p: string) {
    const sk = this.sk, v = sk.points[p][axis];
    sk.points[ORIGIN] ??= { x: 0, y: 0 };
    if (Math.abs(v) < 1e-9) this.con({ type: axis === 'x' ? 'vpoints' : 'hpoints', p1: ORIGIN, p2: p });
    else this.con({ type: 'distance', p1: ORIGIN, p2: p, dir: axis === 'x' ? 'h' : 'v', value: Math.abs(v), ...(v < 0 ? { sign: -1 } : {}) });
  }
  /**
   * Place the shape along each axis by the candidate the code explains best (0 or a variable
   * expression; the first on a tie), so changed sizes grow from where the code puts the shape
   * instead of wherever the solver likes.
   */
  private place(xs: AnchorCand[], ys: AnchorCand[]) {
    for (const [axis, cands] of [['x', xs], ['y', ys]] as const) {
      const best = this.choices.pick(() => {
        let best = 0, score = -1;
        cands.forEach((c, i) => {
          const s = this.linker.explains(c.v);
          if (s > score) [best, score] = [i, s];
        });
        return best;
      });
      this.fixAxis(axis, cands[Math.min(best, cands.length - 1)].p());
    }
  }

  add(s: Shape): void {
    const sk = this.sk;
    switch (s.kind) {
      case 'rect': {
        // With dimensions: width and height can be changed directly.
        const p = [this.pt({ x: s.x0, y: s.y0 }), this.pt({ x: s.x1, y: s.y0 }), this.pt({ x: s.x1, y: s.y1 }), this.pt({ x: s.x0, y: s.y1 })];
        this.line(p[0], p[1], 'horizontal');
        this.line(p[1], p[2], 'vertical');
        this.line(p[2], p[3], 'horizontal');
        this.line(p[3], p[0], 'vertical');
        sk.constraints.push({ id: newId(sk, 'c'), type: 'distance', p1: p[0], p2: p[1], dir: 'h', value: s.x1 - s.x0 });
        sk.constraints.push({ id: newId(sk, 'c'), type: 'distance', p1: p[1], p2: p[2], dir: 'v', value: s.y1 - s.y0 });
        // Placed by a corner, an edge or – when centered (cube(center = true)) – the center on a
        // construction diagonal, like the center rectangle tool.
        let mid: string | undefined;
        const center = () => {
          if (mid) return mid;
          const d = newId(sk, 'e');
          mid = this.pt({ x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2 });
          sk.entities[d] = { type: 'line', p1: p[0], p2: p[2], construction: true };
          this.con({ type: 'midpoint', p: mid, e: d, quiet: true });
          return mid;
        };
        this.place(
          [{ v: s.x0, p: () => p[0] }, { v: (s.x0 + s.x1) / 2, p: center }, { v: s.x1, p: () => p[1] }],
          [{ v: s.y0, p: () => p[0] }, { v: (s.y0 + s.y1) / 2, p: center }, { v: s.y1, p: () => p[3] }],
        );
        return;
      }
      case 'circle': {
        const id = newId(sk, 'e');
        const c = this.pt(s.c);
        sk.entities[id] = { type: 'circle', c, r: s.r };
        sk.constraints.push({ id: newId(sk, 'c'), type: 'diameter', e: id, value: 2 * s.r });
        this.place([{ v: s.c.x, p: () => c }], [{ v: s.c.y, p: () => c }]);
        return;
      }
      case 'rhull': {
        const cs = s.centers.length > 2 ? convexHull(s.centers) : dedupe(s.centers);
        if (cs.length === 1) return this.add({ kind: 'circle', c: cs[0], r: s.r });
        // Lines offset outwards along each edge, arcs around the corners (counterclockwise).
        const k = cs.length;
        const normal = (i: number) => {
          const a = cs[i], b = cs[(i + 1) % k];
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          return { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
        };
        const starts: string[] = [], ends: string[] = [], lines: string[] = [], arcs: string[] = [];
        for (let i = 0; i < k; i++) {
          const nn = normal(i), a = cs[i], b = cs[(i + 1) % k];
          starts.push(this.pt({ x: a.x + nn.x * s.r, y: a.y + nn.y * s.r }));
          ends.push(this.pt({ x: b.x + nn.x * s.r, y: b.y + nn.y * s.r }));
          lines.push(this.line(starts[i], ends[i], Math.abs(nn.x) < 1e-12 ? 'horizontal' : Math.abs(nn.y) < 1e-12 ? 'vertical' : undefined));
        }
        for (let i = 0; i < k; i++) arcs.push(this.arc(cs[(i + 1) % k], ends[i], starts[(i + 1) % k], true));
        // Parametric: the lines are tangent to the arcs, all corners have the same radius (with
        // dimensions).
        for (let i = 0; i < k; i++) {
          this.con({ type: 'tangent', e1: lines[i], e2: arcs[i], quiet: true });
          this.con({ type: 'tangent', e1: lines[(i + 1) % k], e2: arcs[i], quiet: true });
          if (i) this.con({ type: 'equal', e1: arcs[0], e2: arcs[i], quiet: true });
        }
        this.con({ type: 'radius', e: arcs[0], value: s.r });
        // Rounded rectangle: outer width and outer height as dimensions.
        const xs: AnchorCand[] = [], ys: AnchorCand[] = [];
        if (k === 4) {
          const dirs = cs.map((_, i) => normal(i));
          const find = (x: number, y: number) => dirs.findIndex(d => Math.abs(d.x - x) < 1e-9 && Math.abs(d.y - y) < 1e-9);
          const [right, left, top, bottom] = [find(1, 0), find(-1, 0), find(0, 1), find(0, -1)];
          if (Math.min(right, left, top, bottom) >= 0) {
            const box = shapeBox(s);
            this.con({ type: 'pldistance', p: starts[right], e: lines[left], value: box.x1 - box.x0 });
            this.con({ type: 'pldistance', p: starts[top], e: lines[bottom], value: box.y1 - box.y0 });
            // The outer edges can also place it (translate([wall, wall]) of a rounded box).
            xs.push({ v: box.x0, p: () => starts[left] }, { v: box.x1, p: () => starts[right] });
            ys.push({ v: box.y0, p: () => starts[bottom] }, { v: box.y1, p: () => starts[top] });
          }
        }
        // Or by a corner's center (the bottom left one first).
        const centerOf = (i: number) => (sk.entities[arcs[(i + k - 1) % k]] as { c: string }).c;
        const order = cs.map((_, i) => i).sort((a, b) => cs[a].x + cs[a].y - (cs[b].x + cs[b].y));
        this.place(
          [{ v: cs[order[0]].x, p: () => centerOf(order[0]) }, ...xs, ...order.slice(1).map(i => ({ v: cs[i].x, p: () => centerOf(i) }))],
          [{ v: cs[order[0]].y, p: () => centerOf(order[0]) }, ...ys, ...order.slice(1).map(i => ({ v: cs[i].y, p: () => centerOf(i) }))],
        );
        return;
      }
      case 'loop': {
        const pts = dedupe(s.pts);
        if (pts.length < 3) return;
        // A full circle drawn as a polygon (many corners on the same circle) → circle.
        const segs = fitSegments(pts);
        if (segs.length === 1 && segs[0].kind === 'arc') {
          const c = segs[0].c;
          return this.add({ kind: 'circle', c, r: Math.hypot(pts[0].x - c.x, pts[0].y - c.y) });
        }
        // A (rounded) rectangle drawn by OpenSCAD (offset(r) square, …) → the parametric shape. Not
        // in text: a placed "-" or "I" would move away from the other letters.
        const known = !s.text && roundedRect(pts);
        if (known) return this.add(known);
        const ids = pts.map(p => this.pt(p));
        // A small polygon whose corners come from variables (polygon([[t, t], [t + 30, t], …])):
        // every corner placed from the origin, so they follow the variables.
        const byCorners = !s.text && !!this.choices.pick(() =>
          +(segs.length <= 12 && segs.every(g => g.kind === 'line') && pts.some(p => this.linker.explains(p.x) === 1 || this.linker.explains(p.y) === 1)));
        for (const g of segs) {
          if (g.kind === 'line') {
            const a = pts[g.a], b = pts[g.b];
            this.line(ids[g.a], ids[g.b], byCorners ? undefined : Math.abs(a.y - b.y) < 1e-9 ? 'horizontal' : Math.abs(a.x - b.x) < 1e-9 ? 'vertical' : undefined);
          } else this.arc(g.c, ids[g.a], ids[g.b], g.ccw);
        }
        if (byCorners) for (const id of ids) (['x', 'y'] as const).forEach(axis => this.fixAxis(axis, id));
        // Points in the middle of arcs are not used.
        const used = new Set(Object.values(sk.entities).flatMap(e => (e.type === 'circle' ? [e.c] : e.type === 'line' ? [e.p1, e.p2] : [e.c, e.p1, e.p2])));
        for (const id of ids) if (!used.has(id)) delete sk.points[id];
        return;
      }
    }
  }
}
/**
 * An axis-aligned rectangle, or one with four equal rounded corners, as a rect/rhull shape: every
 * corner and every edge midpoint of the polygon lies on its outline. The size and radius come from
 * the straight edges (exact in the SVG export), not from the polygon's arcs.
 */
function roundedRect(pts: Vec[]): Shape | null {
  const { x0, y0, x1, y1 } = box2(pts), w = x1 - x0, h = y1 - y0;
  const eps = 1e-6 * Math.max(1, w, h);
  const bottom = pts.filter(p => Math.abs(p.y - y0) < eps);
  if (!(w > eps && h > eps) || bottom.length < 2) return null;
  const r = Math.min(...bottom.map(p => p.x)) - x0;
  if (r > Math.min(w, h) / 2 - eps) return null;
  // The polygon's arcs (and offset(delta) of them) are a little inside the true arc.
  const tol = Math.max(eps, r * 0.02);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = w / 2 - r, hy = h / 2 - r;
  const off = (p: Vec) => {
    const qx = Math.abs(p.x - cx) - hx, qy = Math.abs(p.y - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const mids = pts.map((p, i) => ({ x: (p.x + pts[(i + 1) % pts.length].x) / 2, y: (p.y + pts[(i + 1) % pts.length].y) / 2 }));
  if ([...pts, ...mids].some(p => Math.abs(off(p)) > tol)) return null;
  if (r < eps) return { kind: 'rect', x0, y0, x1, y1 };
  return { kind: 'rhull', r, centers: [{ x: x0 + r, y: y0 + r }, { x: x1 - r, y: y0 + r }, { x: x1 - r, y: y1 - r }, { x: x0 + r, y: y1 - r }] };
}
const dedupe = (pts: Vec[]) => pts.filter((p, i) => {
  const q = pts[(i + 1) % pts.length];
  return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
});

/** Merge consecutive prisms with the same plane, height and operation into one sketch (if the shapes do not touch each other). */
function mergeTools(tools: Tool[]): Tool[] {
  const out: Tool[] = [];
  for (const t of tools) {
    const last = out[out.length - 1];
    if (
      t.kind === 'prism' && last?.kind === 'prism' && last.op === t.op && last.plane === t.plane && last.direction === t.direction &&
      Math.abs(last.offset - t.offset) < 1e-9 && Math.abs(last.depth - t.depth) < 1e-9 &&
      t.shapes.every(s => last.shapes.every(o => disjoint2(shapeBox(s), shapeBox(o))))
    ) {
      out[out.length - 1] = { ...last, shapes: [...last.shapes, ...t.shapes] };
    } else out.push(t);
  }
  return out;
}

/**
 * One code block per run of tools with the same op: additions in a row are a union and removals in
 * a row cut the union of them, in any order, so the run's code goes into its first code block (a
 * honeycomb of holes would otherwise be hundreds of blocks in the tree). Intersections stay apart.
 */
function mergeCode(tools: Tool[]): Tool[] {
  const out: Tool[] = [];
  let op: Op | null = null, block = -1;
  for (const t of tools) {
    if (t.op !== op) [op, block] = [t.op, -1];
    if (t.kind === 'code' && t.op !== 'intersect') {
      const first = out[block];
      if (first?.kind === 'code') {
        out[block] = { ...first, code: `${first.code}\n${t.code}` };
        continue;
      }
      block = out.length;
    }
    out.push(t);
  }
  return out;
}

/**
 * Convert OpenSCAD code to a document with sketches and features. The code's top-level variables
 * become the document's variables, linked to the values that depend on them (convert/params.ts).
 */
export async function scadToDoc(src: string, engine: ConvertEngine, onLinking?: () => void): Promise<ConvertResult> {
  const linker = new ParamLinker(src);
  const choices = new Choices();
  const r = await buildDoc(src, engine, linker, choices);
  if (linker.params.length) onLinking?.();
  const linked = await linker.link(r.doc, async nudged => {
    choices.replay();
    return (await buildDoc(nudged, engine, linker, choices)).doc;
  });
  return { ...r, params: linker.params.length, linked };
}

async function buildDoc(src: string, engine: ConvertEngine, linker: ParamLinker, choices: Choices) {
  const roots = parseCsg(await engine.csg(src));
  const conv = new Converter(engine);
  for (const n of roots) await conv.walk(n, I4, 'add');
  const tools = mergeCode(mergeTools(conv.tools));
  const doc = emptyDoc();
  let sketches = 0, extrudes = 0, revolves = 0, codeBlocks = 0;
  for (const t of tools) {
    if (t.kind === 'code') {
      const f = newFeature(doc, 'code', { id: '' } as never);
      f.code = t.code;
      f.op = t.op;
      doc.features.push(f);
      codeBlocks++;
      continue;
    }
    if (t.kind === 'revolve') {
      doc.features.push(...revolveFeatures(doc, t, linker, choices));
      sketches++;
      revolves++;
      continue;
    }
    const sk = newSketch(doc, t.plane);
    if (Math.abs(t.offset) > 1e-9) sk.offset = fmt(t.offset);
    const b = new SketchBuilder(sk, linker, choices);
    for (const s of t.shapes) b.add(s);
    doc.features.push(sk);
    const e = newFeature(doc, 'extrude', sk);
    e.depth = fmt(t.depth);
    e.direction = t.direction;
    e.op = t.op;
    doc.features.push(e);
    sketches++;
    extrudes++;
  }
  return { doc, sketches, extrudes, revolves, codeBlocks };
}

/** Sketch with profile and axis (construction line) + Revolve 360°. */
function revolveFeatures(doc: Doc, t: Extract<Tool, { kind: 'revolve' }>, linker: ParamLinker, choices: Choices) {
  const sk = newSketch(doc, t.plane);
  if (Math.abs(t.offset) > 1e-9) sk.offset = fmt(t.offset);
  const pt = (p: Vec) => {
    const id = newId(sk, 'p');
    sk.points[id] = { x: p.x, y: p.y };
    return id;
  };
  // Every point placed from the origin, so the profile follows the variables.
  const b = new SketchBuilder(sk, linker, choices);
  const place = (id: string) => (['x', 'y'] as const).forEach(axis => b.fixAxis(axis, id));
  const ids = t.profile.map(pt);
  const [a0, a1] = t.axis;
  const vertical = Math.abs(a0.x - a1.x) < 1e-9;
  if (t.arc) {
    // Sphere: half circle (counterclockwise from ids[0] to ids[1]) + the line along the axis. The
    // center is placed, the radius is a dimension, and the ends lie on the axis through the center.
    const c = pt(t.arc.c), e = newId(sk, 'e');
    sk.entities[e] = { type: 'arc', c, p1: ids[0], p2: ids[1] };
    sk.entities[newId(sk, 'e')] = { type: 'line', p1: ids[1], p2: ids[0] };
    place(c);
    const { x, y } = sk.points[c], p = sk.points[ids[0]];
    sk.constraints.push({ id: newId(sk, 'c'), type: 'radius', e, value: Math.hypot(p.x - x, p.y - y) });
    for (const id of ids) sk.constraints.push({ id: newId(sk, 'c'), type: vertical ? 'vpoints' : 'hpoints', p1: c, p2: id });
  } else {
    ids.forEach((id, i) => (sk.entities[newId(sk, 'e')] = { type: 'line', p1: id, p2: ids[(i + 1) % ids.length] }));
    ids.forEach(place);
  }
  // The axis: the sketch's Y/X axis if it goes through the origin, otherwise a construction line.
  const r = newFeature(doc, 'revolve', sk);
  if (Math.abs(a0.x) < 1e-9 && Math.abs(a1.x) < 1e-9) r.axis = { kind: 'y' };
  else if (Math.abs(a0.y) < 1e-9 && Math.abs(a1.y) < 1e-9) r.axis = { kind: 'x' };
  else {
    const e = newId(sk, 'e'), p1 = pt(a0), p2 = pt(a1);
    sk.entities[e] = { type: 'line', p1, p2, construction: true };
    [p1, p2].forEach(place);
    r.axis = { kind: 'line', e };
  }
  r.op = t.op;
  return [sk, r];
}
