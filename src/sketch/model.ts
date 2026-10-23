// The sketch's data model. Entities refer to points by id; two entities that share a point are
// joined (coincident). The same layout as planegcs (phase 2).

import { angleOf, ccwSweep, dist, polar, type Vec } from './geom';
import type { Key } from '../i18n';

export type Plane = 'XY' | 'XZ' | 'YZ';
/** The plane names' language keys. */
export const PLANE_NAMES: Record<Plane, Key> = { XY: 'plane.top', XZ: 'plane.front', YZ: 'plane.right' };

export interface SPoint {
  x: number;
  y: number;
  /** Standalone point (the point tool, e.g. a hole center); kept without curves. */
  standalone?: true;
}

interface Base {
  construction?: boolean;
}
export interface LineE extends Base {
  type: 'line';
  p1: string;
  p2: string;
}
export interface CircleE extends Base {
  type: 'circle';
  c: string;
  r: number;
}
/** Arc counterclockwise from p1 to p2 around c; the radius is |p1 − c| (p2 is kept on the same radius). */
export interface ArcE extends Base {
  type: 'arc';
  c: string;
  p1: string;
  p2: string;
}
export type Entity = LineE | CircleE | ArcE;

/**
 * Constraints and dimensions, solved by planegcs (solver.ts). Coincident points are expressed by
 * entities sharing a point id, not as constraints.
 */
export type Constraint = ConstraintKind & {
  /** Created by a tool (polygon, slot): the symbol is only shown when the shape is selected. */
  quiet?: true;
};
type ConstraintKind =
  | { id: string; type: 'horizontal' | 'vertical'; e: string } // line
  | { id: string; type: 'hpoints' | 'vpoints'; p1: string; p2: string } // two points in line
  | { id: string; type: 'parallel' | 'perpendicular' | 'equal' | 'tangent' | 'concentric'; e1: string; e2: string }
  | { id: string; type: 'onCurve' | 'midpoint'; p: string; e: string } // point on curve / middle of line
  | { id: string; type: 'fix'; p: string }
  // Dimensions (driving). Values in mm or degrees; expr = expression with variables (the value is
  // recomputed when they change).
  | { id: string; type: 'distance'; p1: string; p2: string; dir: 'aligned' | 'h' | 'v'; value: number; sign?: 1 | -1; expr?: string }
  | { id: string; type: 'pldistance'; p: string; e: string; value: number; expr?: string }
  | { id: string; type: 'pcdistance'; p: string; e: string; value: number; expr?: string } // point–circle/arc: to the edge
  | { id: string; type: 'ccdistance'; e1: string; e2: string; value: number; expr?: string } // two circles/arcs: edge to edge
  | { id: string; type: 'cldistance'; e: string; l: string; value: number; expr?: string } // circle/arc–line: the edge to the line
  | { id: string; type: 'radius' | 'diameter'; e: string; value: number; expr?: string }
  | { id: string; type: 'angle'; e1: string; e2: string; value: number; expr?: string } // signed, counterclockwise from e1 to e2
  | { id: string; type: 'xangle'; e: string; value: number; expr?: string }; // the line p1→p2 against the X axis, signed counterclockwise (degrees)

export type ConstraintType = Constraint['type'];
/** A constraint without an id (distributed over the union, unlike Omit). */
export type NewConstraint = Constraint extends infer C ? (C extends Constraint ? Omit<C, 'id'> : never) : never;
export const DIMENSION_TYPES: ReadonlySet<ConstraintType> = new Set(['distance', 'pldistance', 'pcdistance', 'ccdistance', 'cldistance', 'radius', 'diameter', 'angle', 'xangle']);
export const isDimension = (c: Constraint) => DIMENSION_TYPES.has(c.type);

/** Points and entities that a constraint refers to. */
export function constraintRefs(c: Constraint): { points: string[]; entities: string[] } {
  switch (c.type) {
    case 'horizontal':
    case 'vertical':
    case 'radius':
    case 'diameter':
    case 'xangle':
      return { points: [], entities: [c.e] };
    case 'hpoints':
    case 'vpoints':
    case 'distance':
      return { points: [c.p1, c.p2], entities: [] };
    case 'parallel':
    case 'perpendicular':
    case 'equal':
    case 'tangent':
    case 'concentric':
    case 'angle':
    case 'ccdistance':
      return { points: [], entities: [c.e1, c.e2] };
    case 'onCurve':
    case 'midpoint':
    case 'pldistance':
    case 'pcdistance':
      return { points: [c.p], entities: [c.e] };
    case 'fix':
      return { points: [c.p], entities: [] };
    case 'cldistance':
      return { points: [], entities: [c.e, c.l] };
  }
}

