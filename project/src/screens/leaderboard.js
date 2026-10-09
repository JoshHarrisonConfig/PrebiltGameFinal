import { REQUIRED_SCANS } from '../../shared/protocol.js';
import {
  clearLeaderboard,
  exportToExcel,
  fetchLeaderboard,
  watchLeaderboard
} from '../utils/leaderboard.js';
import { createSettingsModal } from '../components/Settings.js';
import { renderLogo } from '../components/Logo.js';
import { icon } from '../components/icons.js';
import { clearAdminSession, handleAuthFailure, isAdminLoggedIn } from '../utils/auth.js';
import { avatarClass, escapeHtml, formatClock, formatFinished, initials } from '../utils/dom.js';
import { closeModal } from '../utils/modal.js';
import { onUploadStateChange, pendingUploads } from '../utils/playSync.js';
import { clearLastResult, findOwnRow, readLastResult } from '../utils/result.js';

const SKELETON_ROWS = 5;

export function renderLeaderboardScreen(container) {
  const isAdmin = isAdminLoggedIn();
  // Set by the game screen when this device has just finished a game.
  const lastResult = readLastResult();

  container.innerHTML = `
    <div id="boardScreen" class="screen leaderboard-screen">
      <header class="topbar">
        ${isAdmin ? `
          <button id="logoutBtn" class="chip-btn" type="button">${icon('log-out', { size: 20 })}<span>Sign out</span></button>
        ` : `
          <button id="backButton" class="chip-btn" type="button">${icon('arrow-left', { size: 20 })}<span>Back</span></button>
        `}
        <div class="topbar-end">
          <button id="presentBtn" class="icon-btn" type="button" aria-label="Presentation mode" aria-pressed="false" title="Presentation mode">${icon('maximize', { size: 22 })}</button>
          ${isAdmin ? `
            <button id="settingsBtn" class="icon-btn" type="button" aria-label="Settings" title="Settings">${icon('settings', { size: 22 })}</button>
          ` : ''}
        </div>
      </header>

      <main class="board-main">
      <section class="board-hero">
        ${renderLogo({ compact: true })}
        <h1 class="board-title">Leaderboard</h1>
        <div id="syncStatus" class="sync-status"></div>
        <!-- Screen readers hear connection changes only, not the clock that ticks every update. -->
        <span id="syncAnnouncer" class="visually-hidden" role="status" aria-live="polite"></span>
      </section>

      <section id="resultCard" class="result-card" hidden></section>

      <div id="boardGrid" class="board-grid">
        <div class="board-primary">
          <section id="livePanel" class="live-panel" aria-label="Now playing" hidden>
            <h2 class="live-title">Now playing</h2>
            <ul id="liveList" class="live-list"></ul>
          </section>
          <section id="podium" class="podium" aria-label="Top three"></section>
        </div>

        <div class="board-secondary">
          <div class="board-list">
            <table class="leaderboard-table">
              <caption class="visually-hidden">Fastest finishers</caption>
              <thead>
                <tr>
                  <th class="col-rank" scope="col">Rank</th>
                  <th class="col-name" scope="col">Name</th>
                  <th class="col-time" scope="col">Time</th>
                  <th class="col-date" scope="col">Finished</th>
                </tr>
              </thead>
              <tbody id="leaderboardBody">${skeletonRows()}</tbody>
            </table>
          </div>
          <p id="leaderboardFootnote" class="leaderboard-footnote" hidden></p>
        </div>
      </div>

      <div class="button-group">
        ${isAdmin ? `
          <button id="exportExcel" class="btn btn-secondary" type="button">${icon('download', { size: 20 })} Export to Excel</button>
          <button id="clearLeaderboard" class="btn btn-danger" type="button">${icon('trash', { size: 20 })} Clear leaderboard</button>
        ` : ''}
        <button id="playAgain" class="btn btn-primary" type="button">${icon('play', { size: 20 })} Play again</button>
      </div>
      </main>
    </div>
  `;

  const screen = document.getElementById('boardScreen');
  const grid = document.getElementById('boardGrid');
  const body = document.getElementById('leaderboardBody');
  const podium = document.getElementById('podium');
  const footnote = document.getElementById('leaderboardFootnote');
  const livePanel = document.getElementById('livePanel');
  const liveList = document.getElementById('liveList');
  const resultCard = document.getElementById('resultCard');
  const syncStatus = document.getElementById('syncStatus');
  const syncAnnouncer = document.getElementById('syncAnnouncer');

  podium.innerHTML = podiumSkeleton();

  // ---- rendering ---------------------------------------------------------------------

  let hasBoard = false;
  let renderedSignature = '';
  let liveReceivedAt = Date.now();
  let announced = '';
  // Results already on screen, so a newly arrived one can be highlighted.
  const knownResults = new Set();
  const connection = { state: 'connecting', lastUpdated: null };

  const resultKey = (entry) => `${entry.name}|${entry.finishedAt}`;

  function skeletonRows() {
    return Array.from({ length: SKELETON_ROWS }, () => (
      '<tr class="skeleton-row"><td colspan="4"><span class="skeleton"></span></td></tr>'
    )).join('');
  }

  function podiumSkeleton() {
    return [1, 2, 3].map((place) => `
      <article class="podium-card place-${place} is-loading" aria-hidden="true">
        <span class="skeleton medal-skeleton"></span>
        <span class="skeleton line-skeleton"></span>
        <span class="skeleton line-skeleton line-skeleton--short"></span>
      </article>
    `).join('');
  }

  function rowHtml(entry, { isNew, isYou }) {
    const finished = formatFinished(entry.finishedAt);
    const classes = ['board-row', `rank-${entry.rank}`, entry.rank <= 3 ? 'top3' : '', isNew ? 'is-new' : '', isYou ? 'is-you' : '']
      .filter(Boolean).join(' ');
    return `
      <tr class="${classes}">
        <td class="col-rank"><span class="rank-badge">${entry.rank}</span></td>
        <td class="col-name"><span class="name-wrap"><span class="name-text">${escapeHtml(entry.name)}</span>${isYou ? '<span class="you-tag">You</span>' : ''}</span></td>
        <td class="col-time">${entry.time.toFixed(2)}<span class="time-unit">s</span></td>
        <td class="col-date"><time datetime="${escapeHtml(finished.iso)}">${escapeHtml(finished.label)}</time></td>
      </tr>
    `;
  }

  function podiumCardHtml(place, entry, { isNew, isYou }) {
    if (!entry) {
      return `
        <article class="podium-card place-${place} is-empty" aria-hidden="true">
          <span class="medal">${place}</span>
          <p class="podium-name">&nbsp;</p>
          <p class="podium-time">--</p>
        </article>
      `;
    }
    const classes = ['podium-card', `place-${place}`, isNew ? 'is-new' : '', isYou ? 'is-you' : ''].filter(Boolean).join(' ');
    return `
      <article class="${classes}" data-place="${place}">
        ${place === 1 ? `<span class="podium-crown">${icon('crown', { size: 26 })}</span>` : ''}
        <span class="medal">${place}</span>
        <h3 class="podium-name">${escapeHtml(entry.name)}</h3>
        <p class="podium-time">${entry.time.toFixed(2)}<span>s</span></p>
      </article>
    `;
  }

  function renderRows(board) {
    // Skip identical updates so nothing repaints (or re-animates) every two seconds.
    const signature = JSON.stringify([board.leaderboard, board.finishedCount, lastResult && lastResult.time]);
    if (signature === renderedSignature) return;
    const firstRender = renderedSignature === '';
    renderedSignature = signature;

    const own = findOwnRow(board.leaderboard, lastResult);
    const flags = (entry) => ({
      isNew: !firstRender && !knownResults.has(resultKey(entry)),
      isYou: Boolean(own) && own.rank === entry.rank
    });

    if (board.leaderboard.length === 0) {
      body.innerHTML = `
        <tr class="empty-row"><td colspan="4">
          <div class="empty-state">
            ${icon('trophy', { size: 36 })}
            <p class="empty-title">No results yet</p>
            <p>Be the first to finish the challenge!</p>
          </div>
        </td></tr>`;
    } else {
      body.innerHTML = board.leaderboard.map((entry) => rowHtml(entry, flags(entry))).join('');
    }

    const byRank = new Map(board.leaderboard.map((entry) => [entry.rank, entry]));
    podium.innerHTML = [1, 2, 3]
      .map((place) => podiumCardHtml(place, byRank.get(place), byRank.get(place) ? flags(byRank.get(place)) : {}))
      .join('') + (board.leaderboard.length === 0
        ? '<p class="podium-empty">No results yet. Be the first to finish the challenge!</p>'
        : '');

    board.leaderboard.forEach((entry) => knownResults.add(resultKey(entry)));
    grid.classList.toggle('has-more', board.leaderboard.length > 3);

    const hidden = board.finishedCount - board.leaderboard.length;
    footnote.hidden = hidden <= 0;
    footnote.textContent = hidden > 0 ? `Showing the top ${board.leaderboard.length} of ${board.finishedCount} finishers` : '';
  }

  // "Nice run!" card for the participant who just finished a game on this device.
  function renderResult(board) {
    if (!lastResult) return;
    const own = findOwnRow(board.leaderboard, lastResult);
    const firstName = lastResult.name.trim().split(/\s+/)[0];
    const title = own && own.rank === 1 ? "You're in the lead!"
      : own && own.rank <= 3 ? "You're on the podium!"
      : `Nice run, ${firstName}!`;
    resultCard.hidden = false;
    resultCard.innerHTML = `
      <span class="result-icon">${icon('trophy', { size: 26 })}</span>
      <div>
        <p class="result-title">${escapeHtml(title)}</p>
        <p class="result-sub">Your time <strong>${lastResult.time.toFixed(2)}s</strong>${own ? ` &middot; Rank <strong>#${own.rank}</strong>` : ''}</p>
      </div>
    `;
  }

  function renderLive(board) {
    liveReceivedAt = Date.now();
    livePanel.hidden = board.live.length === 0;
    liveList.innerHTML = board.live.map((player) => {
      // Only numbers are placed in attributes; the name is escaped text.
      const scanned = Math.min(Math.max(Math.trunc(Number(player.scanned)) || 0, 0), REQUIRED_SCANS);
      const elapsed = player.elapsed === null ? null : Number(player.elapsed);
      const pips = Array.from({ length: REQUIRED_SCANS }, (_, index) => `<i${index < scanned ? ' class="on"' : ''}></i>`).join('');
      const status = player.status === 'playing'
        ? `<span class="live-clock" data-elapsed="${Number.isFinite(elapsed) ? elapsed : ''}">${formatClock(elapsed)}</span>`
        : '<span class="live-waiting">Get ready</span>';
      return `
        <li class="live-item">
          <span class="avatar ${avatarClass(player.name)}" aria-hidden="true">${escapeHtml(initials(player.name))}</span>
          <span class="live-name">${escapeHtml(player.name)}</span>
          ${status}
          <span class="live-pips" aria-hidden="true">${pips}</span>
          <span class="live-count">${scanned}/${REQUIRED_SCANS}</span>
        </li>
      `;
    }).join('');
  }

  // Players' clocks keep running between server updates.
  function tickLiveClocks() {
    const sinceUpdate = (Date.now() - liveReceivedAt) / 1000;
    liveList.querySelectorAll('.live-clock').forEach((clock) => {
      const base = Number(clock.dataset.elapsed);
      clock.textContent = clock.dataset.elapsed === '' ? '--:--' : formatClock(base + sinceUpdate);
    });
  }

  function renderStatus() {
    const pending = pendingUploads();
    const parts = [];
    let level = 'ok';

    if (connection.state === 'offline') {
      level = 'error';
      parts.push(connection.lastUpdated
        ? `Reconnecting... showing results from ${new Date(connection.lastUpdated).toLocaleTimeString()}`
        : 'Cannot reach the server. Retrying...');
    } else if (connection.state === 'live') {
      parts.push(`Live - updated ${new Date(connection.lastUpdated).toLocaleTimeString()}`);
    } else {
      level = 'warn';
      parts.push('Connecting...');
    }

    if (pending > 0) {
      if (level === 'ok') level = 'warn';
      parts.push(pending === 1 ? 'Saving your result...' : `Saving ${pending} results...`);
    }

    syncStatus.className = `sync-status ${level}`;
    syncStatus.textContent = parts.join(' | ');

    const announcement = connection.state === 'offline'
      ? 'Connection lost. Showing the last known results.'
      : connection.state === 'live' ? 'Leaderboard is live.' : '';
    if (announcement && announcement !== announced) {
      announced = announcement;
      syncAnnouncer.textContent = announcement;
    }
  }

  function showBoard(board) {
    hasBoard = true;
    renderRows(board);
    renderResult(board);
    renderLive(board);
  }

  renderStatus();

  const stopWatching = watchLeaderboard({
    onBoard: showBoard,
    onStatus: (status) => {
      connection.state = status.state;
      if (status.lastUpdated) connection.lastUpdated = status.lastUpdated;
      if (status.state === 'offline' && !hasBoard) {
        body.innerHTML = `
          <tr class="empty-row"><td colspan="4">
            <div class="empty-state">
              <p class="empty-title">Cannot reach the server</p>
              <p>Retrying automatically...</p>
            </div>
          </td></tr>`;
        podium.innerHTML = '';
      }
      renderStatus();
    }
  });
  const clockTimer = setInterval(tickLiveClocks, 1000);
  // A result still being delivered (poor Wi-Fi) shows up in the status line.
  const stopWatchingUploads = onUploadStateChange(renderStatus);

  // ---- presentation mode (fullscreen, controls hidden) --------------------------------

  const presentBtn = document.getElementById('presentBtn');

  function setPresenting(on) {
    screen.classList.toggle('is-presenting', on);
    presentBtn.setAttribute('aria-pressed', String(on));
    presentBtn.innerHTML = icon(on ? 'minimize' : 'maximize', { size: 22 });
    presentBtn.setAttribute('aria-label', on ? 'Leave presentation mode' : 'Presentation mode');
  }

  async function togglePresenting() {
    const on = !screen.classList.contains('is-presenting');
    setPresenting(on);
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      if (!on && document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      // Fullscreen can be refused; the clean layout still applies.
    }
  }

  const onFullscreenChange = () => {
    if (!document.fullscreenElement) setPresenting(false);
  };
  const onEscape = (event) => {
    if (event.key === 'Escape' && screen.classList.contains('is-presenting')) setPresenting(false);
  };
  presentBtn.addEventListener('click', togglePresenting);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', onEscape);

  // ---- admin controls ------------------------------------------------------------------

  function signedOut() {
    window.location.reload();
  }

  function reportAdminFailure(error, action) {
    if (handleAuthFailure(error)) {
      alert('Your admin session has expired. Please sign in again.');
      signedOut();
      return;
    }
    alert(`Could not ${action}. Check the connection and try again.`);
  }

  let settings = null;
  if (isAdmin) {
    settings = createSettingsModal({ onSignedOut: signedOut });
    container.appendChild(settings.element);

    document.getElementById('logoutBtn').addEventListener('click', () => {
      clearAdminSession();
      window.location.hash = '#login';
    });

    document.getElementById('settingsBtn').addEventListener('click', settings.open);

    document.getElementById('exportExcel').addEventListener('click', async () => {
      try {
        await exportToExcel();
      } catch (error) {
        reportAdminFailure(error, 'export the results');
      }
    });

    document.getElementById('clearLeaderboard').addEventListener('click', async () => {
      const confirmed = confirm(
        'Clear the leaderboard for EVERY device?\n\nThis permanently removes all results and participant details. Export to Excel first if you need a copy.'
      );
      if (!confirmed) return;
      try {
        await clearLeaderboard();
        showBoard(await fetchLeaderboard());
      } catch (error) {
        reportAdminFailure(error, 'clear the leaderboard');
      }
    });
  } else {
    document.getElementById('backButton').addEventListener('click', () => {
      window.location.hash = '#login';
    });
  }

  document.getElementById('playAgain').addEventListener('click', () => {
    window.location.hash = '#game';
  });

  // Called by the router when leaving this screen.
  return () => {
    stopWatching();
    stopWatchingUploads();
    clearInterval(clockTimer);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('keydown', onEscape);
    if (document.fullscreenElement) document.exitFullscreen?.();
    if (settings) closeModal(settings.element);
    // The greeting is shown once; a later visit to the board starts fresh.
    clearLastResult();
  };
}
