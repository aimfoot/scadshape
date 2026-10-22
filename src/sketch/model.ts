// Skissens datamodell. Entiteter refererar till punkter via id; två entiteter som
// delar en punkt sitter ihop (sammanfallande). Samma upplägg som planegcs (fas 2).

import { angleOf, ccwSweep, dist, polar, type Vec } from './geom';
import type { Key } from '../i18n';

export type Plane = 'XY' | 'XZ' | 'YZ';
/** Plannamnens språknycklar. */
export const PLANE_NAMES: Record<Plane, Key> = { XY: 'plane.top', XZ: 'plane.front', YZ: 'plane.right' };

export interface SPoint {
  x: number;
  y: number;
  /** Fristående punkt (punktverktyget, t.ex. hålcentrum); finns kvar utan kurvor. */
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
/** Båge moturs från p1 till p2 runt c; radien är |p1 − c| (p2 hålls på samma radie). */
export interface ArcE extends Base {
  type: 'arc';
  c: string;
  p1: string;
  p2: string;
}
export type Entity = LineE | CircleE | ArcE;

/**
 * Villkor (constraints) och mått, lösta av planegcs (solver.ts).
 * Sammanfallande punkter uttrycks genom att entiteter delar punkt-id, inte som villkor.
 */
export type Constraint = ConstraintKind & {
  /** Skapat av ett verktyg (polygon, slits): symbolen visas bara när formen är markerad. */
  quiet?: true;
};
type ConstraintKind =
  | { id: string; type: 'horizontal' | 'vertical'; e: string } // linje
  | { id: string; type: 'hpoints' | 'vpoints'; p1: string; p2: string } // två punkter i linje
  | { id: string; type: 'parallel' | 'perpendicular' | 'equal' | 'tangent' | 'concentric'; e1: string; e2: string }
  | { id: string; type: 'onCurve' | 'midpoint'; p: string; e: string } // punkt på kurva / mitt på linje
  | { id: string; type: 'fix'; p: string }
  // Mått (driving). Värden i mm resp. grader; expr = uttryck med variabler (värdet räknas om när de ändras).
  | { id: string; type: 'distance'; p1: string; p2: string; dir: 'aligned' | 'h' | 'v'; value: number; sign?: 1 | -1; expr?: string }
  | { id: string; type: 'pldistance'; p: string; e: string; value: number; expr?: string }
  | { id: string; type: 'pcdistance'; p: string; e: string; value: number; expr?: string } // punkt–cirkel/båge: till kanten
  | { id: string; type: 'ccdistance'; e1: string; e2: string; value: number; expr?: string } // två cirklar/bågar: kant till kant
  | { id: string; type: 'cldistance'; e: string; l: string; value: number; expr?: string } // cirkel/båge–linje: kanten till linjen
  | { id: string; type: 'radius' | 'diameter'; e: string; value: number; expr?: string }
  | { id: string; type: 'angle'; e1: string; e2: string; value: number; expr?: string } // signerad, moturs från e1 till e2
  | { id: string; type: 'xangle'; e: string; value: number; expr?: string }; // linjen p1→p2 mot X-axeln, signerad moturs (grader)

export type ConstraintType = Constraint['type'];
/** Ett villkor utan id (fördelad över unionen, till skillnad från Omit). */
export type NewConstraint = Constraint extends infer C ? (C extends Constraint ? Omit<C, 'id'> : never) : never;
export const DIMENSION_TYPES: ReadonlySet<ConstraintType> = new Set(['distance', 'pldistance', 'pcdistance', 'ccdistance', 'cldistance', 'radius', 'diameter', 'angle', 'xangle']);
export const isDimension = (c: Constraint) => DIMENSION_TYPES.has(c.type);

/** Punkter och entiteter som ett villkor refererar till. */
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

/** Origo: snäppbar punkt som skapas första gången något fäster i den; går inte att flytta. */
export const ORIGIN = 'O';

export const emptySketch = (): SketchData => ({ points: {}, entities: {}, constraints: [], nextId: 1 });

export const newId = (sk: SketchData, prefix: 'p' | 'e' | 'c') => `${prefix}${sk.nextId++}`;

/** Ge villkor från fas 1 (utan id) ett id; tål äldre sparade skisser. */
export function normalizeSketch(sk: SketchData) {
  sk.constraints ??= [];
  for (const c of sk.constraints as (Constraint & { id?: string })[]) if (!c.id) c.id = newId(sk, 'c');
  return sk;
}

/** Ta bort villkor som refererar till punkter/entiteter som inte längre finns, eller som blivit meningslösa. */
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

/** Ta bort entiteter, deras constraints och punkter som ingen längre använder. */
export function removeEntities(sk: SketchData, ids: Iterable<string>) {
  for (const id of ids) delete sk.entities[id];
  const used = new Set(Object.values(sk.entities).flatMap(entityPointIds));
  for (const [id, p] of Object.entries(sk.points)) if (!used.has(id) && !p.standalone) delete sk.points[id];
  pruneConstraints(sk);
}

/** Ta bort punkter och allt som använder dem. */
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

/** Håll bågar konsekventa när punkter flyttats (utan lösare): slutpunkten läggs på radien. */
export function fixArcs(sk: SketchData) {
  for (const e of Object.values(sk.entities)) {
    if (e.type !== 'arc') continue;
    const c = sk.points[e.c], p1 = sk.points[e.p1], p2 = sk.points[e.p2];
    const r = dist(c, p1);
    Object.assign(p2, polar(c, r, angleOf(c, p2)));
  }
}

/** Slå ihop punkt `from` med `into` (t.ex. när en punkt dras och släpps på en annan). */
export function mergePoints(sk: SketchData, from: string, into: string) {
  if (from === into) return;
  for (const [id, e] of Object.entries(sk.entities)) {
    for (const k of ['p1', 'p2', 'c'] as const) if ((e as unknown as Record<string, string>)[k] === from) (e as unknown as Record<string, string>)[k] = into;
    // En linje vars båda ändar blivit samma punkt försvinner.
    if (e.type === 'line' && e.p1 === e.p2) delete sk.entities[id];
    if (e.type === 'arc' && (e.p1 === e.p2 || e.c === e.p1 || e.c === e.p2)) delete sk.entities[id];
  }
  delete sk.points[from];
  for (const c of sk.constraints as unknown as Record<string, unknown>[])
    for (const k of ['p', 'p1', 'p2']) if (c[k] === from) c[k] = into;
  removeEntities(sk, []);
}

export const cloneSketch = (sk: SketchData): SketchData => JSON.parse(JSON.stringify(sk));
