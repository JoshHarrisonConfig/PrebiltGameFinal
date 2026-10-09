import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  applyPlayUpdate,
  applySettings,
  buildBoard,
  buildExport,
  clearPlays,
  createEmptyState,
  normalizeLoadedState,
  sweepStalePlays,
  validateSettings
} from '../server/state.mjs';

const id = (n) => String(n).padStart(32, '0');
const T0 = 1_700_000_000_000;

function player(n, extra = {}) {
  return { name: `Player ${n}`, email: `p${n}@example.com`, status: 'ready', scanned: 0, elapsed: null, ...extra };
}

function finish(state, n, time, now = T0) {
  return applyPlayUpdate(
    state,
    id(n),
    player(n, { status: 'finished', scanned: 10, elapsed: time, time }),
    now
  );
}

test('creates a play in the ready state', () => {
  const state = createEmptyState();
  const result = applyPlayUpdate(state, id(1), player(1), T0);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.changed, true);
  assert.equal(state.plays[id(1)].status, 'ready');
  assert.equal(state.plays[id(1)].email, 'p1@example.com');
});

test('rejects malformed ids, including prototype-pollution lookalikes', () => {
  const state = createEmptyState();
  for (const bad of ['__proto__', 'constructor', 'short', 'UPPERCASEHEX0000000000', '../etc/passwd', '']) {
    const result = applyPlayUpdate(state, bad, player(1), T0);
    assert.deepEqual([result.ok, result.error], [false, 'invalid_id'], bad);
  }
  assert.equal(Object.keys(state.plays).length, 0);
  assert.equal({}.polluted, undefined);
});

test('validates the fields of a snapshot', () => {
  const cases = [
    [{ ...player(1), name: '   ' }, 'invalid_name'],
    [{ ...player(1), name: undefined }, 'invalid_name'],
    [{ ...player(1), email: 'not-an-email' }, 'invalid_email'],
    [{ ...player(1), email: 'a'.repeat(250) + '@x.io' }, 'invalid_email'],
    [{ ...player(1), status: 'winning' }, 'invalid_status'],
    [{ ...player(1), scanned: 11 }, 'invalid_scanned'],
    [{ ...player(1), scanned: -1 }, 'invalid_scanned'],
    [{ ...player(1), scanned: 2.5 }, 'invalid_scanned'],
    [{ ...player(1), elapsed: -3 }, 'invalid_elapsed'],
    [{ ...player(1), elapsed: 'soon' }, 'invalid_elapsed'],
    [{ ...player(1), status: 'finished', scanned: 9, time: 30 }, 'invalid_scanned'],
    [{ ...player(1), status: 'finished', scanned: 10, time: 0 }, 'invalid_time'],
    [{ ...player(1), status: 'finished', scanned: 10, time: -5 }, 'invalid_time'],
    [{ ...player(1), status: 'finished', scanned: 10, time: Infinity }, 'invalid_time'],
    [{ ...player(1), status: 'finished', scanned: 10, time: LIMITS.maxTimeSeconds + 1 }, 'invalid_time'],
    [{ ...player(1), status: 'finished', scanned: 10 }, 'invalid_time'],
    [null, 'invalid_body'],
    [[], 'invalid_body']
  ];
  for (const [body, expected] of cases) {
    const state = createEmptyState();
    const result = applyPlayUpdate(state, id(1), body, T0);
    assert.equal(result.error, expected, JSON.stringify(body));
    assert.equal(Object.keys(state.plays).length, 0, 'a rejected snapshot must not create a play');
  }
});

const chr = (codePoint) => String.fromCodePoint(codePoint);

