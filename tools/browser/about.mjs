// "Om scadshape": dialogen, alla licenstexter (finns och är text), bakåt i en text → listan.
//   node about.mjs [url] [utkatalog]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'sv-SE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
await page.goto(url);

if (await page.isHidden('#tree')) await page.click('#btnTree');
await page.click('#btnAbout');
assert.ok(await page.evaluate(() => document.querySelector('#aboutDlg').open));
console.log('version:', await page.textContent('#aboutVersion'));
assert.equal(await page.getAttribute('#aboutSource', 'href'), 'https://github.com/aimfoot/scadshape');
assert.equal(await page.getAttribute('#aboutWebsite', 'href'), 'https://scadshape.com');
assert.equal(await page.getAttribute('#aboutPrivacy', 'href'), 'https://scadshape.com/privacy.html');
assert.match(await page.textContent('#aboutMain'), /samlar inte in något/);
assert.ok(await page.isVisible('#aboutSource'), 'källkodslänken ska synas');
const rows = await page.$$eval('#aboutParts li', lis => lis.length);
console.log('delar:', rows);
await page.screenshot({ path: `${out}/about.png` });

// Varje licensfil som dialogen länkar till finns och är text (inte en felsida).
const links = await page.$$('#aboutParts button.link');
assert.equal(links.length, rows);
for (let i = 0; i < links.length; i++) {
  await links[i].click();
  await page.waitForFunction(() => !/Läser in/.test(document.querySelector('#aboutTextBody').textContent));
  const body = await page.textContent('#aboutTextBody');
  const title = await page.textContent('#aboutTextTitle');
  assert.ok(body.length > 500 && !/Kunde inte|<html/i.test(body), `${title}: ${body.slice(0, 80)}`);
  if (i === 0) await page.screenshot({ path: `${out}/about-text.png` });
  // Första gången Esc (dialogens cancel → listan); sedan Tillbaka-knappen. Chrome låter inte en sida
  // hejda Esc flera gånger i rad, så bara en gång.
  if (i === 0) await page.keyboard.press('Escape');
  else await page.click('#aboutBack');
  assert.ok(await page.isVisible('#aboutMain') && await page.evaluate(() => document.querySelector('#aboutDlg').open), `${title}: tillbaka stängde dialogen`);
}
console.log(`alla ${links.length} licenstexter öppnas`);
await page.click('#aboutLicense');
await page.waitForFunction(() => /GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(document.querySelector('#aboutTextBody').textContent));
await page.click('#aboutBack');
assert.ok(await page.isVisible('#aboutMain'));
console.log('scadshapes licens: GPL-3.0');
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.querySelector('#aboutDlg').open), false);

// Engelska.
await page.selectOption('#lang', 'en');
await page.click('#btnAbout');
assert.match(await page.textContent('#aboutDlg h2'), /About scadshape/);
assert.match(await page.textContent('#aboutParts h3'), /3D engine/);
await page.screenshot({ path: `${out}/about-en.png` });

await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
if (errors.length) process.exit(1);
