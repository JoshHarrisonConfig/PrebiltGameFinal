// Remembers, for this tab only, the game this device just finished, so the leaderboard
// can greet the participant and highlight their row.

import { normalizeName } from '../../shared/protocol.js';

const KEY = 'prebilt_last_result';
const MAX_AGE_MS = 15 * 60 * 1000;

export function saveLastResult({ name, time }) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name, time: Math.round(time * 1000) / 1000, at: Date.now() }));
  } catch {
    // Storage blocked: the highlight is a nicety, never required.
  }
}

export function readLastResult() {
  try {
    const result = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (result && typeof result.name === 'string' && Number.isFinite(result.time) && Date.now() - result.at < MAX_AGE_MS) {
      return result;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearLastResult() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Finds the participant's own entry in the board. The server stores a cleaned-up name and
// a time rounded to the millisecond, so both are normalised the same way before comparing.
export function findOwnRow(leaderboard, result) {
  if (!result) return null;
  const name = normalizeName(result.name);
  return leaderboard.find((row) => row.name === name && Math.abs(row.time - result.time) < 0.0005) ?? null;
}
