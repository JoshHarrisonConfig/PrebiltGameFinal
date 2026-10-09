// Admin authentication, enforced on the server.
//
// Previously the admin check lived in the browser: the password was shipped in the
// JavaScript bundle and "logged in" was a flag in localStorage. That cannot protect
// shared data (participant emails, clearing the leaderboard) once it lives on a server.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Used only when ADMIN_USERNAME / ADMIN_PASSWORD are not configured, so existing
// deployments keep working. Always set ADMIN_PASSWORD for a real event.
const LEGACY_DEFAULTS = Object.freeze({ username: 'admin', password: 'prebilt2024' });

export function getAdminConfig(env = {}) {
  const username = env.ADMIN_USERNAME || LEGACY_DEFAULTS.username;
  const password = env.ADMIN_PASSWORD || LEGACY_DEFAULTS.password;
  return {
    username,
    password,
    usingDefaultPassword: !env.ADMIN_PASSWORD
  };
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

// Compares digests (equal length, constant time) so response timing leaks nothing about
// how much of a guess was correct. Both fields are always checked.
export function verifyCredentials(config, username, password) {
  const userOk = timingSafeEqual(digest(username), digest(config.username));
  const passOk = timingSafeEqual(digest(password), digest(config.password));
  return userOk && passOk;
}

// The signing key mixes the server secret with the current credentials: changing the
// admin password immediately invalidates every previously issued token.
function signingKey(secret, config) {
  return createHmac('sha256', secret).update(`admin:${config.username}:${config.password}`).digest();
}

export function signToken(secret, config, now, ttlMs = TOKEN_TTL_MS) {
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ u: config.username, exp: expiresAt })).toString('base64url');
  const signature = createHmac('sha256', signingKey(secret, config)).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

export function verifyToken(secret, config, token, now) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;

  const expected = createHmac('sha256', signingKey(secret, config)).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.u === config.username && Number.isFinite(claims.exp) && claims.exp > now;
  } catch {
    return false;
  }
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}
