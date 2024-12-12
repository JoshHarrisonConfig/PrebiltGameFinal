import { getLeaderboard, clearLeaderboard, exportToExcel } from '../utils/leaderboard.js';
import { getUserProfile } from '../utils/storage.js';
import { renderSettingsModal } from '../components/Settings.js';
import { renderLogo } from '../components/Logo.js';
import { isAdminLoggedIn, clearAdminSession } from '../utils/auth.js';

export function renderLeaderboardScreen(container) {
  const leaderboard = getLeaderboard();
  const isAdmin = isAdminLoggedIn();
  
  container.innerHTML = `
    <div class="screen leaderboard-screen">
      ${isAdmin ? `
        <button id="logoutBtn" class="btn-admin-login">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </button>
        <button id="settingsBtn" class="settings-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      ` : `
        <button id="backButton" class="btn-back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
      `}
      ${renderLogo(false)}
      <div class="leaderboard-container">
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Username</th>
              <th>Time</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.map((entry, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${entry.username}</td>
                <td>${entry.time.toFixed(2)}s</td>
                <td>${new Date(entry.date).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="button-group">
        ${isAdmin ? `
          <button id="exportExcel" class="btn btn-secondary">Export to Excel</button>
          <button id="clearLeaderboard" class="btn btn-secondary">Clear Leaderboard</button>
        ` : ''}
        <button id="playAgain" class="btn btn-primary">Play Again</button>
      </div>
    </div>
  `;

  // Initialize settings modal if admin
  if (isAdmin) {
    const settingsModal = renderSettingsModal();
    container.appendChild(settingsModal);
  }

  // Event Handlers
  if (isAdmin) {
    document.getElementById('logoutBtn').addEventListener('click', () => {
      clearAdminSession();
      window.location.hash = '#login';
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
      document.getElementById('settingsModal').style.display = 'block';
    });

    document.getElementById('exportExcel').addEventListener('click', exportToExcel);

    document.getElementById('clearLeaderboard').addEventListener('click', () => {
      if (confirm('Are you sure you want to clear the leaderboard?')) {
        clearLeaderboard();
        window.location.reload();
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
}