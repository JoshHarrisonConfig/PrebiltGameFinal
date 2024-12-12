import { scannerManager } from '../utils/scannerManager.js';
import { saveScore, getFastestTime } from '../utils/leaderboard.js';
import { getStoredUsername } from '../utils/storage.js';
import { GameTimer } from '../utils/timer.js';

export function renderGameScreen(container) {
  container.innerHTML = `
    <div class="screen game-screen">
      <div class="game-layout">
        <div class="timer-section">
          <div class="timer-container">
            <div class="timer-label">Time</div>
            <div id="timer" class="timer-display">00:00</div>
          </div>
          <div class="progress">Scanned: <span id="progress">0</span>/10</div>
        </div>
        
        <div class="scanner-section">
          <div id="interactive" class="viewport"></div>
          <div class="scan-feedback" id="scanFeedback"></div>
        </div>

        <div class="info-section">
          <div class="scanned-codes" id="scannedCodes"></div>
          <button id="exitGame" class="btn btn-secondary">Exit Game</button>
        </div>
      </div>
    </div>
  `;

  let scannedCodes = 0;
  const maxCodes = 10;
  const timerElement = document.getElementById('timer');
  const gameTimer = new GameTimer(timerElement, getFastestTime);

  const handleSuccessfulScan = (code) => {
    if (scannedCodes === 0) {
      gameTimer.start();
    }
    
    scannedCodes++;
    document.getElementById('progress').textContent = scannedCodes;
    
    // Update scanned codes display
    const scannedCodesElement = document.getElementById('scannedCodes');
    const codeElement = document.createElement('div');
    codeElement.textContent = `Barcode ${scannedCodes}: ${code}`;
    scannedCodesElement.appendChild(codeElement);
    
    if (scannedCodes >= maxCodes) {
      const totalTime = gameTimer.stop();
      const username = getStoredUsername();
      saveScore(username, totalTime);
      cleanup();
      window.location.hash = '#leaderboard';
    }
  };

  const cleanup = async () => {
    await scannerManager.cleanup();
    gameTimer.cleanup();
  };

  const initScanner = async (retries = 3) => {
    try {
      await scannerManager.initialize('interactive', handleSuccessfulScan);
    } catch (error) {
      console.error('Scanner initialization failed:', error);
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return initScanner(retries - 1);
      }
      cleanup();
      window.location.hash = '#login';
    }
  };

  initScanner();

  document.getElementById('exitGame').addEventListener('click', async () => {
    await cleanup();
    window.location.hash = '#login';
  });

  const handleHashChange = () => cleanup();
  window.addEventListener('hashchange', handleHashChange);

  return () => {
    cleanup();
    window.removeEventListener('hashchange', handleHashChange);
  };
}