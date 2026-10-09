// Local-development and test storage with the same interface and the same
// optimistic-concurrency semantics as the Netlify Blobs store.
//
// Pass `file` to persist across dev-server restarts. This is for a single local process
// only; production uses Netlify Blobs so that every serverless instance shares state.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createEmptyState, normalizeLoadedState } from '../state.mjs';

export function createMemoryStore({ file = null } = {}) {
  let document = null;
  let writes = 0;
  let secret = null;

  if (file && existsSync(file)) {
    try {
      document = JSON.parse(readFileSync(file, 'utf8'));
      writes = 1;
    } catch {
      document = null;
    }
  }

  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(document, null, 2));
    renameSync(temporary, file);
  }

  return {
    async loadState() {
      if (!document) return { state: createEmptyState(), version: null };
      return { state: normalizeLoadedState(structuredClone(document)), version: String(writes) };
    },

    async saveState(state, version) {
      const current = document ? String(writes) : null;
      if (version !== current) return false;
      document = structuredClone(state);
      writes += 1;
      persist();
      return true;
    },

    async getSecret() {
      secret ??= randomBytes(32).toString('base64url');
      return secret;
    }
  };
}
