// Code from an AI chat: the start card's "Copy prompt" (with the printer from Settings) and "Paste
// code" (an answer with text and ``` fences → only the code, in Custom code, rendered), and pasting a
// whole answer straight into the code, and Clear (with its Undo).
// node aiflow.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
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
const toast = () => page.textContent('#partToast');

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
assert.ok(await page.isVisible('#startCard .ai-start'));
await page.screenshot({ path: `${out}/a-start.png` });

// 1. Copy prompt
await page.click('#startPrompt');
await page.waitForFunction(() => /Prompt copied/.test(document.querySelector('#partToast').textContent));
const prompt = await page.evaluate(() => navigator.clipboard.readText());
assert.match(prompt, /^Write an OpenSCAD model for me\. I will open it in scadshape \(OpenSCAD 2026\.10\.15, Manifold backend\)\./);
assert.match(prompt, /print on Bambu Lab A1 mini \(180 × 180 × 180 mm\)/);
assert.match(prompt, /\n\nWhat I want: $/);

// 2. The AI's answer, copied whole (text around the code) → Paste code
const answer = 'Sure! Here is a parametric box:\n\n```openscad\n// Parametric box\n// Box: open on top, 2 mm walls all round.\nwidth = 40; // outer width\ndepth = 30;\nheight = 12;\nwall = 2;\ndifference() {\n  cube([width, depth, height]);\n  translate([wall, wall, wall]) cube([width - 2*wall, depth - 2*wall, height]);\n}\n```\n\nChange `width` to make it bigger.';
await page.evaluate(t => navigator.clipboard.writeText(t), answer);
await page.click('#startPaste');
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.equal(await toast(), 'Code pasted');
const st = await page.evaluate(() => ({ source: document.querySelector('#source').value, code: document.querySelector('#code').value, card: document.querySelector('#startCard').hidden, panel: document.querySelector('#codePanel').hidden }));
assert.deepEqual([st.source, st.card, st.panel], ['custom', true, false]);
assert.match(st.code, /^\/\/ Parametric box\n\/\/ Box: open on top, 2 mm walls all round.\nwidth = 40;/); assert.doesNotMatch(st.code, /Sure!|```|Change `width`/);
assert.match(await page.textContent('#status'), /triangles$/, 'no problems');
await page.screenshot({ path: `${out}/a-pasted.png` });

// What the code says it is (its top comment) above the status: the title, a tap opens the parts, × hides it.
assert.ok(await page.isVisible('#modelNote'));
assert.equal(await page.textContent('#modelNoteTitle'), 'Parametric box');
assert.ok(await page.isHidden('#modelNoteBody'));
await page.click('#modelNoteToggle');
assert.equal(await page.textContent('#modelNoteBody'), 'Box: open on top, 2 mm walls all round.');
await page.screenshot({ path: `${out}/a-note.png` });
await page.click('#modelNoteClose');
assert.ok(await page.isHidden('#modelNote'));

// The code bar has the prompt too
assert.ok(await page.isVisible('#btnPrompt'));

// 3. A whole answer pasted straight into the code: only the code goes in
await page.evaluate(() => { const c = document.querySelector('#code'); c.focus(); c.select(); });
await page.evaluate(t => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  document.querySelector('#code').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, 'Try this:\n```\ncylinder(d = 20, h = 5);\n```');
assert.equal(await page.inputValue('#code'), 'cylinder(d = 20, h = 5);\n');
assert.equal(await toast(), 'Only the code from the answer was pasted');

// Clear: empties the code; the button is Undo for a while and brings it back; typing ends that
const clearBtn = () => page.evaluate(() => { const b = document.querySelector('#btnClearCode'); return { text: b.textContent, undo: b.classList.contains('undo'), label: b.getAttribute('aria-label') }; });
assert.deepEqual(await clearBtn(), { text: '', undo: false, label: 'Clear the code' });
await page.screenshot({ path: `${out}/a-clear.png` });
await page.tap('#btnClearCode');
assert.equal(await page.inputValue('#code'), '');
assert.equal(await toast(), 'Code cleared – tap Undo to get it back');
assert.deepEqual(await clearBtn(), { text: 'Undo', undo: true, label: 'Clear the code' });
await page.screenshot({ path: `${out}/a-cleared.png` });
await page.tap('#btnClearCode');
assert.equal(await page.inputValue('#code'), 'cylinder(d = 20, h = 5);\n');
assert.equal((await clearBtn()).undo, false);
await page.tap('#btnClearCode');
await page.focus('#code');
await page.keyboard.type('cube(5);');
assert.equal((await clearBtn()).undo, false, 'typed: no undo any more');
// The code's own undo still has it (typing can be more than one undo step)
for (let i = 0; i < 4 && (await page.inputValue('#code')) !== 'cylinder(d = 20, h = 5);\n'; i++) await page.keyboard.press('Control+z');
assert.equal(await page.inputValue('#code'), 'cylinder(d = 20, h = 5);\n');

// 4. Nothing usable on the clipboard: paste by hand
await page.evaluate(() => navigator.clipboard.writeText('Sorry, I cannot help with that.'));
await page.selectOption('#source', 'model');
await page.waitForTimeout(300);
await page.click('#btnTree'); await page.click('#btnStart');
await page.click('#startPaste');
await page.waitForFunction(() => /^The clipboard has no OpenSCAD code/.test(document.querySelector('#partToast').textContent));
assert.equal(await page.evaluate(() => document.querySelector('#source').value), 'custom');
assert.ok(await page.isVisible('#btnClearCode'));
// The model's own code is generated: no Clear
await page.selectOption('#source', 'model');
await page.waitForTimeout(300);
assert.ok(await page.isHidden('#btnClearCode'));

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
