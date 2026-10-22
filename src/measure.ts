// Mätverktyget i 3D: vad ett tryck på modellen träffade (hörn, kant, yta) → en referens
// (punkt, rak kant, cirkel/båge, yta) → mått mellan en eller två referenser.
// Ren geometri på nätets kanter (viewerns EdgesGeometry), utan three.js.

import { fmtNum } from './sketch/geom';
import { t } from './i18n';
import type { V3 } from './frame';

export type { V3 };

/** Vad ett tryck träffade (från Viewer.pickMeasure). */
export interface Pick {
  kind: 'vertex' | 'edge' | 'face';
  point: V3;
  normal?: V3; // yta
  seg?: number; // kantsegment (edge)
}

export type Ref =
  | { kind: 'vertex'; p: V3 }
  | { kind: 'line'; p: V3; a: V3; b: V3; dir: V3; length: number; poly: V3[] }
  | { kind: 'circle'; p: V3; c: V3; r: number; n: V3; closed: boolean; poly: V3[] }
  | { kind: 'face'; p: V3; n: V3 };

export interface Result {
  main: string;
  detail?: string;
  /** Hjälplinje att rita (t.ex. det vinkelräta avståndet). */
  guide?: [V3, V3];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const deg = (r: number) => (r * 180) / Math.PI;
const PAR = Math.sin((0.5 * Math.PI) / 180); // parallellt inom 0,5°

const seg = (e: Float32Array, i: number): [V3, V3] => [
  [e[i * 6], e[i * 6 + 1], e[i * 6 + 2]],
  [e[i * 6 + 3], e[i * 6 + 4], e[i * 6 + 5]],
];

/** Index: avrundad punkt → segment som slutar där (och punkten). */
function vertexIndex(e: Float32Array) {
  const key = (p: V3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const map = new Map<string, number[]>();
  const pts = new Map<string, V3>();
  for (let i = 0; i < e.length / 6; i++)
    for (const p of seg(e, i)) {
      const k = key(p);
      const l = map.get(k);
      if (l) l.push(i);
      else {
        map.set(k, [i]);
        pts.set(k, p);
      }
    }
  return { key, map, pts };
}

const MAX_TURN = Math.cos((40 * Math.PI) / 180);
const STRAIGHT = Math.cos((0.5 * Math.PI) / 180);

/**
 * Väx en kedja av kantsegment från segmentet `start` åt båda håll så länge `accept` godtar
 * nästa punkt (fortsättningen med minst sväng väljs). Sluten om den kommer runt till början.
 */
function grow(e: Float32Array, start: number, accept: (chain: V3[], next: V3) => boolean): { poly: V3[]; closed: boolean } {
  const { key, map } = vertexIndex(e);
  const used = new Set([start]);
  let chain: V3[] = seg(e, start);
  const extend = () => {
    for (let n = 0; n < 4000; n++) {
      const cur = chain[chain.length - 1];
      const dir = norm(sub(cur, chain[chain.length - 2]));
      let best = -1, bestCos = -2, bestNext: V3 | null = null;
      for (const s of map.get(key(cur)) ?? []) {
        if (used.has(s)) continue;
        const [p, q] = seg(e, s);
        const next = key(p) === key(cur) ? q : p;
        const c = dot(dir, norm(sub(next, cur)));
        if (c > bestCos && accept(chain, next)) {
          bestCos = c;
          best = s;
          bestNext = next;
        }
      }
      if (best < 0 || !bestNext) return false;
      used.add(best);
      if (key(bestNext) === key(chain[0])) return true;
      chain.push(bestNext);
    }
    return false;
  };
  if (extend()) return { poly: chain, closed: true };
  chain = chain.reverse();
  extend();
  return { poly: chain.reverse(), closed: false };
}

/**
 * Hörn att fästa mot: kantpunkter där en eller fler än två kanter möts, eller där kanten
 * svänger mer än 40° – inte punkterna längs en tessellerad cirkel (3 tal per punkt).
 */
export function cornerVertices(e: Float32Array): Float32Array {
  const { key, map, pts } = vertexIndex(e);
  const out: number[] = [];
  for (const [k, segs] of map) {
    const p = pts.get(k)!;
    if (segs.length === 2) {
      const far = (i: number) => seg(e, i).find(q => key(q) !== k) ?? p;
      if (dot(norm(sub(p, far(segs[0]))), norm(sub(far(segs[1]), p))) > MAX_TURN) continue;
    }
    out.push(...p);
  }
  return new Float32Array(out);
}

/** Cirkel genom tre punkter i rummet (centrum, radie, normal), eller null om de ligger på linje. */
function circle3(a: V3, b: V3, c: V3): { c: V3; r: number; n: V3 } | null {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-12 * dot(ab, ab) * dot(ac, ac)) return null;
  const center = add(a, mul(add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab))), 1 / (2 * n2)));
  return { c: center, r: len(sub(a, center)), n: norm(n) };
}

