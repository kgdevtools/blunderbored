/* Chess Academy service worker — hand-written, no build step.
 *
 * Strategy:
 *   - cache-first   for immutable assets: /_next/static/*, /engine/*, /books/*
 *   - network-first (with a short timeout) for page navigations, falling back
 *     to the cached document, then to /offline. The timeout means a slow or
 *     unreachable network never hangs — it serves the cached page fast.
 *   - stale-while-revalidate for everything else same-origin (incl. RSC payloads)
 *
 * The app shell (including the dynamic /board document) is precached at install
 * so a route works offline even if it was only ever reached via client-side
 * navigation (Next <Link>), which never issues a top-level document request.
 *
 * Bump VERSION to invalidate all caches; old caches are purged on activate.
 */
const VERSION = 'v3';
const STATIC_CACHE = `ca-static-${VERSION}`;
const RUNTIME_CACHE = `ca-runtime-${VERSION}`;
const OFFLINE_URL = '/offline';
const NAV_TIMEOUT_MS = 3000;

// Documents to precache so they render offline without a prior full-page load.
// Their JS/CSS chunks are cached on first online visit (cache-first below).
const PRECACHE_URLS = ['/', '/offline', '/board'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      // Add each individually so one failure (e.g. transient offline) doesn't
      // abort the whole install.
      await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => {})));
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/engine/') ||
    url.pathname.startsWith('/books/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // only handle same-origin

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  // Kick off the network request; update the cache in the background when it
  // succeeds (even if the timeout below has already served a cached response).
  const networkUpdate = fetch(request)
    .then((response) => {
      if (response.ok && !response.redirected) cache.put(request, response.clone());
      return response;
    });

  let timer;
  try {
    const response = await Promise.race([
      networkUpdate,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('nav-timeout')), NAV_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    return response;
  } catch {
    clearTimeout(timer);
    // Network was slow, failed, or offline — serve the best cached document.
    const cached = (await cache.match(request)) || (await cache.match(OFFLINE_URL));
    if (cached) return cached;
    // Nothing cached: fall back to whatever the network eventually returns.
    return networkUpdate;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}
