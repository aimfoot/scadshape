// Container → ordinary features. The container panel is a quick way to set up a box, but what goes
// into the tree is the box's parts: extrudes (body, cavity, lid, lip, snap bead and groove), threads
// and a repeated grip. Text, holes and edges then find the box's faces like on any other body, and
// each part can be changed on its own. The sizes that several parts share become variables.

import { activeCount, insertFeature, newFeature, newSketch, type Doc, type Feature, type SketchFeature } from './doc';
import { isIdentifier, isParametric } from './expr';
import { add, scale, sketchFrame } from './frame';
import type { ContainerFeature } from './features/container';
import type { ExtrudeFeature } from './features/extrude';
import { threadDepth } from './features/threads';
import type { ThreadFeature } from './features/thread';
import { num, type Vec } from './features/common';
import { t, type Key } from './i18n';
import { buildModel, sketchRegions } from './model3d';
import { evalParams, type Param } from './params';
import { newId, type SketchData } from './sketch/model';
import { selectRegions } from './sketch/regions';

/** Must match container.ts: the snap's print layer and the groove's margin, the thread's neck wall. */
const L = 0.2;
const GROOVE_EXTRA = 0.15;
const MIN_NECK_WALL = 1.2;

/** A number as typed in a field (decimal comma). */
const dec = (x: number) => num(x).replace('.', ',');
/** An expression as a term: in parentheses unless it is a name or a number. */
const p = (e: string) => (isIdentifier(e) || /^-?[\d,.]+$/.test(e) ? e : `(${e})`);
/** a + x (x a number, either sign). */
const plusNum = (a: string, x: number) => (Math.abs(x) < 1e-9 ? a : `${a} ${x < 0 ? '-' : '+'} ${dec(Math.abs(x))}`);

/**
 * Put the container's parts into the document in place of `f` (or at the rollback marker if `f` is
 * not in it). Returns an error, and leaves the document alone, if the container cannot be built.
 */
export function applyContainer(doc: Doc, f: ContainerFeature): { error: string } | { parts: Feature[] } {
  const parts = containerParts(doc, f);
  if ('error' in parts) return parts;
  doc.params.push(...parts.params);
  const at = doc.features.findIndex(g => g.id === f.id);
  if (at < 0) parts.features.forEach(g => insertFeature(doc, g));
  else {
    doc.features.splice(at, 1, ...parts.features);
    if (doc.rollback !== null && doc.rollback > at) doc.rollback += parts.features.length - 1;
  }
  return { parts: parts.features };
}

