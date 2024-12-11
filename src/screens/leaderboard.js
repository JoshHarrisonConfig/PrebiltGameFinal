import { getLeaderboard, clearLeaderboard, exportToExcel } from '../utils/leaderboard.js';
import { getUserProfile } from '../utils/storage.js';
import { renderSettingsModal } from '../components/Settings.js';
import { renderLogo } from '../components/Logo.js';

export function renderLeaderboardScreen(container) {
  const leaderboard = getLeaderboard();
  
  container.innerHTML = `
    <div class="screen leaderboard-screen">
      <button id="backButton" class="btn-back">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
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
                <td>
                  <button class="username-btn" data-username="${entry.username}">
                    ${entry.username}
                  </button>
                </td>
                <td>${entry.time.toFixed(2)}s</td>
                <td>${new Date(entry.date).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="button-group">
        <button id="exportExcel" class="btn btn-secondary">Export to Excel</button>
        <button id="clearLeaderboard" class="btn btn-secondary">Clear Leaderboard</button>
        <button id="playAgain" class="btn btn-primary">Play Again</button>
      </div>
      <button id="settingsBtn" class="settings-btn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </div>
  `;

  // Initialize settings modal
  const settingsModal = renderSettingsModal();
  
  // Back button handler
  document.getElementById('backButton').addEventListener('click', () => {
    window.location.hash = '#login';
  });

  // Settings button handler
  document.getElementById('settingsBtn').addEventListener('click', () => {
    settingsModal.style.display = 'block';
  });

  // Export to Excel
  document.getElementById('exportExcel').addEventListener('click', exportToExcel);

  // Clear Leaderboard
  document.getElementById('clearLeaderboard').addEventListener('click', () => {
    document.getElementById('confirmModal').style.display = 'block';
  });

  // Rest of the event handlers...
}