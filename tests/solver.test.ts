// Enhetstester för villkorslösaren (planegcs-WASM i Node).
import { setLang } from '../src/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSolver } from '../src/sketch/solver';
import { emptySketch, newId, normalizeSketch, type Constraint, type NewConstraint, type SketchData } from '../src/sketch/model';
import { measure, signedAngle, visibleAngle } from '../src/sketch/annotate';
import { arcGeom } from '../src/sketch/model';
import { evalExpr } from '../src/expr';
import { cornersFor, cutCorners, defaultCornerSize } from '../src/sketch/fillet';
import { findLoops } from '../src/sketch/regions';
setLang('sv'); // testerna förväntar sig svenska namn och fel

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
let n = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log('ok', name); };

const solver = await loadSolver(process.env.WASM);
function pt(sk: SketchData, x: number, y: number) { const id = newId(sk, 'p'); sk.points[id] = { x, y }; return id; }
function line(sk: SketchData, p1: string, p2: string) { const id = newId(sk, 'e'); sk.entities[id] = { type: 'line', p1, p2 }; return id; }
function con(sk: SketchData, c: NewConstraint) { const id = newId(sk, 'c'); sk.constraints.push({ ...c, id } as Constraint); return id; }
/** Sned rektangel med H/V-villkor (som rektangelverktyget). */
function rect(sk: SketchData) {
  const p = [pt(sk, 0.5, -0.3), pt(sk, 21, 1), pt(sk, 19, 11), pt(sk, 1, 9)];
  const l = [line(sk, p[0], p[1]), line(sk, p[1], p[2]), line(sk, p[2], p[3]), line(sk, p[3], p[0])];
  con(sk, { type: 'horizontal', e: l[0] }); con(sk, { type: 'vertical', e: l[1] });
  con(sk, { type: 'horizontal', e: l[2] }); con(sk, { type: 'vertical', e: l[3] });
  return { p, l };
}
const isRect = (sk: SketchData, p: string[]) => {
  const [a, b, c, d] = p.map(id => sk.points[id]);
  near(a.y, b.y); near(b.x, c.x); near(c.y, d.y); near(d.x, a.x);
};

