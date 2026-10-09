import { renderLoginScreen } from './screens/login.js';
import { renderGameScreen } from './screens/game.js';
import { renderLeaderboardScreen } from './screens/leaderboard.js';
import { getStoredEmail, getStoredUsername } from './utils/storage.js';
import { resumePendingUploads } from './utils/playSync.js';
import { registerServiceWorker } from './utils/pwa.js';
import { createUpdateNotice } from './components/UpdateNotice.js';

export function initializeApp() {
  const app = document.getElementById('app');
  // Each screen may return a function that undoes what it set up (timers, polling...).
  let teardown = null;
  let updateReady = false;
  let updateDismissed = false;

  // Initialize router
  window.addEventListener('hashchange', () => handleRoute());

  // Results that could not be delivered earlier (tab closed offline, server down) are
  // sent now and again whenever the network comes back.
  resumePendingUploads();
  window.addEventListener('online', () => resumePendingUploads());

  // Offline support and updates for the installed app (production builds only).
  registerServiceWorker({
    onUpdateReady: () => {
      updateReady = true;
      syncUpdateNotice();
    }
  });

  handleRoute();

  // A new version is announced with a small notice, but never in the middle of a game: it
  // waits until the participant is on another screen.
  function syncUpdateNotice() {
    const show = updateReady && !updateDismissed && window.location.hash !== '#game';
    let notice = document.getElementById('updateNotice');
    if (!show) {
      if (notice) notice.hidden = true;
      return;
    }
    if (!notice) {
      notice = createUpdateNotice({
        onDismiss: () => {
          updateDismissed = true;
          syncUpdateNotice();
        }
      });
      document.body.appendChild(notice);
    }
    notice.hidden = false;
  }

  function handleRoute() {
    if (teardown) {
      const leave = teardown;
      teardown = null;
      leave();
    }

    const hash = window.location.hash || '#login';
    let screen;

    switch (hash) {
      case '#login':
        screen = renderLoginScreen(app);
        break;
      case '#game':
        if (!getStoredUsername() || !getStoredEmail()) {
          window.location.hash = '#login';
        } else {
          screen = renderGameScreen(app);
        }
        break;
      case '#leaderboard':
        screen = renderLeaderboardScreen(app);
        break;
      default:
        window.location.hash = '#login';
    }

    teardown = typeof screen === 'function' ? screen : null;
    syncUpdateNotice();
  }
}
