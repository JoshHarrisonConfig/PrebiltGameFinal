import { renderLogo } from '../components/Logo.js';
import { setStoredUsername, setStoredEmail, saveUserProfile } from '../utils/storage.js';
import { renderAdminLoginModal } from '../components/AdminLogin.js';
import { authenticateAdmin, setAdminSession, clearAdminSession, isAdminLoggedIn } from '../utils/auth.js';

export function renderLoginScreen(container) {
  const isAdmin = isAdminLoggedIn();
  
  container.innerHTML = `
    <div class="screen login-screen">
      ${isAdmin ? `
        <button id="logoutBtn" class="btn-admin-login">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </button>
      ` : `
        <button id="adminLoginBtn" class="btn-admin-login">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </button>
      `}
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

  // Add admin login modal
  const adminLoginModal = renderAdminLoginModal();
  container.appendChild(adminLoginModal);

  // Admin login button handler
  const adminLoginBtn = document.getElementById('adminLoginBtn');
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', () => {
      adminLoginModal.style.display = 'block';
    });
  }

  // Logout button handler
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearAdminSession();
      window.location.reload();
    });
  }

  // Admin login form handler
  const adminLoginForm = document.getElementById('adminLoginForm');
  adminLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    
    if (authenticateAdmin(username, password)) {
      setAdminSession();
      adminLoginModal.style.display = 'none';
      document.getElementById('adminLoginError').textContent = '';
      window.location.reload();
    } else {
      document.getElementById('adminLoginError').textContent = 'Invalid credentials';
    }
  });

  // Close modal handler
  const closeBtn = adminLoginModal.querySelector('.close-modal');
  closeBtn.addEventListener('click', () => {
    adminLoginModal.style.display = 'none';
  });

  // Regular form handlers
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