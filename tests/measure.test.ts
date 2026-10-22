// Enhetstester för mätverktyget (kanter → referenser → mått).
import { setLang } from '../src/i18n';
import assert from 'node:assert/strict';
import { cornerVertices, describe, measureBetween, refOf, type V3 } from '../src/measure';
setLang('sv');

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

/** Kantsegment som Float32Array (som EdgesGeometry). */
const edges = (segs: [V3, V3][]) => new Float32Array(segs.flatMap(([a, b]) => [...a, ...b]));
const circle = (c: V3, r: number, k: number, a0 = 0, sweep = Math.PI * 2): V3[] =>
  Array.from({ length: k + 1 }, (_, i) => [c[0] + r * Math.cos(a0 + (sweep * i) / k), c[1] + r * Math.sin(a0 + (sweep * i) / k), c[2]] as V3);
const chain = (pts: V3[]): [V3, V3][] => pts.slice(1).map((p, i) => [pts[i], p]);

// Låda 40 × 20 × 10: överkantens framkant delad i två segment (T-korsning i nätet),
// ett hål Ø6 (32 segment) i (10, 10) på ovansidan.
const box: [V3, V3][] = [
  [[0, 0, 10], [25, 0, 10]], [[25, 0, 10], [40, 0, 10]], [[40, 0, 10], [40, 20, 10]], [[40, 20, 10], [0, 20, 10]], [[0, 20, 10], [0, 0, 10]],
  [[0, 0, 0], [40, 0, 0]], [[0, 0, 0], [0, 0, 10]], [[40, 0, 0], [40, 0, 10]],
  ...chain(circle([10, 10, 10], 3, 32)),
];
const E = edges(box);
const segOf = (a: V3, b: V3) => box.findIndex(([p, q]) => p.every((v, i) => Math.abs(v - a[i]) < 1e-9) && q.every((v, i) => Math.abs(v - b[i]) < 1e-9));

test('rak kant i två segment = hela längden', () => {
  const r = refOf({ kind: 'edge', point: [5, 0, 10], seg: segOf([0, 0, 10], [25, 0, 10]) }, E);
  assert.equal(r.kind, 'line');
  if (r.kind === 'line') near(r.length, 40);
  assert.equal(describe(r).main, 'Kant 40 mm');
  assert.equal(describe(r).detail, 'riktning +X');
});

test('hål: cirkel Ø6 med centrum', () => {
  const r = refOf({ kind: 'edge', point: [13, 10, 10], seg: 9 }, E);
  assert.equal(r.kind, 'circle');
  if (r.kind === 'circle') { near(r.r, 3, 1e-5); assert.ok(r.closed); near(r.c[0], 10, 1e-5); near(r.c[1], 10, 1e-5); }
  assert.equal(describe(r).main, 'Ø 6 mm · R 3');
});

test('rundad rektangel: bågen slutar vid tangentpunkten, linjen vid bågen', () => {
  // Hörnradie 5 i (35, 15): linje (0,20)–(35,20)... förenklat: linje (0,20)→(35,20), båge 90° till (40,15), linje ner till (40,0).
  const arc = circle([35, 15, 0], 5, 12, Math.PI / 2, -Math.PI / 2);
  const segs: [V3, V3][] = [[[0, 20, 0], [35, 20, 0]], ...chain(arc), [[40, 15, 0], [40, 0, 0]]];
  const e = edges(segs);
  const a = refOf({ kind: 'edge', point: arc[6], seg: 6 }, e);
  assert.equal(a.kind, 'circle');
  if (a.kind === 'circle') { near(a.r, 5, 1e-5); assert.equal(a.closed, false); assert.equal(a.poly.length, 13); }
  assert.equal(describe(a).main, 'Båge R 5 mm');
  const l = refOf({ kind: 'edge', point: [10, 20, 0], seg: 0 }, e);
  assert.equal(l.kind, 'line');
  if (l.kind === 'line') near(l.length, 35);
});

test('parallella ytor: vinkelrätt avstånd', () => {
  const top = refOf({ kind: 'face', point: [5, 5, 10], normal: [0, 0, 1] }, E);
  const bottom = refOf({ kind: 'face', point: [30, 12, 0], normal: [0, 0, -1] }, E);
  const m = measureBetween(top, bottom);
  assert.equal(m.main, 'Avstånd 10 mm');
  assert.equal(m.detail, 'vinkelrätt mellan parallella ytor');
});

test('ytor i 90°', () => {
  const top = refOf({ kind: 'face', point: [5, 5, 10], normal: [0, 0, 1] }, E);
  const side = refOf({ kind: 'face', point: [40, 5, 5], normal: [1, 0, 0] }, E);
  assert.equal(measureBetween(top, side).main, 'Vinkel mellan ytorna 90°');
});

test('hålcentrum till sidoyta och till hörn', () => {
  const hole = refOf({ kind: 'edge', point: [13, 10, 10], seg: 9 }, E);
  const side = refOf({ kind: 'face', point: [0, 15, 3], normal: [-1, 0, 0] }, E);
  assert.equal(measureBetween(hole, side).main, 'Avstånd 10 mm');
  const corner = refOf({ kind: 'vertex', point: [40, 20, 10] }, E);
  const m = measureBetween(hole, corner);
  assert.equal(m.main, `Avstånd ${String(Math.round(Math.hypot(30, 10) * 100) / 100).replace('.', ',')} mm`);
  assert.equal(m.detail, 'ΔX 30 · ΔY 10 · ΔZ 0');
});

test('kanter: parallella → avstånd, annars vinkel; punkt → kant', () => {
  const front = refOf({ kind: 'edge', point: [5, 0, 10], seg: segOf([0, 0, 10], [25, 0, 10]) }, E);
  const back = refOf({ kind: 'edge', point: [20, 20, 10], seg: segOf([40, 20, 10], [0, 20, 10]) }, E);
  assert.equal(measureBetween(front, back).main, 'Avstånd 20 mm');
  const vert = refOf({ kind: 'edge', point: [0, 0, 5], seg: segOf([0, 0, 0], [0, 0, 10]) }, E);
  assert.equal(measureBetween(front, vert).main, 'Vinkel 90°');
  const corner = refOf({ kind: 'vertex', point: [40, 20, 10] }, E);
  assert.equal(measureBetween(corner, front).main, 'Avstånd 20 mm');
  const lower = refOf({ kind: 'edge', point: [20, 0, 0], seg: segOf([0, 0, 0], [40, 0, 0]) }, E);
  const top = refOf({ kind: 'face', point: [5, 5, 10], normal: [0, 0, 1] }, E);
  assert.equal(measureBetween(lower, top).main, 'Avstånd 10 mm', 'kant parallell med ytan');
  assert.equal(measureBetween(vert, top).main, 'Vinkel 90°');
});

test('hörn att fästa mot: lådans hörn, inte hålets punkter eller T-korsningen', () => {
  const c = cornerVertices(E);
  const pts = Array.from({ length: c.length / 3 }, (_, i) => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]].join(','));
  assert.deepEqual(pts.sort(), ['0,0,0', '0,0,10', '0,20,10', '40,0,0', '40,0,10', '40,20,10'].sort());
});

console.log(`${n} mättester ok`);
