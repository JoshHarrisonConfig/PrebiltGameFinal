// Exercises the real Netlify entry file (netlify/functions/api.mjs) the way Netlify runs
// it: credentials for Blobs come from the NETLIFY_BLOBS_CONTEXT environment variable, the
// function receives a standard Request, and it is bundled with esbuild.
//
// Runs in its own process (node --test isolates files), so setting process.env is safe.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { startBlobsTestServer } from './helpers/blobs-test-server.mjs';

const id = (n) => String(n).padStart(32, '0');
let blobs;
let fn;

before(async () => {
  blobs = await startBlobsTestServer();
  // Exactly what Netlify puts in a function's environment.
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(blobs.clientOptions)).toString('base64');
  process.env.ADMIN_USERNAME = 'boss';
  process.env.ADMIN_PASSWORD = 'function-test-password';
  process.env.BLOBS_STORE_NAME = 'function-test-store';
  fn = await import('../netlify/functions/api.mjs');
});

after(async () => {
  await blobs.stop();
});

const call = async (method, path, { body, token } = {}) => {
  const response = await fn.default(
    new Request(`https://game.example${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    }),
    {} // Netlify's context argument; the handler does not need it
  );
  return { status: response.status, json: await response.json().catch(() => null) };
};

test('is routed for everything under /api/*', () => {
  assert.equal(fn.config.path, '/api/*');
  assert.equal(typeof fn.default, 'function');
});

test('serves the API using Blobs credentials taken from the environment', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);

  const finished = { name: 'Env Test', email: 'env@example.com', status: 'finished', scanned: 10, elapsed: 44.4, time: 44.4 };
  assert.equal((await call('PUT', `/api/plays/${id(1)}`, { body: finished })).status, 200);

  const board = await call('GET', '/api/leaderboard');
  assert.deepEqual(board.json.leaderboard.map((row) => [row.rank, row.name, row.time]), [[1, 'Env Test', 44.4]]);

  const login = await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'function-test-password' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.insecureDefaults, false);
  const exported = await call('GET', '/api/admin/export', { token: login.json.token });
  assert.equal(exported.json.participants[0].email, 'env@example.com');
});

test('data is shared across separate invocations (fresh handler per request)', async () => {
  // Each call above built a new handler and store; the data survived because it lives in Blobs.
  const board = await call('GET', '/api/leaderboard');
  assert.equal(board.json.finishedCount, 1);
});

test('bundles with esbuild, as Netlify does, without pulling in dev-only code', async () => {
  const result = await build({
    entryPoints: ['netlify/functions/api.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent'
  });
  const code = result.outputFiles[0].text;
  assert.match(code, /"\/api\/\*"/, 'route config is present in the bundle');
  assert.doesNotMatch(code, /dev-plugin|memory-store/, 'dev-server code is not shipped to production');
  assert.doesNotMatch(code, /createServer|vite/i, 'no dev server in the function');
});
