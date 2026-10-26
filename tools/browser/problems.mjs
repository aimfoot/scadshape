// The code's problem list: AI-written code with radians() (OpenSCAD has none) renders without the
// gears – the status bar says "1 problem", the list explains it on line 28 with its count, a tap goes
// to the line, and "Copy for AI" puts the text for the chat on the clipboard. Fix changes the code
// (undo works; after typing it refuses). Then a silent rotate(PI/4) and its fix, a part in mid-air,
// and a syntax error.
// node problems.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const status = () => page.evaluate(() => ({ text: document.querySelector('#status').textContent, cls: document.querySelector('#status').className }));
const fillCode = async c => { await page.fill('#code', c); await page.click('#btnRunCode'); await page.waitForTimeout(300); };
const waitRendered = async () => {
  await page.waitForTimeout(1200); // the code renders 0.8 s after typing
  await page.waitForFunction(() => !/Rendering|Loading/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
  return status();
};

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));

// Gear code where one helper uses radians(): everything else renders, the gears are missing.
const gears = `// Planet gear (shortened)
m = 1.5;
pa = 20;
$fn = 48;
function inv(a) = tan(a) - radians(a);
function polar(R, a) = [R*cos(a), R*sin(a)];
function half_ang(z, R) = 90/z + (inv(pa) - inv(acos(min(1, m*z/2*cos(pa)/R)))) * 180/PI;
module gear2d(z) polygon([for (k = [0:z-1], s = [-1, 1]) polar(m*z/2, k*360/z + s*half_ang(z, m*z/2))]);
cylinder(r = 30, h = 3);
translate([0, 0, 3]) linear_extrude(8) gear2d(14);
`;
// The model's code in Code (with "Copy for AI"); Render puts what is typed in the model.
await page.click('#workMode [data-work=code]');
await page.waitForTimeout(300);
await page.waitForSelector('#code', { state: 'visible' });
await fillCode(gears);
let st = await waitRendered();
assert.match(st.text, /triangles · 1 problem$/, st.text);
assert.match(st.cls, /warn/);
const rows = () => page.$$eval('#problemList li', ls => ls.map(l => ({ cls: l.className, text: l.querySelector('.row').textContent, fix: l.querySelector('.fix')?.textContent ?? null })));
let list = await rows();
assert.match(await page.textContent('#problemsTitle'), /^1 problem in the code$/);
assert.match(list[0].text, /^Line 5OpenSCAD has no radians\(\)\. Write x \* PI \/ 180 instead\.× \d+Ignoring unknown function 'radians'$/, list[0].text);
assert.equal(list[0].fix, 'Fixfunction inv(a) = tan(a) - a * PI / 180;');
assert.match(list.at(-1).text, /^\+ \d+ follow-on warnings about undefined values$/);
// One line under the code says there is a problem; "Full log" opens the list and OpenSCAD's log.
assert.ok(await page.isHidden('#problemList')); assert.ok(await page.isHidden('#log'));
assert.ok(await page.isVisible('#btnCopyProblems'));
await page.screenshot({ path: `${out}/p-line.png` });
await page.click('#btnFullLog');
assert.ok(await page.isVisible('#problemList')); assert.ok(await page.isVisible('#log'));
assert.match(await page.textContent('#log'), /Ignoring unknown function 'radians' in file \/in\.scad, line 5 × \d+/);
await page.screenshot({ path: `${out}/p-portrait.png` });

// Tap the problem: line 5 is selected in the code
await page.click('#problemList li:first-child .row');
const sel = await page.evaluate(() => { const c = document.querySelector('#code'); return c.value.slice(c.selectionStart, c.selectionEnd); });
assert.equal(sel, 'function inv(a) = tan(a) - radians(a);');

// Copy for AI
await page.click('#btnCopyProblems');
await page.waitForFunction(() => /Copied/.test(document.querySelector('#partToast')?.textContent ?? ''));
const clip = await page.evaluate(() => navigator.clipboard.readText());
assert.match(clip, /^My OpenSCAD code \(OpenSCAD 2026\.10\.15, Manifold backend; libraries available: BOSL2, Round-Anything, dotSCAD, gridfinity-rebuilt-openscad, MCAD\) gives these problems:\n\nLine 5: WARNING: Ignoring unknown function 'radians' \(\d+ times\)\n {4}function inv\(a\) = tan\(a\) - radians\(a\);\n {4}Hint: OpenSCAD has no radians\(\)\. Write x \* PI \/ 180 instead\.\n\n\(plus \d+ follow-on warnings about undefined values\)\n\nPlease fix the cause and keep what the model is for: don.t remove or fake a feature \(such as a thread\) just to make a warning go away\. Send the whole corrected file\.$/, clip);
console.log('copied for AI:\n' + clip.split('\n').map(l => '  | ' + l).join('\n'));

