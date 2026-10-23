// SVG → sketch geometry. A small XML reader of our own (the same in the browser and the Node
// tests), transforms, path data and the basic shapes. The result is shapes in mm with y up: lines
// and circular arcs exactly (when the transform preserves circles), Bézier curves as curves that
// are flattened only once the size is decided (the tolerance applies to the finished sketch).

import type { Vec } from './sketch/geom';
import { newId, type SketchData } from './sketch/model';

export type Seg =
  | { t: 'L'; a: Vec; b: Vec }
  | { t: 'C'; a: Vec; c1: Vec; c2: Vec; b: Vec }
  /** Circular arc from a to b around c; sweep in radians, positive = counterclockwise (y up). */
  | { t: 'A'; a: Vec; b: Vec; c: Vec; r: number; sweep: number };

export type Shape = { kind: 'path'; segs: Seg[]; closed: boolean } | { kind: 'circle'; c: Vec; r: number };

export interface SvgDrawing {
  shapes: Shape[];
  /** Bounding rectangle (mm). */
  min: Vec;
  max: Vec;
  /** Elements that cannot become geometry (text, images …), count per tag. */
  ignored: Record<string, number>;
}

// ---- Matrices: [a, b, c, d, e, f] → x' = a·x + c·y + e, y' = b·x + d·y + f ---------------------------

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, p: Vec): Vec => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const det = (m: M) => m[0] * m[3] - m[1] * m[2];
/** Uniform (rotation/mirror + equal scale in all directions)? Then circles stay circles. */
function similarity(m: M): number | null {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const dot = m[0] * m[2] + m[1] * m[3];
  return Math.abs(sx - sy) < 1e-9 * Math.max(sx, sy) && Math.abs(dot) < 1e-9 * sx * sy ? sx : null;
}

function parseTransform(s: string | undefined): M {
  let m = ID;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = numbers(args);
    let n: M = ID;
    switch (fn) {
      case 'matrix':
        if (a.length === 6) n = a as M;
        break;
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r);
        const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
        n = mul(mul([1, 0, 0, 1, cx, cy], [c, si, -si, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const numbers = (s: string | undefined) => (s?.match(NUM) ?? []).map(Number);

/** Length with a unit → mm (px = 1/96 inch, as in CSS). */
function lengthMm(s: string | undefined): number | null {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|q)?\s*$/i.exec(s ?? '');
  if (!m) return null;
  const k: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25 };
  return Number(m[1]) * k[(m[2] ?? 'px').toLowerCase()];
}

// ---- XML ------------------------------------------------------------------------------------------------

interface Tag {
  name: string;
  attrs: Record<string, string>;
  close: boolean; // </tag>
  selfClose: boolean;
}

function* tags(xml: string): Generator<Tag> {
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) return;
    if (xml.startsWith('<!--', lt)) {
      i = xml.indexOf('-->', lt) + 3 || xml.length;
      if (i < 3) return;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt);
      if (e < 0) return;
      i = e + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const e = xml.indexOf('>', lt);
      if (e < 0) return;
      i = e + 1;
      continue;
    }
    // Find the end of the tag without being fooled by '>' inside attribute values.
    let j = lt + 1, q = '';
    for (; j < xml.length; j++) {
      const ch = xml[j];
      if (q) {
        if (ch === q) q = '';
      } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
    }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    const close = body.startsWith('/');
    const selfClose = body.endsWith('/');
    const name = /^\/?\s*([\w:.-]+)/.exec(body)?.[1]?.replace(/^svg:/, '') ?? '';
    const attrs: Record<string, string> = {};
    for (const [, k, , v1, v2] of body.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[k] = v1 ?? v2 ?? '';
    yield { name, attrs, close, selfClose };
  }
}

