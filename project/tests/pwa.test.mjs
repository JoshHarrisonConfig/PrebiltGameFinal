import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { computeBuildId, precacheUrls, renderServiceWorker, shellFiles } from '../build/pwa-plugin.mjs';

const TEMPLATE = readFileSync(new URL('../build/sw-template.js', import.meta.url), 'utf8');

const FILES = [
  'assets/index-AbC123.js',
  'assets/index-XyZ789.css',
  'assets/space-grotesk-latin-wght-normal-Q1w2.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'index.html',
  'manifest.webmanifest',
  'prebilt-logo.png',
  'favicon.svg',
  // never precached:
  'sw.js',
  'assets/index-AbC123.js.map',
  'screenshots/handheld.jpg',
  'vite.svg'
];

// ---- build plugin helpers --------------------------------------------------------------

test('precache list: the app shell only, with index.html served as "/"', () => {
  const urls = precacheUrls(FILES);
  assert.ok(urls.includes('/'));
  assert.ok(!urls.includes('/index.html'));
  assert.ok(urls.includes('/assets/index-AbC123.js'));
  assert.ok(urls.includes('/manifest.webmanifest'));
  assert.ok(urls.includes('/icons/icon-512.png'));
  for (const excluded of ['/sw.js', '/assets/index-AbC123.js.map', '/screenshots/handheld.jpg', '/vite.svg']) {
    assert.ok(!urls.includes(excluded), `${excluded} must not be precached`);
  }
  assert.equal(urls.length, shellFiles(FILES).length);
});

test('build id changes exactly when the app changes', () => {
  const contents = Object.fromEntries(FILES.map((file) => [file, `content of ${file}`]));
  const read = (file) => contents[file];
  const base = computeBuildId(FILES, read);

  assert.match(base, /^[0-9a-f]{12}$/);
  assert.equal(computeBuildId(FILES, read), base, 'deterministic');
  assert.equal(computeBuildId([...FILES].reverse().sort(), read), base, 'independent of listing order');

  assert.notEqual(computeBuildId(FILES, (f) => (f === 'index.html' ? 'changed' : contents[f])), base, 'page changed');
  assert.notEqual(computeBuildId(FILES, (f) => (f === 'icons/icon-192.png' ? 'new icon' : contents[f])), base, 'un-hashed file changed');
  assert.notEqual(computeBuildId([...FILES, 'assets/new-Zz9.js'], (f) => contents[f] ?? 'x'), base, 'file added');

  // Files that are not part of the shell must not trigger a pointless update.
  assert.equal(computeBuildId(FILES, (f) => (f === 'sw.js' || f.startsWith('screenshots/') ? 'different' : contents[f])), base);
});

test('the worker is rendered from the template, and only from a complete template', () => {
  const code = renderServiceWorker(TEMPLATE, { buildId: 'abc123def456', urls: ['/', '/assets/a$&b.js'] });
  assert.match(code, /const BUILD_ID = "abc123def456";/);
  assert.match(code, /"\/assets\/a\$&b\.js"/, 'characters special to String.replace are kept literally');
  assert.doesNotMatch(code, /__BUILD_ID__|__PRECACHE_URLS__/);
  assert.doesNotThrow(() => new vm.Script(code), 'the generated worker is valid JavaScript');

  assert.throws(() => renderServiceWorker('const nothing = 1;', { buildId: 'x', urls: [] }), /missing/);
});

// ---- the worker's behaviour, run against a simulated browser -----------------------------

const ORIGIN = 'https://game.example';

function createBrowser() {
  class FakeRequest {
    constructor(input, init = {}) {
      this.url = new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
      this.method = init.method || 'GET';
      this.mode = init.mode || 'no-cors';
      this.cache = init.cache;
    }
  }
  const stores = new Map();
  const keyOf = (request) => (typeof request === 'string' ? new URL(request, ORIGIN) : new URL(request.url)).pathname + (typeof request === 'string' ? '' : new URL(request.url).search);
  const makeCache = (name) => {
    const entries = (stores.get(name) ?? stores.set(name, new Map()).get(name));
    return {
      match: async (request) => entries.get(keyOf(request)),
      put: async (request, response) => { entries.set(keyOf(request), response); },
      addAll: async (requests) => { for (const request of requests) entries.set(keyOf(request), { fromPrecache: true, url: request.url }); }
    };
  };
  const caches = {
    stores,
    open: async (name) => makeCache(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => { for (const entries of stores.values()) { const hit = entries.get(keyOf(request)); if (hit) return hit; } return undefined; }
  };
  const network = [];
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    skipWaiting: () => { self.skipped = true; },
    clients: { claim: async () => { self.claimed = true; } }
  };
  const context = vm.createContext({
    self, caches, URL, Promise, Request: FakeRequest,
    fetch: async (request) => { network.push(request.url ?? String(request)); return { ok: true, type: 'basic', fromNetwork: true, clone() { return this; } }; }
  });
  return { context, self, caches, network, listeners, FakeRequest };
}

