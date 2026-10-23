// Unit tests for sketch geometry, profiles and code generation.
// node tests/run.mjs
import { setLang } from '../src/i18n';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { arcThrough, circumcircle, segmentsFor, fmtNum } from '../src/sketch/geom';
import { emptySketch, newId, removePoints, mergePoints, type SketchData } from '../src/sketch/model';
import { findLoops } from '../src/sketch/regions';
import { codegenSketch } from '../src/sketch/sketchcode';
import { emptyDoc, insertFeature, newExtrude, newSketch } from '../src/doc';
import { buildModel } from '../src/model3d';
setLang('en'); // the tests expect English names and errors

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok', name); };

function pt(sk: SketchData, x: number, y: number) { const id = newId(sk, 'p'); sk.points[id] = { x, y }; return id; }
function line(sk: SketchData, p1: string, p2: string) { const id = newId(sk, 'e'); sk.entities[id] = { type: 'line', p1, p2 }; return id; }
function rect(sk: SketchData, x0: number, y0: number, x1: number, y1: number) {
  const a = pt(sk, x0, y0), b = pt(sk, x1, y0), c = pt(sk, x1, y1), d = pt(sk, x0, y1);
  return [line(sk, a, b), line(sk, b, c), line(sk, c, d), line(sk, d, a)];
}

