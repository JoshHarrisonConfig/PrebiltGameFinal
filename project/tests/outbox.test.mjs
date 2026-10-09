import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, mergeSnapshots } from '../src/utils/outbox.js';

const id = (n) => String(n).padStart(32, '0');
const snap = (n, extra = {}) => ({
  id: id(n),
  name: `Player ${n}`,
  email: `p${n}@example.com`,
  status: 'ready',
  scanned: 0,
  elapsed: null,
  ...extra
});

// A controllable world: in-memory storage, hand-cranked timers, and a sender whose
// behaviour each test decides.
function createEnv({ storageMap = new Map(), failStorage = false } = {}) {
  const storage = {
    getItem: (key) => storageMap.get(key) ?? null,
    setItem: (key, value) => {
      if (failStorage) throw new Error('QuotaExceededError');
      storageMap.set(key, value);
    }
  };
  const timers = [];
  const env = {
    storageMap,
    sent: [],
    delays: () => timers.filter((t) => !t.cancelled && !t.fired).map((t) => t.ms),
    behavior: async () => {},
    setTimer(fn, ms) {
      const timer = { fn, ms, cancelled: false, fired: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.cancelled = true;
    },
    // Fire the oldest pending timer and let everything it triggers finish.
    async advance() {
      const timer = timers.find((t) => !t.cancelled && !t.fired);
      assert.ok(timer, 'expected a pending timer');
      timer.fired = true;
      timer.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
    create(extra = {}) {
      return createOutbox({
        storage,
        send: async (snapshot) => {
          env.sent.push(structuredClone(snapshot));
          await env.behavior(snapshot);
        },
        setTimer: env.setTimer,
        clearTimer: env.clearTimer,
        ...extra
      });
    }
  };
  return env;
}

const retryable = () => Object.assign(new Error('network'), { retryable: true });
const permanent = () => Object.assign(new Error('invalid_name'), { retryable: false });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('delivers a snapshot and empties the queue', async () => {
  const env = createEnv();
  const outbox = env.create();
  await outbox.enqueue(snap(1));
  assert.equal(env.sent.length, 1);
  assert.equal(outbox.pendingCount(), 0);
  assert.equal(outbox.has(id(1)), false);
});

test('a newer snapshot for the same game replaces the one still waiting', async () => {
  const env = createEnv();
  const outbox = env.create();
  let release;
  env.behavior = () => new Promise((resolve) => (release = resolve));

  const first = outbox.enqueue(snap(1)); // in flight, blocked
  await settle();
  outbox.enqueue(snap(1, { status: 'playing', scanned: 1, elapsed: 0 }));
  outbox.enqueue(snap(1, { status: 'playing', scanned: 2, elapsed: 5 }));
  outbox.enqueue(snap(1, { status: 'playing', scanned: 3, elapsed: 9 }));

  env.behavior = async () => {};
  release();
  await first;

  // The first request, then only the latest state - the in-between ones were superseded.
  assert.deepEqual(env.sent.map((s) => [s.status, s.scanned]), [['ready', 0], ['playing', 3]]);
  assert.equal(outbox.pendingCount(), 0);
});

test('keeps retrying with growing, capped delays until the server answers', async () => {
  const env = createEnv();
  const outbox = env.create({ initialDelayMs: 1000, maxDelayMs: 4000 });
  env.behavior = async () => {
    throw retryable();
  };

  await outbox.enqueue(snap(1));
  assert.deepEqual(env.delays(), [1000]);
  assert.equal(outbox.pendingCount(), 1, 'still queued');

  await env.advance();
  assert.deepEqual(env.delays(), [2000]);
  await env.advance();
  assert.deepEqual(env.delays(), [4000]);
  await env.advance();
  assert.deepEqual(env.delays(), [4000], 'capped');

  env.behavior = async () => {};
  await env.advance();
  assert.equal(outbox.pendingCount(), 0, 'delivered once the network is back');
  assert.equal(env.delays().length, 0);
  assert.equal(env.sent.length, 5);
});

test('queued results survive a page reload', async () => {
  const env = createEnv();
  const before = env.create();
  env.behavior = async () => {
    throw retryable();
  };
  await before.enqueue(snap(1, { status: 'finished', scanned: 10, elapsed: 61.5, time: 61.5 }));
  assert.equal(before.pendingCount(), 1);

  // New page load: a brand-new outbox reading the same storage.
  const after = env.create();
  assert.equal(after.pendingCount(), 1);
  env.behavior = async () => {};
  env.sent.length = 0;
  await after.flush();
  assert.deepEqual(env.sent.map((s) => [s.id, s.status, s.time]), [[id(1), 'finished', 61.5]]);
  assert.equal(after.pendingCount(), 0);
  assert.equal(env.create().pendingCount(), 0, 'and it is gone from storage too');
});

test('a snapshot the server will never accept is dropped and does not block the rest', async () => {
  const env = createEnv();
  const outbox = env.create();
  env.behavior = async (snapshot) => {
    if (snapshot.id === id(1)) throw permanent();
  };
  outbox.enqueue(snap(1));
  await outbox.enqueue(snap(2));
  await outbox.flush();
  assert.deepEqual(env.sent.map((s) => s.id), [id(1), id(2)]);
  assert.equal(outbox.pendingCount(), 0);
});

test('a temporarily failing game is retried in order and is not lost', async () => {
  const env = createEnv();
  const outbox = env.create();
  let down = true;
  env.behavior = async () => {
    if (down) throw retryable();
  };
  await outbox.enqueue(snap(1));
  await outbox.enqueue(snap(2));
  assert.equal(outbox.pendingCount(), 2);
  down = false;
  await env.advance();
  await outbox.flush();
  assert.equal(outbox.pendingCount(), 0);
  assert.deepEqual(env.sent.slice(-2).map((s) => s.id), [id(1), id(2)], 'oldest first');
});

test('merging never moves a game backwards, and finished is final', () => {
  const playing = snap(1, { status: 'playing', scanned: 5, elapsed: 30 });
  assert.deepEqual(mergeSnapshots(playing, snap(1, { status: 'ready' })), playing);
  assert.equal(mergeSnapshots(playing, snap(1, { status: 'playing', scanned: 3, elapsed: 12 })).scanned, 5);
  assert.equal(mergeSnapshots(playing, snap(1, { status: 'playing', scanned: 3, elapsed: 12 })).elapsed, 30);

  const done = snap(1, { status: 'finished', scanned: 10, elapsed: 70, time: 70 });
  assert.deepEqual(mergeSnapshots(done, snap(1, { status: 'abandoned', scanned: 4 })), done);
  assert.deepEqual(mergeSnapshots(done, snap(1, { status: 'playing', scanned: 9, elapsed: 80 })), done);

  const finishing = mergeSnapshots(playing, done);
  assert.equal(finishing.status, 'finished');
  assert.equal(finishing.time, 70);
  assert.equal(finishing.name, 'Player 1');
});

test('exiting after finishing cannot overwrite the result in the queue', async () => {
  const env = createEnv();
  const outbox = env.create();
  env.behavior = async () => {
    throw retryable();
  };
  await outbox.enqueue(snap(1, { status: 'playing', scanned: 9, elapsed: 50 }));
  await outbox.enqueue(snap(1, { status: 'finished', scanned: 10, elapsed: 55, time: 55 }));
  await outbox.enqueue(snap(1, { status: 'abandoned', scanned: 10, elapsed: 56 }));

  env.behavior = async () => {};
  env.sent.length = 0;
  await env.advance();
  assert.deepEqual(env.sent.map((s) => [s.status, s.time]), [['finished', 55]]);
});

test('whenDelivered resolves true on delivery and false if still waiting at the deadline', async () => {
  const env = createEnv();
  const outbox = env.create();

  // Server reachable: confirmed.
  const ok = outbox.enqueue(snap(1));
  assert.equal(await outbox.whenDelivered(id(1), 3000), true);
  await ok;

  // Server down: the deadline passes first, the result stays queued.
  env.behavior = async () => {
    throw retryable();
  };
  await outbox.enqueue(snap(2, { status: 'finished', scanned: 10, elapsed: 60, time: 60 }));
  const waiting = outbox.whenDelivered(id(2), 3000);
  const deadline = env.delays().length; // the retry timer is already pending
  assert.ok(deadline >= 1);
  // The deadline timer was created last; fire timers until the wait settles.
  let result;
  waiting.then((value) => (result = value));
  for (let i = 0; i < 5 && result === undefined; i += 1) await env.advance();
  assert.equal(result, false);
  assert.equal(outbox.has(id(2)), true, 'still queued, will keep retrying');

  // And if it is already delivered there is nothing to wait for.
  assert.equal(await outbox.whenDelivered(id(99), 3000), true);
});

test('a snapshot queued the instant the queue empties is still delivered', async () => {
  const env = createEnv();
  const outbox = env.create();
  await outbox.enqueue(snap(1));
  // Right after a run finished (nothing in flight), a new snapshot must start a new run.
  const second = outbox.enqueue(snap(1, { status: 'playing', scanned: 1, elapsed: 0 }));
  const third = outbox.enqueue(snap(2));
  await Promise.all([second, third]);
  assert.deepEqual(env.sent.map((s) => s.id).sort(), [id(1), id(1), id(2)].sort());
  assert.equal(outbox.pendingCount(), 0);
});

test('under pressure the oldest unfinished games are dropped, finished results never are', async () => {
  const env = createEnv();
  const outbox = env.create();
  env.behavior = async () => {
    throw retryable();
  };
  await outbox.enqueue(snap(1, { status: 'finished', scanned: 10, elapsed: 40, time: 40 }));
  for (let n = 2; n <= 60; n += 1) await outbox.enqueue(snap(n));
  assert.equal(outbox.pendingCount(), 50);
  assert.equal(outbox.has(id(1)), true, 'the finished result is kept');
  assert.equal(outbox.has(id(2)), false, 'the oldest unfinished one was dropped');
  assert.equal(outbox.has(id(60)), true);
});

test('survives corrupt or unavailable storage', async () => {
  const corrupt = createEnv({ storageMap: new Map([['prebilt_outbox_v1', '{not json']]) });
  assert.equal(corrupt.create().pendingCount(), 0);

  const blocked = createEnv({ failStorage: true });
  const outbox = blocked.create();
  await outbox.enqueue(snap(1));
  assert.equal(blocked.sent.length, 1, 'delivery does not depend on storage working');
});

test('listeners are told about the queue and a faulty one cannot break delivery', async () => {
  const env = createEnv();
  const outbox = env.create();
  const seen = [];
  outbox.subscribe(() => {
    throw new Error('buggy listener');
  });
  const stop = outbox.subscribe((state) => seen.push(state.pending));
  await outbox.enqueue(snap(1));
  assert.equal(seen[0], 1);
  assert.equal(seen.at(-1), 0);
  stop();
  const count = seen.length;
  await outbox.enqueue(snap(2));
  assert.equal(seen.length, count);
});
