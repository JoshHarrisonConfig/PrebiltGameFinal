// Production storage: Netlify Blobs.
//
// The whole game lives in ONE JSON document so that every change (a scan, a finish, a
// clear) is atomic and totally ordered. Concurrent writers are serialized with the
// blob's ETag: saveState only succeeds if nobody else wrote since loadState, otherwise
// the API re-reads and retries. Reads and writes use strong consistency; the default
// (eventual) mode can serve data up to 60 seconds old, which is useless for a live board.

import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createEmptyState, normalizeLoadedState } from '../state.mjs';

const STATE_KEY = 'state';
const SECRET_KEY = 'auth-secret';

export const DEFAULT_STORE_NAME = 'barcode-game';

export function createBlobsStore({ name = DEFAULT_STORE_NAME, ...clientOptions } = {}) {
  const store = getStore({ name, consistency: 'strong', ...clientOptions });

  return {
    async loadState() {
      const entry = await store.getWithMetadata(STATE_KEY, { type: 'json', consistency: 'strong' });
      if (!entry) return { state: createEmptyState(), version: null };
      if (!entry.etag) throw new Error('Blob store returned no ETag; cannot do safe concurrent writes');
      return { state: normalizeLoadedState(entry.data), version: entry.etag };
    },

    // Resolves true if written, false if someone else wrote first (caller retries).
    async saveState(state, version) {
      const condition = version ? { onlyIfMatch: version } : { onlyIfNew: true };
      const result = await store.setJSON(STATE_KEY, state, condition);
      return result.modified;
    },

    // Random signing secret, created once and kept next to the data. Two cold starts
    // racing to create it is safe: only one write wins, the other reads the winner.
    async getSecret() {
      const existing = await store.get(SECRET_KEY, { consistency: 'strong' });
      if (existing) return existing;
      const secret = randomBytes(32).toString('base64url');
      const result = await store.set(SECRET_KEY, secret, { onlyIfNew: true });
      if (result.modified) return secret;
      return store.get(SECRET_KEY, { consistency: 'strong' });
    }
  };
}
