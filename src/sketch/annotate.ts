// Dimensions and constraint symbols: measure current values, draw them and provide hit areas.

import { angleOf, dist, fmtNum, polar, TAU, type Vec } from './geom';
import { arcGeom, isDimension, type Constraint, type SketchData } from './model';

export interface Hotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  key: string; // 'c:<id>'
  dim: boolean;
}

type Line = { a: Vec; b: Vec };
const lineOf = (sk: SketchData, e: string): Line | null => {
  const l = sk.entities[e];
  return l?.type === 'line' ? { a: sk.points[l.p1], b: sk.points[l.p2] } : null;
};
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec) => Math.hypot(v.x, v.y);
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Radius for a circle/arc. */
export function radiusOf(sk: SketchData, e: string): number | null {
  const ent = sk.entities[e];
  if (ent?.type === 'circle') return ent.r;
  if (ent?.type === 'arc') return arcGeom(sk, ent).r;
  return null;
}

/** The circle's/arc's center and radius. */
function curveOf(sk: SketchData, e: string): { c: Vec; r: number } | null {
  const ent = sk.entities[e];
  if (ent?.type === 'circle') return { c: sk.points[ent.c], r: ent.r };
  if (ent?.type === 'arc') return arcGeom(sk, ent);
  return null;
}

/** Distance from a point to a circle's/arc's edge (outside or inside). */
export const pointCurveDistance = (p: Vec, cv: { c: Vec; r: number }) => Math.abs(dist(p, cv.c) - cv.r);

/**
 * The shortest path between two circles' edges along the center line: a on the first, b on the
 * second. Side by side: edge to edge; one inside the other: the inner edge to the outer.
 */
export function curveGap(c1: { c: Vec; r: number }, c2: { c: Vec; r: number }): { gap: number; a: Vec; b: Vec } {
  const d = dist(c1.c, c2.c);
  const ang = d < 1e-9 ? 0 : angleOf(c1.c, c2.c);
  if (d >= c1.r + c2.r) return { gap: d - c1.r - c2.r, a: polar(c1.c, c1.r, ang), b: polar(c2.c, c2.r, ang + Math.PI) };
  // Inside (or overlapping): the edges in the same direction, seen from the larger circle's center.
  return { gap: Math.max(0, Math.abs(c1.r - c2.r) - d), a: polar(c1.c, c1.r, c1.r >= c2.r ? ang : ang + Math.PI), b: polar(c2.c, c2.r, c1.r >= c2.r ? ang : ang + Math.PI) };
}

/** The gap between a circle's edge and a line (the line outside; 0 if it cuts the circle), perpendicular to the line. */
export function curveLineGap(cv: { c: Vec; r: number }, l: Line): { gap: number; a: Vec; b: Vec } {
  const d = sub(l.b, l.a);
  const t = dot(sub(cv.c, l.a), d) / (dot(d, d) || 1);
  const foot = { x: l.a.x + d.x * t, y: l.a.y + d.y * t };
  const h = dist(cv.c, foot);
  const ang = h < 1e-9 ? Math.atan2(d.x, -d.y) : angleOf(cv.c, foot);
  return { gap: Math.max(0, h - cv.r), a: polar(cv.c, cv.r, ang), b: foot };
}

/** The line's direction a→b against the X axis, degrees in (−180, 180]. */
export const xAngle = (l: Line) => (Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI;

/** Signed angle (degrees) from line 1's direction to line 2's, in (−180, 180]. */
export function signedAngle(l1: Line, l2: Line) {
  const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a);
  return (Math.atan2(cross(d1, d2), dot(d1, d2)) * 180) / Math.PI;
}

/** Distance from a point to an (infinite) line. */
export function pointLineDistance(p: Vec, l: Line) {
  const d = sub(l.b, l.a);
  return Math.abs(cross(d, sub(p, l.a))) / (len(d) || 1);
}

