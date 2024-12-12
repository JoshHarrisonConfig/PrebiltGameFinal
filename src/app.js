import { renderLoginScreen } from './screens/login.js';
import { renderGameScreen } from './screens/game.js';
import { renderLeaderboardScreen } from './screens/leaderboard.js';
import { getStoredUsername } from './utils/storage.js';

export function initializeApp() {
  const app = document.getElementById('app');
  
  // Initialize router
  window.addEventListener('hashchange', () => handleRoute());
  handleRoute();

  function handleRoute() {
    const hash = window.location.hash || '#login';
    
    switch (hash) {
      case '#login':
        renderLoginScreen(app);
        break;
      case '#game':
        const username = getStoredUsername();
        if (!username) {
          window.location.hash = '#login';
        } else {
          renderGameScreen(app);
        }
        break;
      case '#leaderboard':
        renderLeaderboardScreen(app);
        break;
      default:
        window.location.hash = '#login';
    }
  }
}