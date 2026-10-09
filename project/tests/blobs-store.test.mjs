// Runs the production storage adapter against the real @netlify/blobs client talking to
// the SDK's own local server, so ETag/conditional-write behaviour is exercised for real.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBlobsStore } from '../server/stores/blobs-store.mjs';
import { createApiHandler } from '../server/api.mjs';
import { createEmptyState } from '../server/state.mjs';
import { startBlobsTestServer } from './helpers/blobs-test-server.mjs';

const id = (n) => String(n).padStart(32, '0');

let blobs;
let counter = 0;

before(async () => {
  blobs = await startBlobsTestServer();
});

after(async () => {
  await blobs.stop();
});

// Every test gets its own store name so tests cannot see each other's data.
function freshStore() {
  counter += 1;
  return createBlobsStore({ name: `test-store-${counter}`, ...blobs.clientOptions });
}

test('an empty store loads as a fresh state with no version', async () => {
  const store = freshStore();
  const { state, version } = await store.loadState();
  assert.equal(version, null);
  assert.deepEqual(state, createEmptyState());
});

test('first write must create, later writes must present the current version', async () => {
  const store = freshStore();
  const state = createEmptyState();
  state.rev = 1;

  assert.equal(await store.saveState(state, null), true, 'creates the document');
  assert.equal(await store.saveState(state, null), false, 'a second "create" must lose');

  const loaded = await store.loadState();
  assert.equal(loaded.state.rev, 1);
  assert.ok(loaded.version, 'an ETag is returned');

  loaded.state.rev = 2;
  assert.equal(await store.saveState(loaded.state, loaded.version), true);
  // Using the old version again is exactly what a slower concurrent writer would do.
  loaded.state.rev = 99;
  assert.equal(await store.saveState(loaded.state, loaded.version), false, 'stale version is rejected');

  assert.equal((await store.loadState()).state.rev, 2, 'the rejected write changed nothing');
});

test('the signing secret is created once and is stable, even when many cold starts race', async () => {
  const store = freshStore();
  const secrets = await Promise.all(Array.from({ length: 8 }, () => store.getSecret()));
  assert.equal(new Set(secrets).size, 1, 'all racers agree on one secret');
  assert.ok(secrets[0].length >= 32);
  assert.equal(await store.getSecret(), secrets[0]);
});

test('the full API works on top of the real Blobs client, including parallel writers', async () => {
  const store = freshStore();
  const handler = createApiHandler({
    store,
    env: { ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'pw-for-this-test' },
    logger: { warn() {}, error: console.error }
  });
  const call = async (method, path, body, token) => {
    const response = await handler(
      new Request(`http://test.local${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    );
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const finished = (n) => ({
    name: `Player ${n}`,
    email: `p${n}@example.com`,
    status: 'finished',
    scanned: 10,
    elapsed: 30 + n,
    time: 30 + n
  });

  // Sequential writes must all stick.
  for (let n = 1; n <= 5; n += 1) {
    assert.equal((await call('PUT', `/api/plays/${id(n)}`, finished(n))).status, 200);
  }
  // Then a burst of parallel writes from "different devices".
  const sent = Array.from({ length: 10 }, (_, i) => i + 6);
  const results = await Promise.all(sent.map((n) => call('PUT', `/api/plays/${id(n)}`, finished(n))));
  for (const result of results.filter((r) => r.status !== 200)) {
    assert.deepEqual([result.status, result.json.error], [503, 'busy']);
  }
  const acknowledged = sent.filter((_, i) => results[i].status === 200);

  const board = (await call('GET', '/api/leaderboard')).json;
  assert.equal(board.finishedCount, 5 + acknowledged.length, 'every acknowledged result is stored, none lost');

  const login = await call('POST', '/api/admin/login', { username: 'boss', password: 'pw-for-this-test' });
  assert.equal(login.status, 200);
  const exported = await call('GET', '/api/admin/export', undefined, login.json.token);
  assert.equal(exported.json.participants.length, board.finishedCount);

  assert.equal((await call('DELETE', '/api/admin/leaderboard', undefined, login.json.token)).status, 200);
  assert.equal((await call('GET', '/api/leaderboard')).json.finishedCount, 0);
});
