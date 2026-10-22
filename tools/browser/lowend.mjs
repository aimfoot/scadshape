// Svag telefon: strypt processor (CDP) och liten skärm. Mäter start, motorns laddning och
// rendering av exemplen; kontrollerar att inget hamnar utanför skärmen.
//   node lowend.mjs [url] [utkatalog] [strypningar, t.ex. 1,4,6]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const rates = (process.argv[4] ?? '1,4,6').split(',').map(Number);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const rows = [];

for (const rate of rates) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'sv-SE' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${rate}×: ${e.message}`));
  page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${rate}×: ${m.text()}`));
  await page.route('**/api/**', r => r.fulfill({ status: 204 }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForSelector('body:not(.loading)');
  const ready = Date.now() - t0;
  // Inget får sticka ut åt sidan (horisontell rullning på hela sidan).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `${rate}×: sidan är ${overflow} px för bred`);
  const row = { rate, ready };
  for (const [i, name] of [[0, 'låda'], [1, 'platta'], [2, 'skylt'], [3, 'kopp']]) {
    if (await page.isHidden('#startCard')) {
      if (await page.isHidden('#tree')) await page.click('#btnTree');
      await page.click('#btnStart');
    }
    const t1 = Date.now();
    const before = await page.evaluate(() => window.__scadshape.doc);
    await page.click(`#startExamples button >> nth=${i}`);
    // Vänta på den nya modellen (inte förra statusraden) och dess färdiga rendering.
    await page.waitForFunction(b => window.__scadshape.doc !== b, before, { timeout: 30000 });
    await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent) && !document.querySelector('#status').classList.contains('busy'), null, { timeout: 180000 })
      .catch(async e => { console.log(`${rate}× ${name}: status "${await page.textContent('#status')}"`); throw e; });
    const status = await page.textContent('#status');
    console.log(`${rate}× ${name}: ${status}`);
    row[name] = `${((Date.now() - t1) / 1000).toFixed(1)} s (motor ${status.split(' ·')[0]})`;
  }
  await page.screenshot({ path: `${out}/lowend-${rate}x.png` });
  rows.push(row);
  await ctx.close();
}
await browser.close();
console.table(rows);
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
if (errors.length) process.exit(1);
