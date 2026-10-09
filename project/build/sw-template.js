/* PreBilt service worker.
   This file is a TEMPLATE: build/pwa-plugin.mjs fills in the two placeholders below and
   writes the result to dist/sw.js on every `vite build`.

   What it does
   - Precaches the whole app shell (page, scripts, styles, fonts, logo, icons) so the app
     opens and can be played with no network at all. Results are queued on the device by the
     app's outbox and delivered once the network is back.
   - Never touches /api/*. Leaderboard, results and admin calls are live data: they always go
     to the network, and a failure is reported honestly by the app instead of showing stale data.
   - A new deploy produces a new BUILD_ID, so the browser installs the new worker, which swaps
     the cache and removes the old one. */

const BUILD_ID = '__BUILD_ID__';
const PRECACHE_URLS = __PRECACHE_URLS__;

const SHELL_PREFIX = 'prebilt-shell-';
const SHELL_CACHE = `${SHELL_PREFIX}${BUILD_ID}`;
const RUNTIME_CACHE = 'prebilt-runtime';
// Every navigation (the app is a single page with #hash routes) is answered with this.
const APP_SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `cache: 'reload'` skips the browser's HTTP cache, so un-hashed files such as the page
      // and the icons are always stored fresh. If any file fails, the whole install fails and
      // the previous worker keeps running (no half-updated app).
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data and the worker itself always come from the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/') || url.pathname === '/sw.js') return;

  // Page navigations get the app. A navigation straight to some other file (for example
  // /manifest.webmanifest typed into the address bar) is served as that file instead.
  const isOtherFile = /\.[a-z0-9]+$/i.test(url.pathname) && !url.pathname.endsWith('.html');
  if (request.mode === 'navigate' && !isOtherFile) {
    event.respondWith(appShell(request));
    return;
  }
  event.respondWith(asset(request, url));
});

async function appShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(APP_SHELL);
  return cached || fetch(request);
}

// Files: cache first. Anything under /assets/ that was not precached (for example a font
// subset needed for an unusual name) is kept the first time it is fetched.
async function asset(request, url) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic' && url.pathname.startsWith('/assets/')) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}