const fitChain = (poly: V3[]) => {
  const m = poly.length;
  return circle3(poly[0], poly[Math.floor(m / 3)], poly[Math.floor((2 * m) / 3)]);
};
const onCircle = (f: { c: V3; r: number; n: V3 }, p: V3) => {
  const tol = Math.max(1e-3, 0.01 * f.r);
  return Math.abs(len(sub(p, f.c)) - f.r) < tol && Math.abs(dot(sub(p, f.c), f.n)) < tol;
};

/** Cirkel/båge: varje steg svänger lite (inte rakt), lika långa steg, och punkten ligger på cirkeln genom kedjan. */
function arcAccept(chain: V3[], next: V3) {
  const n = chain.length;
  const prev = sub(chain[n - 1], chain[n - 2]), step = sub(next, chain[n - 1]);
  const c = dot(norm(prev), norm(step));
  if (c < MAX_TURN || c > STRAIGHT) return false;
  // Tessellerade bågar har jämna segment; en lång rak kant som går in i en båge är inte en del av den.
  const ratio = len(step) / len(prev);
  if (ratio > 3 || ratio < 1 / 3) return false;
  if (n < 3) return true;
  const f = fitChain(chain);
  return !!f && onCircle(f, next);
}

/** Rak kant (delad i flera segment): fortsätter i samma riktning. */
const straightAccept = (chain: V3[], next: V3) => dot(norm(sub(chain[chain.length - 1], chain[0])), norm(sub(next, chain[chain.length - 1]))) > STRAIGHT;

/** Referensen för ett tryck: hörn, cirkel/båge, rak kant (hela längden) eller yta. */
export function refOf(pick: Pick, edges: Float32Array | null): Ref {
  if (pick.kind === 'vertex') return { kind: 'vertex', p: pick.point };
  if (pick.kind === 'face' || pick.seg === undefined || !edges) return { kind: 'face', p: pick.point, n: norm(pick.normal ?? [0, 0, 1]) };
  const arc = grow(edges, pick.seg, arcAccept);
  if (arc.poly.length >= 4) {
    const f = fitChain(arc.poly);
    if (f && arc.poly.every(p => onCircle(f, p))) return { kind: 'circle', p: f.c, c: f.c, r: f.r, n: f.n, closed: arc.closed, poly: arc.closed ? [...arc.poly, arc.poly[0]] : arc.poly };
  }
  const { poly } = grow(edges, pick.seg, straightAccept);
  const a = poly[0], b = poly[poly.length - 1];
  return { kind: 'line', p: pick.point, a, b, dir: norm(sub(b, a)), length: len(sub(b, a)), poly };
}

const mm = (v: number) => `${fmtNum(v)} mm`;
const xyz = (p: V3) => `X ${fmtNum(p[0])} · Y ${fmtNum(p[1])} · Z ${fmtNum(p[2])}`;
const AXES: [V3, string][] = [[[1, 0, 0], 'X'], [[0, 1, 0], 'Y'], [[0, 0, 1], 'Z']];
function axisName(n: V3) {
  for (const [a, name] of AXES) {
    const c = dot(n, a);
    if (Math.abs(c) > 1 - 1e-6) return (c > 0 ? '+' : '−') + name;
  }
  return n.map(v => fmtNum(v, 3)).join(', ');
}