const URLS = ['/', '/assets/app-1.js', '/assets/font-latin.woff2', '/manifest.webmanifest', '/icons/icon-192.png'];

async function installedWorker() {
  const env = createBrowser();
  vm.runInContext(renderServiceWorker(TEMPLATE, { buildId: 'build1', urls: URLS }), env.context);
  const install = { waitUntil(promise) { this.done = promise; } };
  env.listeners.install(install);
  await install.done;
  const activate = { waitUntil(promise) { this.done = promise; } };
  env.listeners.activate(activate);
  await activate.done;
  env.fetchEvent = (path, { method = 'GET', mode = 'no-cors', origin = ORIGIN } = {}) => {
    const event = { request: { url: new URL(path, origin).href, method, mode }, respondWith(promise) { this.response = promise; } };
    env.listeners.fetch(event);
    return event;
  };
  return env;
}

test('install stores the whole shell and takes over; activate removes only old shells', async () => {
  const env = createBrowser();
  env.caches.stores.set('prebilt-shell-old', new Map());
  env.caches.stores.set('somebody-elses-cache', new Map());
  vm.runInContext(renderServiceWorker(TEMPLATE, { buildId: 'build1', urls: URLS }), env.context);

  const install = { waitUntil(promise) { this.done = promise; } };
  env.listeners.install(install);
  await install.done;
  assert.equal(env.self.skipped, true, 'a new version does not wait for every tab to close');
  assert.deepEqual([...env.caches.stores.get('prebilt-shell-build1').keys()].sort(), [...URLS].sort());

  const activate = { waitUntil(promise) { this.done = promise; } };
  env.listeners.activate(activate);
  await activate.done;
  assert.deepEqual([...env.caches.stores.keys()].sort(), ['prebilt-shell-build1', 'somebody-elses-cache']);
  assert.equal(env.self.claimed, true);
});

test('live data is never intercepted: /api, other methods, other sites, the worker itself', async () => {
  const env = await installedWorker();
  for (const [path, options] of [
    ['/api/leaderboard', {}],
    ['/api/plays/abc', { method: 'PUT' }],
    ['/api/admin/export', {}],
    ['/.netlify/functions/api', {}],
    ['/assets/app-1.js', { method: 'POST' }],
    ['/sw.js', {}],
    ['/assets/app-1.js', { origin: 'https://cdn.other.test' }]
  ]) {
    const event = env.fetchEvent(path, options);
    assert.equal(event.response, undefined, `${options.method || 'GET'} ${options.origin || ''}${path} must go straight to the network`);
  }
  assert.deepEqual(env.network, [], 'the worker itself made no requests');
});

test('every page navigation is answered with the cached app, so it opens offline', async () => {
  const env = await installedWorker();
  for (const path of ['/', '/?source=pwa', '/index.html', '/#leaderboard', '/some/unknown/path']) {
    const event = env.fetchEvent(path, { mode: 'navigate' });
    const response = await event.response;
    assert.equal(response.fromPrecache, true, `${path} is served from the cache`);
    assert.equal(response.url, `${ORIGIN}/`);
  }
  assert.deepEqual(env.network, [], 'no network needed');
});

test('a navigation straight to a file is served as that file, not as the app', async () => {
  const env = await installedWorker();
  const event = env.fetchEvent('/manifest.webmanifest', { mode: 'navigate' });
  const response = await event.response;
  assert.equal(response.url, `${ORIGIN}/manifest.webmanifest`);
});

test('precached files come from the cache; other /assets files are fetched once, then kept', async () => {
  const env = await installedWorker();

  const precached = await env.fetchEvent('/assets/app-1.js').response;
  assert.equal(precached.fromPrecache, true);
  assert.deepEqual(env.network, []);

  const first = await env.fetchEvent('/assets/font-latin-ext.woff2').response;
  assert.equal(first.fromNetwork, true);
  assert.deepEqual(env.network, [`${ORIGIN}/assets/font-latin-ext.woff2`]);
  assert.ok(env.caches.stores.get('prebilt-runtime').has('/assets/font-latin-ext.woff2'));

  const again = await env.fetchEvent('/assets/font-latin-ext.woff2').response;
  assert.equal(again.fromNetwork, true, 'the stored copy is returned');
  assert.equal(env.network.length, 1, 'and no second request is made');

  // Anything outside /assets/ that was not precached is passed through, not stored.
  await env.fetchEvent('/random.json').response;
  assert.ok(!env.caches.stores.get('prebilt-runtime').has('/random.json'));
});
