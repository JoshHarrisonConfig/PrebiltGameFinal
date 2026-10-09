// The shared-leaderboard HTTP API, written against the standard Request/Response types
// so the same code runs in a Netlify Function, in the Vite dev server and in tests.
//
//   Public (used by every device)
//     GET    /api/leaderboard         top results + who is playing right now (no emails)
//     PUT    /api/plays/:id           a player's device reports its state (idempotent)
//     GET    /api/health              liveness + storage check
//   Admin (Bearer token from /api/admin/login)
//     POST   /api/admin/login
//     GET    /api/admin/settings      PUT /api/admin/settings
//     GET    /api/admin/export        everything, including emails
//     DELETE /api/admin/leaderboard   clear all results

import { bearerToken, getAdminConfig, signToken, verifyCredentials, verifyToken } from './auth.mjs';
import {
  applyPlayUpdate,
  applySettings,
  buildBoard,
  buildExport,
  clearPlays,
  sweepStalePlays,
  validateSettings
} from './state.mjs';

const MAX_WRITE_ATTEMPTS = 12;
const BACKOFF_BASE_MS = 20;
const BACKOFF_CAP_MS = 250;
const BODY_LIMIT_BYTES = 8 * 1024;

class HttpError extends Error {
  constructor(status, code, headers = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // This is live data: it must never be served from any cache.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

async function readJson(request, limit = BODY_LIMIT_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'payload_too_large');
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'payload_too_large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

// Load -> change -> save-if-unchanged. If another request wrote in between, the save is
// rejected and the whole step is re-run against the fresh state, so concurrent writers
// can never overwrite each other. `change` must be free of side effects other than
// editing the state it is given.
//
// Losers back off for a random time that grows with each failed attempt ("full jitter"),
// which spreads a burst of writers out instead of having them collide again in lockstep.
// If the budget runs out the caller gets a retryable 503; devices simply send it again.
async function mutate(store, change) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const { state, version } = await store.loadState();
    const outcome = change(state);
    if (!outcome.changed) return outcome;
    state.rev += 1;
    if (await store.saveState(state, version)) return outcome;
    await sleep(Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
  }
  throw new HttpError(503, 'busy', { 'Retry-After': '1' });
}

function matchRoute(routes, method, segments) {
  let pathMatched = false;
  for (const route of routes) {
    if (route.path.length !== segments.length) continue;
    const params = {};
    const matches = route.path.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[index];
        return true;
      }
      return part === segments[index];
    });
    if (!matches) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return { route: null, pathMatched, params: {} };
}

export function createApiHandler({ store, env = {}, now = () => Date.now(), logger = console }) {
  let warnedAboutDefaultPassword = false;

  async function authSecret() {
    return env.AUTH_SECRET || (await store.getSecret());
  }

  async function requireAdmin(request) {
    const token = bearerToken(request);
    const config = getAdminConfig(env);
    const valid = token ? verifyToken(await authSecret(), config, token, now()) : false;
    if (!valid) throw new HttpError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' });
    return config;
  }

  const routes = [
    {
      method: 'GET',
      path: ['health'],
      async handle() {
        const { state } = await store.loadState();
        return jsonResponse(200, { ok: true, rev: state.rev });
      }
    },
    {
      method: 'GET',
      path: ['leaderboard'],
      async handle() {
        const { state } = await store.loadState();
        return jsonResponse(200, buildBoard(state, now()));
      }
    },
    {
      method: 'PUT',
      path: ['plays', ':id'],
      async handle(request, { id }) {
        const body = await readJson(request);
        const outcome = await mutate(store, (state) => {
          const timestamp = now();
          const swept = sweepStalePlays(state, timestamp);
          const result = applyPlayUpdate(state, id, body, timestamp);
          return result.ok ? { ...result, changed: result.changed || swept } : result;
        });
        if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
        return jsonResponse(200, {
          ok: true,
          status: outcome.play.status,
          created: outcome.created,
          spotPrize: outcome.play.spotPrize
        });
      }
    },
    {
      method: 'POST',
      path: ['admin', 'login'],
      async handle(request) {
        const body = await readJson(request, 1024);
        if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
          throw new HttpError(400, 'invalid_body');
        }
        const config = getAdminConfig(env);
        if (!verifyCredentials(config, body.username, body.password)) {
          throw new HttpError(401, 'invalid_credentials');
        }
        if (config.usingDefaultPassword && !warnedAboutDefaultPassword) {
          warnedAboutDefaultPassword = true;
          logger.warn('[api] Admin login is using the built-in default password. Set ADMIN_PASSWORD.');
        }
        const { token, expiresAt } = signToken(await authSecret(), config, now());
        return jsonResponse(200, { token, expiresAt, insecureDefaults: config.usingDefaultPassword });
      }
    },
    {
      method: 'GET',
      path: ['admin', 'settings'],
      async handle(request) {
        const config = await requireAdmin(request);
        const { state } = await store.loadState();
        return jsonResponse(200, { settings: state.settings, insecureDefaults: config.usingDefaultPassword });
      }
    },
    {
      method: 'PUT',
      path: ['admin', 'settings'],
      async handle(request) {
        const config = await requireAdmin(request);
        const body = await readJson(request);
        const outcome = await mutate(store, (state) => {
          const validated = validateSettings(body, state.settings);
          if (!validated.ok) return validated;
          applySettings(state, validated.settings);
          return { ok: true, changed: true, settings: state.settings };
        });
        if (!outcome.ok) throw new HttpError(outcome.status, outcome.error);
        return jsonResponse(200, { settings: outcome.settings, insecureDefaults: config.usingDefaultPassword });
      }
    },
    {
      method: 'GET',
      path: ['admin', 'export'],
      async handle(request) {
        await requireAdmin(request);
        const { state } = await store.loadState();
        return jsonResponse(200, { participants: buildExport(state, now()) });
      }
    },
    {
      method: 'DELETE',
      path: ['admin', 'leaderboard'],
      async handle(request) {
        await requireAdmin(request);
        const outcome = await mutate(store, (state) => {
          const removed = clearPlays(state);
          return { ok: true, changed: true, removed };
        });
        return jsonResponse(200, { ok: true, removed: outcome.removed });
      }
    }
  ];

  return async function handleRequest(request) {
    try {
      const url = new URL(request.url);
      const segments = url.pathname
        .replace(/^\/(\.netlify\/functions\/api|api)(?=\/|$)/, '')
        .split('/')
        .filter(Boolean);

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { Allow: 'GET, PUT, POST, DELETE, OPTIONS' } });
      }

      const { route, pathMatched, params } = matchRoute(routes, request.method, segments);
      if (!route) {
        if (pathMatched) throw new HttpError(405, 'method_not_allowed');
        throw new HttpError(404, 'not_found');
      }
      return await route.handle(request, params);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(error.status, { error: error.code }, error.headers);
      }
      // Storage or network trouble is transient from the caller's point of view.
      logger.error('[api] request failed', error);
      return jsonResponse(503, { error: 'unavailable' }, { 'Retry-After': '2' });
    }
  };
}
