// Enhetstester för SVG-import (svg.ts): tolkning, enheter, transformer, bågar, utplattning och lösaren.
import { setLang } from '../src/i18n';
import assert from 'node:assert/strict';
import { addShapesToSketch, parseSvg, placeDrawing } from '../src/svg';
import { emptySketch, arcGeom, type SketchData } from '../src/sketch/model';
import { findLoops } from '../src/sketch/regions';
import { loadSolver } from '../src/sketch/solver';
setLang('sv');

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
let n = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log('ok', name); };
const solver = await loadSolver(process.env.WASM);

const svg = (body: string, attrs = 'width="100mm" height="50mm" viewBox="0 0 100 50"') =>
  `<?xml version="1.0"?>\n<!-- Inkscape -->\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
function sketchOf(xml: string, opts: { origin?: 'corner' | 'center'; scale?: number; lock?: boolean } = {}) {
  const d = parseSvg(xml);
  const sk = emptySketch();
  const stats = addShapesToSketch(sk, placeDrawing(d, opts.scale ?? 1, opts.origin ?? 'corner'), { lock: opts.lock });
  return { d, sk, stats };
}
const ents = (sk: SketchData, type: string) => Object.values(sk.entities).filter(e => e.type === type);
const regions = (sk: SketchData) => findLoops(sk).loops.length;
const xs = (sk: SketchData) => Object.values(sk.points).map(p => p.x);
const ys = (sk: SketchData) => Object.values(sk.points).map(p => p.y);

await test('rektangel i mm, y uppåt, nedre vänstra hörnet i origo', () => {
  const { d, sk, stats } = sketchOf(svg('<rect x="10" y="10" width="30" height="20" style="fill:none"/>'));
  near(d.min.x, 10); near(d.max.x, 40); near(d.min.y, -30); near(d.max.y, -10);
  assert.deepEqual(stats, { points: 4, lines: 4, arcs: 0, circles: 0 });
  near(Math.min(...xs(sk)), 0); near(Math.max(...xs(sk)), 30); near(Math.min(...ys(sk)), 0); near(Math.max(...ys(sk)), 20);
  assert.equal(regions(sk), 1);
});

await test('cirkel, mitten i origo, skala 2', () => {
  const { sk } = sketchOf(svg('<circle cx="50" cy="25" r="4"/>'), { origin: 'center', scale: 2 });
  const [c] = ents(sk, 'circle') as { c: string; r: number }[];
  near(c.r, 8); near(sk.points[c.c].x, 0); near(sk.points[c.c].y, 0);
  assert.equal(regions(sk), 1);
});

await test('px utan viewBox (96 dpi) och tum', () => {
  let { d } = sketchOf(svg('<rect width="96" height="48"/>', ''));
  near(d.max.x - d.min.x, 25.4);
  ({ d } = sketchOf(svg('<rect width="1" height="1"/>', 'width="2in" height="2in" viewBox="0 0 2 2"')));
  near(d.max.x - d.min.x, 25.4);
});

await test('halvcirkel med båge (A) och kompakta flaggor', () => {
  for (const dPath of ['M 0 20 A 5 5 0 0 1 10 20 Z', 'M0 20a5 5 0 0110 0z']) {
    const { sk, stats } = sketchOf(svg(`<path d="${dPath}"/>`));
    assert.deepEqual(stats, { points: 3, lines: 1, arcs: 1, circles: 0 }, dPath);
    const [a] = ents(sk, 'arc');
    near(arcGeom(sk, a as never).r, 5); near(arcGeom(sk, a as never).sweep, Math.PI);
    assert.equal(regions(sk), 1, dPath);
  }
});

await test('transformer: translate/scale behåller cirkeln, skew gör den till kurva', () => {
  let { sk } = sketchOf(svg('<g transform="translate(10,5) scale(2)"><circle cx="0" cy="0" r="3"/></g>'));
  near((ents(sk, 'circle')[0] as { r: number }).r, 6);
  ({ sk } = sketchOf(svg('<g transform="rotate(30 50 25)"><rect x="40" y="20" width="20" height="10" rx="2"/></g>')));
  assert.equal(ents(sk, 'arc').length, 4, 'rundad rektangel, roterad: fyra bågar');
  assert.equal(regions(sk), 1);
  ({ sk } = sketchOf(svg('<g transform="skewX(20)"><circle cx="20" cy="20" r="5"/></g>')));
  assert.equal(ents(sk, 'circle').length, 0);
  assert.ok(ents(sk, 'line').length >= 16, 'snedvriden cirkel = utplattad kurva');
  assert.equal(regions(sk), 1);
});

await test('Bézier plattas ut inom toleransen', () => {
  // Cirkel r = 20 av fyra kubiska Bézier (k = 0,5523).
  const k = 20 * 0.5522847498;
  const dp = `M 70 25 C 70 ${25 + k} ${50 + k} 45 50 45 C ${50 - k} 45 30 ${25 + k} 30 25 C 30 ${25 - k} ${50 - k} 5 50 5 C ${50 + k} 5 70 ${25 - k} 70 25 Z`;
  const { sk, stats } = sketchOf(svg(`<path d="${dp}"/>`), { origin: 'center' });
  assert.ok(stats.lines > 30 && stats.lines < 200, String(stats.lines));
  for (const p of Object.values(sk.points)) near(Math.hypot(p.x, p.y), 20, 0.03);
  assert.equal(regions(sk), 1);
});

await test('ellips, polygon, polyline, line, Q/T/S, H/V och relativa kommandon', () => {
  const { sk } = sketchOf(svg(
    '<ellipse cx="20" cy="20" rx="8" ry="4"/><polygon points="40,10 50,10 45,20"/><polyline points="60,10 70,10 70,20"/>' +
    '<line x1="80" y1="10" x2="90" y2="10"/><path d="M 10 40 q 5 -5 10 0 t 10 0 s 5 5 10 0 h 5 v 5 l -35 0 z"/>',
  ));
  assert.equal(regions(sk), 3, 'ellips, triangel och den slutna banan');
});

await test('text och bilder hoppas över, dolt och defs räknas inte', () => {
  const { d } = sketchOf(svg('<defs><rect width="5" height="5"/></defs><text x="1" y="1">Hej</text><image href="a.png"/><rect width="1" height="1" style="display:none"/><rect x="2" width="3" height="3"/>'));
  assert.deepEqual(d.ignored, { text: 1, image: 1 });
  assert.equal(d.shapes.length, 1);
});

await test('lösaren: fri och låst geometri med avrundade koordinater', () => {
  const body = '<path d="M 0 0 A 5.001 5.001 0 0 1 10.0003 0.0002 L 10 10 L 0 10 Z"/><rect x="20" y="0" width="20" height="10" rx="3"/><circle cx="50" cy="5" r="2"/>';
  for (const lock of [false, true]) {
    const { sk } = sketchOf(svg(body), { lock });
    const r = solver.solve(sk);
    assert.ok(r.ok, `lock=${lock}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.redundant, []);
    if (lock) assert.equal(r.dof, 1, 'bara cirkelns radie är fri');
    assert.equal(regions(sk), 3);
  }
});

await test('inte en SVG', () => {
  assert.throws(() => parseSvg('hej'));
  assert.throws(() => parseSvg('{"format":"scadshape"}'));
});

console.log(`${n} svg-tester ok`);
