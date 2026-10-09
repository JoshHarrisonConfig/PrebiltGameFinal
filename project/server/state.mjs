// Pure game state logic. No I/O, no clocks: callers pass `now`, so every rule is
// deterministic and unit-testable. The API layer loads state, calls one of these
// functions, then saves the result with an optimistic-concurrency check.

import {
  CODE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  PLAY_ID_PATTERN,
  PLAY_STATUS,
  REQUIRED_SCANS,
  SPOT_PRIZE_INTERVAL_MAX,
  STATUS_RANK,
  defaultSettings,
  isValidEmail,
  normalizeEmail,
  normalizeName
} from '../shared/protocol.js';

export const STATE_VERSION = 1;

export const LIMITS = Object.freeze({
  // Hard cap on stored plays so a script spamming the public endpoint cannot grow the
  // state document without bound. A conference is orders of magnitude below this.
  maxPlays: 5000,
  // A player who has not reported for this long is hidden from "Now playing".
  liveTtlMs: 45_000,
  // ...and after this long they are recorded as having abandoned the game.
  abandonAfterMs: 10 * 60_000,
  maxTimeSeconds: 24 * 60 * 60,
  leaderboardSize: 10
});

const { READY, PLAYING, ABANDONED, FINISHED } = PLAY_STATUS;

export function createEmptyState() {
  return {
    v: STATE_VERSION,
    rev: 0,
    spotPrizeCount: 0,
    settings: defaultSettings(),
    plays: {}
  };
}

// Tolerate a hand-edited or older document instead of crashing the whole API.
export function normalizeLoadedState(raw) {
  const base = createEmptyState();
  if (!raw || typeof raw !== 'object') return base;

  const settings = { ...base.settings, ...(raw.settings || {}) };
  if (!Number.isInteger(settings.spotPrizeInterval) || settings.spotPrizeInterval < 1) {
    settings.spotPrizeInterval = base.settings.spotPrizeInterval;
  }
  if (!Array.isArray(settings.barcodeSequence) || settings.barcodeSequence.length !== REQUIRED_SCANS) {
    settings.barcodeSequence = base.settings.barcodeSequence;
  }

  return {
    ...base,
    ...raw,
    rev: Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0,
    spotPrizeCount: Number.isInteger(raw.spotPrizeCount) && raw.spotPrizeCount >= 0 ? raw.spotPrizeCount : 0,
    settings,
    plays: raw.plays && typeof raw.plays === 'object' ? raw.plays : {}
  };
}

