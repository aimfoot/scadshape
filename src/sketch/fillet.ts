// Avrunda (fillet) och fasa (chamfer) skisshörn: ett hörn är en punkt där exakt två
// linjer möts. Linjerna trimmas till tangentpunkterna och hörnet ersätts av en tangent
// båge (radiemått) resp. en rak linje (mått på benet).
//
// Virtuellt hörn: har hörnpunkten mått/villkor (eller är origo) behålls den på
// linjernas förlängning, så att de måtten fortsätter gälla. En linje med Lika/Mittpunkt
// blir konstruktion i full längd (villkoren gäller hela sidan) och får en trimmad kopia.

import { angleOf, ccwSweep, dist, type Vec } from './geom';
import { constraintRefs, entityPointIds, newId, ORIGIN, removeEntities, type Constraint, type LineE, type NewConstraint, type SketchData } from './model';

export type CornerKind = 'fillet' | 'chamfer';

export interface Corner {
  p: string;
  l1: string;
  l2: string;
}

const other = (l: LineE, p: string) => (l.p1 === p ? l.p2 : l.p1);
const unit = (a: Vec, b: Vec): Vec => {
  const L = dist(a, b);
  return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
};

/** Hörnet i punkten p, eller null (fler/färre än två linjer, båge i punkten, parallella linjer). */
export function cornerAt(sk: SketchData, p: string): Corner | null {
  const at = Object.entries(sk.entities).filter(([, e]) => !e.construction && entityPointIds(e).includes(p));
  if (at.length !== 2 || at.some(([, e]) => e.type !== 'line')) return null;
  const [[l1, e1], [l2, e2]] = at as [string, LineE][];
  const P = sk.points[p], A = sk.points[other(e1, p)], B = sk.points[other(e2, p)];
  if (!P || dist(P, A) < 1e-9 || dist(P, B) < 1e-9) return null;
  const u1 = unit(P, A), u2 = unit(P, B);
  if (Math.abs(u1.x * u2.y - u1.y * u2.x) < 0.01) return null; // (nästan) raka eller vikta tillbaka
  return { p, l1, l2 };
}

/** Hörnen i en markering: markerade hörnpunkter, eller punkter som två markerade linjer delar. */
export function cornersFor(sk: SketchData, points: string[], lines: string[]): Corner[] {
  if (points.length) {
    const cs = points.map(p => cornerAt(sk, p));
    return cs.every(Boolean) ? (cs as Corner[]) : [];
  }
  const sel = new Set(lines);
  const ends = new Set(lines.flatMap(l => entityPointIds(sk.entities[l])));
  return [...ends].map(p => cornerAt(sk, p)).filter((c): c is Corner => !!c && sel.has(c.l1) && sel.has(c.l2));
}

/** Hörnets vinkel (0..π) och de båda linjernas längder. */
function cornerGeom(sk: SketchData, c: Corner) {
  const l1 = sk.entities[c.l1] as LineE, l2 = sk.entities[c.l2] as LineE;
  const P = sk.points[c.p], A = sk.points[other(l1, c.p)], B = sk.points[other(l2, c.p)];
  const u1 = unit(P, A), u2 = unit(P, B);
  const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  return { P, u1, u2, theta, len1: dist(P, A), len2: dist(P, B) };
}

/** Avståndet från hörnet längs linjerna till tangentpunkten för en radie/fasning. */
const legFor = (kind: CornerKind, size: number, theta: number) => (kind === 'fillet' ? size / Math.tan(theta / 2) : size);

/** Ett jämnt förslag som får plats i alla hörnen (ungefär en fjärdedel av kortaste sidan). */
export function defaultCornerSize(sk: SketchData, corners: Corner[], kind: CornerKind): number {
  let best = Infinity;
  for (const c of corners) {
    const g = cornerGeom(sk, c);
    const leg = 0.25 * Math.min(g.len1, g.len2);
    best = Math.min(best, kind === 'fillet' ? leg * Math.tan(g.theta / 2) : leg);
  }
  return niceDown(best);
}

function niceDown(v: number) {
  if (!(v > 0) || !isFinite(v)) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [8, 6, 5, 4, 3, 2.5, 2, 1.5, 1]) if (m * k <= v * (1 + 1e-9)) return m * k;
  return k;
}

