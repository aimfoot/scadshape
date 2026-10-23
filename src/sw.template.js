// Service worker (only over https): the app works offline and can be installed. build.mjs fills in
// VERSION (a hash of all files) and FILES. New version → new cache; the old one is removed.
// Everything is fetched from the cache first (fast start, even without network); a new version is
// downloaded in the background and used from the next start.
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
  // The page itself (also with ? parameters) → index.html from the cache.
  const key = req.mode === 'navigate' ? new URL('./', location.href).href : req;
  e.respondWith(caches.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