/** Text för en ensam referens. */
export function describe(r: Ref): Result {
  switch (r.kind) {
    case 'vertex':
      return { main: t('measure.point'), detail: xyz(r.p) };
    case 'line':
      return { main: t('measure.edge', { v: mm(r.length) }), detail: `${t('measure.direction')} ${axisName(r.dir)}` };
    case 'circle':
      return {
        main: r.closed ? `Ø ${mm(2 * r.r)} · R ${fmtNum(r.r)}` : t('measure.arc', { r: mm(r.r) }),
        detail: `${t('measure.center')} ${xyz(r.c)}`,
      };
    case 'face':
      return { main: t('measure.face'), detail: `${t('measure.normal')} ${axisName(r.n)}` };
  }
}

const pointLike = (r: Ref) => r.kind === 'vertex' || r.kind === 'circle';

/** Avstånd/vinkel mellan två referenser. */
export function measureBetween(a: Ref, b: Ref): Result {
  if (b.kind === 'face' && a.kind !== 'face') [a, b] = [b, a];
  if (b.kind === 'line' && pointLike(a)) [a, b] = [b, a];
  const straight = (p: V3, q: V3): Result => {
    const d = sub(q, p);
    return { main: t('measure.distance', { v: mm(len(d)) }), detail: `ΔX ${fmtNum(Math.abs(d[0]))} · ΔY ${fmtNum(Math.abs(d[1]))} · ΔZ ${fmtNum(Math.abs(d[2]))}`, guide: [p, q] };
  };
  const angle = (rad: number, kind: 'measure.angleFaces' | 'measure.angle'): Result => ({ main: t(kind, { v: `${fmtNum(deg(rad), 1)}°` }) });

  if (a.kind === 'face') {
    const n = a.n;
    if (b.kind === 'face') {
      const c = dot(n, b.n);
      if (len(cross(n, b.n)) < PAR) {
        const d = dot(sub(b.p, a.p), n);
        return { main: t('measure.distance', { v: mm(Math.abs(d)) }), detail: t('measure.parallelFaces'), guide: [b.p, sub(b.p, mul(n, d))] };
      }
      return angle(Math.acos(Math.max(-1, Math.min(1, c))), 'measure.angleFaces');
    }
    if (b.kind === 'line' && Math.abs(dot(b.dir, n)) > PAR) return angle(Math.asin(Math.min(1, Math.abs(dot(b.dir, n)))), 'measure.angle');
    // Punkt (eller kant parallell med ytan) → vinkelrätt avstånd till ytans plan.
    const d = dot(sub(b.p, a.p), n);
    return { main: t('measure.distance', { v: mm(Math.abs(d)) }), detail: t('measure.perpendicular'), guide: [b.p, sub(b.p, mul(n, d))] };
  }
  if (a.kind === 'line') {
    if (b.kind === 'line') {
      const s = len(cross(a.dir, b.dir));
      if (s < PAR) {
        const off = sub(b.a, a.a);
        const perp = sub(off, mul(a.dir, dot(off, a.dir)));
        const foot = sub(b.p, perp);
        return { main: t('measure.distance', { v: mm(len(perp)) }), detail: t('measure.parallelEdges'), guide: [b.p, foot] };
      }
      return angle(Math.asin(Math.min(1, s)), 'measure.angle');
    }
    // Punkt → vinkelrätt avstånd till kantens linje.
    const off = sub(b.p, a.a);
    const foot = add(a.a, mul(a.dir, dot(off, a.dir)));
    return { main: t('measure.distance', { v: mm(len(sub(b.p, foot))) }), detail: t('measure.toEdge'), guide: [b.p, foot] };
  }
  return straight(a.p, b.p);
}
