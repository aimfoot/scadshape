// "About scadshape": the dialog, all licence texts (exist and are text), back in a text → the list.
// node about.mjs [url] [outdir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: 'en-US' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.route('**/api/**', r => r.fulfill({ status: 204 }));
const openSettings = async () => {
  if (await page.evaluate(() => document.querySelector('#settingsDlg').open)) return;
  if (await page.isHidden('#tree')) await page.click('#btnTree');
  await page.click('#btnSettings');
};
const closeSettings = () => page.evaluate(() => document.querySelector('#settingsDlg').close());
await page.goto(url);

await openSettings();
await page.click('#btnAbout');
assert.ok(await page.evaluate(() => document.querySelector('#aboutDlg').open));
console.log('version:', await page.textContent('#aboutVersion'));
assert.equal(await page.getAttribute('#aboutSource', 'href'), 'https://github.com/aimfoot/scadshape');
assert.ok(await page.isVisible('#aboutSource'), 'the source code link should be visible');
const rows = await page.$$eval('#aboutParts li', lis => lis.length);
console.log('parts:', rows);
await page.screenshot({ path: `${out}/about.png` });

// Every licence file the dialog links to exists and is text (not an error page).
const links = await page.$$('#aboutParts button.link');
assert.equal(links.length, rows);
for (let i = 0; i < links.length; i++) {
  await links[i].click();
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('#aboutTextBody').textContent));
  const body = await page.textContent('#aboutTextBody');
  const title = await page.textContent('#aboutTextTitle');
  assert.ok(body.length > 500 && !/Could not|<html/i.test(body), `${title}: ${body.slice(0, 80)}`);
  if (i === 0) await page.screenshot({ path: `${out}/about-text.png` });
  // The first time Esc (the dialog's cancel → the list); then the Back button. Chrome does not let
  // a page stop Esc several times in a row, so only once.
  if (i === 0) await page.keyboard.press('Escape');
  else await page.click('#aboutBack');
  assert.ok(await page.isVisible('#aboutMain') && await page.evaluate(() => document.querySelector('#aboutDlg').open), `${title}: back closed the dialog`);
}
console.log(`all ${links.length} licence texts open`);
await page.click('#aboutLicense');
await page.waitForFunction(() => /GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(document.querySelector('#aboutTextBody').textContent));
await page.click('#aboutBack');
assert.ok(await page.isVisible('#aboutMain'));
console.log('scadshape\'s licence: GPL-3.0');
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.querySelector('#aboutDlg').open), false);

// Swedish.
await page.selectOption('#lang', 'sv');
await page.click('#btnAbout');
assert.match(await page.textContent('#aboutDlg h2'), /Om scadshape/);
assert.match(await page.textContent('#aboutParts h3'), /3D-motor/);
await page.screenshot({ path: `${out}/about-sv.png` });

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
if (errors.length) process.exit(1);
