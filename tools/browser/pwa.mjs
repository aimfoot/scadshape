// PWA: manifest and icons, the service worker caches the app, and the app starts and renders
// offline.
// node pwa.mjs [url-of-public-server]   (locally: http://127.0.0.1:8792/?sw – otherwise sw only
// registers over https)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.argv[2] ?? 'http://127.0.0.1:8792/?sw';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'en-US' });
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
assert.match(await page.textContent('#partToast'), /offline/);
const cached = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return { keys: k, n: (await c.keys()).length }; });
console.log('cache:', cached);

// Offline: reload, pick the Plate example and render with OpenSCAD from the cache
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => /triangles|Start with/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.selectOption('#source', 'plate');
await page.waitForFunction(() => /\d+ triangles/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
console.log('offline:', await page.textContent('#status'));
await ctx.setOffline(false);
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console errors. All checks ok.');
