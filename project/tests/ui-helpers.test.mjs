import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avatarClass, formatFinished, initials } from '../src/utils/dom.js';
import { clearLastResult, findOwnRow, readLastResult, saveLastResult } from '../src/utils/result.js';

const chr = (codePoint) => String.fromCodePoint(codePoint);

test('initials: first and last word, whole characters, never empty', () => {
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('plato'), 'P');
  assert.equal(initials('  Jean   Claude  Van Damme '), 'JD');
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
  assert.equal(initials(null), '?');
  // An emoji at the start of a name is one character, not half a surrogate pair.
  assert.equal(initials(`${chr(0x1f600)} Smile`), `${chr(0x1f600)}S`);
});

test('avatarClass: stable per name and always one of the six hues', () => {
  assert.equal(avatarClass('Ada Lovelace'), avatarClass('Ada Lovelace'));
  const classes = new Set();
  for (const name of ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Tim', 'Hedy']) {
    const result = avatarClass(name);
    assert.match(result, /^avatar--[0-5]$/);
    classes.add(result);
  }
  assert.ok(classes.size >= 3, 'different people get different colours');
  assert.match(avatarClass(''), /^avatar--[0-5]$/);
});

test('formatFinished: today shows only the time, other days add the date', () => {
  const now = new Date(2026, 9, 9, 17, 30).getTime();
  const today = formatFinished(new Date(2026, 9, 9, 9, 5).getTime(), now);
  const earlier = formatFinished(new Date(2026, 9, 8, 22, 45).getTime(), now);

  assert.doesNotMatch(today.label, /,/, 'no date for today');
  assert.match(today.label, /5/);
  assert.match(earlier.label, /,/, 'earlier days include the date');
  assert.notEqual(today.label, earlier.label);
  assert.equal(new Date(today.iso).getTime(), new Date(2026, 9, 9, 9, 5).getTime());
});

test('findOwnRow: matches the participant by cleaned-up name and rounded time', () => {
  const board = [
    { rank: 1, name: 'Tom Okafor', time: 38.9 },
    { rank: 2, name: 'Ada Lovelace', time: 41.275 },
    { rank: 3, name: 'Ada Lovelace', time: 52.1 }
  ];
  // The server stores the time to the millisecond and collapses spaces in the name.
  assert.equal(findOwnRow(board, { name: '  Ada   Lovelace ', time: 41.2749 })?.rank, 2);
  assert.equal(findOwnRow(board, { name: 'Ada Lovelace', time: 52.1 })?.rank, 3, 'the same person can appear twice');
  assert.equal(findOwnRow(board, { name: 'Ada Lovelace', time: 99 }), null, 'outside the top 10');
  assert.equal(findOwnRow(board, { name: 'Someone Else', time: 38.9 }), null);
  assert.equal(findOwnRow(board, null), null);
  assert.equal(findOwnRow([], { name: 'Ada Lovelace', time: 41.275 }), null);
});

// ---- the "last result" memory (per browser tab) -----------------------------------------

let store;
beforeEach(() => {
  store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
});

test('last result is remembered, rounded to the millisecond, and can be cleared', () => {
  assert.equal(readLastResult(), null);
  saveLastResult({ name: 'Ada Lovelace', time: 41.27549 });
  const result = readLastResult();
  assert.equal(result.name, 'Ada Lovelace');
  assert.equal(result.time, 41.275);
  clearLastResult();
  assert.equal(readLastResult(), null);
});

test('a stale or damaged last result is ignored', () => {
  const realNow = Date.now;
  try {
    saveLastResult({ name: 'Ada Lovelace', time: 40 });
    Date.now = () => realNow() + 16 * 60 * 1000;
    assert.equal(readLastResult(), null, 'older than 15 minutes');
  } finally {
    Date.now = realNow;
  }
  store.set('prebilt_last_result', '{not json');
  assert.equal(readLastResult(), null);
  store.set('prebilt_last_result', JSON.stringify({ name: 5, time: 'x', at: Date.now() }));
  assert.equal(readLastResult(), null);
});

test('storage that throws never breaks the game', () => {
  globalThis.sessionStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    }
  };
  assert.doesNotThrow(() => saveLastResult({ name: 'Ada', time: 30 }));
  assert.equal(readLastResult(), null);
  assert.doesNotThrow(() => clearLastResult());
});