test('circumcircle', () => {
  const r = circumcircle({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 })!;
  near(r.c.x, 1); near(r.c.y, 0); near(r.r, 1);
  assert.equal(circumcircle({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
});
test('arcThrough direction', () => {
  assert.equal(arcThrough({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 })!.ccw, true);
  assert.equal(arcThrough({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 })!.ccw, false);
});
test('segmentsFor', () => {
  assert.ok(segmentsFor(10, Math.PI * 2) >= 60 && segmentsFor(10, Math.PI * 2) <= 80);
  assert.equal(segmentsFor(1000, Math.PI * 2), 360);
  assert.equal(segmentsFor(0.1, Math.PI * 2), 16);
});
test('fmtNum', () => {
  assert.equal(fmtNum(12.5), '12,5'); assert.equal(fmtNum(3), '3'); assert.equal(fmtNum(-0.001), '0'); assert.equal(fmtNum(1.234567, 3), '1,235');
});
test('rectangle = one profile', () => {
  const sk = emptySketch(); rect(sk, 0, 0, 20, 10);
  const { loops } = findLoops(sk);
  assert.equal(loops.length, 1); near(loops[0].area, 200);
});
test('an open chain gives no profile, a loose end is cleaned away', () => {
  const sk = emptySketch();
  const a = pt(sk, 0, 0), b = pt(sk, 10, 0), c = pt(sk, 10, 10);
  line(sk, a, b); line(sk, b, c);
  assert.equal(findLoops(sk).loops.length, 0);
  const sk2 = emptySketch(); rect(sk2, 0, 0, 10, 10);
  const extra = pt(sk2, 20, 0); line(sk2, Object.keys(sk2.points)[1], extra); // T branch
  const { loops } = findLoops(sk2);
  assert.equal(loops.length, 1); near(loops[0].area, 100);
});
test('crossing lines split the rectangle into four faces', () => {
  const sk = emptySketch(); rect(sk, 0, 0, 20, 20);
  line(sk, pt(sk, -5, -5), pt(sk, 25, 25)); line(sk, pt(sk, -5, 25), pt(sk, 25, -5)); // sticks out in every direction
  const { loops } = findLoops(sk);
  assert.equal(loops.length, 4);
  near(loops.reduce((a, l) => a + l.area, 0), 400, 1e-6);
  assert.ok(loops.every(l => l.depth === 0));
});
test('circle touching the rectangle at one point', () => {
  const sk = emptySketch(); rect(sk, 0, 0, 20, 20);
  sk.entities[newId(sk, 'e')] = { type: 'circle', c: pt(sk, 30, 10), r: 10 };
  const { loops } = findLoops(sk);
  assert.equal(loops.length, 2);
  near(loops.reduce((a, l) => a + l.area, 0), 400 + Math.PI * 100, 0.5);
});
const phone = JSON.parse(readFileSync(new URL('./phone-sketches.json', 'file://' + process.env.TESTDIR + '/'), 'utf8')) as Record<string, SketchData>;
const phoneSketch = (k: string) => ({ ...emptySketch(), ...phone[k], constraints: [] }) as SketchData;
test('hand-drawn: strut (arc + chord + quadrilateral + triangle)', () => {
  const sk = phoneSketch('strut');
  const { loops } = findLoops(sk);
  assert.equal(loops.length, 3, 'three adjacent faces');
  assert.ok(loops.every(l => l.depth === 0));
  writeFileSync(process.env.OUT + '/phone_sketch2.scad', `linear_extrude(5) {\n${codegenSketch(sk)}\n}\n`);
});
test('hand-drawn: strut without chord', () => {
  const { loops } = findLoops(phoneSketch('strut-open'));
  assert.equal(loops.length, 2);
});
test('hand-drawn: rectangle + circle around the corner', () => {
  const sk = phoneSketch('square-circle');
  const { loops } = findLoops(sk);
  assert.ok(loops.length >= 3, `${loops.length} faces`);
  // The union must be the circle (r 22) plus the part of the 15×24 rectangle that sticks out.
  const total = loops.reduce((a, l) => a + l.area, 0);
  assert.ok(total > Math.PI * 484 - 1 && total < Math.PI * 484 + 100, `area ${total}`);
  writeFileSync(process.env.OUT + '/phone_sketch1.scad', `linear_extrude(5) {\n${codegenSketch(sk)}\n}\n`);
});
test('construction lines do not count', () => {
  const sk = emptySketch(); const ids = rect(sk, 0, 0, 10, 10);
  sk.entities[ids[0]].construction = true;
  assert.equal(findLoops(sk).loops.length, 0);
});
test('hole and island', () => {
  const sk = emptySketch(); rect(sk, 0, 0, 100, 100);
  const c = pt(sk, 50, 50); sk.entities[newId(sk, 'e')] = { type: 'circle', c, r: 30 };
  rect(sk, 45, 45, 55, 55);
  const { loops } = findLoops(sk);
  const byArea = [...loops].sort((a, b) => b.area - a.area);
  assert.deepEqual(byArea.map(l => l.depth), [0, 1, 2]);
  const code = codegenSketch(sk)!;
  assert.match(code, /difference\(\)/);
  assert.match(code, /translate\(\[50, 50\]\) circle\(r = 30/);
  writeFileSync(process.env.OUT + '/hole_and_island.scad', `linear_extrude(5) {\n${code}\n}\n`);
});
test('D shape (line + arc)', () => {
  const sk = emptySketch();
  const c = pt(sk, 0, 0), a = pt(sk, 10, 0), b = pt(sk, -10, 0);
  sk.entities[newId(sk, 'e')] = { type: 'arc', c, p1: a, p2: b }; // counterclockwise over
  line(sk, b, a);
  const { loops } = findLoops(sk);
  assert.equal(loops.length, 1); near(loops[0].area, Math.PI * 50, 0.5);
  writeFileSync(process.env.OUT + '/d_form.scad', `linear_extrude(5) {\n${codegenSketch(sk)}\n}\n`);
});
test('removing a point removes lines', () => {
  const sk = emptySketch(); rect(sk, 0, 0, 10, 10);
  removePoints(sk, [Object.keys(sk.points)[0]]);
  assert.equal(Object.keys(sk.entities).length, 2); assert.equal(Object.keys(sk.points).length, 3);
});
test('merging points closes a profile', () => {
  const sk = emptySketch();
  const a = pt(sk, 0, 0), b = pt(sk, 10, 0), c = pt(sk, 10, 10), d = pt(sk, 0, 10), a2 = pt(sk, 0.1, 0.1);
  line(sk, a, b); line(sk, b, c); line(sk, c, d); line(sk, d, a2);
  assert.equal(findLoops(sk).loops.length, 0);
  mergePoints(sk, a2, a);
  assert.equal(findLoops(sk).loops.length, 1);
});
test('document code on three planes', () => {
  const doc = emptyDoc();
  for (const plane of ['XY', 'XZ', 'YZ'] as const) {
    const f = newSketch(doc, plane); rect(f, 0, 0, 20, 10); insertFeature(doc, f);
    insertFeature(doc, newExtrude(doc, f.id));
  }
  insertFeature(doc, newSketch(doc, 'XY')); // an empty sketch
  const { code, solids, errors } = buildModel(doc);
  assert.equal(solids, 3); assert.equal(errors.size, 0);
  assert.match(code, /module extrude_1\(\)/); assert.match(code, /rotate\(\[90, 0, 0\]\) linear_extrude/);
  writeFileSync(process.env.OUT + '/three_planes.scad', code);
});
console.log(`${n} sketch tests ok`);
