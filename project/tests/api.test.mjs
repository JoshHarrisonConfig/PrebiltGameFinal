import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../server/api.mjs';
import { createMemoryStore } from '../server/stores/memory-store.mjs';
import { LIMITS } from '../server/state.mjs';

const id = (n) => String(n).padStart(32, '0');
const ENV = { ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'test-password-123' };

function createHarness({ env = ENV, store = createMemoryStore(), start = 1_700_000_000_000 } = {}) {
  const clock = { now: start };
  const logs = { warn: [], error: [] };
  const logger = { warn: (...a) => logs.warn.push(a), error: (...a) => logs.error.push(a) };
  const handler = createApiHandler({ store, env, now: () => clock.now, logger });

  async function call(method, path, { body, token, raw, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.authorization = `Bearer ${token}`;
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const response = await handler(new Request(`http://test.local${path}`, init));
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, json: text ? safeParse(text) : null };
  }

  async function login(password = ENV.ADMIN_PASSWORD) {
    const result = await call('POST', '/api/admin/login', { body: { username: ENV.ADMIN_USERNAME, password } });
    return result.json?.token;
  }

  return { call, login, clock, logs, store, handler };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const player = (n, extra = {}) => ({
  name: `Player ${n}`,
  email: `p${n}@example.com`,
  status: 'ready',
  scanned: 0,
  elapsed: null,
  ...extra
});
const finished = (n, time) => player(n, { status: 'finished', scanned: 10, elapsed: time, time });

test('empty leaderboard, never cacheable', async () => {
  const { call } = createHarness();
  const response = await call('GET', '/api/leaderboard');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(response.json.leaderboard, []);
  assert.deepEqual(response.json.live, []);
  assert.equal(response.json.finishedCount, 0);
});

test('a game from first scan to finish is visible to a different device', async () => {
  const { call, clock } = createHarness();

  // Device A (the TC501) registers and plays.
  assert.equal((await call('PUT', `/api/plays/${id(1)}`, { body: player(1) })).json.created, true);
  // Device B (the admin laptop) sees them waiting.
  let board = (await call('GET', '/api/leaderboard')).json;
  assert.deepEqual(board.live.map((p) => [p.name, p.status, p.scanned]), [['Player 1', 'ready', 0]]);

  clock.now += 2000;
  await call('PUT', `/api/plays/${id(1)}`, { body: player(1, { status: 'playing', scanned: 3, elapsed: 14 }) });
  clock.now += 3000;
  board = (await call('GET', '/api/leaderboard')).json;
  assert.deepEqual(board.live.map((p) => [p.name, p.status, p.scanned, p.elapsed]), [['Player 1', 'playing', 3, 17]]);

  clock.now += 1000;
  const done = await call('PUT', `/api/plays/${id(1)}`, { body: finished(1, 61.25) });
  assert.equal(done.json.status, 'finished');

  board = (await call('GET', '/api/leaderboard')).json;
  assert.deepEqual(board.live, [], 'no longer playing');
  assert.deepEqual(board.leaderboard.map((r) => [r.rank, r.name, r.time]), [[1, 'Player 1', 61.25]]);
  assert.equal(board.rev > 0, true);
});

test('participant emails never appear in any public response', async () => {
  const { call } = createHarness();
  const responses = [
    await call('PUT', `/api/plays/${id(1)}`, { body: player(1) }),
    await call('PUT', `/api/plays/${id(1)}`, { body: finished(1, 50) }),
    await call('GET', '/api/leaderboard'),
    await call('GET', '/api/health')
  ];
  for (const response of responses) {
    assert.doesNotMatch(response.text, /example\.com/);
    assert.doesNotMatch(response.text, new RegExp(id(1)));
  }
});

test('every admin route rejects missing, malformed, forged and expired tokens', async () => {
  const { call, login, clock } = createHarness();
  const goodToken = await login();
  assert.ok(goodToken);

  const routes = [
    ['GET', '/api/admin/settings'],
    ['PUT', '/api/admin/settings'],
    ['GET', '/api/admin/export'],
    ['DELETE', '/api/admin/leaderboard']
  ];
  const forged = `${goodToken.split('.')[0]}.AAAA`;
  for (const [method, path] of routes) {
    for (const token of [undefined, 'garbage', forged]) {
      const response = await call(method, path, { token, body: method === 'PUT' ? {} : undefined });
      assert.equal(response.status, 401, `${method} ${path} with ${token}`);
      assert.equal(response.json.error, 'unauthorized');
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    }
  }

  clock.now += 13 * 60 * 60 * 1000; // past the 12h session lifetime
  assert.equal((await call('GET', '/api/admin/export', { token: goodToken })).status, 401);
});

test('login: wrong credentials are refused and give no token', async () => {
  const { call } = createHarness();
  for (const body of [
    { username: 'boss', password: 'wrong' },
    { username: 'nope', password: ENV.ADMIN_PASSWORD },
    { username: '', password: '' }
  ]) {
    const response = await call('POST', '/api/admin/login', { body });
    assert.equal(response.status, 401);
    assert.equal(response.json.token, undefined);
  }
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 'boss' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 1, password: 2 } })).status, 400);
});

