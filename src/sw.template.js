// Service worker (bara över https): appen fungerar offline och kan installeras.
// build.mjs fyller i VERSION (hash av alla filer) och FILES. Ny version → ny cache; den gamla tas bort.
// Allt hämtas från cachen först (snabb start, även utan nät); en ny version laddas ner i bakgrunden
// och används från nästa start.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `scadshape-${VERSION}`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('scadshape-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  // Sidan själv (även med ?-parametrar) → index.html ur cachen.
  const key = req.mode === 'navigate' ? new URL('./', location.href).href : req;
  e.respondWith(caches.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
