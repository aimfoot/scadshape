// One model, two ways of working: the start card's "Copy prompt" (with the printer from Settings, and
// on to Code) and "Paste code" (an answer with text and ``` fences → only the code, as the model, in
// Code), pasting a whole answer straight into the code, editing the code (Render puts it in the
// model), a drawn model turned into code by an edit (and back with Draw's undo), and pasting when the
// model is not empty (a new model).
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
const work = () => page.evaluate(() => document.body.dataset.work);
const feats = () => page.evaluate(() => window.__scadshape.doc.features.map(f => f.type).join());
const docCode = () => page.evaluate(() => window.__scadshape.doc.features[0]?.code);
const settled = () => page.waitForFunction(() => /\d+ triangles|Error/.test(document.querySelector('#status').textContent) && !/Rendering/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('scadshape.lang', 'en'); });
await page.reload();
await page.waitForFunction(() => /Start with Sketch/.test(document.querySelector('#status').textContent));
assert.equal(await work(), 'draw');
assert.ok(await page.isVisible('#startCard .ai-start'));
assert.equal(await page.$$eval('#workMode [data-work]', bs => bs.map(b => b.textContent).join()), 'Draw,Code');
await page.screenshot({ path: `${out}/a-start.png` });

// 1. Copy prompt: on to Code, which has the prompt and Convert next to Measure
await page.click('#startPrompt');
await page.waitForFunction(() => /Prompt copied/.test(document.querySelector('#partToast').textContent));
const prompt = await page.evaluate(() => navigator.clipboard.readText());
assert.match(prompt, /^Write an OpenSCAD model for me\. I will open it in scadshape \(OpenSCAD 2026\.10\.15, Manifold backend\)\./);
assert.match(prompt, /print on Bambu Lab A1 mini \(180 × 180 × 180 mm\)/);
assert.match(prompt, /\n\nWhat I want: $/);
assert.equal(await work(), 'code');
assert.ok(await page.isHidden('#startCard'));
for (const id of ['#btnMeasure', '#btnPrompt', '#btnConvert', '#code', '#btnRunCode']) assert.ok(await page.isVisible(id), id);
for (const id of ['#btnNewSketch', '#btnParams', '#btnDocUndo']) assert.ok(await page.isHidden(id), id);
await page.click('#workMode [data-work=draw]');
await page.waitForTimeout(300);
assert.ok(await page.isVisible('#startCard .ai-start'));
assert.ok(await page.isHidden('#codePanel'));

