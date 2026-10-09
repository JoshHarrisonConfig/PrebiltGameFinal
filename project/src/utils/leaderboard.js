import * as XLSX from 'xlsx';
import { apiRequest } from './api.js';
import { getAdminToken } from './auth.js';

// How often a visible leaderboard asks the server for changes. Netlify does not offer
// WebSockets, and polling a tiny JSON document is the most dependable thing on venue
// Wi-Fi: updates show up within about this long, and a dropped request just retries.
export const POLL_INTERVAL_MS = 2000;
const HIDDEN_POLL_INTERVAL_MS = 15000;
const MAX_BACKOFF_MS = 10000;
const FAILURES_BEFORE_OFFLINE = 2;

// The in-game timer turns green/red against the record, and asks for it every second,
// so the latest known fastest time is kept here instead of being fetched each time.
let fastestTime = null;

export function getFastestTime() {
  return fastestTime;
}

function rememberFastest(board) {
  fastestTime = board.leaderboard.length > 0 ? board.leaderboard[0].time : null;
}

export async function fetchLeaderboard() {
  const board = await apiRequest('/leaderboard', { timeoutMs: 6000 });
  rememberFastest(board);
  return board;
}

// Best effort: a failure just leaves the previously known record in place.
export async function refreshFastestTime() {
  try {
    await fetchLeaderboard();
  } catch {
    // keep the last known value
  }
}

// Polls the shared leaderboard until stop() is called.
//   onBoard(board)  - fresh data from the server
//   onStatus(state) - { state: 'live' | 'offline', lastUpdated, failures }
export function watchLeaderboard({ onBoard, onStatus }) {
  let stopped = false;
  let timer = null;
  let failures = 0;
  let inFlight = false;

  const nextDelay = () => {
    if (failures > 0) return Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
    return document.hidden ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  };

  // At most one request is ever in flight, and each finished request schedules exactly
  // one next one, so a refresh triggered from outside can never start a second loop.
  async function tick() {
    timer = null;
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const board = await fetchLeaderboard();
      if (!stopped) {
        failures = 0;
        onBoard(board);
        onStatus({ state: 'live', lastUpdated: Date.now(), failures });
      }
    } catch {
      if (!stopped) {
        failures += 1;
        if (failures >= FAILURES_BEFORE_OFFLINE) onStatus({ state: 'offline', failures });
      }
    } finally {
      inFlight = false;
    }
    if (!stopped) timer = setTimeout(tick, nextDelay());
  }

  // Refresh straight away when the page comes back into view or the network returns,
  // rather than waiting out a slow background/backoff delay.
  const refreshNow = () => {
    if (stopped || document.hidden) return;
    clearTimeout(timer);
    tick();
  };
  document.addEventListener('visibilitychange', refreshNow);
  window.addEventListener('online', refreshNow);
  tick();

  return function stop() {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', refreshNow);
    window.removeEventListener('online', refreshNow);
  };
}

// ---- admin actions ------------------------------------------------------------------

function adminToken() {
  return getAdminToken();
}

export async function clearLeaderboard() {
  await apiRequest('/admin/leaderboard', { method: 'DELETE', token: adminToken() });
  fastestTime = null;
}

// Builds the workbook contents from the server's participant list. Kept separate from
// the download so it can be tested.
export function buildExportSheets(participants) {
  const finished = participants
    .filter((participant) => participant.status === 'finished')
    .sort((a, b) => a.rank - b.rank);

  const leaderboard = finished.map((participant) => ({
    Rank: participant.rank,
    Username: participant.name,
    Email: participant.email,
    'Time (seconds)': participant.time.toFixed(2),
    Date: new Date(participant.finishedAt).toLocaleString(),
    'Spot Prize': participant.spotPrize ? 'Yes' : ''
  }));

  const everyone = participants.map((participant) => ({
    Username: participant.name,
    Email: participant.email,
    Status: participant.status,
    Scanned: participant.scanned,
    'Time (seconds)': participant.time === null ? '' : participant.time.toFixed(2),
    Registered: new Date(participant.registeredAt).toLocaleString()
  }));

  return { leaderboard, everyone };
}

export async function exportToExcel() {
  const { participants } = await apiRequest('/admin/export', { token: adminToken() });
  const { leaderboard, everyone } = buildExportSheets(participants);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(leaderboard), 'Leaderboard');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(everyone), 'All participants');
  XLSX.writeFile(workbook, 'barcode-game-leaderboard.xlsx');
}

export async function loadSettings() {
  return apiRequest('/admin/settings', { token: adminToken() });
}

export async function saveSettings(settings) {
  return apiRequest('/admin/settings', { method: 'PUT', token: adminToken(), body: settings });
}