test('admin sees emails and can export, change settings and clear', async () => {
  const { call, login } = createHarness();
  const token = await login();
  await call('PUT', `/api/plays/${id(1)}`, { body: finished(1, 45) });
  await call('PUT', `/api/plays/${id(2)}`, { body: player(2) });

  const exported = await call('GET', '/api/admin/export', { token });
  assert.equal(exported.status, 200);
  assert.deepEqual(
    exported.json.participants.map((p) => [p.name, p.email, p.status, p.rank]),
    [['Player 1', 'p1@example.com', 'finished', 1], ['Player 2', 'p2@example.com', 'ready', null]]
  );

  const sequence = Array.from({ length: 10 }, (_, i) => ({ code: `BOX-${i + 1}`, description: `Box ${i + 1}` }));
  const saved = await call('PUT', '/api/admin/settings', { token, body: { spotPrizeInterval: 3, barcodeSequence: sequence } });
  assert.equal(saved.status, 200);
  const reloaded = await call('GET', '/api/admin/settings', { token });
  assert.equal(reloaded.json.settings.spotPrizeInterval, 3);
  assert.equal(reloaded.json.settings.barcodeSequence[4].code, 'BOX-5');
  assert.equal((await call('PUT', '/api/admin/settings', { token, body: { spotPrizeInterval: 0 } })).status, 400);

  const cleared = await call('DELETE', '/api/admin/leaderboard', { token });
  assert.deepEqual([cleared.status, cleared.json.removed], [200, 2]);
  assert.deepEqual((await call('GET', '/api/leaderboard')).json.leaderboard, []);
  assert.deepEqual((await call('GET', '/api/admin/export', { token })).json.participants, []);
  // Settings survive a clear.
  assert.equal((await call('GET', '/api/admin/settings', { token })).json.settings.spotPrizeInterval, 3);
});

test('settings and results are shared across handler instances (devices) via the store', async () => {
  const store = createMemoryStore();
  const laptop = createHarness({ store });
  const tc501 = createHarness({ store });
  await tc501.call('PUT', `/api/plays/${id(1)}`, { body: finished(1, 33.3) });
  const board = (await laptop.call('GET', '/api/leaderboard')).json;
  assert.equal(board.leaderboard[0].name, 'Player 1');
});

test('rotating the admin password signs out existing sessions', async () => {
  const store = createMemoryStore();
  const before = createHarness({ store });
  const token = await before.login();
  assert.equal((await before.call('GET', '/api/admin/export', { token })).status, 200);

  const after = createHarness({ store, env: { ...ENV, ADMIN_PASSWORD: 'a-different-password' } });
  assert.equal((await after.call('GET', '/api/admin/export', { token })).status, 401);
});

