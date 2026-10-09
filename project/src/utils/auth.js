// Admin sign-in. The password is checked by the server, which hands back a signed,
// expiring token. This device keeps only that token; the credentials are no longer
// part of the app bundle, and "being an admin" is no longer a flag anyone can set.

import { ApiError, apiRequest } from './api.js';

const SESSION_KEY = 'prebilt_admin_token';
// The previous client-only flag. It proves nothing now, so it is simply discarded.
const LEGACY_SESSION_KEY = 'prebilt_admin_session';

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (session && typeof session.token === 'string' && session.expiresAt > Date.now()) return session;
  } catch {
    // Unreadable or blocked storage: treat as signed out.
  }
  return null;
}

// Resolves true when signed in, false for wrong credentials. Rejects (ApiError) if the
// server cannot be reached, so the UI can say that instead of "invalid credentials".
export async function authenticateAdmin(username, password) {
  try {
    const { token, expiresAt } = await apiRequest('/admin/login', {
      method: 'POST',
      body: { username, password }
    });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}

export function getAdminToken() {
  return readSession()?.token ?? null;
}

export function isAdminLoggedIn() {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // ignore
  }
  return readSession() !== null;
}

export function clearAdminSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // ignore
  }
}

// True if the server rejected our token (expired, or the admin password was changed).
// Signs out locally so the UI falls back to the logged-out view.
export function handleAuthFailure(error) {
  if (error instanceof ApiError && error.status === 401) {
    clearAdminSession();
    return true;
  }
  return false;
}
