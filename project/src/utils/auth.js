// Admin authentication utilities
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'prebilt2024' // In a real app, this would be hashed and stored securely
};

const ADMIN_SESSION_KEY = 'prebilt_admin_session';

export function authenticateAdmin(username, password) {
  return username === ADMIN_CREDENTIALS.username && 
         password === ADMIN_CREDENTIALS.password;
}

export function setAdminSession() {
  localStorage.setItem(ADMIN_SESSION_KEY, 'true');
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function isAdminLoggedIn() {
  return localStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}