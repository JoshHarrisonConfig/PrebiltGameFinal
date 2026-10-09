// Device-local storage: only who is playing on THIS device right now.
//
// Everything that has to be seen from other devices (results, participants, settings)
// lives on the server instead - see playSync.js and leaderboard.js.

const USERNAME_KEY = 'barcodeGame_username';
const EMAIL_KEY = 'barcodeGame_email';

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
