// A durable "send this until the server confirms it" queue.
//
// Conference Wi-Fi drops. A participant's finished game must never be lost because the
// request happened to fail, so every update to the server goes through here:
//   - each game keeps only its LATEST snapshot (a newer one replaces an older one),
//   - snapshots are kept in localStorage until the server acknowledges them, so they
//     survive a page reload,
//   - sending is retried with growing delays, and
//   - the server treats every snapshot as idempotent, so re-sending is always safe.
//
// Written without browser globals (storage, sender and timers are injected) so it can be
// unit-tested in Node.

import { STATUS_RANK } from '../../shared/protocol.js';

const STORAGE_KEY = 'prebilt_outbox_v1';
const MAX_ENTRIES = 50;

// Combine an already-queued snapshot with a newer one for the same game. Mirrors the
// server's rules: finished is final, status and progress never move backwards.
export function mergeSnapshots(previous, next) {
  if (!previous) return { ...next };
  if (previous.status === 'finished') return previous;
  if (STATUS_RANK[next.status] < STATUS_RANK[previous.status]) return previous;

  const elapsed = [previous.elapsed, next.elapsed].filter((value) => typeof value === 'number');
  return {
    ...previous,
    ...next,
    scanned: Math.max(previous.scanned ?? 0, next.scanned ?? 0),
    elapsed: elapsed.length ? Math.max(...elapsed) : null
  };
}

export function createOutbox({
  storage,
  send,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  initialDelayMs = 1000,
  maxDelayMs = 15000
}) {
  let entries = load();
  let running = false;
  let runPromise = Promise.resolve();
  let retryTimer = null;
  let delayMs = initialDelayMs;
  let sequence = 0;
  const listeners = new Set();
  let lastError = null;

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
    } catch {
      return {};
    }
  }

  function persist() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries }));
    } catch {
      // Storage may be full or blocked (private mode). Delivery still works from memory.
    }
  }

  function emit() {
    for (const listener of listeners) {
      try {
        listener({ pending: Object.keys(entries).length, error: lastError });
      } catch {
        // A faulty listener must not break delivery.
      }
    }
  }

  function trim() {
    const ids = Object.keys(entries);
    if (ids.length <= MAX_ENTRIES) return;
    // Under pressure drop the oldest unfinished games first; finished results are precious.
    const droppable = ids
      .filter((id) => entries[id].snapshot.status !== 'finished')
      .sort((a, b) => entries[a].queuedAt - entries[b].queuedAt);
    for (const id of droppable.slice(0, ids.length - MAX_ENTRIES)) delete entries[id];
  }

  function oldest() {
    const ids = Object.keys(entries);
    if (ids.length === 0) return null;
    ids.sort((a, b) => entries[a].queuedAt - entries[b].queuedAt);
    return ids[0];
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      flush();
    }, delayMs);
    delayMs = Math.min(delayMs * 2, maxDelayMs);
  }

  async function run() {
    for (;;) {
      const id = oldest();
      // No await between this check and clearing `running`: a snapshot queued at any
      // other moment is guaranteed to be picked up by a new run.
      if (!id) {
        running = false;
        delayMs = initialDelayMs;
        lastError = null;
        emit();
        return;
      }

      const { snapshot, seq } = entries[id];
      try {
        await send(snapshot);
      } catch (error) {
        lastError = error;
        if (error?.retryable === false) {
          // The server will never accept this one (invalid data). Drop it so it cannot
          // block everything queued behind it.
          delete entries[id];
          persist();
          emit();
          continue;
        }
        running = false;
        scheduleRetry();
        emit();
        return;
      }

      // If the game moved on while this request was in flight, keep the newer snapshot
      // queued and send it next.
      if (entries[id] && entries[id].seq === seq) {
        delete entries[id];
        persist();
      }
      delayMs = initialDelayMs;
      lastError = null;
      emit();
    }
  }

  function flush() {
    if (running) return runPromise;
    running = true;
    runPromise = run();
    return runPromise;
  }

  return {
    enqueue(snapshot) {
      const existing = entries[snapshot.id];
      sequence += 1;
      entries[snapshot.id] = {
        snapshot: mergeSnapshots(existing?.snapshot, snapshot),
        seq: sequence,
        queuedAt: existing?.queuedAt ?? now()
      };
      trim();
      persist();
      emit();
      return flush();
    },

    flush,

    pendingCount: () => Object.keys(entries).length,
    has: (id) => Boolean(entries[id]),

    // Resolves true as soon as the game's latest snapshot has been delivered, or false if
    // that has not happened within `timeoutMs` (it stays queued and keeps retrying).
    whenDelivered(id, timeoutMs) {
      if (!entries[id]) return Promise.resolve(true);
      return new Promise((resolve) => {
        let timer = null;
        const finish = (value) => {
          clearTimer(timer);
          listeners.delete(check);
          resolve(value);
        };
        const check = () => {
          if (!entries[id]) finish(true);
        };
        timer = setTimer(() => finish(false), timeoutMs);
        listeners.add(check);
      });
    },

    // Subscribe to { pending, error } changes. Returns an unsubscribe function.
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
