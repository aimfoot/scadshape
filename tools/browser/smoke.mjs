// Smoke test of scadshape in headless Chromium (mobile emulation, touch screen).
// node smoke.mjs [url] [outdir] [--bench]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const bench = process.argv.includes('--bench');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
for (const [name, vp] of [['landscape', { width: 915, height: 412 }], ['portrait', { width: 412, height: 915 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('console', m => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`));
  const logged = [];
  await page.route('**/api/bench', r => r.fulfill({ status: 204 }));
  await page.route('**/api/log', r => (logged.push(JSON.parse(r.request().postData() ?? '{}').kind), r.fulfill({ status: 204 })));
  page.on('close', () => console.log(name, 'logged:', logged.join(' ')));
  const t0 = Date.now();
  await page.goto(url);
  await page.selectOption('#source', 'plate');
  await page.waitForFunction(() => /triangles|Error|Empty/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
  console.log(name, 'status:', await page.textContent('#status'), `(${Date.now() - t0} ms from page load)`);
  await page.screenshot({ path: `${out}/${name}.png` });
  if (name === 'landscape') {
    await page.click('#btnCode');
    await page.fill('#code', 'cube(10);\nsphere(;'); // a syntax error; renders by itself
    await page.waitForFunction(() => /Error/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
    console.log('syntax error →', await page.textContent('#status'), '|', (await page.textContent('#log')).split('\n').find(l => /ERROR/.test(l)));
    await page.screenshot({ path: `${out}/error.png` });
    await page.selectOption('#source', 'cup');
    await page.waitForFunction(() => /triangles/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
    console.log('cup →', await page.textContent('#status'));
    await page.click('[data-view="top"]');
    await page.screenshot({ path: `${out}/cup-top.png` });
    if (bench) {
      if (await page.isHidden('#tree')) await page.click('#btnTree'); // the button is in ☰
      await page.click('#btnBench');
      await page.waitForFunction(() => /Done|aborted/.test(document.querySelector('#benchSummary').textContent), null, { timeout: 180000 });
      const rows = await page.$$eval('#benchBody tr', trs => trs.map(tr => [...tr.cells].map(c => c.textContent).join(' | ')));
      console.log(rows.join('\n'));
      console.log(await page.textContent('#benchSummary'));
      await page.screenshot({ path: `${out}/bench.png` });
    }
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors.');
