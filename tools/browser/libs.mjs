// Libraries: BOSL2 is loaded only when the code uses it, and renders in Custom code.
// node libs.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const libRequests = [];
page.on('request', r => r.url().includes('/libs/') && libRequests.push(r.url().split('/').pop()));
const status = () => page.textContent('#status');
const renderCode = async code => {
  await page.fill('#code', code); // renders by itself when the typing pauses (0.8 s)
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent) && !/Cancel/.test(document.querySelector('#btnRender').textContent), null, { timeout: 90000 });
  return status();
};
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
await page.selectOption('#source', 'cube'); await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent));
assert.deepEqual(libRequests, [], 'no library before it is used');
if (await page.isHidden('#codePanel')) await page.click('#btnCode');

// BOSL2: rounded cube and an M6 screw (screws.scad fetches more files from the library)
let st = await renderCode('include <BOSL2/std.scad>\ncuboid([40, 30, 10], rounding = 2, $fn = 24);');
assert.match(st, /triangles/, st); assert.deepEqual(libRequests, ['BOSL2.json']);
console.log('cuboid:', st);
st = await renderCode('include <BOSL2/std.scad>\ninclude <BOSL2/screws.scad>\nscrew("M6", length = 16, $fn = 32);');
assert.match(st, /triangles/, st); assert.equal(libRequests.length, 1, 'fetched only once');
console.log('screw:', st);
await page.screenshot({ path: `${out}/l-bosl2.png` });
// Round-Anything and dotSCAD (as on the server: dotSCAD/src/…)
st = await renderCode('use <Round-Anything/polyround.scad>\nlinear_extrude(5) polygon(polyRound([[0,0,3],[30,0,3],[30,20,3],[0,20,3]], 12));');
assert.match(st, /triangles/, st); console.log('Round-Anything:', st);
st = await renderCode('use <dotSCAD/src/line2d.scad>\nuse <dotSCAD/src/arc.scad>\nlinear_extrude(3) { line2d([0, 0], [30, 10], width = 2); arc(radius = 10, angle = [0, 120], width = 2); }');
assert.match(st, /triangles/, st); console.log('dotSCAD:', st);
// Gridfinity: the whole gridfinity-rebuilt-bins.scad pasted in (relative include <src/core/…>)
const bins = readFileSync(new URL('../../vendor/libraries/gridfinity-rebuilt-openscad/gridfinity-rebuilt-bins.scad', import.meta.url), 'utf8');
st = await renderCode(bins);
assert.match(st, /triangles/, `${st}\n${await page.textContent('#log')}`); console.log('gridfinity-bins:', st);
await page.screenshot({ path: `${out}/l-gridfinity.png` });
assert.deepEqual([...libRequests].sort(), ['BOSL2.json', 'Round-Anything.json', 'dotSCAD.json', 'gridfinity-rebuilt-openscad.json']);

// A library that does not exist gives OpenSCAD's warning in the log, not a crash
st = await renderCode('include <DoesNotExist/std.scad>\ncube(5);');
assert.match(await page.textContent('#log'), /Can't find include file/);

// Open a .scad file from ☰ → the model → Open file: becomes Custom code and renders
await page.selectOption('#source', 'model');
await page.waitForTimeout(500);
if (await page.isVisible('#codePanel')) await page.click('#btnCode');
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.click('#btnProjects'); await page.waitForSelector('#projDlg[open]');
assert.equal(await page.getAttribute('#projFile', 'accept'), null, 'no filter that greys out .scad');
const scadPath = new URL('../../vendor/libraries/BOSL2/LICENSE', import.meta.url).pathname; // wrong file type first
await page.setInputFiles('#projFile', scadPath);
await page.waitForSelector('#partToast:not([hidden])'); assert.match(await page.textContent('#partToast'), /neither/);
await page.setInputFiles('#projFile', { name: 'screw.scad', mimeType: 'application/octet-stream', buffer: Buffer.from('include <BOSL2/std.scad>\ncyl(d = 12, h = 20, chamfer = 1, $fn = 48);') });
await page.waitForFunction(() => document.querySelector('#source').value === 'custom');
assert.ok(await page.isVisible('#codePanel')); assert.match(await page.inputValue('#code'), /cyl\(d = 12/);
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent) && !/Rendering/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
console.log('opened .scad:', await status());
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
