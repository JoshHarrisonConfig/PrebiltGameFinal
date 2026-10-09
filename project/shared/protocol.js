// Rules shared by the browser app and the API, so both ends agree on what is valid.
// Plain ES module with no imports: it runs in the browser, in Node and in Netlify Functions.

export const REQUIRED_SCANS = 10;
export const NAME_MAX_LENGTH = 30;
export const EMAIL_MAX_LENGTH = 254;
export const CODE_MAX_LENGTH = 128;
export const DESCRIPTION_MAX_LENGTH = 200;
export const SPOT_PRIZE_INTERVAL_MAX = 1000;

export const PLAY_STATUS = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  ABANDONED: 'abandoned',
  FINISHED: 'finished'
});

// When updates arrive out of order (retries, flaky Wi-Fi) the higher rank wins, so a
// late "playing" snapshot can never undo "finished".
export const STATUS_RANK = Object.freeze({
  [PLAY_STATUS.READY]: 0,
  [PLAY_STATUS.PLAYING]: 1,
  [PLAY_STATUS.ABANDONED]: 2,
  [PLAY_STATUS.FINISHED]: 3
});

// Play ids are random capability tokens generated on the device. Hex-only keeps them
// safe to use as object keys (no "__proto__" / "constructor" lookalikes).
export const PLAY_ID_PATTERN = /^[a-f0-9]{16,64}$/;

// Names are shown on a big screen, so characters that hide or reorder text are removed:
// control characters, line/paragraph separators and invisible "format" characters such
// as zero-width spaces and bidirectional overrides. Zero-width joiner / non-joiner are
// kept because real names need them (Persian, Indic scripts) and so do emoji sequences.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const JOINERS = new Set([0x200c, 0x200d]);

function stripInvisible(value) {
  return Array.from(value)
    .filter((character) => JOINERS.has(character.codePointAt(0)) || !INVISIBLE.test(character))
    .join('');
}

export function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const cleaned = stripInvisible(value.slice(0, 200)).replace(/\s+/g, ' ').trim();
  // A name made only of joiners would render as blank space on the leaderboard.
  if (!/[^\p{Z}\p{C}]/u.test(cleaned)) return '';
  // Count code points, not UTF-16 units, so emoji are never cut in half.
  return Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join('').trim();
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return stripInvisible(value.slice(0, EMAIL_MAX_LENGTH + 50)).trim();
}

export function isValidEmail(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function defaultSettings() {
  return {
    spotPrizeInterval: 5,
    barcodeSequence: Array.from({ length: REQUIRED_SCANS }, (_, index) => ({
      position: index + 1,
      code: '',
      description: ''
    }))
  };
}
