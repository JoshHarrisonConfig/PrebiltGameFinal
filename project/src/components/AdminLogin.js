import { icon } from './icons.js';

export function renderAdminLoginModal() {
  const modal = document.createElement('div');
  modal.id = 'adminLoginModal';
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-content admin-login-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="adminLoginTitle">Admin sign in</h2>
        <button type="button" class="icon-btn close-modal" data-close-modal aria-label="Close">${icon('x', { size: 22 })}</button>
      </div>
      <form id="adminLoginForm" class="admin-login-form">
        <div class="field">
          <label for="adminUsername">Username</label>
          <div class="input-wrap">
            ${icon('user', { size: 20, className: 'field-icon' })}
            <input type="text" id="adminUsername" required autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>
        </div>
        <div class="field">
          <label for="adminPassword">Password</label>
          <div class="input-wrap">
            ${icon('lock', { size: 20, className: 'field-icon' })}
            <input type="password" id="adminPassword" required autocomplete="current-password">
          </div>
        </div>
        <div class="error-message" id="adminLoginError" role="alert"></div>
        <button type="submit" class="btn btn-primary">Sign in</button>
      </form>
    </div>
  `;

  return modal;
}