/**
 * The angle the user sees: between the half-lines from the intersection towards the lines'
 * midpoints (0–180°). s1/s2 say whether the half-line goes with (1) or against (−1) the line's
 * direction.
 */
export function visibleAngle(l1: Line, l2: Line) {
  const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a);
  const den = cross(d1, d2);
  let I: Vec;
  if (Math.abs(den) < 1e-12 * len(d1) * len(d2)) I = mid(mid(l1.a, l1.b), mid(l2.a, l2.b));
  else {
    const t = cross(sub(l2.a, l1.a), d2) / den;
    I = { x: l1.a.x + d1.x * t, y: l1.a.y + d1.y * t };
  }
  const toward = (l: Line, d: Vec) => {
    let m = mid(l.a, l.b);
    if (dist(m, I) < 1e-9) m = l.b;
    return dot(sub(m, I), d) >= 0 ? 1 : -1;
  };
  const s1 = toward(l1, d1), s2 = toward(l2, d2);
  const v = Math.abs(signedAngle(l1, l2));
  return { I, s1, s2, theta: s1 === s2 ? v : 180 - v, r1: { x: d1.x * s1, y: d1.y * s1 }, r2: { x: d2.x * s2, y: d2.y * s2 } };
}

/** The dimension's current value in the geometry (what is shown, always ≥ 0). */
export function measure(sk: SketchData, c: Constraint): number | null {
  switch (c.type) {
    case 'distance': {
      const a = sk.points[c.p1], b = sk.points[c.p2];
      if (!a || !b) return null;
      return c.dir === 'aligned' ? dist(a, b) : Math.abs(c.dir === 'h' ? b.x - a.x : b.y - a.y);
    }
    case 'pldistance': {
      const l = lineOf(sk, c.e);
      return l && sk.points[c.p] ? pointLineDistance(sk.points[c.p], l) : null;
    }
    case 'pcdistance': {
      const cv = curveOf(sk, c.e);
      return cv && sk.points[c.p] ? pointCurveDistance(sk.points[c.p], cv) : null;
    }
    case 'ccdistance': {
      const a = curveOf(sk, c.e1), b = curveOf(sk, c.e2);
      return a && b ? curveGap(a, b).gap : null;
    }
    case 'cldistance': {
      const cv = curveOf(sk, c.e), l = lineOf(sk, c.l);
      return cv && l ? curveLineGap(cv, l).gap : null;
    }
    case 'radius':
    case 'diameter': {
      const r = radiusOf(sk, c.e);
      return r === null ? null : c.type === 'radius' ? r : 2 * r;
    }
    case 'angle': {
      const l1 = lineOf(sk, c.e1), l2 = lineOf(sk, c.e2);
      return l1 && l2 ? visibleAngle(l1, l2).theta : null;
    }
    case 'xangle': {
      const l = lineOf(sk, c.e);
      return l ? Math.abs(xAngle(l)) : null;
    }
    default:
      return null;
  }
}

export function dimensionText(c: Constraint): string {
  const e = 'expr' in c && c.expr ? `${c.expr} = ` : '';
  return e + dimensionValueText(c);
}

function dimensionValueText(c: Constraint): string {
  switch (c.type) {
    case 'radius':
      return `R${fmtNum(c.value)}`;
    case 'diameter':
      return `Ø${fmtNum(c.value)}`;
    case 'angle':
    case 'xangle':
      return `${fmtNum(Math.abs(c.value), 1)}°`; // drawDimension shows the visible angle
    case 'distance':
    case 'pldistance':
    case 'pcdistance':
    case 'ccdistance':
    case 'cldistance':
      return fmtNum(c.value);
    default:
      return '';
  }
}

const SYMBOL: Partial<Record<Constraint['type'], string>> = {
  horizontal: 'H',
  vertical: 'V',
  hpoints: 'H',
  vpoints: 'V',
  parallel: '∥',
  perpendicular: '⊥',
  equal: '=',
  tangent: 'T',
  concentric: '◎',
  onCurve: '•',
  midpoint: 'M',
  fix: '⚓',
};