// Fix: the code is changed in place, renders without problems, and undo brings the old code back
await page.tap('#problemList .fix');
assert.equal(await page.inputValue('#code'), gears.replace('radians(a)', 'a * PI / 180'));
st = await waitRendered();
assert.doesNotMatch(st.text, /problem/); assert.doesNotMatch(st.cls, /warn|error/);
assert.equal(await page.textContent('#problemsTitle'), 'No problems in the code');
assert.ok(await page.isHidden('#btnCopyProblems'));
await page.focus('#code');
await page.keyboard.press('Control+z');
assert.equal(await page.inputValue('#code'), gears, 'undo after a fix');
await page.keyboard.press('Control+Enter'); // renders, like Render
st = await waitRendered();
assert.match(st.text, /1 problem$/);
// Typed since the render: the fix refuses instead of changing the wrong place
await page.evaluate(() => { const c = document.querySelector('#code'); c.value = '// new\n' + c.value; });
await page.tap('#problemList .fix');
await page.waitForFunction(() => /has changed/.test(document.querySelector('#partToast')?.textContent ?? ''));
assert.match(await page.inputValue('#code'), /^\/\/ new\n/);
assert.match(await page.inputValue('#code'), /radians\(a\)/);

// A silent mistake: OpenSCAD renders rotate(PI/4) without a word (it turns 0.785°), the app's check
// finds it and says so in the status bar and the text for the AI.
await fillCode('cube([30, 4, 4]);\nrotate([0, 0, PI / 4]) cube([30, 4, 4]);\n');
st = await waitRendered();
assert.match(st.text, /triangles · 1 problem$/, st.text);
list = await rows();
assert.match(list[0].text, /^Line 2rotate\(\) takes degrees, but this uses PI \(radians\)/);
assert.match(list[0].text, /rotate\(\[0, 0, PI \/ 4\]\)$/);
assert.equal(list[0].fix, 'Fixrotate([0, 0, 45]) cube([30, 4, 4]);');
await page.click('#btnCopyProblems');
await page.waitForTimeout(300);
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /\nLine 2: CHECK: rotate\(\) takes degrees, but this uses PI \(radians\): rotate\(90\), not rotate\(PI\/2\)\.\n {4}rotate\(\[0, 0, PI \/ 4\]\) cube\(\[30, 4, 4\]\);\n/);
await page.screenshot({ path: `${out}/p-check.png` });
await page.tap('#problemList .fix');
st = await waitRendered();
assert.equal(await page.inputValue('#code'), 'cube([30, 4, 4]);\nrotate([0, 0, 45]) cube([30, 4, 4]);\n');
assert.doesNotMatch(st.text, /problem/);

// A part in mid-air (an AI's screw-top jar: the cavity cut takes away the top the neck stands on).
// Found in the rendered model, so no line; the lid beside it is fine.
await fillCode(readFileSync(new URL('../../tests/ai-mistakes/screw-jar.scad', import.meta.url), 'utf8'));
st = await waitRendered();
assert.match(st.text, /triangles · 1 problem$/, st.text);
list = await rows();
assert.equal(list.length, 1);
assert.match(list[0].text, /^ModelSomething starts in mid-air at z = 35 mm \(x -12…12, y -12…12 mm\), 35 mm above the bottom of the model/, list[0].text);
await page.click('#btnCopyProblems');
await page.waitForTimeout(300);
assert.match(await page.evaluate(() => navigator.clipboard.readText()), /\nCHECK: Something starts in mid-air at z = 35 mm \(x -12…12, y -12…12 mm\)/);
await page.screenshot({ path: `${out}/p-floating.png` });

// A cut that removes nothing (an AI's ring "engraved" outside its surface): found by an extra check
// once the model stands still, and added to the list on its line.
await fillCode(readFileSync(new URL('../../tests/ai-mistakes/engrave-outside.scad', import.meta.url), 'utf8'));
st = await waitRendered();
assert.match(st.text, /triangles$/, st.text);
await page.waitForFunction(() => /1 problem$/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
list = await rows();
assert.equal(list.length, 1);
assert.match(list[0].text, /^Line 16The cut text\("love"\) doesn't touch the shape it is cut from, so it removes nothing/, list[0].text);
await page.screenshot({ path: `${out}/p-cut.png` });

// A syntax error (+=): fails, the list says why
await fillCode('x = 1;\nx += 1;\ncube(x);\n');
st = await waitRendered();
assert.match(st.cls, /error/);
assert.equal(st.text, 'Error · 1 problem');
list = await rows();
assert.equal(list.length, 1);
assert.match(list[0].text, /^Line 2OpenSCAD has no \+= or \+\+/);
assert.equal(list[0].cls, 'error');

// Code renders only when asked: Render is highlighted until then.
await page.fill('#code', 'cube(7);\n');
await page.waitForTimeout(1500);
assert.equal(st.text, (await status()).text, 'no render while writing');
assert.ok(await page.$eval('#btnRunCode', b => b.classList.contains('stale')));
await page.click('#btnRunCode');
await page.waitForTimeout(300);
st = await waitRendered();
assert.doesNotMatch(st.text, /problem/);
assert.ok(!(await page.$eval('#btnRunCode', b => b.classList.contains('stale'))));
await page.setViewportSize({ width: 915, height: 412 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/p-landscape.png` });

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