test('built-in default credentials still work for existing deployments, but are flagged', async () => {
  const { call, logs } = createHarness({ env: {} });
  const response = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'prebilt2024' } });
  assert.equal(response.status, 200);
  assert.equal(response.json.insecureDefaults, true);
  await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'prebilt2024' } });
  assert.equal(logs.warn.length, 1, 'warned once, not on every login');

  const configured = createHarness();
  const ok = await configured.call('POST', '/api/admin/login', { body: { username: 'boss', password: ENV.ADMIN_PASSWORD } });
  assert.equal(ok.json.insecureDefaults, false);
  const old = await configured.call('POST', '/api/admin/login', { body: { username: 'admin', password: 'prebilt2024' } });
  assert.equal(old.status, 401, 'once configured, the old default no longer works');
});

test('an explicit AUTH_SECRET is used to sign sessions', async () => {
  const a = createHarness({ env: { ...ENV, AUTH_SECRET: 'secret-a' } });
  const token = await a.login();
  assert.equal((await a.call('GET', '/api/admin/export', { token })).status, 200);
  const b = createHarness({ env: { ...ENV, AUTH_SECRET: 'secret-b' }, store: a.store });
  assert.equal((await b.call('GET', '/api/admin/export', { token })).status, 401);
});

test('unknown routes, wrong methods and preflight', async () => {
  const { call } = createHarness();
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/api/plays')).status, 404);
  assert.equal((await call('POST', '/api/leaderboard')).status, 405);
  assert.equal((await call('GET', `/api/plays/${id(1)}`)).status, 405);
  assert.equal((await call('DELETE', '/api/leaderboard')).status, 405, 'only the admin route can clear');
  assert.equal((await call('OPTIONS', '/api/leaderboard')).status, 204);
  // The same handler works when reached through Netlify's default function URL.
  assert.equal((await call('GET', '/.netlify/functions/api/leaderboard')).status, 200);
});

test('bad input is rejected without side effects', async () => {
  const { call } = createHarness();
  assert.equal((await call('PUT', `/api/plays/${id(1)}`, { raw: '{not json' })).json.error, 'invalid_json');
  assert.equal((await call('PUT', `/api/plays/${id(1)}`, { raw: '' })).status, 400);
  assert.equal((await call('PUT', `/api/plays/${id(1)}`, { raw: 'x'.repeat(20_000) })).status, 413);
  assert.equal(
    (await call('PUT', `/api/plays/${id(1)}`, { raw: '{}', headers: { 'content-length': '999999' } })).status,
    413
  );
  assert.equal((await call('PUT', '/api/plays/not-hex', { body: player(1) })).json.error, 'invalid_id');
  assert.equal((await call('PUT', `/api/plays/${id(1)}`, { body: { ...player(1), email: 'nope' } })).json.error, 'invalid_email');
  assert.deepEqual((await call('GET', '/api/leaderboard')).json.live, []);
});

test('a stored name is data, not markup: it is returned verbatim for the client to escape', async () => {
  const { call } = createHarness();
  const name = '<img src=x onerror=alert(1)>';
  await call('PUT', `/api/plays/${id(1)}`, { body: { ...finished(1, 40), name } });
  const row = (await call('GET', '/api/leaderboard')).json.leaderboard[0];
  assert.equal(row.name, name);
});

test('stale players are swept to abandoned by the next write', async () => {
  const { call, clock, store } = createHarness();
  await call('PUT', `/api/plays/${id(1)}`, { body: player(1, { status: 'playing', scanned: 2, elapsed: 5 }) });
  clock.now += LIMITS.abandonAfterMs + 1000;
  await call('PUT', `/api/plays/${id(2)}`, { body: player(2) });
  const { state } = await store.loadState();
  assert.equal(state.plays[id(1)].status, 'abandoned');
  assert.equal(state.plays[id(2)].status, 'ready');
});

// ---- concurrency --------------------------------------------------------------------

// Wraps a store so every load/save yields a random number of times, forcing requests to
// interleave the way parallel serverless invocations do.
function jitterStore(inner) {
  const wobble = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 6));
  return {
    async loadState() {
      await wobble();
      const result = await inner.loadState();
      await wobble();
      return result;
    },
    async saveState(state, version) {
      await wobble();
      return inner.saveState(state, version);
    },
    getSecret: () => inner.getSecret()
  };
}

