export function renderAdminLoginModal() {
  const modal = document.createElement('div');
  modal.id = 'adminLoginModal';
  modal.className = 'modal';
  
  modal.innerHTML = `
    <div class="modal-content admin-login-modal">
      <span class="close-modal">&times;</span>
      <h2>Admin Login</h2>
      <form id="adminLoginForm" class="admin-login-form">
        <div class="form-group">
          <label for="adminUsername">Username:</label>
          <input type="text" id="adminUsername" required>
        </div>
        <div class="form-group">
          <label for="adminPassword">Password:</label>
          <input type="password" id="adminPassword" required>
        </div>
        <div class="error-message" id="adminLoginError"></div>
        <button type="submit" class="btn btn-primary">Login</button>
      </form>
    </div>
  `;
  
  return modal;
}