export function containerParts(doc: Doc, f: ContainerFeature): { error: string } | { params: Param[]; features: Feature[] } {
  // The container's own checks (sizes, a circle for a screw lid …) decide whether it can be built.
  const at = doc.features.findIndex(g => g.id === f.id);
  const trial: Doc = { ...doc, features: [...doc.features.slice(0, at >= 0 ? at : activeCount(doc)), f], rollback: null };
  const err = buildModel(trial).errors.get(f.id);
  if (err) return { error: err };
  const sk = doc.features.find((g): g is SketchFeature => g.type === 'sketch' && g.id === f.sketch)!;
  const vars = evalParams(doc.params).vars;
  const val = (src: string) => evalParams([...doc.params, { name: '_', expr: src }]).vars.get('_') ?? 0;

  // Shared sizes: a typed number becomes a variable, an expression is used as it is.
  const params: Param[] = [];
  const taken = new Set(doc.params.map(q => q.name));
  const named = (key: Key, src: string) => {
    if (isParametric(src)) return src.trim();
    const base = t(key);
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    params.push({ name, expr: src.trim() });
    return name;
  };
  const names = new Set(doc.features.map(g => g.name));
  const partName = (key: Key) => {
    let name = t(key);
    for (let n = 2; names.has(name); n++) name = `${t(key)} ${n}`;
    names.add(name);
    return name;
  };
  const out: Feature[] = [];
  const extrude = (s: SketchFeature, key: Key, o: Partial<ExtrudeFeature>) => {
    const e = Object.assign(newFeature(doc, 'extrude', s), { name: partName(key), direction: 'normal' as const }, o);
    out.push(e);
    return e;
  };
  const sketchLike = (from: SketchFeature, key: Key, data?: SketchData) => {
    const s = newSketch(doc, from.plane);
    s.name = partName(key);
    if (data) Object.assign(s, JSON.parse(JSON.stringify({ points: data.points, entities: data.entities, constraints: data.constraints, nextId: data.nextId })));
    for (const k of ['offset', 'face', 'faceRef', 'outward', 'seat'] as const) if (from[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(from[k]));
    out.push(s);
    return s;
  };
  /** A copy of the sketch moved dx along its x: the lid lies beside the box for printing. */
  const besides = (key: Key, dx: number) => {
    const s = sketchLike(sk, key, sk);
    const base = sketchFrame({ ...sk, offset: undefined }, vars, doc);
    s.face = { o: add(base.o, scale(base.u, dx)), u: base.u, v: base.v };
    delete s.faceRef;
    return s;
  };

  const { loops, regions } = sketchRegions(sk);
  const sel = selectRegions(regions, loops, f.regions);
  const outer = sel.map(i => loops[regions[i].loop].pts);
  const xs = outer.flat().map(q => q.x), ys = outer.flat().map(q => q.y);
  const H = named('var.height', f.height), W = named('var.wall', f.wall), FL = named('var.floor', f.floor);
  const w = val(f.wall), fl = val(f.floor), c = f.lid === 'none' ? 0 : val(f.clearance);
  const C = f.lid === 'none' ? '0' : named('var.clearance', f.clearance);

  if (f.lid === 'screw') {
    const loop = loops[regions[sel[0]].loop];
    const circle = loop.circle!, cid = loop.entityIds[0];
    const R = circle.r, P = val(f.pitch), Lt = val(f.threadLength);
    const LT = named('var.threadLength', f.threadLength), PITCH = named('var.pitch', f.pitch);
    const DIA = circleDiameter(sk, cid) ?? dec(2 * R);
    const cone = Math.max(0, threadDepth(P) + MIN_NECK_WALL - w); // the inside narrows this much at the neck
    extrude(sk, 'part.body', { depth: H });
    const thread = (s: SketchFeature, key: Key, o: Partial<ThreadFeature>) =>
      out.push(Object.assign(newFeature(doc, 'thread', s), { name: partName(key), circles: [cid], size: 'custom', diameter: DIA, pitch: PITCH, length: LT, clearance: '0' }, o));
    thread(sk, 'part.thread', { mode: 'external', start: `${H} - ${p(LT)}`, direction: 'normal', chamfer: true });
    // The inside: up to the neck, narrowing at 45° (printable) to the wall inside the thread.
    extrude(sk, 'part.cavity', {
      op: 'remove', start: FL, depth: `${H} - ${p(LT)} - ${p(FL)}`, inset: `-${p(W)}`,
      ...(cone > 0 ? { edge: 'chamfer' as const, edgeSize: dec(cone), edgeWhere: 'far' as const } : {}),
    });
    extrude(sk, 'part.neck', { op: 'remove', start: `${H} - ${p(LT)}`, depth: `${p(LT)} + 1`, inset: cone > 0 ? `-(${W} + ${dec(cone)})` : `-${p(W)}` });
    // The lid beside it: wall + clearance around the jar's thread, a grip around it.
    const Ro = R + c + w;
    const lid = besides('part.lidSketch', R + Ro + 10);
    const Hl = `${FL} + ${p(LT)}`;
    extrude(lid, 'part.lid', { depth: Hl, inset: `${W} + ${C}` });
    const grip = sketchLike(lid, 'part.gripSketch');
    const gc = newId(grip, 'p'), ge = newId(grip, 'e');
    grip.points[gc] = { x: circle.c.x + Ro, y: circle.c.y };
    grip.entities[ge] = { type: 'circle', c: gc, r: 0.8, fn: 12 };
    extrude(grip, 'part.grip', {
      depth: Hl, rep: 'circular', repRotAxis: 'circle', repCircle: `${lid.id}/${cid}`, repCount: String(Math.max(8, Math.round((2 * Math.PI * Ro) / 5))), repAngle: '360',
    });
    thread(lid, 'part.lidThread', { mode: 'internal', clearance: `2 * ${p(C)}`, start: Hl, direction: 'reverse', chamfer: false });
    return { params, features: out };
  }

  const RAD = f.radius && val(f.radius) > 0 ? named('var.corner', f.radius) : '0';
  const lipH = f.lid === 'lip' || f.lid === 'snap' ? val(f.lipHeight) : 0;
  const LIP = lipH ? named('var.lip', f.lipHeight) : '0';
  extrude(sk, 'part.body', { depth: H, radius: RAD });
  extrude(sk, 'part.cavity', { op: 'remove', start: FL, depth: H, inset: `-${p(W)}`, radius: RAD });
  // Snap lid: the same layers as container.ts (snapGeometry), as extrudes with 45° chamfers.
  const snap = f.lid === 'snap' ? snapLayers(val(f.height), fl, lipH, val(f.snapDepth || '0,6')) : null;
  if (snap) {
    extrude(sk, 'part.groove', {
      op: 'remove', start: plusNum(`${H} - ${p(LIP)}`, snap.g0 - (val(f.height) - lipH)), depth: dec(snap.gh), inset: `${dec(snap.G)} - (${W} + ${C})`,
      radius: RAD, edge: 'chamfer', edgeSize: dec(snap.G), edgeWhere: 'both',
    });
  }
  const nx = Math.round(val(f.cellsX || '1')), ny = Math.round(val(f.cellsY || '1'));
  if (nx > 1 || ny > 1) {
    const div = sketchLike(sk, 'part.dividerSketch');
    for (const r of dividers(outer, nx, ny, { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, w)) rect(div, r);
    // They end below the lid's lip so the lid fits.
    extrude(div, 'part.dividers', { start: FL, depth: lipH ? `${H} - ${p(FL)} - ${p(LIP)} - 0,5` : `${H} - ${p(FL)}` });
  }
  if (lipH) {
    // The lid lies beside it, lip up: a plate + a ring that fits inside the wall.
    const lid = besides('part.lidSketch', Math.max(...xs) - Math.min(...xs) + 10);
    extrude(lid, 'part.lid', { depth: FL, radius: RAD });
    extrude(lid, 'part.lip', { start: FL, depth: LIP, inset: `-(${W} + ${C})`, radius: RAD });
    if (snap) {
      // The bead is a solid layer stack here; the lip's inside below takes its middle away.
      const D = named('var.bead', f.snapDepth || '0,6');
      extrude(lid, 'part.bead', {
        start: plusNum(`${FL} + ${p(LIP)}`, snap.zb - fl - lipH), depth: dec(snap.bh), inset: `${p(D)} - (${W} + ${C})`,
        radius: RAD, edge: 'chamfer', edgeSize: D, edgeWhere: 'both',
      });
    }
    extrude(lid, 'part.lipInside', { op: 'remove', start: FL, depth: `${p(LIP)} + 1`, inset: `-(2 * ${p(W)} + ${C})`, radius: RAD });
  }
  return { params, features: out };
}

/**
 * The snap's bead (in the lid, from its plate) and groove (in the box), on whole print layers like
 * container.ts. The groove is G deep (the bead's depth + margin, up to a whole layer) so its 45°
 * chamfer steps fall on the layers too.
 */
function snapLayers(H: number, fl: number, lipH: number, d: number) {
  const floorL = (v: number) => Math.floor(v / L + 1e-6) * L, ceilL = (v: number) => Math.ceil(v / L - 1e-6) * L;
  const bh = Math.ceil((2 * d + 0.4) / L - 1e-9) * L;
  const zb = Math.round((fl + lipH - bh - 0.6) / L) * L;
  // The lid flipped onto the box: lid height z is box height H + fl − z.
  const g0 = floorL(H + fl - zb - bh - GROOVE_EXTRA), g1 = ceilL(H + fl - zb + GROOVE_EXTRA);
  return { bh, zb, g0, gh: g1 - g0, G: ceilL(d + GROOVE_EXTRA) };
}

/** The circle's diameter as its dimension's expression, if it has one. */
function circleDiameter(sk: SketchFeature, id: string): string | null {
  for (const c of sk.constraints) {
    if ((c.type !== 'diameter' && c.type !== 'radius') || c.e !== id || !c.expr) continue;
    return c.type === 'diameter' ? c.expr : `2 * ${p(c.expr)}`;
  }
  return null;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

function rect(s: SketchData, r: Rect) {
  const ids = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(([x, y]) => {
    const id = newId(s, 'p');
    s.points[id] = { x: Number(num(x)), y: Number(num(y)) };
    return id;
  });
  ids.forEach((a, i) => (s.entities[newId(s, 'e')] = { type: 'line', p1: a, p2: ids[(i + 1) % 4] }));
}

/**
 * Dividers for nx × ny compartments, spaced like container.ts. Each one reaches into the middle of
 * the wall at both ends (measured where the profile is narrowest across the divider's width).
 */
function dividers(outer: Vec[][], nx: number, ny: number, b: Rect, w: number): Rect[] {
  /** Where the line u = at (u = x or y) enters and leaves the profile, along the other axis. */
  const across = (at: number, axis: 'x' | 'y'): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    for (const poly of outer)
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], q = poly[(i + 1) % poly.length];
        const [ua, va, uq, vq] = axis === 'x' ? [a.x, a.y, q.x, q.y] : [a.y, a.x, q.y, q.x];
        if ((ua - at) * (uq - at) > 0 || ua === uq) continue;
        const v = va + ((at - ua) / (uq - ua)) * (vq - va);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    return [lo, hi];
  };
  const span = (at: number, axis: 'x' | 'y'): [number, number] => {
    const s = [at - w / 2, at, at + w / 2].map(u => across(u, axis));
    return [Math.max(...s.map(v => v[0])) + w / 2, Math.min(...s.map(v => v[1])) - w / 2];
  };
  const out: Rect[] = [];
  const ix0 = b.x0 + w, ix1 = b.x1 - w, iy0 = b.y0 + w, iy1 = b.y1 - w;
  for (let i = 1; i < nx; i++) {
    const x = ix0 + ((ix1 - ix0) * i) / nx;
    const [y0, y1] = span(x, 'x');
    if (y1 > y0) out.push({ x0: x - w / 2, x1: x + w / 2, y0, y1 });
  }
  for (let j = 1; j < ny; j++) {
    const y = iy0 + ((iy1 - iy0) * j) / ny;
    const [x0, x1] = span(y, 'y');
    if (x1 > x0) out.push({ x0, x1, y0: y - w / 2, y1: y + w / 2 });
  }
  return out;
}