await test('uttryck', () => {
  assert.equal(evalExpr('20'), 20); assert.equal(evalExpr('12,5'), 12.5); assert.equal(evalExpr('20/2 + 5'), 15);
  assert.equal(evalExpr('(3+4)*2'), 14); assert.equal(evalExpr('-3+10'), 7); assert.equal(evalExpr('10 mm'), 10);
  assert.equal(evalExpr('2*'), null); assert.equal(evalExpr('abc'), null); assert.equal(evalExpr(''), null);
});
await test('rektangel rätas upp, 4 frihetsgrader, allt fritt', () => {
  const sk = emptySketch(); const { p } = rect(sk);
  const r = solver.solve(sk);
  assert.ok(r.ok); assert.equal(r.dof, 4); isRect(sk, p);
  assert.equal(solver.freedom(sk).points.size, 4);
});
await test('fixerat hörn + bredd + höjd = fullt bestämd', () => {
  const sk = emptySketch(); const { p } = rect(sk);
  con(sk, { type: 'fix', p: p[0] });
  con(sk, { type: 'distance', p1: p[0], p2: p[1], dir: 'aligned', value: 30 });
  con(sk, { type: 'distance', p1: p[1], p2: p[2], dir: 'aligned', value: 15 });
  const r = solver.solve(sk);
  assert.ok(r.ok); assert.equal(r.dof, 0); isRect(sk, p);
  near(sk.points[p[1]].x - sk.points[p[0]].x, 30, 1e-6);
  assert.equal(solver.freedom(sk).points.size, 0);
});
await test('motstridigt mått avvisas och pekar ut villkoren', () => {
  const sk = emptySketch(); const { p } = rect(sk);
  con(sk, { type: 'distance', p1: p[0], p2: p[1], dir: 'aligned', value: 30 });
  const bad = con(sk, { type: 'distance', p1: p[2], p2: p[3], dir: 'aligned', value: 25 });
  const before = JSON.stringify(sk);
  const r = solver.solve(sk);
  assert.equal(r.ok, false); assert.ok(r.conflicting.includes(bad));
  assert.equal(JSON.stringify(sk), before, 'skissen orörd');
});
await test('överflödigt villkor rapporteras', () => {
  const sk = emptySketch(); const { l } = rect(sk);
  con(sk, { type: 'parallel', e1: l[0], e2: l[2] });
  const r = solver.solve(sk);
  assert.ok(r.redundant.length > 0, JSON.stringify(r));
});
await test('dra ett hörn: rektangeln förblir rektangel', () => {
  const sk = emptySketch(); const { p } = rect(sk);
  solver.solve(sk);
  const r = solver.solve(sk, { points: [{ id: p[2], x: 40, y: 25 }] });
  assert.ok(r.ok); isRect(sk, p);
  near(sk.points[p[2]].x, 40, 1e-3); near(sk.points[p[2]].y, 25, 1e-3);
});
await test('dra mot omöjligt mål: villkoren håller ändå', () => {
  const sk = emptySketch(); const { p } = rect(sk);
  con(sk, { type: 'fix', p: p[0] });
  con(sk, { type: 'distance', p1: p[0], p2: p[1], dir: 'aligned', value: 30 });
  solver.solve(sk);
  solver.solve(sk, { points: [{ id: p[1], x: 50, y: 20 }] });
  isRect(sk, p); near(sk.points[p[1]].x - sk.points[p[0]].x, 30, 1e-5);
});
await test('tangent linje–båge i gemensam ändpunkt', () => {
  const sk = emptySketch();
  const a = pt(sk, 0, 0), b = pt(sk, 20, 0), c = pt(sk, 22, 8), e = pt(sk, 30, 12);
  const L = line(sk, a, b);
  const A = newId(sk, 'e'); sk.entities[A] = { type: 'arc', c, p1: b, p2: e };
  con(sk, { type: 'tangent', e1: L, e2: A });
  assert.ok(solver.solve(sk).ok);
  const g = arcGeom(sk, sk.entities[A] as never);
  // Radien vid b ska vara vinkelrät mot linjen.
  const rv = { x: sk.points[b].x - g.c.x, y: sk.points[b].y - g.c.y }, lv = { x: sk.points[b].x - sk.points[a].x, y: sk.points[b].y - sk.points[a].y };
  near((rv.x * lv.x + rv.y * lv.y) / (Math.hypot(rv.x, rv.y) * Math.hypot(lv.x, lv.y)), 0, 1e-5);
  // Linje (4) + båge (centrum 2, radie, två vinklar; ändpunkten delad) − arc_rules (4) … − tangens = 6
  assert.equal(solver.solve(sk).dof, 6);
});
await test('slits (två bågar + två linjer, tangenta, lika radier) har 5 frihetsgrader', () => {
  const sk = emptySketch();
  const A = pt(sk, 0, 0), B = pt(sk, 20, 0), aL = pt(sk, 0, 4), aR = pt(sk, 0, -4), bL = pt(sk, 20, 4), bR = pt(sk, 20, -4);
  const arcA = newId(sk, 'e'); sk.entities[arcA] = { type: 'arc', c: A, p1: aL, p2: aR };
  const arcB = newId(sk, 'e'); sk.entities[arcB] = { type: 'arc', c: B, p1: bR, p2: bL };
  const l1 = line(sk, aR, bR), l2 = line(sk, bL, aL);
  for (const [l, a] of [[l1, arcA], [l1, arcB], [l2, arcA], [l2, arcB]]) con(sk, { type: 'tangent', e1: l, e2: a });
  con(sk, { type: 'equal', e1: arcA, e2: arcB });
  const r = solver.solve(sk);
  assert.ok(r.ok); assert.deepEqual(r.redundant, []); assert.equal(r.dof, 5, 'två ändar + bredd');
});
await test('vågrätt avstånd behåller tecknet', () => {
  const sk = emptySketch();
  const a = pt(sk, 10, 0), b = pt(sk, 2, 5);
  con(sk, { type: 'fix', p: a });
  con(sk, { type: 'distance', p1: a, p2: b, dir: 'h', value: 20, sign: -1 });
  assert.ok(solver.solve(sk).ok);
  near(sk.points[b].x, -10); near(sk.points[b].y, 5);
});
await test('vinkel: synlig vinkel ↔ lagrad', () => {
  const sk = emptySketch();
  const o = pt(sk, 0, 0), x = pt(sk, 20, 0), y = pt(sk, 10, 10);
  const l1 = line(sk, o, x), l2 = line(sk, o, y);
  con(sk, { type: 'fix', p: o }); con(sk, { type: 'horizontal', e: l1 });
  const L = (e: string) => { const l = sk.entities[e] as { p1: string; p2: string }; return { a: sk.points[l.p1], b: sk.points[l.p2] }; };
  near(visibleAngle(L(l1), L(l2)).theta, 45);
  const c = con(sk, { type: 'angle', e1: l1, e2: l2, value: 60 });
  assert.ok(solver.solve(sk).ok);
  near(signedAngle(L(l1), L(l2)), 60, 1e-6);
  near(measure(sk, sk.constraints.find(k => k.id === c)!)!, 60, 1e-6);
});
await test('cirkel: diameter och koncentrisk', () => {
  const sk = emptySketch();
  const c1 = pt(sk, 0, 0), c2 = pt(sk, 3, 1);
  const A = newId(sk, 'e'); sk.entities[A] = { type: 'circle', c: c1, r: 10 };
  const B = newId(sk, 'e'); sk.entities[B] = { type: 'circle', c: c2, r: 4 };
  con(sk, { type: 'diameter', e: A, value: 30 }); con(sk, { type: 'concentric', e1: A, e2: B }); con(sk, { type: 'equal', e1: A, e2: B });
  assert.ok(solver.solve(sk).ok);
  near((sk.entities[A] as { r: number }).r, 15); near((sk.entities[B] as { r: number }).r, 15);
  near(sk.points[c1].x, sk.points[c2].x); near(sk.points[c1].y, sk.points[c2].y);
});
await test('punkt på cirkel och mittpunkt', () => {
  const sk = emptySketch();
  const c = pt(sk, 0, 0), q = pt(sk, 7, 7), a = pt(sk, -10, -20), b = pt(sk, 10, -20), m = pt(sk, 3, -15);
  const C = newId(sk, 'e'); sk.entities[C] = { type: 'circle', c, r: 5 };
  const L = line(sk, a, b);
  con(sk, { type: 'onCurve', p: q, e: C }); con(sk, { type: 'midpoint', p: m, e: L });
  assert.ok(solver.solve(sk).ok);
  near(Math.hypot(sk.points[q].x - sk.points[c].x, sk.points[q].y - sk.points[c].y), (sk.entities[C] as { r: number }).r, 1e-6);
  near(sk.points[m].x, (sk.points[a].x + sk.points[b].x) / 2); near(sk.points[m].y, (sk.points[a].y + sk.points[b].y) / 2);
});
await test('fas 1-villkor utan id migreras', () => {
  const sk = emptySketch(); const { l } = rect(sk);
  for (const c of sk.constraints) delete (c as { id?: string }).id;
  normalizeSketch(sk);
  assert.ok(sk.constraints.every(c => c.id)); assert.equal(new Set(sk.constraints.map(c => c.id)).size, 4);
  assert.ok(l.length === 4 && solver.solve(sk).ok);
});
await test('telefonens skisser löses utan problem', () => {
  const phone = JSON.parse(readFileSync(process.env.TESTDIR + '/phone-sketches.json', 'utf8')) as Record<string, SketchData>;
  for (const [k, v] of Object.entries(phone)) {
    const sk = normalizeSketch({ ...emptySketch(), ...v, constraints: [], nextId: 1000 });
    const before = JSON.stringify(sk.points);
    const r = solver.solve(sk);
    assert.ok(r.ok, k);
    // Utan villkor ska inget flytta sig (förutom bågändar som läggs exakt på radien).
    const moved = Object.entries(sk.points).filter(([id, p]) => Math.hypot(p.x - JSON.parse(before)[id].x, p.y - JSON.parse(before)[id].y) > 0.5);
    assert.equal(moved.length, 0, `${k}: ${JSON.stringify(moved)}`);
  }
});