export interface DrawStyle {
  dim: string;
  dimText: string;
  selected: string;
  conflict: string;
}

type S = (p: Vec) => Vec;

/** The sketch's center (to place dimensions and symbols outside the shape). */
function centroid(sk: SketchData): Vec {
  const ps = Object.values(sk.points);
  if (!ps.length) return { x: 0, y: 0 };
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Normal to a→b (screen) pointing away from `away`; up if unclear. */
function outward(a: Vec, b: Vec, away: Vec): Vec {
  const d = sub(b, a);
  const L = len(d) || 1;
  let n = { x: -d.y / L, y: d.x / L };
  const side = dot(n, sub(mid(a, b), away));
  if (Math.abs(side) > 1) {
    if (side < 0) n = { x: -n.x, y: -n.y };
  } else if (n.y > 0 || (Math.abs(n.y) < 1e-9 && n.x < 0)) n = { x: -n.x, y: -n.y };
  return n;
}

function badge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, bg: string, font: string): Hotspot {
  ctx.font = font;
  const w = Math.max(18, ctx.measureText(text).width + 10), h = 18;
  const r = { x: x - w / 2, y: y - h / 2, w, h };
  ctx.fillStyle = bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  return { ...r, key: '', dim: false };
}

function arrowLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  for (const [p, d] of [[a, ang], [b, ang + Math.PI]] as const) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 7 * Math.cos(d + 0.35), p.y + 7 * Math.sin(d + 0.35));
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 7 * Math.cos(d - 0.35), p.y + 7 * Math.sin(d - 0.35));
  }
  ctx.stroke();
}

