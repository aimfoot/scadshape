// Skärmbilder och GIF:ar till README.md (docs/media/): engelska, ljust tema, telefon på höjden.
//   node build.mjs --out dist-next
//   python3 -I -m http.server 8799 --bind 127.0.0.1 --directory dist-next
//   node readme-media.mjs [url]
// GIF:arna byggs som en bildserie med bestämd visningstid per bild (inte realtid), så de blir
// jämna oavsett hur snabbt datorn är. gifenc kodar, pngjs läser skärmbilderna.
import { chromium } from 'playwright';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = new URL('../../docs/media/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];

async function session(scale) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, locale: 'en-US', colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  await page.goto(url);
  await page.waitForSelector('body:not(.loading)');
  return { ctx, page, touch };
}
const rendered = page => page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent) && !document.querySelector('#status').classList.contains('busy'), null, { timeout: 60000 });
async function openExample(page, i) {
  if (await page.isHidden('#startCard')) { if (await page.isHidden('#tree')) await page.click('#btnTree'); await page.click('#btnStart'); }
  const before = await page.evaluate(() => window.__scadshape.doc);
  await page.click(`#startExamples button >> nth=${i}`);
  await page.waitForFunction(b => window.__scadshape.doc !== b, before);
  await rendered(page);
  await page.waitForTimeout(3500); // tills toasten har försvunnit
}

/** Dialogerna ligger mitt i bilden: flytta upp modellen med två fingrar så att den syns ovanför. */
async function liftModel(page, touch, zoomOut = 0) {
  const box = await page.locator('#viewport canvas').boundingBox();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Två fingrar uppåt (och, med zoomOut, närmare varandra = zooma ut).
  const half = i => 80 - (zoomOut * i) / 8;
  await touch('touchStart', [{ x: c.x - 80, y: c.y }, { x: c.x + 80, y: c.y }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: c.x - half(i), y: c.y - i * 30 }, { x: c.x + half(i), y: c.y - i * 30 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
}

/** Bildserie → GIF. Likadana bilder i följd slås ihop (längre visningstid). */
function recorder(page) {
  const frames = [];
  return {
    async frame(ms) {
      const png = PNG.sync.read(await page.screenshot());
      const last = frames[frames.length - 1];
      if (last && Buffer.compare(last.data, png.data) === 0) last.ms += ms;
      else frames.push({ data: png.data, w: png.width, h: png.height, ms });
    },
    save(name) {
      // DUMP=<katalog>: spara också bilderna som PNG, för att granska dem.
      if (process.env.DUMP) frames.forEach((f, i) => {
        const png = new PNG({ width: f.w, height: f.h });
        f.data.copy(png.data);
        writeFileSync(`${process.env.DUMP}/${name}-${String(i).padStart(2, '0')}.png`, PNG.sync.write(png));
      });
      const gif = GIFEncoder();
      for (const f of frames) {
        const palette = quantize(f.data, 256);
        gif.writeFrame(applyPalette(f.data, palette), f.w, f.h, { palette, delay: f.ms });
      }
      gif.finish();
      writeFileSync(out + name, gif.bytes());
      console.log(`${name}: ${frames.length} bilder, ${(gif.bytes().length / 1024).toFixed(0)} kB`);
    },
  };
}

// ---- GIF 1: skiss → del ---------------------------------------------------------------------------
{
  const { ctx, page, touch } = await session(1);
  const rec = recorder(page);
  await page.waitForTimeout(800);
  await rec.frame(1600); // startkortet
  await page.click('#btnNewSketch');
  await rec.frame(900);
  await page.click('#planeDlg [data-plane="XY"]');
  await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
  await rec.frame(500);
  await page.click('[data-tool="rect"]');
  await rec.frame(500);
  const C = p => page.evaluate(p => window.__scadshape.editor.clientPoint(p), p);
  const a = await C({ x: -30, y: -18 }), b = await C({ x: 30, y: 18 });
  await touch('touchStart', [a]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
    await rec.frame(110);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  await rec.frame(1100);
  await page.click('#btnDone');
  await page.waitForFunction(() => document.body.dataset.mode === 'part');
  await page.waitForTimeout(4000); // tipset (toast) försvinner – annars ligger det kvar över bilden
  await rec.frame(700);
  await page.click('#btnExtrude');
  await page.waitForSelector('#featPanel:not([hidden])');
  await page.fill('#fp-depth', '12');
  await page.waitForTimeout(600);
  await rec.frame(1100);
  await page.click('#fpOk');
  await rendered(page);
  await page.waitForTimeout(400);
  await rec.frame(900);
  // Vrid vyn med ett finger.
  const box = await page.locator('#viewport canvas').boundingBox();
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch('touchStart', [c]);
  for (let i = 1; i <= 7; i++) {
    await touch('touchMove', [{ x: c.x - i * 14, y: c.y }]);
    await rec.frame(90);
  }
  await touch('touchEnd', []);
  await rec.frame(2200);
  rec.save('sketch-to-part.gif');
  await ctx.close();
}

// ---- GIF 2: ändra en variabel ----------------------------------------------------------------------
{
  const { ctx, page, touch } = await session(1);
  await openExample(page, 1); // Mounting plate
  await liftModel(page, touch, 30); // syns ovanför dialogen, med plats för den längre plattan
  const rec = recorder(page);
  await rec.frame(1500);
  await page.click('#btnParams');
  await page.waitForTimeout(400);
  await rec.frame(900);
  const input = page.getByLabel('Value of length');
  await input.click();
  await input.fill('');
  await rec.frame(400);
  for (const ch of '110') {
    await input.type(ch);
    await rec.frame(260);
  }
  await input.press('Enter');
  await rendered(page);
  await page.waitForTimeout(400);
  await rec.frame(900);
  await page.click('#paramsDlg form[method="dialog"] button');
  await page.waitForTimeout(300);
  await rec.frame(2500);
  rec.save('variables.gif');
  await ctx.close();
}

// ---- Skärmbilder ------------------------------------------------------------------------------------
{
  const { ctx, page, touch } = await session(1.5);
  const shot = async name => { await page.waitForTimeout(300); await page.screenshot({ path: out + name }); console.log(name); };
  await page.waitForTimeout(800);
  await shot('start.png');

  await openExample(page, 0); // Box with lid
  await shot('model.png');

  await openExample(page, 1); // Mounting plate
  if (await page.isHidden('#tree')) await page.click('#btnTree');
  await page.locator('#featureList button.feature').first().click(); // första skissen
  await page.waitForFunction(() => window.__scadshape.editor?.solverReady, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot('sketch.png');
  await page.click('#btnDone');
  await rendered(page);

  // Featurepanelen (stående: nertill) – modellen flyttas upp ovanför den.
  if (await page.isHidden('#tree')) await page.click('#btnTree');
  await page.locator('#featureList button.feature', { hasText: 'Hole' }).click();
  await page.waitForSelector('#featPanel:not([hidden])');
  await page.waitForTimeout(1000);
  await shot('hole.png');
  await page.click('#fpCancel');

  await page.click('[data-view="iso"]');
  await page.click('#btnFit');
  await liftModel(page, touch); // exportdialogen ligger mitt i bilden
  await page.click('#btnExport');
  await page.waitForSelector('#exDownload:not([disabled])', { timeout: 60000 });
  await shot('export.png');
  await ctx.close();
}

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga sidfel.');
if (errors.length) process.exit(1);
