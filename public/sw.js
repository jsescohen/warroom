/*
 * Warroom service worker: keeps the game's own files on the device so it opens at once, even
 * while the free server is still waking up. Game code (/assets/, named by content hash) is
 * served from the cache; the page itself is fetched fresh when the network answers quickly and
 * taken from the cache otherwise. Maps, saves and the AI (/maps/, /api/) always go to the server.
 */
const SHELL = 'warroom-shell-v1';
const ASSETS = 'warroom-assets-v1';
const PAGE_TIMEOUT_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/maps/')) return;
  if (url.pathname.startsWith('/assets/')) return e.respondWith(cacheFirst(req));
  if (req.mode === 'navigate') return e.respondWith(pageFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    // old builds' files pile up: keep the newest hundred
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - 100))) await cache.delete(k);
  }
  return res;
}

async function pageFirst(req) {
  const cache = await caches.open(SHELL);
  const network = fetch(req).then(async (res) => {
    if (res.ok) await cache.put('/', res.clone());
    return res;
  });
  const timeout = new Promise((r) => setTimeout(r, PAGE_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  // slow or no network: the saved page, if there is one (the server may be waking up)
  const saved = await cache.match('/');
  return saved ?? network;
}
