// PWA: manifest och ikoner, service worker sparar appen, och appen startar och renderar utan nät.
//   node pwa.mjs [url-till-publik-server]   (lokalt: http://127.0.0.1:8792/?sw – sw registreras annars bara över https)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8792/?sw';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'sv-SE' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type() === 'error' && !(m.location()?.url ?? '').includes('/api/') && errors.push(m.text() + ' ' + (m.location()?.url ?? '')));
page.on('requestfailed', r => !r.url().includes('/api/') && errors.push('requestfailed ' + r.url()));
page.on('response', r => r.status() >= 400 && !r.url().includes('/api/') && errors.push(r.status() + ' ' + r.url()));

await page.goto(url);
const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) assert.equal((await page.request.get(new URL(icon.src, page.url()).href)).status(), 200, icon.src);
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 60000 });
await page.waitForSelector('#partToast:not([hidden])');
assert.match(await page.textContent('#partToast'), /utan nät/);
const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return { keys: k, n: (await c.keys()).length }; });
console.log('cache:', cached);

// Utan nät: ladda om, välj exemplet Plattan och rendera med OpenSCAD ur cachen
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => /trianglar|Börja med/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.selectOption('#source', 'plattan');
await page.waitForFunction(() => /\d+ trianglar/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
console.log('offline:', await page.textContent('#status'));
await ctx.setOffline(false);
await browser.close();
console.log(errors.length ? 'FEL:\n' + errors.join('\n') : 'Inga konsolfel. Alla kontroller ok.');