/** Value from an attribute or style="…" (style takes precedence). */
function prop(attrs: Record<string, string>, key: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`).exec(attrs.style ?? '');
  return m ? m[1].trim() : attrs[key];
}

// ---- Path-data --------------------------------------------------------------------------------------

/** Parse path data into subpaths in the element's coordinates (arcs as endpoint arcs). */
type RawSeg =
  | { t: 'L'; a: Vec; b: Vec }
  | { t: 'C'; a: Vec; c1: Vec; c2: Vec; b: Vec }
  | { t: 'E'; a: Vec; b: Vec; rx: number; ry: number; phi: number; large: boolean; sweep: boolean };
interface RawPath {
  segs: RawSeg[];
  closed: boolean;
}

function parsePathData(d: string): RawPath[] {
  const out: RawPath[] = [];
  let i = 0;
  const ws = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const num = (): number | null => {
    ws();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m || m.index !== i) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): boolean | null => {
    ws();
    if (d[i] === '0' || d[i] === '1') return d[i++] === '1';
    return null;
  };
  let cur: Vec = { x: 0, y: 0 }, start: Vec = { x: 0, y: 0 };
  const st: { path: RawPath | null } = { path: null };
  let lastC: Vec | null = null, lastQ: Vec | null = null;
  let cmd = '';
  const begin = (p: Vec) => {
    if (st.path?.segs.length) out.push(st.path);
    st.path = { segs: [], closed: false };
    cur = start = p;
  };
  const push = (s: RawSeg) => {
    if (!st.path) begin(cur);
    st.path!.segs.push(s);
    cur = s.b;
  };
  for (;;) {
    ws();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const P = (x: number, y: number): Vec => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    const C = cmd.toUpperCase();
    let prevC: Vec | null = null, prevQ: Vec | null = null;
    if (C === 'Z') {
      if (st.path) {
        if (Math.hypot(cur.x - start.x, cur.y - start.y) > 1e-12) push({ t: 'L', a: cur, b: start });
        st.path!.closed = true;
        out.push(st.path!);
        st.path = null;
      }
      cur = start;
      cmd = '';
      lastC = lastQ = null;
      continue;
    }
    const n = () => {
      const v = num();
      if (v === null) throw new Error('bad');
      return v;
    };
    try {
      if (C === 'M') {
        const p = P(n(), n());
        begin(p);
        cmd = rel ? 'l' : 'L'; // the following pairs are lines
      } else if (C === 'L') push({ t: 'L', a: cur, b: P(n(), n()) });
      else if (C === 'H') {
        const x = n();
        push({ t: 'L', a: cur, b: { x: rel ? cur.x + x : x, y: cur.y } });
      } else if (C === 'V') {
        const y = n();
        push({ t: 'L', a: cur, b: { x: cur.x, y: rel ? cur.y + y : y } });
      } else if (C === 'C') {
        const c1 = P(n(), n()), c2 = P(n(), n()), b = P(n(), n());
        push({ t: 'C', a: cur, c1, c2, b });
        prevC = c2;
      } else if (C === 'S') {
        const c1 = lastC ? { x: 2 * cur.x - lastC.x, y: 2 * cur.y - lastC.y } : cur;
        const c2 = P(n(), n()), b = P(n(), n());
        push({ t: 'C', a: cur, c1, c2, b });
        prevC = c2;
      } else if (C === 'Q' || C === 'T') {
        const q: Vec = C === 'Q' ? P(n(), n()) : lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : cur;
        const b = P(n(), n()), a = cur;
        push({ t: 'C', a, c1: { x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) }, c2: { x: b.x + (2 / 3) * (q.x - b.x), y: b.y + (2 / 3) * (q.y - b.y) }, b });
        prevQ = q;
      } else if (C === 'A') {
        const rx = Math.abs(n()), ry = Math.abs(n()), phi = n();
        const large = flag(), sweep = flag();
        if (large === null || sweep === null) throw new Error('bad');
        const b = P(n(), n());
        if (Math.hypot(b.x - cur.x, b.y - cur.y) < 1e-12) {
          /* zero arc: skip */
        } else if (rx < 1e-12 || ry < 1e-12) push({ t: 'L', a: cur, b });
        else push({ t: 'E', a: cur, b, rx, ry, phi: (phi * Math.PI) / 180, large, sweep });
      } else break; // unknown command
    } catch {
      break; // broken data: keep what has been read
    }
    lastC = prevC;
    lastQ = prevQ;
  }
  if (st.path?.segs.length) out.push(st.path);
  return out;
}

/** Endpoint arc → center, radii and angles (the SVG spec's appendix F.6.5). */
function arcCenter(s: Extract<RawSeg, { t: 'E' }>) {
  let { rx, ry } = s;
  const cos = Math.cos(s.phi), sin = Math.sin(s.phi);
  const dx = (s.a.x - s.b.x) / 2, dy = (s.a.y - s.b.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const k = (s.large === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const c = { x: cos * cx1 - sin * cy1 + (s.a.x + s.b.x) / 2, y: sin * cx1 + cos * cy1 + (s.a.y + s.b.y) / 2 };
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  if (s.sweep && dt < 0) dt += 2 * Math.PI;
  return { c, rx, ry, cos, sin, t1, dt };
}

/** Elliptical arc as cubic Béziers (at most 90° per piece), in the element's coordinates. */
function ellipseToCubics(s: Extract<RawSeg, { t: 'E' }>): RawSeg[] {
  const { c, rx, ry, cos, sin, t1, dt } = arcCenter(s);
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number): Vec => ({ x: c.x + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: c.y + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const der = (t: number): Vec => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: RawSeg[] = [];
  for (let i = 0; i < n; i++) {
    const ta = t1 + i * step, tb = ta + step;
    const a = i === 0 ? s.a : pt(ta), b = i === n - 1 ? s.b : pt(tb);
    const da = der(ta), db = der(tb);
    out.push({ t: 'C', a, c1: { x: a.x + k * da.x, y: a.y + k * da.y }, c2: { x: b.x - k * db.x, y: b.y - k * db.y }, b });
  }
  return out;
}

/** The element's subpaths → shapes in the drawing's coordinates (the matrix m). */
function placePaths(paths: RawPath[], m: MatrixLike): Shape[] {
  const s = similarity(m);
  const flip = det(m) < 0 ? -1 : 1;
  return paths.map(p => {
    const segs: Seg[] = [];
    for (const r of p.segs) {
      if (r.t === 'L') segs.push({ t: 'L', a: apply(m, r.a), b: apply(m, r.b) });
      else if (r.t === 'C') segs.push({ t: 'C', a: apply(m, r.a), c1: apply(m, r.c1), c2: apply(m, r.c2), b: apply(m, r.b) });
      else if (s !== null && Math.abs(r.rx - r.ry) < 1e-9 * Math.max(r.rx, r.ry)) {
        const g = arcCenter(r);
        segs.push({ t: 'A', a: apply(m, r.a), b: apply(m, r.b), c: apply(m, g.c), r: g.rx * s, sweep: g.dt * flip });
      } else for (const c of ellipseToCubics(r)) if (c.t === 'C') segs.push({ t: 'C', a: apply(m, c.a), c1: apply(m, c.c1), c2: apply(m, c.c2), b: apply(m, c.b) });
    }
    return { kind: 'path' as const, segs, closed: p.closed };
  });
}
type MatrixLike = M;

// ---- Element ------------------------------------------------------------------------------------------

const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'metadata', 'title', 'desc', 'style', 'script', 'linearGradient', 'radialGradient', 'filter', 'foreignObject', 'sodipodi:namedview', 'namedview']);
const IGNORED = new Set(['text', 'image', 'use', 'foreignObject']);

const f = (a: Record<string, string>, k: string, d = 0) => {
  const v = parseFloat(a[k] ?? '');
  return Number.isFinite(v) ? v : d;
};

function elementPaths(name: string, a: Record<string, string>): RawPath[] | 'circle' | null {
  switch (name) {
    case 'path':
      return parsePathData(a.d ?? '');
    case 'line':
      return [{ segs: [{ t: 'L', a: { x: f(a, 'x1'), y: f(a, 'y1') }, b: { x: f(a, 'x2'), y: f(a, 'y2') } }], closed: false }];
    case 'polyline':
    case 'polygon': {
      const n = numbers(a.points);
      const pts: Vec[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
      if (pts.length < 2) return null;
      const segs: RawSeg[] = pts.slice(1).map((b, i) => ({ t: 'L' as const, a: pts[i], b }));
      if (name === 'polygon') segs.push({ t: 'L', a: pts[pts.length - 1], b: pts[0] });
      return [{ segs, closed: name === 'polygon' }];
    }
    case 'rect': {
      const x = f(a, 'x'), y = f(a, 'y'), w = f(a, 'width'), h = f(a, 'height');
      if (!(w > 0 && h > 0)) return null;
      let rx = a.rx !== undefined ? f(a, 'rx') : f(a, 'ry'), ry = a.ry !== undefined ? f(a, 'ry') : rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (!rx || !ry) return parsePathData(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
      return parsePathData(
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
          `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
      );
    }
    case 'circle':
      return f(a, 'r') > 0 ? 'circle' : null;
    case 'ellipse': {
      const cx = f(a, 'cx'), cy = f(a, 'cy'), rx = f(a, 'rx'), ry = f(a, 'ry');
      if (!(rx > 0 && ry > 0)) return null;
      if (Math.abs(rx - ry) < 1e-12) return 'circle';
      return parsePathData(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`);
    }
    default:
      return null;
  }
}

/** Read an SVG file. Throws Error if it is not an SVG. */
export function parseSvg(xml: string): SvgDrawing {
  const shapes: Shape[] = [];
  const ignored: Record<string, number> = {};
  const stack: { name: string; m: M; skip: boolean }[] = [];
  let root = false;
  for (const tag of tags(xml)) {
    if (tag.close) {
      // Close up to and including the nearest tag with the same name (tolerates sloppy XML).
      const i = stack.map(s => s.name).lastIndexOf(tag.name);
      if (i >= 0) stack.length = i;
      continue;
    }
    const parent = stack[stack.length - 1];
    const a = tag.attrs;
    let m = parent?.m ?? ID;
    let skip = !!parent?.skip || SKIP.has(tag.name) || prop(a, 'display') === 'none' || prop(a, 'visibility') === 'hidden';
    if (tag.name === 'svg' && !root) {
      root = true;
      // The root element: viewBox and width/height → mm, y up.
      const vb = numbers(a.viewBox);
      const W = lengthMm(a.width), H = lengthMm(a.height);
      const px = 25.4 / 96;
      let sx = px, sy = px, tx = 0, ty = 0;
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        sx = W !== null ? W / vb[2] : H !== null ? H / vb[3] : px;
        sy = H !== null ? H / vb[3] : sx;
        if (W !== null && H === null) sy = sx;
        // preserveAspectRatio is ignored: the same scale both ways (the smaller, like "meet").
        const s = Math.min(sx, sy);
        sx = sy = s;
        tx = -vb[0];
        ty = -vb[1];
      }
      m = mul([sx, 0, 0, -sy, 0, 0], [1, 0, 0, 1, tx, ty]);
    } else if (!root) {
      continue; // something before <svg>
    }
    m = mul(m, parseTransform(a.transform));
    if (!skip && IGNORED.has(tag.name)) {
      ignored[tag.name] = (ignored[tag.name] ?? 0) + 1;
      skip = true;
    }
    if (!skip) {
      const p = elementPaths(tag.name, a);
      if (p === 'circle') {
        const s = similarity(m);
        const cx = f(a, 'cx'), cy = f(a, 'cy'), r = tag.name === 'circle' ? f(a, 'r') : f(a, 'rx');
        if (s !== null) shapes.push({ kind: 'circle', c: apply(m, { x: cx, y: cy }), r: r * s });
        else shapes.push(...placePaths(parsePathData(`M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`), m));
      } else if (p) shapes.push(...placePaths(p, m));
    }
    if (!tag.selfClose) stack.push({ name: tag.name, m, skip });
  }
  if (!root) throw new Error('not svg');
  const nonEmpty = shapes.filter(s => s.kind === 'circle' || s.segs.length);
  const { min, max } = bounds(nonEmpty);
  return { shapes: nonEmpty, min, max, ignored };
}

// ---- Extent, placement and flattening ---------------------------------------------------------------------

function cubicAt(s: Extract<Seg, { t: 'C' }>, t: number): Vec {
  const u = 1 - t;
  return {
    x: u * u * u * s.a.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.b.x,
    y: u * u * u * s.a.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.b.y,
  };
}
const arcAt = (s: Extract<Seg, { t: 'A' }>, t: number): Vec => {
  const a0 = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x) + s.sweep * t;
  return { x: s.c.x + s.r * Math.cos(a0), y: s.c.y + s.r * Math.sin(a0) };
};

function bounds(shapes: Shape[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Vec) => {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  };
  for (const s of shapes) {
    if (s.kind === 'circle') {
      add({ x: s.c.x - s.r, y: s.c.y - s.r });
      add({ x: s.c.x + s.r, y: s.c.y + s.r });
      continue;
    }
    for (const g of s.segs) {
      add(g.a);
      add(g.b);
      if (g.t === 'C') for (let i = 1; i < 16; i++) add(cubicAt(g, i / 16));
      if (g.t === 'A') for (let i = 1; i < 32; i++) add(arcAt(g, i / 32));
    }
  }
  if (!Number.isFinite(x0)) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return { min: { x: x0, y: y0 }, max: { x: x1, y: y1 } };
}

/** Scale uniformly around ref and move ref to the origin (ref = the lower left corner or the middle). */
export function placeDrawing(d: SvgDrawing, scale: number, origin: 'corner' | 'center'): Shape[] {
  const ref = origin === 'corner' ? d.min : { x: (d.min.x + d.max.x) / 2, y: (d.min.y + d.max.y) / 2 };
  const P = (p: Vec): Vec => ({ x: (p.x - ref.x) * scale, y: (p.y - ref.y) * scale });
  return d.shapes.map(s =>
    s.kind === 'circle'
      ? { kind: 'circle', c: P(s.c), r: s.r * scale }
      : {
          kind: 'path',
          closed: s.closed,
          segs: s.segs.map(g =>
            g.t === 'L' ? { t: 'L', a: P(g.a), b: P(g.b) }
            : g.t === 'C' ? { t: 'C', a: P(g.a), c1: P(g.c1), c2: P(g.c2), b: P(g.b) }
            : { t: 'A', a: P(g.a), b: P(g.b), c: P(g.c), r: g.r * scale, sweep: g.sweep },
          ),
        },
  );
}

/** Cubic Bézier → points (without the start point) so the deviation stays below tol. */
function flattenCubic(g: Extract<Seg, { t: 'C' }>, tol: number, out: Vec[], depth = 0) {
  const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y;
  const L = Math.hypot(dx, dy);
  const d = (p: Vec) => (L > 1e-12 ? Math.abs((p.x - g.a.x) * dy - (p.y - g.a.y) * dx) / L : Math.hypot(p.x - g.a.x, p.y - g.a.y));
  if (depth >= 12 || Math.max(d(g.c1), d(g.c2)) * 0.75 <= tol) return void out.push(g.b);
  const m = (p: Vec, q: Vec): Vec => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const ab = m(g.a, g.c1), bc = m(g.c1, g.c2), cd = m(g.c2, g.b), abc = m(ab, bc), bcd = m(bc, cd), mid = m(abc, bcd);
  flattenCubic({ t: 'C', a: g.a, c1: ab, c2: abc, b: mid }, tol, out, depth + 1);
  flattenCubic({ t: 'C', a: mid, c1: bcd, c2: cd, b: g.b }, tol, out, depth + 1);
}

export interface SketchStats {
  points: number;
  lines: number;
  arcs: number;
  circles: number;
}

/**
 * Put the shapes in the sketch: lines, arcs and circles; Béziers are flattened to lines (tol mm).
 * End points that coincide become the same point. lock = all points are fixed (large drawings).
 */
export function addShapesToSketch(sk: SketchData, shapes: Shape[], opts: { tol?: number; lock?: boolean } = {}): SketchStats {
  const tol = opts.tol ?? 0.02;
  const stats: SketchStats = { points: 0, lines: 0, arcs: 0, circles: 0 };
  const ids = new Map<string, string>();
  const fresh: string[] = [];
  const key = (p: Vec) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
  const point = (p: Vec, shared = true) => {
    const k = key(p);
    if (shared && ids.has(k)) return ids.get(k)!;
    const id = newId(sk, 'p');
    sk.points[id] = { x: p.x, y: p.y };
    fresh.push(id);
    if (shared) ids.set(k, id);
    return id;
  };
  const line = (a: Vec, b: Vec) => {
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) return;
    const p1 = point(a), p2 = point(b);
    if (p1 === p2) return;
    sk.entities[newId(sk, 'e')] = { type: 'line', p1, p2 };
    stats.lines++;
  };
  for (const s of shapes) {
    if (s.kind === 'circle') {
      if (s.r < 1e-6) continue;
      sk.entities[newId(sk, 'e')] = { type: 'circle', c: point(s.c, false), r: s.r };
      stats.circles++;
      continue;
    }
    for (const g of s.segs) {
      if (g.t === 'L') line(g.a, g.b);
      else if (g.t === 'C') {
        const pts: Vec[] = [];
        flattenCubic(g, tol, pts);
        let prev = g.a;
        for (const p of pts) {
          line(prev, p);
          prev = p;
        }
      } else if (g.r < 1e-6) line(g.a, g.b);
      else if (Math.abs(g.sweep) >= 2 * Math.PI - 1e-9) {
        sk.entities[newId(sk, 'e')] = { type: 'circle', c: point(g.c, false), r: g.r };
        stats.circles++;
      } else {
        // The sketch's arcs go counterclockwise from p1 to p2.
        const [from, to] = g.sweep > 0 ? [g.a, g.b] : [g.b, g.a];
        const p1 = point(from), p2 = point(to);
        if (p1 === p2) continue;
        // Center on the perpendicular bisector, so both ends lie exactly on the radius (the file's
        // rounded coordinates do not fit otherwise, and with locked points it cannot be solved).
        const A = sk.points[p1], B = sk.points[p2];
        const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, n = { x: -(B.y - A.y), y: B.x - A.x };
        const k = ((g.c.x - m.x) * n.x + (g.c.y - m.y) * n.y) / (n.x * n.x + n.y * n.y);
        sk.entities[newId(sk, 'e')] = { type: 'arc', c: point({ x: m.x + k * n.x, y: m.y + k * n.y }, false), p1, p2 };
        stats.arcs++;
      }
    }
  }
  stats.points = fresh.length;
  if (opts.lock) for (const p of fresh) sk.constraints.push({ id: newId(sk, 'c'), type: 'fix', p, quiet: true });
  return stats;
}