function fail(status, error) {
  return { ok: false, status, error };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

const round3 = (value) => Math.round(value * 1000) / 1000;

// A game that is still "ready"/"playing" but has not reported for a long time.
function isSilent(play, now) {
  const open = play.status === READY || play.status === PLAYING;
  return open && now - play.updatedAt > LIMITS.abandonAfterMs;
}

// Anything still "ready"/"playing" but silent for too long is recorded as abandoned.
// Returns true if anything changed.
export function sweepStalePlays(state, now) {
  let changed = false;
  for (const play of Object.values(state.plays)) {
    if (isSilent(play, now)) {
      play.status = ABANDONED;
      changed = true;
    }
  }
  return changed;
}

// Applies one snapshot from a player's device. Idempotent: devices retry until they get
// an answer, so the same snapshot (or an older one) arriving again must be harmless.
export function applyPlayUpdate(state, id, body, now) {
  if (typeof id !== 'string' || !PLAY_ID_PATTERN.test(id)) return fail(400, 'invalid_id');
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_body');

  const { status, scanned } = body;
  if (!Object.hasOwn(STATUS_RANK, status)) return fail(400, 'invalid_status');
  if (!Number.isInteger(scanned) || scanned < 0 || scanned > REQUIRED_SCANS) {
    return fail(400, 'invalid_scanned');
  }

  let elapsed = null;
  if (body.elapsed !== undefined && body.elapsed !== null) {
    if (!isFiniteNumber(body.elapsed) || body.elapsed < 0 || body.elapsed > LIMITS.maxTimeSeconds) {
      return fail(400, 'invalid_elapsed');
    }
    elapsed = round3(body.elapsed);
  }

  let time = null;
  if (status === FINISHED) {
    if (scanned !== REQUIRED_SCANS) return fail(400, 'invalid_scanned');
    if (!isFiniteNumber(body.time) || body.time <= 0 || body.time > LIMITS.maxTimeSeconds) {
      return fail(400, 'invalid_time');
    }
    time = round3(body.time);
  }

  let play = Object.hasOwn(state.plays, id) ? state.plays[id] : null;
  let changed = false;
  let created = false;

  if (!play) {
    const name = normalizeName(body.name);
    if (!name) return fail(400, 'invalid_name');
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return fail(400, 'invalid_email');
    if (Object.keys(state.plays).length >= LIMITS.maxPlays) return fail(429, 'capacity_reached');

    play = {
      id,
      name,
      email,
      status: READY,
      scanned: 0,
      elapsed: null,
      time: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      spotPrize: false
    };
    state.plays[id] = play;
    changed = true;
    created = true;
  }

  const incomingRank = STATUS_RANK[status];
  const currentRank = STATUS_RANK[play.status];
  const stale =
    play.status === FINISHED ||
    incomingRank < currentRank ||
    (incomingRank === currentRank && scanned < play.scanned);
  if (stale) return { ok: true, changed, created, play };

  // name and email are fixed when the play is created; later snapshots cannot edit them.
  play.status = status;
  play.scanned = Math.max(play.scanned, scanned);
  if (elapsed !== null) play.elapsed = Math.max(play.elapsed ?? 0, elapsed);
  play.updatedAt = now;

  if (status === FINISHED) {
    play.scanned = REQUIRED_SCANS;
    play.time = time;
    play.elapsed = time;
    play.finishedAt = now;
    // Same rule the app always had: every Nth finisher is a spot-prize winner.
    const interval = state.settings.spotPrizeInterval;
    state.spotPrizeCount = (state.spotPrizeCount + 1) % interval;
    play.spotPrize = state.spotPrizeCount === 0;
  }

  return { ok: true, changed: true, created, play };
}

function byFastest(a, b) {
  return a.time - b.time || a.finishedAt - b.finishedAt || (a.id < b.id ? -1 : 1);
}

function finishedPlays(state) {
  return Object.values(state.plays).filter((play) => play.status === FINISHED).sort(byFastest);
}

// The public view. Contains no emails and no play ids (an id lets its holder update that
// play, so it must never be exposed).
export function buildBoard(state, now, limit = LIMITS.leaderboardSize) {
  const finished = finishedPlays(state);

  const live = Object.values(state.plays)
    .filter(
      (play) =>
        (play.status === READY || play.status === PLAYING) && now - play.updatedAt <= LIMITS.liveTtlMs
    )
    .sort((a, b) => {
      const aPlaying = a.status === PLAYING ? 0 : 1;
      const bPlaying = b.status === PLAYING ? 0 : 1;
      return aPlaying - bPlaying || a.createdAt - b.createdAt;
    })
    .map((play) => ({
      name: play.name,
      status: play.status,
      scanned: play.scanned,
      // The device's timer keeps running between reports, so project it forward.
      elapsed:
        play.status === PLAYING && play.elapsed !== null
          ? round3(play.elapsed + (now - play.updatedAt) / 1000)
          : null
    }));

  return {
    rev: state.rev,
    serverNow: now,
    finishedCount: finished.length,
    leaderboard: finished.slice(0, limit).map((play, index) => ({
      rank: index + 1,
      name: play.name,
      time: play.time,
      finishedAt: play.finishedAt
    })),
    live
  };
}

// Admin-only: everything, including emails.
export function buildExport(state, now) {
  const rankById = new Map(finishedPlays(state).map((play, index) => [play.id, index + 1]));
  return Object.values(state.plays)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((play) => ({
      name: play.name,
      email: play.email,
      // The stored status is only corrected when something next writes, so a game that
      // went silent at the end of the event is reported as abandoned here as well.
      status: isSilent(play, now) ? ABANDONED : play.status,
      scanned: play.scanned,
      time: play.time,
      rank: rankById.get(play.id) ?? null,
      spotPrize: play.spotPrize,
      registeredAt: play.createdAt,
      finishedAt: play.finishedAt
    }));
}

// "Clear leaderboard": removes every play and restarts the spot-prize cadence, so test
// plays from a rehearsal cannot shift who wins during the event.
export function clearPlays(state) {
  const removed = Object.keys(state.plays).length;
  state.plays = {};
  state.spotPrizeCount = 0;
  return removed;
}

export function validateSettings(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'invalid_body');

  const next = {
    spotPrizeInterval: current.spotPrizeInterval,
    barcodeSequence: current.barcodeSequence
  };

  if (input.spotPrizeInterval !== undefined) {
    const interval = input.spotPrizeInterval;
    if (!Number.isInteger(interval) || interval < 1 || interval > SPOT_PRIZE_INTERVAL_MAX) {
      return fail(400, 'invalid_spot_prize_interval');
    }
    next.spotPrizeInterval = interval;
  }

  if (input.barcodeSequence !== undefined) {
    const sequence = input.barcodeSequence;
    if (!Array.isArray(sequence) || sequence.length !== REQUIRED_SCANS) {
      return fail(400, 'invalid_barcode_sequence');
    }
    const cleaned = [];
    for (let index = 0; index < sequence.length; index += 1) {
      const item = sequence[index];
      if (!item || typeof item !== 'object') return fail(400, 'invalid_barcode_sequence');
      const code = typeof item.code === 'string' ? item.code.trim() : '';
      const description = typeof item.description === 'string' ? item.description.trim() : '';
      if (code.length > CODE_MAX_LENGTH || description.length > DESCRIPTION_MAX_LENGTH) {
        return fail(400, 'invalid_barcode_sequence');
      }
      cleaned.push({ position: index + 1, code, description });
    }
    next.barcodeSequence = cleaned;
  }

  return { ok: true, settings: next };
}

export function applySettings(state, settings) {
  const intervalChanged = settings.spotPrizeInterval !== state.settings.spotPrizeInterval;
  state.settings = settings;
  // A new interval restarts the cadence (as the app always did when it was changed).
  if (intervalChanged) state.spotPrizeCount = 0;
}
