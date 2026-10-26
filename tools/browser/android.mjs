// The Android app's bridge (src/android.ts, src/ui/android.ts) with a fake ScadshapeAndroid.
// Run against the app's own files:
// cd android && ./build.sh
// python3 -I -m http.server 8799 --bind 127.0.0.1 --directory android/build/assets/www
// node android.mjs http://127.0.0.1:8799/ [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];

/** Binary STL: cube 20 mm. */
function cubeStl(s = 20) {
  const q = [[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
    [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], [[1,0,0],[1,1,0],[1,1,1],[1,0,1]]];
  const tris = q.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c * s, 84 + i * 50 + 12 + k * 12 + j * 4))));
  return buf;
}
const pending = (name, bytes) => JSON.stringify({ name, data: Buffer.from(bytes).toString('base64') });

const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
// The bridge that MainActivity adds; a .scad file is already waiting (as when the app is started
// from a file manager).
await ctx.addInitScript(first => {
  window.ScadshapeAndroid = {
    calls: [],
    pending: first,
    saveFile(name, mime, b64) { this.calls.push({ fn: 'save', name, mime, head: atob(b64.slice(0, 4)), bytes: atob(b64).length }); return ''; },
    shareFile(name, mime, b64) { this.calls.push({ fn: 'share', name, mime, bytes: atob(b64).length }); return ''; },
    setBars(color, dark) { this.calls.push({ fn: 'bars', color, dark }); },
    takeFile() { const p = this.pending; this.pending = ''; return p; },
  };
}, pending('cube.scad', Buffer.from('cube([30, 20, 10]);\n')));

const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const calls = fn => page.evaluate(fn => window.ScadshapeAndroid.calls.filter(c => c.fn === fn), fn);
const waitRendered = () => page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

await page.goto(url);

// 1. The file waiting at start is opened as a model in Code and rendered.
await waitRendered();
assert.equal(await page.evaluate(() => window.__scadshape.work), 'code');
assert.equal(await page.evaluate(() => window.__scadshape.doc.features.map(f => f.type).join()), 'code');
console.log('waiting .scad →', await page.textContent('#status'));

// 2. The system bars get the toolbar's color (light theme).
const bars = await calls('bars');
assert.ok(bars.length >= 1 && bars.at(-1).dark === false, JSON.stringify(bars));
console.log('system bars:', bars.at(-1));

// 3. Export: Download saves via the app (3MF = zip, "PK"), Share is shown and goes via the app.
await page.click('#btnExport');
await page.waitForSelector('#exDownload:not([disabled])', { timeout: 60000 });
assert.ok(await page.isVisible('#exShare'), 'Share should be visible in the app');
await page.click('#exDownload');
await page.waitForFunction(() => window.ScadshapeAndroid.calls.some(c => c.fn === 'save'));
const [saved] = await calls('save');
assert.match(saved.name, /\.3mf$/);
assert.ok(saved.head.startsWith('PK'), 'a 3MF is a zip');
console.log('saved:', saved);
await page.click('#exShare');
await page.waitForFunction(() => window.ScadshapeAndroid.calls.some(c => c.fn === 'share'));
console.log('shared:', (await calls('share'))[0]);
await page.screenshot({ path: `${out}/android-export.png` });

// 4. Back closes the dialog; then whatever is open until nothing is left (→ false: the app goes to
// the background).
assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
assert.equal(await page.evaluate(() => document.querySelector('#exportDlg').open), false);
let n = 0;
while (await page.evaluate(() => window.scadshapeBack())) assert.ok(++n < 10, 'back should run out');
console.log(`back: the dialog + ${n} more, then false`);

const openSettings = async () => {
  if (await page.evaluate(() => document.querySelector('#settingsDlg').open)) return;
  await page.click('#btnSettings');
};
const closeSettings = () => page.evaluate(() => document.querySelector('#settingsDlg').close());
// 4b. Back in a licence text in "About" → the list; once more → the dialog closes.
await openSettings();
await page.click('#btnAbout');
await page.click('#aboutLicense');
await page.waitForFunction(() => /GNU GENERAL PUBLIC LICENSE/.test(document.querySelector('#aboutTextBody').textContent));
assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
assert.ok(await page.isVisible('#aboutMain'), 'back should show the list');
assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
assert.equal(await page.evaluate(() => document.querySelector('#aboutDlg').open), false);
while (await page.evaluate(() => window.scadshapeBack()));
console.log('back in About: licence text → list → closed');

// 5. Back in sketch mode = Done.
await page.evaluate(() => document.querySelector('#btnNewSketch')?.click());
if (await page.isVisible('#planeDlg')) {
  await page.click('#planeDlg [data-plane="XY"]');
}
if (await page.evaluate(() => document.body.dataset.mode) === 'sketch') {
  assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'part');
  console.log('back in sketch mode → part mode');
} else console.log('(sketch mode skipped: could not enter it)');

// 6. An STL shared to the app while it is open: the import panel opens → OK → imported body.
await page.evaluate(p => { window.ScadshapeAndroid.pending = p; window.scadshapeOpenPending(); }, pending('cube.stl', cubeStl()));
await page.waitForSelector('#featPanel:not([hidden])', { timeout: 30000 });
assert.match(await page.textContent('#fpTitle'), /Imported body|cube/);
await page.click('#fpOk');
await page.waitForFunction(() => window.__scadshape.doc.features.some(f => f.type === 'mesh'), null, { timeout: 30000 });
await waitRendered();
console.log('shared STL →', await page.textContent('#status'));

// 7. Dark theme on the phone → light icons in the system bars.
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForFunction(() => window.ScadshapeAndroid.calls.filter(c => c.fn === 'bars').at(-1).dark === true);
console.log('dark theme:', (await calls('bars')).at(-1));
await page.screenshot({ path: `${out}/android-dark.png` });

// 8. No benchmark button (developer tool) in the app build.
assert.equal(await page.$('#btnBench'), null, 'the benchmark button should not exist in the app');

// 9. No service worker in the app.
assert.equal(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0), 0);

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
if (errors.length) process.exit(1);