export interface SketchData {
  points: Record<string, SPoint>;
  entities: Record<string, Entity>;
  constraints: Constraint[];
  nextId: number;
}

/** Origin: a snappable point created the first time something attaches to it; it cannot be moved. */
export const ORIGIN = 'O';

export const emptySketch = (): SketchData => ({ points: {}, entities: {}, constraints: [], nextId: 1 });

export const newId = (sk: SketchData, prefix: 'p' | 'e' | 'c') => `${prefix}${sk.nextId++}`;

/** Give constraints from phase 1 (without an id) an id; tolerates older saved sketches. */
export function normalizeSketch(sk: SketchData) {
  sk.constraints ??= [];
  for (const c of sk.constraints as (Constraint & { id?: string })[]) if (!c.id) c.id = newId(sk, 'c');
  return sk;
}

/** Remove constraints that refer to points/entities that no longer exist, or that have become meaningless. */
export function pruneConstraints(sk: SketchData) {
  sk.constraints = sk.constraints.filter(c => {
    const r = constraintRefs(c);
    if (!r.points.every(p => p in sk.points || p === ORIGIN) || !r.entities.every(e => e in sk.entities)) return false;
    if (r.points.length === 2 && r.points[0] === r.points[1]) return false;
    if (r.entities.length === 2 && r.entities[0] === r.entities[1]) return false;
    if ((c.type === 'onCurve' || c.type === 'midpoint' || c.type === 'pldistance' || c.type === 'pcdistance') && entityPointIds(sk.entities[c.e]).includes(c.p)) return false;
    return true;
  });
}

export function entityPointIds(e: Entity): string[] {
  return e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.c] : [e.c, e.p1, e.p2];
}

export interface ArcGeom {
  c: Vec;
  r: number;
  a0: number;
  sweep: number;
}

export function arcGeom(sk: SketchData, a: ArcE): ArcGeom {
  const c = sk.points[a.c], p1 = sk.points[a.p1], p2 = sk.points[a.p2];
  const a0 = angleOf(c, p1);
  return { c, r: dist(c, p1), a0, sweep: ccwSweep(a0, angleOf(c, p2)) };
}

/** Remove entities, their constraints and points that nothing uses any more. */
export function removeEntities(sk: SketchData, ids: Iterable<string>) {
  for (const id of ids) delete sk.entities[id];
  const used = new Set(Object.values(sk.entities).flatMap(entityPointIds));
  for (const [id, p] of Object.entries(sk.points)) if (!used.has(id) && !p.standalone) delete sk.points[id];
  pruneConstraints(sk);
}

/** Remove points and everything that uses them. */
export function removePoints(sk: SketchData, ids: Iterable<string>) {
  const set = new Set(ids);
  removeEntities(
    sk,
    Object.entries(sk.entities)
      .filter(([, e]) => entityPointIds(e).some(p => set.has(p)))
      .map(([id]) => id),
  );
  for (const id of set) delete sk.points[id];
}

/** Keep arcs consistent after points have moved (without a solver): the end point is put on the radius. */
export function fixArcs(sk: SketchData) {
  for (const e of Object.values(sk.entities)) {
    if (e.type !== 'arc') continue;
    const c = sk.points[e.c], p1 = sk.points[e.p1], p2 = sk.points[e.p2];
    const r = dist(c, p1);
    Object.assign(p2, polar(c, r, angleOf(c, p2)));
  }
}

/** Merge point `from` into `into` (e.g. when a point is dragged and dropped on another). */
export function mergePoints(sk: SketchData, from: string, into: string) {
  if (from === into) return;
  for (const [id, e] of Object.entries(sk.entities)) {
    for (const k of ['p1', 'p2', 'c'] as const) if ((e as unknown as Record<string, string>)[k] === from) (e as unknown as Record<string, string>)[k] = into;
    // A line whose two ends have become the same point disappears.
    if (e.type === 'line' && e.p1 === e.p2) delete sk.entities[id];
    if (e.type === 'arc' && (e.p1 === e.p2 || e.c === e.p1 || e.c === e.p2)) delete sk.entities[id];
  }
  delete sk.points[from];
  for (const c of sk.constraints as unknown as Record<string, unknown>[])
    for (const k of ['p', 'p1', 'p2']) if (c[k] === from) c[k] = into;
  removeEntities(sk, []);
}

export const cloneSketch = (sk: SketchData): SketchData => JSON.parse(JSON.stringify(sk));
