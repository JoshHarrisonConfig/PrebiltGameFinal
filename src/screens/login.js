import { renderLogo } from '../components/Logo.js';
import { setStoredUsername, setStoredEmail, saveUserProfile } from '../utils/storage.js';

export function renderLoginScreen(container) {
  container.innerHTML = `
    <div class="screen login-screen">
      ${renderLogo()}
      <form id="loginForm" class="login-form">
        <div class="form-group">
          <label for="username">Full Name:</label>
          <input type="text" id="username" required minlength="3" maxlength="30">
        </div>
        <div class="form-group">
          <label for="email">Email:</label>
          <input type="email" id="email" required>
        </div>
        <button type="submit" class="btn btn-primary">Start Game</button>
      </form>
      <button class="btn btn-secondary" id="viewLeaderboard">View Leaderboard</button>
    </div>
  `;

  const form = document.getElementById('loginForm');
  const leaderboardBtn = document.getElementById('viewLeaderboard');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    
    if (username && email) {
      setStoredUsername(username);
      setStoredEmail(email);
      saveUserProfile(username, email);
      window.location.hash = '#game';
    }
  });

  leaderboardBtn.addEventListener('click', () => {
    window.location.hash = '#leaderboard';
  });
}