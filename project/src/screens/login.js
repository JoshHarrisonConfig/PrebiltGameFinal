import { renderLogo } from '../components/Logo.js';
import { icon } from '../components/icons.js';
import { setStoredUsername, setStoredEmail } from '../utils/storage.js';
import { renderAdminLoginModal } from '../components/AdminLogin.js';
import { authenticateAdmin, clearAdminSession, isAdminLoggedIn } from '../utils/auth.js';
import { closeModal, openModal, prepareModal } from '../utils/modal.js';
import { canInstall, onInstallAvailabilityChange, promptInstall } from '../utils/pwa.js';

export function renderLoginScreen(container) {
  const isAdmin = isAdminLoggedIn();

  container.innerHTML = `
    <div class="screen login-screen">
      <header class="topbar">
        <div class="topbar-start">
          <button id="installBtn" class="chip-btn" type="button" hidden>
            ${icon('download', { size: 20 })}<span>Install app</span>
          </button>
        </div>
        ${isAdmin ? `
          <button id="logoutBtn" class="chip-btn" type="button">
            ${icon('log-out', { size: 20 })}<span>Sign out</span>
          </button>
        ` : `
          <button id="adminLoginBtn" class="chip-btn" type="button" aria-label="Admin sign in">
            ${icon('user', { size: 20 })}<span>Admin</span>
          </button>
        `}
      </header>

      <main class="login-main">
        <section class="hero">
          ${renderLogo()}
          <p class="hero-tagline">Scan <em>10 boxes</em>. Beat the clock.</p>
          <ol class="steps" aria-label="How it works">
            <li class="step">
              <span class="step-icon">${icon('user', { size: 20 })}</span>
              <span><b>Register</b>your details</span>
            </li>
            <li class="step">
              <span class="step-icon">${icon('scan', { size: 20 })}</span>
              <span><b>Scan 10</b>unique barcodes</span>
            </li>
            <li class="step">
              <span class="step-icon">${icon('trophy', { size: 20 })}</span>
              <span><b>Climb</b>the leaderboard</span>
            </li>
          </ol>
        </section>

        <section class="panel panel--glass login-panel" aria-label="Start a game">
          <form id="loginForm" class="login-form">
            <h2 class="panel-title">Enter your details</h2>
            <div class="field">
              <label for="username">Full name</label>
              <div class="input-wrap">
                ${icon('user', { size: 20, className: 'field-icon' })}
                <input type="text" id="username" name="name" required minlength="3" maxlength="30"
                       autocomplete="name" autocapitalize="words" enterkeyhint="next" placeholder="e.g. Ada Lovelace">
              </div>
            </div>
            <div class="field">
              <label for="email">Email address</label>
              <div class="input-wrap">
                ${icon('mail', { size: 20, className: 'field-icon' })}
                <input type="email" id="email" name="email" required autocomplete="email" inputmode="email"
                       autocapitalize="none" spellcheck="false" enterkeyhint="go" placeholder="you@company.com">
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Start game ${icon('arrow-right', { size: 20 })}</button>
          </form>
          <div class="divider"><span>or</span></div>
          <button class="btn btn-secondary" id="viewLeaderboard" type="button">${icon('trophy', { size: 20 })} View leaderboard</button>
        </section>
      </main>
    </div>
  `;

  // Admin sign-in dialog
  const adminLoginModal = renderAdminLoginModal();
  container.appendChild(adminLoginModal);
  prepareModal(adminLoginModal, { labelledBy: 'adminLoginTitle' });

  const adminLoginBtn = document.getElementById('adminLoginBtn');
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', () => {
      openModal(adminLoginModal, { initialFocus: '#adminUsername' });
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearAdminSession();
      window.location.reload();
    });
  }

  // Admin login form handler. The password is checked by the server.
  const adminLoginForm = document.getElementById('adminLoginForm');
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    const errorBox = document.getElementById('adminLoginError');
    const submitButton = adminLoginForm.querySelector('button[type="submit"]');

    errorBox.textContent = '';
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    try {
      if (await authenticateAdmin(username, password)) {
        closeModal(adminLoginModal);
        window.location.reload();
        return;
      }
      errorBox.textContent = 'Invalid credentials';
    } catch {
      errorBox.textContent = 'Cannot reach the server. Check the connection and try again.';
    }
    submitButton.disabled = false;
    submitButton.removeAttribute('aria-busy');
  });

  // "Install app": offered only while the browser says this app can be installed.
  const installBtn = document.getElementById('installBtn');
  const syncInstallButton = () => {
    installBtn.hidden = !canInstall();
  };
  syncInstallButton();
  const stopWatchingInstall = onInstallAvailabilityChange(syncInstallButton);
  installBtn.addEventListener('click', async () => {
    await promptInstall();
    syncInstallButton();
  });

  // Regular form handlers
  const form = document.getElementById('loginForm');
  const leaderboardBtn = document.getElementById('viewLeaderboard');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();

    if (username && email) {
      // Remember who is playing on this device. The game screen registers the play with
      // the shared server when it starts.
      setStoredUsername(username);
      setStoredEmail(email);
      window.location.hash = '#game';
    }
  });

  leaderboardBtn.addEventListener('click', () => {
    window.location.hash = '#leaderboard';
  });

  // Called by the router when leaving this screen.
  return () => {
    stopWatchingInstall();
    closeModal(adminLoginModal);
  };
}