/** Draw a dimension; returns the label's hit area. */
export function drawDimension(ctx: CanvasRenderingContext2D, sk: SketchData, c: Constraint, S: S, color: string, bg: string): Hotspot | null {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const font = '600 12px system-ui, sans-serif';
  let at: Vec | null = null;
  let text = dimensionText(c);
  switch (c.type) {
    case 'distance': {
      const a = S(sk.points[c.p1]), b = S(sk.points[c.p2]);
      if (c.dir === 'aligned') {
        const n = outward(a, b, S(centroid(sk)));
        const o = 16;
        const a2 = { x: a.x + n.x * o, y: a.y + n.y * o }, b2 = { x: b.x + n.x * o, y: b.y + n.y * o };
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a2.x + n.x * 4, a2.y + n.y * 4);
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b2.x + n.x * 4, b2.y + n.y * 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        arrowLine(ctx, a2, b2);
        at = { x: (a2.x + b2.x) / 2 + n.x * 12, y: (a2.y + b2.y) / 2 + n.y * 12 };
      } else if (c.dir === 'h') {
        const y = Math.min(a.y, b.y) - 18;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x, y - 4);
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x, y - 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        arrowLine(ctx, { x: a.x, y }, { x: b.x, y });
        at = { x: (a.x + b.x) / 2, y: y - 12 };
      } else {
        const x = Math.max(a.x, b.x) + 18;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(x + 4, a.y);
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(x + 4, b.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        arrowLine(ctx, { x, y: a.y }, { x, y: b.y });
        at = { x: x + 14, y: (a.y + b.y) / 2 };
      }
      break;
    }
    case 'pldistance': {
      const l = lineOf(sk, c.e);
      if (!l) return null;
      const p = sk.points[c.p];
      const d = sub(l.b, l.a);
      const t = dot(sub(p, l.a), d) / (dot(d, d) || 1);
      const foot = { x: l.a.x + d.x * t, y: l.a.y + d.y * t };
      const a = S(p), b = S(foot);
      arrowLine(ctx, a, b);
      const m = mid(a, b);
      const v = sub(b, a);
      const L = len(v) || 1;
      at = { x: m.x - (v.y / L) * 14, y: m.y + (v.x / L) * 14 };
      break;
    }
    case 'pcdistance': {
      // Along the line from the center through the point, from the point to the edge.
      const cv = curveOf(sk, c.e);
      const p = sk.points[c.p];
      if (!cv || !p) return null;
      const foot = polar(cv.c, cv.r, dist(p, cv.c) < 1e-9 ? 0 : angleOf(cv.c, p));
      const a = S(p), b = S(foot);
      arrowLine(ctx, a, b);
      const m = mid(a, b);
      const v = sub(b, a);
      const L = len(v) || 1;
      at = { x: m.x - (v.y / L) * 14, y: m.y + (v.x / L) * 14 };
      break;
    }
    case 'ccdistance':
    case 'cldistance': {
      let g: { a: Vec; b: Vec };
      if (c.type === 'ccdistance') {
        const c1 = curveOf(sk, c.e1), c2 = curveOf(sk, c.e2);
        if (!c1 || !c2) return null;
        g = curveGap(c1, c2);
      } else {
        const cv = curveOf(sk, c.e), l = lineOf(sk, c.l);
        if (!cv || !l) return null;
        g = curveLineGap(cv, l);
      }
      const a = S(g.a), b = S(g.b);
      arrowLine(ctx, a, b);
      const m = mid(a, b);
      const v = sub(b, a);
      const L = len(v) || 1;
      at = { x: m.x - (v.y / L) * 14, y: m.y + (v.x / L) * 14 };
      break;
    }
    case 'radius':
    case 'diameter': {
      const ent = sk.entities[c.e];
      if (!ent || ent.type === 'line') return null;
      let center: Vec, r: number, ang: number;
      if (ent.type === 'circle') {
        center = sk.points[ent.c];
        r = ent.r;
        ang = Math.PI / 4;
      } else {
        const g = arcGeom(sk, ent);
        center = g.c;
        r = g.r;
        ang = g.a0 + g.sweep / 2;
      }
      const on = S(polar(center, r, ang));
      const cS = S(center);
      const from = c.type === 'diameter' ? S(polar(center, r, ang + Math.PI)) : cS;
      arrowLine(ctx, from, on);
      const dir = sub(on, cS);
      const L = len(dir) || 1;
      at = { x: on.x + (dir.x / L) * 22, y: on.y + (dir.y / L) * 14 };
      break;
    }
    case 'xangle': {
      // From a dashed ray along +X at the line's start to the line.
      const l = lineOf(sk, c.e);
      if (!l) return null;
      const I = S(l.a);
      const a = xAngle(l) * Math.PI / 180;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(I.x, I.y);
      ctx.lineTo(I.x + 44, I.y);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(I.x, I.y, 30, 0, -a, a > 0); // the screen's y points down
      ctx.stroke();
      at = { x: I.x + 48 * Math.cos(-a / 2), y: I.y + 48 * Math.sin(-a / 2) };
      break;
    }
    case 'angle': {
      const l1 = lineOf(sk, c.e1), l2 = lineOf(sk, c.e2);
      if (!l1 || !l2) return null;
      const v = visibleAngle(l1, l2);
      text = `${c.expr ? `${c.expr} = ` : ''}${fmtNum(v.theta, 1)}°`;
      const I = S(v.I);
      // The screen's y points down: the angles are mirrored.
      const a1 = -Math.atan2(v.r1.y, v.r1.x), a2 = -Math.atan2(v.r2.y, v.r2.x);
      let d = a2 - a1;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      ctx.beginPath();
      ctx.arc(I.x, I.y, 30, a1, a1 + d, d < 0);
      ctx.stroke();
      at = { x: I.x + 48 * Math.cos(a1 + d / 2), y: I.y + 48 * Math.sin(a1 + d / 2) };
      break;
    }
    default:
      return null;
  }
  const h = badge(ctx, text, at.x, at.y, color, bg, font);
  return { ...h, key: `c:${c.id}`, dim: true };
}

