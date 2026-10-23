// Unit tests for the measure tool (edges → references → measurements).
import { setLang } from '../src/i18n';
import assert from 'node:assert/strict';
import { cornerVertices, describe, measureBetween, refOf, type V3 } from '../src/measure';
setLang('en');

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

/** Edge segments as a Float32Array (like EdgesGeometry). */
const edges = (segs: [V3, V3][]) => new Float32Array(segs.flatMap(([a, b]) => [...a, ...b]));
const circle = (c: V3, r: number, k: number, a0 = 0, sweep = Math.PI * 2): V3[] =>
  Array.from({ length: k + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (sweep * i) / k), c[1] + r * Math.sin(a0 + (sweep * i) / k), c[2]] as V3);
const chain = (pts: V3[]): [V3, V3][] => pts.slice(1).map((p, i) => [pts[i], p]);

// Box 40 × 20 × 10: the top front edge split into two segments (a T junction in the mesh), a hole
// Ø6 (32 segments) at (10, 10) on the top.
const box: [V3, V3][] = [
  [[0, 0, 10], [25, 0, 10]], [[25, 0, 10], [40, 0, 10]], [[40, 0, 10], [40, 20, 10]], [[40, 20, 10], [0, 20, 10]], [[0, 20, 10], [0, 0, 10]],
  [[0, 0, 0], [40, 0, 0]], [[0, 0, 0], [0, 0, 10]], [[40, 0, 0], [40, 0, 10]],
  ...chain(circle([10, 10, 10], 3, 32)),
];
const E = edges(box);
const segOf = (a: V3, b: V3) => box.findIndex(([p, q]) => p.every((v, i) => Math.abs(v - a[i]) < 1e-9) && q.every((v, i) => Math.abs(v - b[i]) < 1e-9));

test('straight edge in two segments = the whole length', () => {
  const r = refOf({ kind: 'edge', point: [5, 0, 10], seg: segOf([0, 0, 10], [25, 0, 10]) }, E);
  assert.equal(r.kind, 'line');
  if (r.kind === 'line') near(r.length, 40);
  assert.equal(describe(r).main, 'Edge 40 mm');
  assert.equal(describe(r).detail, 'direction +X');
});

test('hole: circle Ø6 with center', () => {
  const r = refOf({ kind: 'edge', point: [13, 10, 10], seg: 9 }, E);
  assert.equal(r.kind, 'circle');
  if (r.kind === 'circle') { near(r.r, 3, 1e-5); assert.ok(r.closed); near(r.c[0], 10, 1e-5); near(r.c[1], 10, 1e-5); }
  assert.equal(describe(r).main, 'Ø 6 mm · R 3');
});

test('rounded rectangle: the arc ends at the tangent point, the line at the arc', () => {
  // Corner radius 5 at (35, 15): line (0,20)–(35,20)... simplified: line (0,20)→(35,20), arc 90° to
  // (40,15), line down to (40,0).
  const arc = circle([35, 15, 0], 5, 12, Math.PI / 2, -Math.PI / 2);
  const segs: [V3, V3][] = [[[0, 20, 0], [35, 20, 0]], ...chain(arc), [[40, 15, 0], [40, 0, 0]]];
  const e = edges(segs);
  const a = refOf({ kind: 'edge', point: arc[6], seg: 6 }, e);
  assert.equal(a.kind, 'circle');
  if (a.kind === 'circle') { near(a.r, 5, 1e-5); assert.equal(a.closed, false); assert.equal(a.poly.length, 13); }
  assert.equal(describe(a).main, 'Arc R 5 mm');
  const l = refOf({ kind: 'edge', point: [10, 20, 0], seg: 0 }, e);
  assert.equal(l.kind, 'line');
  if (l.kind === 'line') near(l.length, 35);
});

test('parallel faces: perpendicular distance', () => {
  const top = refOf({ kind: 'face', point: [5, 5, 10], normal: [0, 0, 1] }, E);
  const bottom = refOf({ kind: 'face', point: [30, 12, 0], normal: [0, 0, -1] }, E);
  const m = measureBetween(top, bottom);
  assert.equal(m.main, 'Distance 10 mm');
  assert.equal(m.detail, 'perpendicular between parallel faces');
});

test('faces at 90°', () => {
  const top = refOf({ kind: 'face', point: [5, 5, 10], normal: [0, 0, 1] }, E);
  const side = refOf({ kind: 'face', point: [40, 5, 5], normal: [1, 0, 0] }, E);
  assert.equal(measureBetween(top, side).main, 'Angle between faces 90°');
});

test('hole center to side face and to corner', () => {
  const hole = refOf({ kind: 'edge', point: [13, 10, 10], seg: 9 }, E);
  const side = refOf({ kind: 'face', point: [0, 15, 3], normal: [-1, 0, 0] }, E);
  assert.equal(measureBetween(hole, side).main, 'Distance 10 mm');
  const corner = refOf({ kind: 'vertex', point: [40, 20, 10] }, E);
  const m = measureBetween(hole, corner);
  assert.equal(m.main, `Distance ${String(Math.round(Math.hypot(30, 10) * 100) / 100).replace('.', ',')} mm`);
  assert.equal(m.detail, 'ΔX 30 · ΔY 10 · ΔZ 0');
});

test('edges: parallel → distance, otherwise angle; point → edge', () => {
  const front = refOf({ kind: 'edge', point: [5, 0, 10], seg: segOf([0, 0, 10], [25, 0, 10]) }, E);
  const back = refOf({ kind: 'edge', point: [20, 20, 10], seg: segOf([40, 20, 10], [0, 20, 10]) }, E);
  assert.equal(measureBetween(front, back).main, 'Distance 20 mm');
  const vert = refOf({ kind: 'edge', point: [0, 0, 5], seg: segOf([0, 0, 0], [0, 0, 10]) }, E);
  assert.equal(measureBetween(front, vert).main, 'Angle 90°');
  const corner = refOf({ kind: 'vertex', point: [40, 20, 10] }, E);
  assert.equal(measureBetween(corner, front).main, 'Distance 20 mm');
  const lower = refOf({ kind: 'edge', point: [20, 0, 0], seg: segOf([0, 0, 0], [40, 0, 0]) }, E);
  const top = refOf({ kind: 'face', point: [5, 5, 10], normal: [0, 0, 1] }, E);
  assert.equal(measureBetween(lower, top).main, 'Distance 10 mm', 'edge parallel to the face');
  assert.equal(measureBetween(vert, top).main, 'Angle 90°');
});

test('corners to snap to: the box\'s corners, not the hole\'s points or the T junction', () => {
  const c = cornerVertices(E);
  const pts = Array.from({ length: c.length / 3 }, (_, i) => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]].join(','));
  assert.deepEqual(pts.sort(), ['0,0,0', '0,0,10', '0,20,10', '40,0,0', '40,0,10', '40,20,10'].sort());
});

console.log(`${n} measure tests ok`);