const dist2 = (sk: SketchData, l: string) => { const e = sk.entities[l] as { p1: string; p2: string }; return Math.hypot(sk.points[e.p1].x - sk.points[e.p2].x, sk.points[e.p1].y - sk.points[e.p2].y); };

/** Rak rektangel 0..40 × 0..20 med H/V; fixed = hörn i origo-punkten fixerad + bredd/höjd-mått (fullt definierad). */
function axisRect(sk: SketchData, fixed: boolean) {
  const p = [pt(sk, 0, 0), pt(sk, 40, 0), pt(sk, 40, 20), pt(sk, 0, 20)];
  const l = [line(sk, p[0], p[1]), line(sk, p[1], p[2]), line(sk, p[2], p[3]), line(sk, p[3], p[0])];
  con(sk, { type: 'horizontal', e: l[0] }); con(sk, { type: 'vertical', e: l[1] });
  con(sk, { type: 'horizontal', e: l[2] }); con(sk, { type: 'vertical', e: l[3] });
  if (fixed) {
    con(sk, { type: 'fix', p: p[0] });
    con(sk, { type: 'distance', p1: p[0], p2: p[1], dir: 'aligned', value: 40 });
    con(sk, { type: 'distance', p1: p[1], p2: p[2], dir: 'aligned', value: 20 });
  }
  return { p, l };
}
const arcs = (sk: SketchData) => Object.values(sk.entities).filter(e => e.type === 'arc') as { type: 'arc'; c: string; p1: string; p2: string }[];
const setDimValue = (sk: SketchData, id: string, v: number) => { const c = sk.constraints.find(c => c.id === id) as { value: number }; c.value = v; };

