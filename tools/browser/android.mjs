// Android-appens brygga (src/android.ts, src/ui/android.ts) med en låtsad ScadshapeAndroid.
// Kör mot appens egna filer:
//   cd android && ./build.sh
//   python3 -I -m http.server 8799 --bind 127.0.0.1 --directory android/build/assets/www
//   node android.mjs http://127.0.0.1:8799/ [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];

/** Binär STL: kub 20 mm. */
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

const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
// Bryggan som MainActivity lägger in; en .scad-fil väntar redan (som när appen startas från en filhanterare).
await ctx.addInitScript(first => {
  window.ScadshapeAndroid = {
    calls: [],
    pending: first,
    saveFile(name, mime, b64) { this.calls.push({ fn: 'save', name, mime, head: atob(b64.slice(0, 4)), bytes: atob(b64).length }); return ''; },
    shareFile(name, mime, b64) { this.calls.push({ fn: 'share', name, mime, bytes: atob(b64).length }); return ''; },
    setBars(color, dark) { this.calls.push({ fn: 'bars', color, dark }); },
    takeFile() { const p = this.pending; this.pending = ''; return p; },
  };
}, pending('kub.scad', Buffer.from('cube([30, 20, 10]);\n')));

const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const calls = fn => page.evaluate(fn => window.ScadshapeAndroid.calls.filter(c => c.fn === fn), fn);
const waitRendered = () => page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });

await page.goto(url);

// 1. Filen som väntade vid start öppnas som Egen kod och renderas.
await waitRendered();
assert.equal(await page.evaluate(() => window.__scadshape.source), 'egen');
console.log('väntande .scad →', await page.textContent('#status'));

// 2. Systemraderna får verktygsradens färg (ljust tema).
const bars = await calls('bars');
assert.ok(bars.length >= 1 && bars.at(-1).dark === false, JSON.stringify(bars));
console.log('systemrader:', bars.at(-1));

// 3. Export: Ladda ner sparar via appen (3MF = zip, "PK"), Dela visas och går via appen.
await page.click('#btnExport');
await page.waitForSelector('#exDownload:not([disabled])', { timeout: 60000 });
assert.ok(await page.isVisible('#exShare'), 'Dela ska synas i appen');
await page.click('#exDownload');
await page.waitForFunction(() => window.ScadshapeAndroid.calls.some(c => c.fn === 'save'));
const [saved] = await calls('save');
assert.match(saved.name, /\.3mf$/);
assert.ok(saved.head.startsWith('PK'), 'en 3MF är en zip');
console.log('sparad:', saved);
await page.click('#exShare');
await page.waitForFunction(() => window.ScadshapeAndroid.calls.some(c => c.fn === 'share'));
console.log('delad:', (await calls('share'))[0]);
await page.screenshot({ path: `${out}/android-export.png` });

// 4. Bakåt stänger dialogen; sedan det som är öppet tills inget är kvar (→ false: appen i bakgrunden).
assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
assert.equal(await page.evaluate(() => document.querySelector('#exportDlg').open), false);
let n = 0;
while (await page.evaluate(() => window.scadshapeBack())) assert.ok(++n < 10, 'bakåt ska ta slut');
console.log(`bakåt: dialogen + ${n} till, sedan false`);

// 4b. Bakåt i en licenstext i "Om" → listan; en gång till → dialogen stängs.
if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.click('#btnAbout');
await page.click('#aboutLicense');
await page.waitForFunction(() => /GNU GENERAL PUBLIC LICENSE/.test(document.querySelector('#aboutTextBody').textContent));
assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
assert.ok(await page.isVisible('#aboutMain'), 'bakåt ska visa listan');
assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
assert.equal(await page.evaluate(() => document.querySelector('#aboutDlg').open), false);
while (await page.evaluate(() => window.scadshapeBack()));
console.log('bakåt i Om: licenstext → listan → stängd');

// 5. Bakåt i skissläget = Klar.
await page.evaluate(() => document.querySelector('#btnNewSketch')?.click());
if (await page.isVisible('#planeDlg')) {
  await page.click('#planeDlg [data-plane="XY"]');
}
if (await page.evaluate(() => document.body.dataset.mode) === 'sketch') {
  assert.equal(await page.evaluate(() => window.scadshapeBack()), true);
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'part');
  console.log('bakåt i skissläget → delläget');
} else console.log('(skissläget hoppades över: kom inte in i det)');

// 6. En STL som delas till appen medan den är öppen: importpanelen öppnas → OK → importerad kropp.
await page.evaluate(p => { window.ScadshapeAndroid.pending = p; window.scadshapeOpenPending(); }, pending('kub.stl', cubeStl()));
await page.waitForSelector('#featPanel:not([hidden])', { timeout: 30000 });
assert.match(await page.textContent('#fpTitle'), /Importerad kropp|kub/);
await page.click('#fpOk');
await page.waitForFunction(() => window.__scadshape.doc.features.some(f => f.type === 'mesh'), null, { timeout: 30000 });
await waitRendered();
console.log('delad STL →', await page.textContent('#status'));

// 7. Mörkt tema på telefonen → ljusa ikoner i systemraderna.
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForFunction(() => window.ScadshapeAndroid.calls.filter(c => c.fn === 'bars').at(-1).dark === true);
console.log('mörkt tema:', (await calls('bars')).at(-1));
await page.screenshot({ path: `${out}/android-dark.png` });

// 8. Ingen mätknapp (utvecklarverktyg) i appbygget.
assert.equal(await page.$('#btnBench'), null, 'mätknappen ska inte finnas i appen');

// 9. Ingen service worker i appen.
assert.equal(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0), 0);

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel.');
if (errors.length) process.exit(1);
