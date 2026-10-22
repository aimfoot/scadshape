// Bibliotek: BOSL2 laddas bara när koden använder det, och renderas i Egen kod.
//   node libs.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const libRequests = [];
page.on('request', r => r.url().includes('/libs/') && libRequests.push(r.url().split('/').pop()));
const status = () => page.textContent('#status');
const renderCode = async code => {
  await page.fill('#code', code);
  await page.click('#btnRender');
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !/Renderar|Laddar/.test(document.querySelector('#status').textContent) && !/Avbryt/.test(document.querySelector('#btnRender').textContent), null, { timeout: 90000 });
  return status();
};
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'sv'); });
await page.reload();
await page.waitForFunction(() => /Börja med Skiss/.test(document.querySelector('#status').textContent));
await page.selectOption('#source', 'kub'); await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent));
assert.deepEqual(libRequests, [], 'inget bibliotek innan det används');
if (await page.isHidden('#codePanel')) await page.click('#btnCode');

// BOSL2: rundad kub och en M6-skruv (screws.scad hämtar fler filer ur biblioteket)
let st = await renderCode('include <BOSL2/std.scad>\ncuboid([40, 30, 10], rounding = 2, $fn = 24);');
assert.match(st, /trianglar/, st); assert.deepEqual(libRequests, ['BOSL2.json']);
console.log('cuboid:', st);
st = await renderCode('include <BOSL2/std.scad>\ninclude <BOSL2/screws.scad>\nscrew("M6", length = 16, $fn = 32);');
assert.match(st, /trianglar/, st); assert.equal(libRequests.length, 1, 'hämtas bara en gång');
console.log('skruv:', st);
await page.screenshot({ path: `${out}/l-bosl2.png` });
// Round-Anything och dotSCAD (som på servern: dotSCAD/src/…)
st = await renderCode('use <Round-Anything/polyround.scad>\nlinear_extrude(5) polygon(polyRound([[0,0,3],[30,0,3],[30,20,3],[0,20,3]], 12));');
assert.match(st, /trianglar/, st); console.log('Round-Anything:', st);
st = await renderCode('use <dotSCAD/src/line2d.scad>\nuse <dotSCAD/src/arc.scad>\nlinear_extrude(3) { line2d([0, 0], [30, 10], width = 2); arc(radius = 10, angle = [0, 120], width = 2); }');
assert.match(st, /trianglar/, st); console.log('dotSCAD:', st);
// Gridfinity: hela gridfinity-rebuilt-bins.scad inklistrad (relativa include <src/core/…>)
const bins = readFileSync(new URL('../../vendor/libraries/gridfinity-rebuilt-openscad/gridfinity-rebuilt-bins.scad', import.meta.url), 'utf8');
st = await renderCode(bins);
assert.match(st, /trianglar/, `${st}\n${await page.textContent('#log')}`); console.log('gridfinity-bins:', st);
await page.screenshot({ path: `${out}/l-gridfinity.png` });
assert.deepEqual([...libRequests].sort(), ['BOSL2.json', 'Round-Anything.json', 'dotSCAD.json', 'gridfinity-rebuilt-openscad.json']);

// Ett bibliotek som inte finns ger OpenSCADs varning i loggen, inte en krasch
st = await renderCode('include <Finnsinte/std.scad>\ncube(5);');
assert.match(await page.textContent('#log'), /Can't find include file/);

// Öppna en .scad-fil från ☰ → modellen → Öppna fil: blir Egen kod och renderas
await page.selectOption('#source', 'model');
await page.waitForTimeout(500);
if (await page.isVisible('#codePanel')) await page.click('#btnCode');
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.click('#btnProjects'); await page.waitForSelector('#projDlg[open]');
assert.equal(await page.getAttribute('#projFile', 'accept'), null, 'inget filter som gråar ut .scad');
const scadPath = new URL('../../vendor/libraries/BOSL2/LICENSE', import.meta.url).pathname; // fel filtyp först
await page.setInputFiles('#projFile', scadPath);
await page.waitForSelector('#partToast:not([hidden])'); assert.match(await page.textContent('#partToast'), /varken/);
await page.setInputFiles('#projFile', { name: 'skruv.scad', mimeType: 'application/octet-stream', buffer: Buffer.from('include <BOSL2/std.scad>\ncyl(d = 12, h = 20, chamfer = 1, $fn = 48);') });
await page.waitForFunction(() => document.querySelector('#source').value === 'egen');
assert.ok(await page.isVisible('#codePanel')); assert.match(await page.inputValue('#code'), /cyl\(d = 12/);
await page.waitForFunction(() => /\d+ trianglar/.test(document.querySelector('#status').textContent) && !/Renderar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
console.log('öppnad .scad:', await status());
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
