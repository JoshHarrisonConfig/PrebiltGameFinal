// Post-deploy smoke test for the shared leaderboard API.
//
//   node scripts/smoke.mjs https://game.theconfigteam.com
//   SMOKE_ADMIN_PASSWORD=... node scripts/smoke.mjs https://game.theconfigteam.com   (also checks admin)
//
// Run it after deploying and before the event. It exercises the real storage layer:
// read-after-write, and several devices writing at the same moment. It only creates
// players named "SMOKE TEST ..." and marks them abandoned, so they never show on the
// leaderboard or under "Now playing". Because a smoke test must never delete real data,
// those rows remain in the admin export until you press "Clear Leaderboard" - so run it
// BEFORE the event, not during it.

import { randomBytes } from 'node:crypto';

const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(baseUrl)) {
  console.error('Usage: node scripts/smoke.mjs <site url>   e.g. https://game.theconfigteam.com');
  process.exit(2);
}

const adminUser = process.env.SMOKE_ADMIN_USERNAME || 'admin';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || '';
let failures = 0;

function report(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function call(method, path, { body, token } = {}) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, json, text, ms: Date.now() - started, headers: response.headers };
}

const newId = () => randomBytes(16).toString('hex');
const snapshot = (name, extra = {}) => ({
  name,
  email: 'smoke-test@example.invalid',
  status: 'ready',
  scanned: 0,
  elapsed: null,
  ...extra
});

async function main() {
  console.log(`Smoke testing ${baseUrl}\n`);

  // 1. The function is deployed and can reach storage.
  const health = await call('GET', '/api/health');
  report(health.status === 200 && health.json?.ok === true, 'API is deployed and storage is reachable', `${health.status}, ${health.ms}ms`);
  if (health.status !== 200) {
    console.log('\nThe API did not answer. Check that the site was deployed from the `project` folder,');
    console.log('that netlify/functions/api.mjs was included, and the function logs in the Netlify UI.');
    return;
  }
  report(health.headers.get('cache-control') === 'no-store', 'responses are marked no-store');

  // 2. A device registers; a second device sees it immediately (strong consistency).
  const soloId = newId();
  const created = await call('PUT', `/api/plays/${soloId}`, { body: snapshot('SMOKE TEST solo') });
  report(created.status === 200 && created.json?.created === true, 'a device can register a player', `${created.status}`);

  const seen = await call('GET', '/api/leaderboard');
  const visible = seen.json?.live?.some((player) => player.name === 'SMOKE TEST solo');
  report(visible, 'another device sees it straight away (read-after-write)');
  report(!JSON.stringify(seen.json).includes('smoke-test@example.invalid'), 'the public leaderboard exposes no email');

  // 3. Several devices write at the same instant: nobody's update may be lost.
  const ids = Array.from({ length: 6 }, newId);
  const results = await Promise.all(
    ids.map((id, index) => call('PUT', `/api/plays/${id}`, { body: snapshot(`SMOKE TEST parallel ${index + 1}`) }))
  );
  const acknowledged = results.filter((result) => result.status === 200).length;
  const refused = results.filter((result) => result.status === 503).length;
  const afterBurst = await call('GET', '/api/leaderboard');
  const present = afterBurst.json.live.filter((player) => player.name.startsWith('SMOKE TEST parallel')).length;
  report(
    present === acknowledged && acknowledged + refused === ids.length,
    'parallel writers: every acknowledged write is stored, none lost',
    `${acknowledged} acknowledged, ${refused} asked to retry, ${present} stored`
  );

  // 4. Tidy up: mark every test player abandoned so they leave "Now playing".
  const everything = [soloId, ...ids];
  const names = ['SMOKE TEST solo', ...ids.map((_, i) => `SMOKE TEST parallel ${i + 1}`)];
  await Promise.all(
    everything.map((id, index) => call('PUT', `/api/plays/${id}`, { body: snapshot(names[index], { status: 'abandoned' }) }))
  );
  const cleaned = await call('GET', '/api/leaderboard');
  report(
    !cleaned.json.live.some((player) => player.name.startsWith('SMOKE TEST')),
    'test players were removed from "Now playing"'
  );

  // 5. Admin side (optional).
  const unauthenticated = await call('GET', '/api/admin/export');
  report(unauthenticated.status === 401, 'admin data is refused without a login', `${unauthenticated.status}`);

  if (!adminPassword) {
    console.log('\nSKIP  admin checks (set SMOKE_ADMIN_PASSWORD to include them)');
    return;
  }
  const login = await call('POST', '/api/admin/login', { body: { username: adminUser, password: adminPassword } });
  report(login.status === 200 && Boolean(login.json?.token), 'admin login works', `${login.status}`);
  if (login.status !== 200) return;

  report(login.json.insecureDefaults === false, 'admin password is configured (not the built-in default)');
  const exported = await call('GET', '/api/admin/export', { token: login.json.token });
  report(
    exported.status === 200 && exported.json.participants.some((p) => p.name === 'SMOKE TEST solo' && p.status === 'abandoned'),
    'admin export includes participant details'
  );
  const settings = await call('GET', '/api/admin/settings', { token: login.json.token });
  report(settings.status === 200 && settings.json.settings.barcodeSequence.length === 10, 'admin settings load');
  console.log('\nNote: the SMOKE TEST rows stay in the admin export. Press "Clear Leaderboard" before the event.');
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.error('FAIL  could not complete the smoke test:', error.message);
}
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