await test('avrunda: fri rektangel, ett hörn', () => {
  const sk = emptySketch();
  const { p } = axisRect(sk, false);
  const dof0 = solver.solve(sk).dof;
  assert.equal(defaultCornerSize(sk, cornersFor(sk, [p[2]], []), 'fillet'), 5);
  const dim = cutCorners(sk, [p[2]], 'fillet', 5)!;
  assert.ok(dim);
  assert.ok(!(p[2] in sk.points), 'hörnpunkten utan villkor tas bort');
  const r = solver.solve(sk);
  assert.ok(r.ok); assert.deepEqual(r.redundant, []); assert.equal(r.dof, dof0, 'samma frihetsgrader');
  const [a] = arcs(sk);
  const g = arcGeom(sk, a as never);
  near(g.r, 5); near(g.c.x, 35); near(g.c.y, 15); near(g.sweep, Math.PI / 2);
  assert.equal(findLoops(sk).loops.length, 1);
  setDimValue(sk, dim, 8);
  assert.ok(solver.solve(sk).ok); near(arcGeom(sk, arcs(sk)[0] as never).r, 8);
});

await test('avrunda: fullt definierad rektangel, alla hörn (virtuella hörn behåller måtten)', () => {
  const sk = emptySketch();
  const { p, l } = axisRect(sk, true);
  assert.equal(solver.solve(sk).dof, 0);
  const corners = cornersFor(sk, [], l);
  assert.equal(corners.length, 4);
  const dim = cutCorners(sk, corners.map(c => c.p), 'fillet', 4)!;
  let r = solver.solve(sk);
  assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(r.redundant, []); assert.equal(r.dof, 0, 'fortfarande fullt definierad');
  assert.ok(p[0] in sk.points && p[1] in sk.points && p[2] in sk.points, 'refererade hörn finns kvar');
  assert.equal(arcs(sk).length, 4);
  assert.equal(findLoops(sk).loops.length, 1);
  setDimValue(sk, dim, 6);
  r = solver.solve(sk);
  assert.ok(r.ok); assert.equal(r.dof, 0);
  for (const a of arcs(sk)) near(arcGeom(sk, a as never).r, 6);
  near(sk.points[p[2]].x, 40); near(sk.points[p[2]].y, 20);
  // Bredden ändras: hörnen följer med.
  setDimValue(sk, sk.constraints.find(c => c.type === 'distance' && c.p2 === p[1])!.id, 50);
  assert.ok(solver.solve(sk).ok);
  const xs = arcs(sk).map(a => sk.points[a.c].x).sort((a, b) => a - b);
  near(xs[0], 6); near(xs[3], 44);
});

