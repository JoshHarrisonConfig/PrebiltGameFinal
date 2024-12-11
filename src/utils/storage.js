const USERNAME_KEY = 'barcodeGame_username';
const EMAIL_KEY = 'barcodeGame_email';
const USERS_KEY = 'barcodeGame_users';
const SPOT_PRIZE_KEY = 'barcodeGame_spotPrize';

export function setStoredUsername(username) {
  localStorage.setItem(USERNAME_KEY, username);
}

export function getStoredUsername() {
  return localStorage.getItem(USERNAME_KEY);
}

export function setStoredEmail(email) {
  localStorage.setItem(EMAIL_KEY, email);
}

export function getStoredEmail() {
  return localStorage.getItem(EMAIL_KEY);
}

export function saveUserProfile(username, email) {
  const users = getUserProfiles();
  users[username] = { email };
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function getUserProfiles() {
  const users = localStorage.getItem(USERS_KEY);
  return users ? JSON.parse(users) : {};
}

export function getUserProfile(username) {
  const users = getUserProfiles();
  return users[username] || null;
}

export function getSpotPrizeSettings() {
  const settings = localStorage.getItem(SPOT_PRIZE_KEY);
  return settings ? JSON.parse(settings) : { interval: 5, count: 0 };
}

export function saveSpotPrizeSettings(interval) {
  const settings = { interval, count: 0 };
  localStorage.setItem(SPOT_PRIZE_KEY, JSON.stringify(settings));
}