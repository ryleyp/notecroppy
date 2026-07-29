/**
 * Offline cache.
 *
 * Vite fingerprints its build output, so rather than shipping a precomputed
 * file list this caches same-origin GETs as they are requested and serves them
 * from the cache when the network is unavailable. Nothing is ever uploaded —
 * the cache only holds the app's own assets.
 */
const CACHE = 'notecroppy-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      // Navigations go to the network first so a deployed update is picked up,
      // falling back to the cached shell when offline.
      if (request.mode === 'navigate') {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          return cached ?? caches.match('./index.html');
        }
      }

      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