await test('avrunda: hexagon (Lika-sidor på konstruktionscirkel)', () => {
  const sk = emptySketch();
  const c = pt(sk, 0, 0);
  const circ = newId(sk, 'e');
  sk.entities[circ] = { type: 'circle', c, r: 20, construction: true };
  const ps = [0, 1, 2, 3, 4, 5].map(i => pt(sk, 20 * Math.cos((i * Math.PI) / 3), 20 * Math.sin((i * Math.PI) / 3)));
  const ls = ps.map((q, i) => line(sk, q, ps[(i + 1) % 6]));
  for (const q of ps) con(sk, { type: 'onCurve', p: q, e: circ });
  for (let i = 1; i < 6; i++) con(sk, { type: 'equal', e1: ls[0], e2: ls[i] });
  const dof0 = solver.solve(sk).dof;
  assert.ok(cutCorners(sk, [ps[0]], 'fillet', 3));
  const r = solver.solve(sk);
  assert.ok(r.ok); assert.deepEqual(r.redundant, []); assert.equal(r.dof, dof0);
  // Sidorna är fortfarande lika långa (konstruktionslinjerna i full längd).
  for (const l of ls) near(dist2(sk, l), 20, 1e-6);
  assert.equal(findLoops(sk).loops.length, 1);
});

await test('fasa: två hörn, ett mått, lika ben', () => {
  const sk = emptySketch();
  const { p } = axisRect(sk, true);
  const dim = cutCorners(sk, [p[1], p[2]], 'chamfer', 3)!;
  let r = solver.solve(sk);
  assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(r.redundant, []); assert.equal(r.dof, 0);
  setDimValue(sk, dim, 5);
  r = solver.solve(sk);
  assert.ok(r.ok);
  const chamfers = Object.values(sk.entities).filter(e => e.type === 'line' && !e.construction && Math.abs(sk.points[e.p1].x - sk.points[e.p2].x) > 1e-6 && Math.abs(sk.points[e.p1].y - sk.points[e.p2].y) > 1e-6);
  assert.equal(chamfers.length, 2);
  for (const e of chamfers as { p1: string; p2: string }[]) near(Math.hypot(sk.points[e.p1].x - sk.points[e.p2].x, sk.points[e.p1].y - sk.points[e.p2].y), 5 * Math.SQRT2);
  assert.equal(findLoops(sk).loops.length, 1);
});