// 2. The AI's answer, copied whole (text around the code) → Paste code: the model, in Code
const answer = 'Sure! Here is a parametric box:\n\n```openscad\n// Parametric box\n// Box: open on top, 2 mm walls all round.\nwidth = 40; // outer width\ndepth = 30;\nheight = 12;\nwall = 2;\ndifference() {\n  cube([width, depth, height]);\n  translate([wall, wall, wall]) cube([width - 2*wall, depth - 2*wall, height]);\n}\n```\n\nChange `width` to make it bigger.';
await page.evaluate(t => navigator.clipboard.writeText(t), answer);
await page.click('#startPaste');
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
assert.equal(await toast(), 'Code pasted');
assert.equal(await work(), 'code');
const box = await page.inputValue('#code');
assert.match(box, /^\/\/ Parametric box\n\/\/ Box: open on top, 2 mm walls all round.\nwidth = 40;/); assert.doesNotMatch(box, /Sure!|```|Change `width`/);
assert.equal(await feats(), 'code'); assert.equal(await docCode(), box, 'the code is the model');
assert.match(await page.textContent('#status'), /triangles$/, 'no problems');
await page.screenshot({ path: `${out}/a-pasted.png` });

// What the code says it is (its top comment) above the status: the title, a tap opens the parts, × hides it.
assert.ok(await page.isVisible('#modelNote'));
assert.equal(await page.textContent('#modelNoteTitle'), 'Parametric box');
await page.click('#modelNoteToggle');
assert.equal(await page.textContent('#modelNoteBody'), 'Box: open on top, 2 mm walls all round.');
await page.screenshot({ path: `${out}/a-note.png` });
await page.click('#modelNoteClose');
assert.ok(await page.isHidden('#modelNote'));

// 3. A whole answer pasted straight into the code: only the code goes in; Render puts it in the model
await page.evaluate(() => { const c = document.querySelector('#code'); c.focus(); c.select(); });
await page.evaluate(t => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  document.querySelector('#code').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, 'Try this:\n```\ncylinder(d = 20, h = 5);\n```');
assert.equal(await page.inputValue('#code'), 'cylinder(d = 20, h = 5);\n');
assert.equal(await toast(), 'Only the code from the answer was pasted');
assert.equal(await docCode(), box, 'not in the model before Render');
assert.ok(await page.$eval('#btnRunCode', b => b.classList.contains('stale')));
await page.click('#btnRunCode');
await page.waitForTimeout(300);
await settled();
assert.equal(await docCode(), 'cylinder(d = 20, h = 5);\n');
assert.ok(!(await page.$eval('#btnRunCode', b => b.classList.contains('stale'))));

// 4. Edits go into the model when going back to Draw too, and Draw shows it as one code feature
await page.fill('#code', 'cylinder(d = 30, h = 5);\n');
await page.click('#workMode [data-work=draw]');
await page.waitForTimeout(300);
assert.equal(await docCode(), 'cylinder(d = 30, h = 5);\n');
assert.equal(await feats(), 'code');

// 4b. Code's Paste: the clipboard's code (an AI's corrected file, fences and all) replaces the code, in the model, rendered
await page.click('#workMode [data-work=code]');
await page.waitForTimeout(300);
assert.ok(await page.isVisible('#btnPasteCode'));
await page.evaluate(() => navigator.clipboard.writeText('Fixed:\n```openscad\ncylinder(d = 12, h = 6);\n```'));
await page.click('#btnPasteCode');
await page.waitForFunction(() => /Code pasted/.test(document.querySelector('#partToast').textContent));
assert.equal(await page.inputValue('#code'), 'cylinder(d = 12, h = 6);\n');
assert.equal(await docCode(), 'cylinder(d = 12, h = 6);\n');
await settled();
// Not code on the clipboard: the code stays as it is
await page.evaluate(() => navigator.clipboard.writeText('Sorry, no.'));
await page.click('#btnPasteCode');
await page.waitForFunction(() => /^The clipboard has no OpenSCAD code/.test(document.querySelector('#partToast').textContent));
assert.equal(await page.inputValue('#code'), 'cylinder(d = 12, h = 6);\n');
await page.click('#workMode [data-work=draw]');
await page.waitForTimeout(300);

// 5. A drawn model: Code shows its code; an edit makes it code, Draw's undo brings the sketches back
await page.click('#btnStart');
await page.click('#startExamples .example');
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const drawn = await feats();
assert.ok(drawn.split(',').length > 2, drawn);
await page.click('#workMode [data-work=code]');
await page.waitForTimeout(300);
const generated = await page.inputValue('#code');
assert.match(generated, /^\/\/ Made with scadshape/);
await page.click('#workMode [data-work=draw]'); // no edit: still drawn
await page.waitForTimeout(300);
assert.equal(await feats(), drawn);
await page.click('#workMode [data-work=code]');
await page.waitForTimeout(300);
await page.fill('#code', `${generated}\ntranslate([0, 0, 40]) cube(5);\n`);
await page.click('#btnRunCode');
await page.waitForFunction(() => /now code/.test(document.querySelector('#partToast').textContent));
await settled();
assert.equal(await feats(), 'code');
await page.click('#workMode [data-work=draw]');
await page.waitForTimeout(300);
await page.click('#btnDocUndo');
await page.waitForTimeout(300);
assert.equal(await feats(), drawn, 'undo brings the sketches back');

// 6. Pasting when the model is not empty: a new model, named by the code's top comment
const before = await page.textContent('#projName');
await page.evaluate(t => navigator.clipboard.writeText(t), answer);
await page.click('#btnStart');
await page.click('#startPaste');
// (step 2 already named the first model so: this one gets a name of its own)
await page.waitForFunction(b => /^Parametric box \S+$/.test(document.querySelector('#projName').textContent) && document.querySelector('#projName').textContent !== b, before);
await settled();
assert.equal(await feats(), 'code');

// 7. Nothing usable on the clipboard: paste by hand in Code
await page.evaluate(() => navigator.clipboard.writeText('Sorry, I cannot help with that.'));
await page.click('#workMode [data-work=draw]');
await page.click('#btnStart');
await page.click('#startPaste');
await page.waitForFunction(() => /^The clipboard has no OpenSCAD code/.test(document.querySelector('#partToast').textContent));
assert.equal(await work(), 'code');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