test('parallel writers never lose each other\'s updates', async () => {
  const inner = createMemoryStore();
  const { call } = createHarness({ store: jitterStore(inner) });
  const players = Array.from({ length: 12 }, (_, i) => i + 1);

  const responses = await Promise.all(
    players.map((n) => call('PUT', `/api/plays/${id(n)}`, { body: finished(n, 100 - n) }))
  );
  assert.deepEqual([...new Set(responses.map((r) => r.status))], [200]);

  const { state } = await inner.loadState();
  assert.equal(Object.keys(state.plays).length, 12, 'all results were stored');
  assert.equal(state.rev, 12, 'every successful write bumped the revision exactly once');

  const board = (await call('GET', '/api/leaderboard')).json;
  assert.equal(board.finishedCount, 12);
  assert.equal(board.leaderboard[0].name, 'Player 12');
});

test('under extreme contention a request either fully succeeds or is cleanly refused, and retries converge', async () => {
  const inner = createMemoryStore();
  const { call } = createHarness({ store: jitterStore(inner) });
  const players = Array.from({ length: 60 }, (_, i) => i + 1);
  const send = (n) => call('PUT', `/api/plays/${id(n)}`, { body: finished(n, 100 - n) });

  const first = await Promise.all(players.map(send));
  const refused = players.filter((_, i) => first[i].status !== 200);
  for (const response of first.filter((r) => r.status !== 200)) {
    assert.deepEqual([response.status, response.json.error], [503, 'busy']);
  }

  // What the server stored is exactly the set it acknowledged: no lost and no phantom writes.
  const { state } = await inner.loadState();
  const acknowledged = players.filter((_, i) => first[i].status === 200);
  assert.deepEqual(Object.keys(state.plays).sort(), acknowledged.map(id).sort());

  // Devices retry what was refused (that is what the outbox does); everything lands.
  let pending = refused;
  for (let round = 0; round < 10 && pending.length > 0; round += 1) {
    const results = await Promise.all(pending.map(send));
    pending = pending.filter((_, i) => results[i].status !== 200);
  }
  assert.deepEqual(pending, []);
  assert.equal(Object.keys((await inner.loadState()).state.plays).length, 60);
});

test('the same finish delivered twice at once counts once', async () => {
  const inner = createMemoryStore();
  const { call, login } = createHarness({ store: jitterStore(inner) });
  const token = await login();
  await call('PUT', '/api/admin/settings', { token, body: { spotPrizeInterval: 2 } });

  await Promise.all(Array.from({ length: 6 }, () => call('PUT', `/api/plays/${id(1)}`, { body: finished(1, 70) })));
  const { state } = await inner.loadState();
  assert.equal(Object.keys(state.plays).length, 1);
  assert.equal(state.spotPrizeCount, 1, 'one finisher counted once toward the spot prize');
});

test('gives up with a retryable 503 if the store is permanently contended', async () => {
  const contended = { ...createMemoryStore(), saveState: async () => false };
  const { call } = createHarness({ store: contended });
  const response = await call('PUT', `/api/plays/${id(1)}`, { body: player(1) });
  assert.equal(response.status, 503);
  assert.equal(response.json.error, 'busy');
  assert.equal(response.headers.get('retry-after'), '1');
});

test('storage outages become a retryable 503 and are logged, not leaked', async () => {
  const broken = {
    loadState: async () => {
      throw new Error('connect ETIMEDOUT blobs.internal:443');
    },
    saveState: async () => false,
    getSecret: async () => 'x'
  };
  const { call, logs } = createHarness({ store: broken });
  for (const response of [await call('GET', '/api/leaderboard'), await call('PUT', `/api/plays/${id(1)}`, { body: player(1) })]) {
    assert.equal(response.status, 503);
    assert.deepEqual(response.json, { error: 'unavailable' });
    assert.doesNotMatch(response.text, /ETIMEDOUT/);
  }
  assert.equal(logs.error.length, 2);
});