/** Draw constraint symbols; returns hit areas. */
export function drawGlyphs(
  ctx: CanvasRenderingContext2D, sk: SketchData, S: S, colorFor: (key: string) => string, bg: string,
  visible: (c: Constraint) => boolean = () => true,
): Hotspot[] {
  const spots: Hotspot[] = [];
  const center = S(centroid(sk));
  const stack = new Map<string, number>(); // how many symbols have already been drawn at an anchor
  const font = '700 11px system-ui, sans-serif';
  const place = (anchorKey: string, base: Vec, along: Vec) => {
    const n = stack.get(anchorKey) ?? 0;
    stack.set(anchorKey, n + 1);
    return { x: base.x + along.x * 20 * n, y: base.y + along.y * 20 * n };
  };
  /** Anchor at an entity: a little to the side of the middle. */
  const entityAnchor = (e: string): { base: Vec; along: Vec } | null => {
    const ent = sk.entities[e];
    if (!ent) return null;
    if (ent.type === 'line') {
      const a = S(sk.points[ent.p1]), b = S(sk.points[ent.p2]);
      const d = sub(b, a);
      const L = len(d) || 1;
      const n = outward(a, b, center);
      // Outwards (like the dimensions) but at a quarter of the line, so they do not land on the
      // dimension in the middle.
      const q = { x: a.x + d.x * 0.25, y: a.y + d.y * 0.25 };
      return { base: { x: q.x + n.x * 18, y: q.y + n.y * 18 }, along: { x: d.x / L, y: d.y / L } };
    }
    let c: Vec, r: number, ang: number;
    if (ent.type === 'circle') {
      c = sk.points[ent.c];
      r = ent.r;
      ang = -Math.PI / 4;
    } else {
      const g = arcGeom(sk, ent);
      c = g.c;
      r = g.r;
      ang = g.a0 + g.sweep * 0.3;
    }
    const cs = S(c), on = S(polar(c, r, ang));
    const v = sub(on, cs);
    const L = len(v) || 1;
    return { base: { x: on.x + (v.x / L) * 22, y: on.y + (v.y / L) * 22 }, along: { x: 0, y: 1 } };
  };
  const pointAnchor = (p: string) => {
    const s = S(sk.points[p]);
    return { base: { x: s.x + 18, y: s.y - 18 }, along: { x: 1, y: 0 } };
  };
  for (const c of sk.constraints) {
    if (isDimension(c) || !visible(c)) continue;
    const sym = SYMBOL[c.type];
    if (!sym) continue;
    const key = `c:${c.id}`;
    const at: Vec[] = [];
    switch (c.type) {
      case 'horizontal':
      case 'vertical': {
        const a = entityAnchor(c.e);
        if (a) at.push(place(`e:${c.e}`, a.base, a.along));
        break;
      }
      case 'parallel':
      case 'perpendicular':
      case 'equal':
      case 'tangent':
      case 'concentric':
        for (const e of [c.e1, c.e2]) {
          const a = entityAnchor(e);
          if (a) at.push(place(`e:${e}`, a.base, a.along));
        }
        break;
      case 'hpoints':
      case 'vpoints': {
        const a = S(sk.points[c.p1]), b = S(sk.points[c.p2]);
        at.push(place(`pp:${c.p1}:${c.p2}`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 }, { x: 1, y: 0 }));
        break;
      }
      case 'onCurve':
      case 'midpoint':
      case 'fix': {
        if (!sk.points[c.p]) break;
        const a = pointAnchor(c.p);
        at.push(place(`p:${c.p}`, a.base, a.along));
        break;
      }
    }
    for (const p of at) spots.push({ ...badge(ctx, sym, p.x, p.y, colorFor(key), bg, font), key, dim: false });
  }
  return spots;
}

export { angleOf };