/**
 * Ersätt hörnen med bågar/fasningar av storleken size (radie resp. benlängd).
 * Hörnen behandlas ett i taget från aktuell geometri (en linje kan ha hörn i båda ändar).
 * Returnerar id för måttet, eller null om något hörn inte längre går (eller inte får plats).
 */
export function cutCorners(sk: SketchData, points: string[], kind: CornerKind, size: number): string | null {
  let dim: string | null = null;
  let first: string | null = null; // första bågen (fillet) resp. första benet (chamfer)
  const add = (c: NewConstraint) => {
    const id = newId(sk, 'c');
    sk.constraints.push({ ...c, id } as Constraint);
    return id;
  };
  const addLine = (p1: string, p2: string, construction?: true) => {
    const id = newId(sk, 'e');
    sk.entities[id] = { type: 'line', p1, p2, construction };
    return id;
  };
  for (const p of points) {
    const corner = cornerAt(sk, p);
    if (!corner) return null;
    const g = cornerGeom(sk, corner);
    const leg = legFor(kind, size, g.theta);
    if (!(leg > 1e-9) || leg >= g.len1 - 1e-9 || leg >= g.len2 - 1e-9) return null;
    const T: string[] = [];
    const real: string[] = [];
    const trimmed: string[] = [];
    for (const [l, u] of [[corner.l1, g.u1], [corner.l2, g.u2]] as const) {
      const t = newId(sk, 'p');
      sk.points[t] = { x: g.P.x + u.x * leg, y: g.P.y + u.y * leg };
      T.push(t);
      const line = sk.entities[l] as LineE;
      const full = sk.constraints.some(c => (c.type === 'equal' && (c.e1 === l || c.e2 === l)) || (c.type === 'midpoint' && c.e === l));
      if (full) {
        line.construction = true;
        real.push(addLine(t, other(line, p)));
        add({ type: 'onCurve', p: t, e: l, quiet: true });
      } else {
        if (line.p1 === p) line.p1 = t;
        else line.p2 = t;
        real.push(l);
        trimmed.push(l);
      }
    }
    const referenced = p === ORIGIN || sk.constraints.some(c => constraintRefs(c).points.includes(p));
    const used = Object.values(sk.entities).some(e => entityPointIds(e).includes(p));
    let legs: string[] = [];
    if (kind === 'chamfer' || referenced || used) {
      for (const l of trimmed) add({ type: 'onCurve', p, e: l, quiet: true });
      if (kind === 'chamfer' || !used) legs = T.map(t => addLine(p, t, true));
    } else delete sk.points[p];

    if (kind === 'fillet') {
      const P = g.P, half = g.theta / 2;
      const bis = unit({ x: 0, y: 0 }, { x: g.u1.x + g.u2.x, y: g.u1.y + g.u2.y });
      const c = newId(sk, 'p');
      sk.points[c] = { x: P.x + (bis.x * size) / Math.sin(half), y: P.y + (bis.y * size) / Math.sin(half) };
      // Bågen går moturs från p1 till p2 – välj ordning så att den blir den korta (< 180°).
      const C = sk.points[c];
      let [p1, p2] = T;
      if (ccwSweep(angleOf(C, sk.points[p1]), angleOf(C, sk.points[p2])) > Math.PI) [p1, p2] = [p2, p1];
      const arc = newId(sk, 'e');
      sk.entities[arc] = { type: 'arc', c, p1, p2 };
      for (const l of real) add({ type: 'tangent', e1: l, e2: arc, quiet: true });
      if (first) add({ type: 'equal', e1: first, e2: arc, quiet: true });
      else {
        first = arc;
        dim = add({ type: 'radius', e: arc, value: size });
      }
    } else {
      addLine(T[0], T[1]);
      add({ type: 'equal', e1: legs[0], e2: legs[1], quiet: true });
      if (first) add({ type: 'equal', e1: first, e2: legs[0], quiet: true });
      else {
        first = legs[0];
        dim = add({ type: 'distance', p1: p, p2: T[0], dir: 'aligned', value: size });
      }
    }
  }
  removeEntities(sk, []);
  return dim;
}
