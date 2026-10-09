// Keeps the shared server informed about the game this device is running, so the admin
// laptop (or any other device) can see who is playing and what they scored.
//
// Gameplay itself never waits on the network: every call just queues a snapshot in the
// outbox, which delivers it in the background and retries until the server confirms.

import { REQUIRED_SCANS } from '../../shared/protocol.js';
import { apiRequest } from './api.js';
import { createOutbox } from './outbox.js';

// How long finishing a game waits for the server to confirm before moving on (the result
// stays queued and keeps retrying either way).
const FINISH_CONFIRMATION_WAIT_MS = 3000;

function browserStorage() {
  try {
    const probe = '__prebilt_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    // Storage blocked: fall back to memory so the session still works.
    const memory = new Map();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value)
    };
  }
}

const outbox = createOutbox({
  storage: browserStorage(),
  send: ({ id, ...snapshot }) => apiRequest(`/plays/${id}`, { method: 'PUT', body: snapshot })
});

// 128 random bits. The id doubles as the secret that lets this device update its game, so
// it comes from the browser's cryptographic generator and is never shown to anyone else.
export function generatePlayId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Registers a new game for this participant and returns a handle to report on it.
export function startPlay({ name, email }) {
  const id = generatePlayId();
  const queue = (fields) => outbox.enqueue({ id, name, email, ...fields });

  queue({ status: 'ready', scanned: 0, elapsed: null });

  return {
    id,

    // Call after every scan, and periodically as a heartbeat while the game screen is open.
    // `elapsed` is the running timer in seconds, or null before the first scan.
    progress({ scanned, elapsed }) {
      queue({ status: scanned > 0 ? 'playing' : 'ready', scanned, elapsed });
    },

    // Records the final result. Resolves true once the server has confirmed it, false if it
    // is still waiting to be delivered (it will keep retrying in the background).
    finish({ time }) {
      queue({ status: 'finished', scanned: REQUIRED_SCANS, elapsed: time, time });
      return outbox.whenDelivered(id, FINISH_CONFIRMATION_WAIT_MS);
    },

    // The participant left without finishing.
    abandon({ scanned = 0, elapsed = null } = {}) {
      queue({ status: 'abandoned', scanned, elapsed });
    }
  };
}

// Deliver anything a previous visit could not (e.g. the tab was closed while offline).
export function resumePendingUploads() {
  return outbox.flush();
}

export const pendingUploads = () => outbox.pendingCount();
export const onUploadStateChange = (listener) => outbox.subscribe(listener);
