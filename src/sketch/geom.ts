// 2D geometry for sketches (mm, y up).

export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleOf = (c: Vec, p: Vec) => Math.atan2(p.y - c.y, p.x - c.x);
export const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;
export const polar = (c: Vec, r: number, a: number): Vec => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

/** Counterclockwise angle from a0 to a1, in (0, 2π]. */
export function ccwSweep(a0: number, a1: number) {
  const s = normAngle(a1 - a0);
  return s < 1e-12 ? TAU : s;
}

/** Circle through three points (null if they are collinear). */
export function circumcircle(a: Vec, b: Vec, c: Vec): { c: Vec; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const scale = Math.max(dist(a, b), dist(b, c), dist(a, c));
  if (Math.abs(d) < 1e-9 * scale * scale) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { c: center, r: dist(center, a) };
}

/** Arc from start to end through mid: center, radius and whether it goes counterclockwise. */
export function arcThrough(start: Vec, end: Vec, mid: Vec): { c: Vec; r: number; ccw: boolean } | null {
  const cc = circumcircle(start, mid, end);
  if (!cc) return null;
  const a0 = angleOf(cc.c, start);
  const ccw = ccwSweep(a0, angleOf(cc.c, mid)) < ccwSweep(a0, angleOf(cc.c, end));
  return { ...cc, ccw };
}

export function distToSegment(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance to a counterclockwise arc (c, r, from angle a0, sweep sweep). */
export function distToArc(p: Vec, c: Vec, r: number, a0: number, sweep: number) {
  if (ccwSweep(a0, angleOf(c, p)) <= sweep) return Math.abs(dist(p, c) - r);
  return Math.min(dist(p, polar(c, r, a0)), dist(p, polar(c, r, a0 + sweep)));
}

/** Number of segments for an arc so the chord error stays below tol (mm). */
export function segmentsFor(r: number, sweep: number, tol = 0.01) {
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(r, 1e-9)));
  const full = Math.min(360, Math.max(16, Math.ceil(TAU / step)));
  return Math.max(2, Math.ceil((full * sweep) / TAU));
}

/** Points along a counterclockwise arc, including both end points. */
export function arcPoints(c: Vec, r: number, a0: number, sweep: number, tol = 0.01): Vec[] {
  const n = segmentsFor(r, sweep, tol);
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) pts.push(polar(c, r, a0 + (sweep * i) / n));
  return pts;
}

/** Shoelace: positive for a counterclockwise polygon. */
export function signedArea(pts: Vec[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
}

export function pointInPolygon(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Number formatting in Swedish style (decimal comma) with at most `dec` decimals. */
export function fmtNum(n: number, dec = 2) {
  const s = (Math.round(n * 10 ** dec) / 10 ** dec).toFixed(dec).replace(/\.?0+$/, '');
  return (s === '-0' ? '0' : s).replace('.', ',');
}