await test('avrunda: för stor radie och icke-hörn avvisas', () => {
  const sk = emptySketch();
  const { p } = axisRect(sk, false);
  assert.equal(cutCorners(sk, [p[0]], 'fillet', 25), null);
  const q = pt(sk, 60, 0); line(sk, p[1], q);
  assert.equal(cornersFor(sk, [p[1]], []).length, 0, 'tre linjer i punkten');
});
await test('avstånd punkt–cirkelkant: utanför, innanför och till en båge', () => {
  for (const [px, arc, want] of [[30, false, 13], [4, false, 7], [30, true, 13]] as const) {
    const sk = emptySketch();
    const c = pt(sk, 0, 0); con(sk, { type: 'fix', p: c });
    const e = newId(sk, 'e');
    if (arc) sk.entities[e] = { type: 'arc', c, p1: pt(sk, 10, 0), p2: pt(sk, 0, 10) };
    else sk.entities[e] = { type: 'circle', c, r: 10 };
    con(sk, { type: 'radius', e, value: 10 });
    const p = pt(sk, px, 0.5);
    con(sk, { type: 'pcdistance', p, e, value: 3 });
    assert.ok(solver.solve(sk).ok);
    near(Math.hypot(sk.points[p].x, sk.points[p].y), want);
    near(measure(sk, sk.constraints.at(-1)!)!, 3);
  }
});
await test('avstånd mellan cirkelkanter: bredvid, inuti och mot en båge', () => {
  for (const [x2, r2, arc, want] of [[40, 5, false, 17], [3, 4, false, 4], [40, 5, true, 17]] as const) {
    const sk = emptySketch();
    const c1 = pt(sk, 0, 0); con(sk, { type: 'fix', p: c1 });
    const a = newId(sk, 'e'); sk.entities[a] = { type: 'circle', c: c1, r: 10 }; con(sk, { type: 'radius', e: a, value: 10 });
    const c2 = pt(sk, x2, 0.5); con(sk, { type: 'hpoints', p1: c1, p2: c2 });
    const b = newId(sk, 'e');
    if (arc) sk.entities[b] = { type: 'arc', c: c2, p1: pt(sk, x2 + r2, 0.5), p2: pt(sk, x2, 0.5 + r2) };
    else sk.entities[b] = { type: 'circle', c: c2, r: r2 };
    con(sk, { type: 'radius', e: b, value: r2 });
    con(sk, { type: 'ccdistance', e1: a, e2: b, value: 2 });
    assert.ok(solver.solve(sk).ok);
    near(Math.hypot(sk.points[c2].x, sk.points[c2].y), want);
    near(measure(sk, sk.constraints.at(-1)!)!, 2);
  }
});
await test('avstånd cirkelkant–linje: ovanför, genom (flyttas ut), under och mot en båge', () => {
  for (const [y0, arc, want] of [[20, false, 12], [3, false, 12], [-20, false, -12], [20, true, 12]] as const) {
    const sk = emptySketch();
    const c = pt(sk, 0, 0); con(sk, { type: 'fix', p: c });
    const e = newId(sk, 'e');
    if (arc) sk.entities[e] = { type: 'arc', c, p1: pt(sk, 10, 0), p2: pt(sk, 0, 10) };
    else sk.entities[e] = { type: 'circle', c, r: 10 };
    con(sk, { type: 'radius', e, value: 10 });
    const a = pt(sk, -30, y0), l = line(sk, a, pt(sk, 30, y0 + 0.3));
    con(sk, { type: 'horizontal', e: l });
    con(sk, { type: 'cldistance', e, l, value: 2 });
    assert.ok(solver.solve(sk).ok);
    near(sk.points[a].y, want);
    near(measure(sk, sk.constraints.at(-1)!)!, 2);
  }
});
await test('vinkel mot X-axeln: ovanför och under axeln', () => {
  for (const [y, v, want] of [[5, 30, 30], [-5, -30, -30], [5, 135, 135]] as const) {
    const sk = emptySketch();
    const a = pt(sk, 0, 0); con(sk, { type: 'fix', p: a });
    const b = pt(sk, 10, y); const l = line(sk, a, b);
    con(sk, { type: 'distance', p1: a, p2: b, dir: 'aligned', value: 10 });
    con(sk, { type: 'xangle', e: l, value: v });
    assert.ok(solver.solve(sk).ok);
    near((Math.atan2(sk.points[b].y, sk.points[b].x) * 180) / Math.PI, want, 1e-6);
    near(measure(sk, sk.constraints.at(-1)!)!, Math.abs(want), 1e-6);
  }
});
console.log(`${n} lösartester ok`);
