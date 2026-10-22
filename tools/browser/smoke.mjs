// Röktest av scadshape i headless Chromium (mobil-emulering, pekskärm).
//   node smoke.mjs [url] [utkatalog] [--bench]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const bench = process.argv.includes('--bench');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
for (const [name, vp] of [['landscape', { width: 915, height: 412 }], ['portrait', { width: 412, height: 915 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
  const page = await ctx.newPage();
  page.on('console', m => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  const logged = [];
  await page.route('**/api/bench', r => r.fulfill({ status: 204 }));
  await page.route('**/api/log', r => (logged.push(JSON.parse(r.request().postData() ?? '{}').kind), r.fulfill({ status: 204 })));
  page.on('close', () => console.log(name, 'loggat:', logged.join(' ')));
  const t0 = Date.now();
  await page.goto(url);
  await page.selectOption('#source', 'plattan');
  await page.waitForFunction(() => /trianglar|Fel|Tom/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
  console.log(name, 'status:', await page.textContent('#status'), `(${Date.now() - t0} ms från sidladdning)`);
  await page.screenshot({ path: `${out}/${name}.png` });
  if (name === 'landscape') {
    await page.click('#btnCode');
    await page.fill('#code', 'cube(10);\nsphere(;'); // syntaxfel
    await page.click('#btnRender');
    await page.waitForFunction(() => /Fel/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
    console.log('syntaxfel →', await page.textContent('#status'), '|', (await page.textContent('#log')).split('\n').find(l => /ERROR/.test(l)));
    await page.screenshot({ path: `${out}/error.png` });
    await page.selectOption('#source', 'kopp');
    await page.waitForFunction(() => /trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
    console.log('kopp →', await page.textContent('#status'));
    await page.click('[data-view="top"]');
    await page.screenshot({ path: `${out}/kopp-top.png` });
    if (bench) {
      if (await page.isHidden('#tree')) await page.click('#btnTree'); // knappen ligger i ☰
      await page.click('#btnBench');
      await page.waitForFunction(() => /Klart|Avbrutet/.test(document.querySelector('#benchSummary').textContent), null, { timeout: 180000 });
      const rows = await page.$$eval('#benchBody tr', trs => trs.map(tr => [...tr.cells].map(c => c.textContent).join(' | ')));
      console.log(rows.join('\n'));
      console.log(await page.textContent('#benchSummary'));
      await page.screenshot({ path: `${out}/bench.png` });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel.');
