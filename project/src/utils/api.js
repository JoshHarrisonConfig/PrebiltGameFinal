// Thin wrapper around fetch for the shared-leaderboard API (same origin, /api/*).

const API_BASE = '/api';
const DEFAULT_TIMEOUT_MS = 8000;

// Statuses that mean "this request is wrong and will never succeed, retrying is pointless".
// Everything else (network failure, timeouts, 5xx, 404 while the API is still deploying)
// may succeed later.
const PERMANENT_STATUSES = new Set([400, 401, 403, 413, 422]);

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error', retryable = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export async function apiRequest(path, { method = 'GET', body, token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal
      });
    } catch {
      const timedOut = controller.signal.aborted;
      throw new ApiError(timedOut ? 'The server took too long to respond' : 'Cannot reach the server', {
        code: timedOut ? 'timeout' : 'network_error'
      });
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Not JSON (for example an HTML error page from a proxy).
    }

    if (!response.ok) {
      throw new ApiError(data?.error || response.statusText || `HTTP ${response.status}`, {
        status: response.status,
        code: data?.error || 'http_error',
        retryable: !PERMANENT_STATUSES.has(response.status)
      });
    }
    if (data === null) {
      throw new ApiError('Unexpected response from the server', {
        status: response.status,
        code: 'bad_response'
      });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