test('names are cleaned: control, zero-width and bidi-override characters removed', () => {
  const state = createEmptyState();
  // right-to-left override, zero-width space, NUL, newline
  const dirty = ['  Ada', chr(0x202e), ' ', chr(0x200b), 'Love', chr(0), 'lace\n  '].join('');
  applyPlayUpdate(state, id(1), player(1, { name: dirty }), T0);
  assert.equal(state.plays[id(1)].name, 'Ada Lovelace');

  applyPlayUpdate(state, id(2), player(2, { name: 'x'.repeat(100) }), T0);
  assert.equal(state.plays[id(2)].name.length, 30);

  // Emoji are counted as characters and never split in half.
  applyPlayUpdate(state, id(3), player(3, { name: chr(0x1f600).repeat(40) }), T0);
  assert.equal(Array.from(state.plays[id(3)].name).length, 30);
  assert.doesNotMatch(state.plays[id(3)].name, /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test('joiners that real names and emoji need are kept, but an invisible-only name is refused', () => {
  const state = createEmptyState();
  const persian = ['mi', chr(0x200c), 'khahad'].join(''); // zero-width non-joiner
  applyPlayUpdate(state, id(1), player(1, { name: persian }), T0);
  assert.equal(state.plays[id(1)].name, persian);

  const family = [chr(0x1f468), chr(0x200d), chr(0x1f469)].join(''); // emoji joined by ZWJ
  applyPlayUpdate(state, id(2), player(2, { name: family }), T0);
  assert.equal(state.plays[id(2)].name, family);

  const blanks = [chr(0xa0), ' ', '\t'].join(''); // non-breaking space, space, tab
  for (const invisible of [chr(0x200d).repeat(5), chr(0x200b), [chr(0x202e), chr(0x200c)].join(''), blanks]) {
    const result = applyPlayUpdate(createEmptyState(), id(3), player(3, { name: invisible }), T0);
    assert.equal(result.error, 'invalid_name');
  }
});

test('progress only moves forward and never overwrites identity', () => {
  const state = createEmptyState();
  applyPlayUpdate(state, id(1), player(1), T0);
  applyPlayUpdate(state, id(1), player(1, { status: 'playing', scanned: 4, elapsed: 20 }), T0 + 1000);

  // A delayed older snapshot arrives late (retry after a Wi-Fi blip).
  const late = applyPlayUpdate(state, id(1), player(1, { status: 'playing', scanned: 2, elapsed: 8 }), T0 + 2000);
  assert.equal(late.changed, false);
  assert.equal(state.plays[id(1)].scanned, 4);
  assert.equal(state.plays[id(1)].elapsed, 20);

  const backwards = applyPlayUpdate(state, id(1), player(1, { status: 'ready' }), T0 + 3000);
  assert.equal(backwards.changed, false);
  assert.equal(state.plays[id(1)].status, 'playing');

  // Name/email are fixed when the play is created.
  applyPlayUpdate(
    state,
    id(1),
    { name: 'Mallory', email: 'mallory@evil.test', status: 'playing', scanned: 5, elapsed: 25 },
    T0 + 4000
  );
  assert.equal(state.plays[id(1)].name, 'Player 1');
  assert.equal(state.plays[id(1)].email, 'p1@example.com');
  assert.equal(state.plays[id(1)].scanned, 5);
});

test('a heartbeat (same snapshot again) refreshes updatedAt', () => {
  const state = createEmptyState();
  const snapshot = player(1, { status: 'playing', scanned: 3, elapsed: 12 });
  applyPlayUpdate(state, id(1), snapshot, T0);
  const again = applyPlayUpdate(state, id(1), snapshot, T0 + 10_000);
  assert.equal(again.changed, true);
  assert.equal(state.plays[id(1)].updatedAt, T0 + 10_000);
});

test('finishing records the result once and is idempotent', () => {
  const state = createEmptyState();
  const first = finish(state, 1, 61.2345, T0);
  assert.equal(first.ok, true);
  assert.equal(state.plays[id(1)].status, 'finished');
  assert.equal(state.plays[id(1)].time, 61.235);
  assert.equal(state.plays[id(1)].finishedAt, T0);
  assert.equal(state.plays[id(1)].scanned, 10);

  // The device retries because it never saw the response: nothing may change.
  const retry = finish(state, 1, 61.2345, T0 + 5000);
  assert.equal(retry.changed, false);
  assert.equal(state.plays[id(1)].finishedAt, T0);

  // A finished result cannot be rewritten or undone, by anyone holding the id.
  const faster = finish(state, 1, 5, T0 + 6000);
  assert.equal(faster.changed, false);
  assert.equal(state.plays[id(1)].time, 61.235);
  for (const status of ['playing', 'abandoned', 'ready']) {
    applyPlayUpdate(state, id(1), player(1, { status, scanned: 3 }), T0 + 7000);
  }
  assert.equal(state.plays[id(1)].status, 'finished');
});

test('an unknown play can be created and finished in one snapshot', () => {
  const state = createEmptyState();
  const result = finish(state, 7, 44.5);
  assert.equal(result.created, true);
  assert.equal(state.plays[id(7)].status, 'finished');
});

test('spot prize goes to every Nth finisher and is not double counted by retries', () => {
  const state = createEmptyState();
  state.settings.spotPrizeInterval = 3;
  const winners = [];
  for (let n = 1; n <= 7; n += 1) {
    finish(state, n, 30 + n);
    finish(state, n, 30 + n); // retry
    if (state.plays[id(n)].spotPrize) winners.push(n);
  }
  assert.deepEqual(winners, [3, 6]);
});

test('ranks by time, then by who finished first, and the public board hides private data', () => {
  const state = createEmptyState();
  finish(state, 1, 50, T0 + 1);
  finish(state, 2, 40, T0 + 2);
  finish(state, 3, 40, T0 + 3); // same time as player 2, finished later
  finish(state, 4, 99, T0 + 4);

  const board = buildBoard(state, T0 + 10);
  assert.deepEqual(
    board.leaderboard.map((row) => [row.rank, row.name, row.time]),
    [
      [1, 'Player 2', 40],
      [2, 'Player 3', 40],
      [3, 'Player 1', 50],
      [4, 'Player 4', 99]
    ]
  );
  assert.equal(board.finishedCount, 4);

  const text = JSON.stringify(board);
  assert.doesNotMatch(text, /example\.com/, 'emails must never reach the public board');
  assert.doesNotMatch(text, /0000000000000000000000000000000/, 'play ids must never reach the public board');
});

test('the public board is capped at the top 10 but still reports how many finished', () => {
  const state = createEmptyState();
  for (let n = 1; n <= 14; n += 1) finish(state, n, 100 - n);
  const board = buildBoard(state, T0 + 1);
  assert.equal(board.leaderboard.length, 10);
  assert.equal(board.finishedCount, 14);
  assert.equal(board.leaderboard[0].name, 'Player 14');
  // Nothing was thrown away: the export still has every participant.
  assert.equal(buildExport(state, T0).length, 14);
});

test('live list shows active players, projects elapsed time, and hides silent ones', () => {
  const state = createEmptyState();
  applyPlayUpdate(state, id(1), player(1, { status: 'playing', scanned: 4, elapsed: 20 }), T0);
  applyPlayUpdate(state, id(2), player(2), T0); // ready, not started yet

  let board = buildBoard(state, T0 + 5000);
  assert.deepEqual(
    board.live.map((row) => [row.name, row.status, row.scanned, row.elapsed]),
    [
      ['Player 1', 'playing', 4, 25],
      ['Player 2', 'ready', 0, null]
    ]
  );

  board = buildBoard(state, T0 + LIMITS.liveTtlMs + 1);
  assert.deepEqual(board.live, [], 'players that stopped reporting disappear from Now playing');
});

test('stale open plays are swept to abandoned, yet can still finish later', () => {
  const state = createEmptyState();
  applyPlayUpdate(state, id(1), player(1, { status: 'playing', scanned: 6, elapsed: 30 }), T0);
  assert.equal(sweepStalePlays(state, T0 + 1000), false);
  assert.equal(sweepStalePlays(state, T0 + LIMITS.abandonAfterMs + 1), true);
  assert.equal(state.plays[id(1)].status, 'abandoned');

  // The device was offline for a long while, came back, and finished: that still counts.
  const result = finish(state, 1, 75, T0 + LIMITS.abandonAfterMs + 60_000);
  assert.equal(result.changed, true);
  assert.equal(state.plays[id(1)].status, 'finished');
  assert.equal(buildBoard(state, T0 + LIMITS.abandonAfterMs + 61_000).leaderboard.length, 1);
});

test('a hard cap on stored plays protects the document from unbounded growth', () => {
  const state = createEmptyState();
  for (let n = 0; n < LIMITS.maxPlays; n += 1) {
    state.plays[id(n + 1)] = { id: id(n + 1), status: 'abandoned', scanned: 0, createdAt: T0, updatedAt: T0 };
  }
  const result = applyPlayUpdate(state, id(999999), player(1), T0);
  assert.deepEqual([result.ok, result.status, result.error], [false, 429, 'capacity_reached']);
  // Existing plays can still be updated when full.
  const existing = applyPlayUpdate(state, id(1), player(1, { status: 'finished', scanned: 10, time: 50 }), T0);
  assert.equal(existing.ok, true);
});

test('clearing removes every play and restarts the spot prize cadence', () => {
  const state = createEmptyState();
  state.settings.spotPrizeInterval = 3;
  finish(state, 1, 40);
  finish(state, 2, 41);
  assert.equal(state.spotPrizeCount, 2);
  assert.equal(clearPlays(state), 2);
  assert.deepEqual(state.plays, {});
  assert.equal(state.spotPrizeCount, 0);
});

test('export lists everyone with their email, rank and status', () => {
  const state = createEmptyState();
  applyPlayUpdate(state, id(1), player(1), T0);
  finish(state, 2, 55, T0 + 10);
  const rows = buildExport(state, T0 + 10);
  assert.deepEqual(
    rows.map((row) => [row.name, row.email, row.status, row.rank, row.time]),
    [
      ['Player 1', 'p1@example.com', 'ready', null, null],
      ['Player 2', 'p2@example.com', 'finished', 1, 55]
    ]
  );
});

test('export reports a game that went silent as abandoned, even if nothing has written since', () => {
  const state = createEmptyState();
  applyPlayUpdate(state, id(1), player(1, { status: 'playing', scanned: 4, elapsed: 20 }), T0);
  finish(state, 2, 55, T0);

  const later = T0 + LIMITS.abandonAfterMs + 1000;
  const rows = buildExport(state, later);
  assert.deepEqual(rows.map((row) => row.status), ['abandoned', 'finished']);
  // Reading must not change anything; the finished result is never reclassified.
  assert.equal(state.plays[id(1)].status, 'playing');
  assert.deepEqual(buildExport(state, T0 + 1000).map((row) => row.status), ['playing', 'finished']);
});

test('settings validation', () => {
  const current = createEmptyState().settings;
  const sequence = Array.from({ length: 10 }, (_, i) => ({ code: ` CODE${i} `, description: ' d ', position: 99 }));

  const ok = validateSettings({ spotPrizeInterval: 7, barcodeSequence: sequence }, current);
  assert.equal(ok.ok, true);
  assert.equal(ok.settings.spotPrizeInterval, 7);
  assert.deepEqual(ok.settings.barcodeSequence[3], { position: 4, code: 'CODE3', description: 'd' });

  const partial = validateSettings({ spotPrizeInterval: 2 }, current);
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.settings.barcodeSequence, current.barcodeSequence);

  for (const bad of [
    { spotPrizeInterval: 0 },
    { spotPrizeInterval: -1 },
    { spotPrizeInterval: 1.5 },
    { spotPrizeInterval: '5' },
    { spotPrizeInterval: 100000 },
    { barcodeSequence: sequence.slice(0, 9) },
    { barcodeSequence: 'nope' },
    { barcodeSequence: sequence.map(() => ({ code: 'x'.repeat(500), description: '' })) },
    null,
    []
  ]) {
    assert.equal(validateSettings(bad, current).ok, false, JSON.stringify(bad));
  }
});

test('changing the interval restarts the spot prize cadence, re-saving the same one does not', () => {
  const state = createEmptyState();
  finish(state, 1, 40);
  finish(state, 2, 41);
  assert.equal(state.spotPrizeCount, 2);

  applySettings(state, { ...state.settings, spotPrizeInterval: 5 });
  assert.equal(state.spotPrizeCount, 2, 'same interval keeps the count');

  applySettings(state, { ...state.settings, spotPrizeInterval: 9 });
  assert.equal(state.spotPrizeCount, 0);
});

test('a damaged stored document cannot break the API', () => {
  const broken = normalizeLoadedState({ rev: 'x', spotPrizeCount: -4, settings: { spotPrizeInterval: 0, barcodeSequence: 'bad' }, plays: 5 });
  assert.equal(broken.rev, 0);
  assert.equal(broken.spotPrizeCount, 0);
  assert.equal(broken.settings.spotPrizeInterval, 5);
  assert.equal(broken.settings.barcodeSequence.length, 10);
  assert.deepEqual(broken.plays, {});
  assert.deepEqual(normalizeLoadedState(null), createEmptyState());
});
