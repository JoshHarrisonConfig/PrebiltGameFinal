import { REQUIRED_SCANS } from '../../shared/protocol.js';
import { icon } from '../components/icons.js';
import { scannerManager } from '../utils/scannerManager.js';
import { getFastestTime, refreshFastestTime } from '../utils/leaderboard.js';
import { getStoredEmail, getStoredUsername } from '../utils/storage.js';
import { startPlay } from '../utils/playSync.js';
import { GameTimer } from '../utils/timer.js';
import { avatarClass, escapeHtml, initials } from '../utils/dom.js';
import { saveLastResult } from '../utils/result.js';

// While a game is open the device reports in this often, so the admin screen keeps
// showing the player under "Now playing" even when they pause between scans.
const HEARTBEAT_MS = 10000;
// Re-check the shared record now and then: another device may have beaten it.
const RECORD_REFRESH_MS = 20000;

// A short tick in the hand confirms a scan without looking at the screen. Silently does
// nothing on devices without a vibration motor.
function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

export function renderGameScreen(container) {
  const playerName = getStoredUsername() || '';

  container.innerHTML = `
    <div class="screen game-screen">
      <header class="game-bar">
        <button id="exitGame" class="chip-btn" type="button" aria-label="Exit game">
          ${icon('x', { size: 20 })}<span>Exit</span>
        </button>
        <div class="player-chip">
          <span class="avatar avatar--sm ${avatarClass(playerName)}" aria-hidden="true">${escapeHtml(initials(playerName))}</span>
          <span class="player-name">${escapeHtml(playerName)}</span>
        </div>
        <div class="count-pill" role="status" aria-label="Barcodes scanned">
          <span id="progress">0</span><span class="count-total">/${REQUIRED_SCANS}</span>
        </div>
      </header>

      <main class="game-layout">
        <h1 class="visually-hidden">Barcode challenge</h1>
        <section class="timer-card" aria-label="Timer">
          <p class="timer-label">Time</p>
          <div id="timer" class="timer-display" role="timer">00:00</div>
          <p id="recordLine" class="record-line" hidden></p>
        </section>

        <section class="scanner-card" aria-label="Barcode scanner">
          <div id="scannerFrame" class="scanner-frame">
            <div id="interactive" class="viewport" aria-hidden="true"></div>
            <div class="scanner-overlay" aria-hidden="true">
              <span class="corner tl"></span><span class="corner tr"></span>
              <span class="corner bl"></span><span class="corner br"></span>
              <div class="scan-track"><span class="scan-line"></span></div>
            </div>
            <div class="scanner-loading"><span class="spinner"></span><span>Starting camera...</span></div>
            <div class="scan-feedback" id="scanFeedback" role="status" aria-live="polite"></div>
          </div>
          <p class="scanner-hint">Aim at a barcode. Each box counts once.</p>
        </section>

        <section class="progress-card" aria-hidden="true">
          <div id="pips" class="pips">${'<span class="pip"></span>'.repeat(REQUIRED_SCANS)}</div>
        </section>

        <section class="codes-card" aria-label="Scanned barcodes">
          <h2 class="codes-title">Scanned</h2>
          <ol id="scannedCodes" class="scanned-codes"></ol>
        </section>
      </main>
    </div>
  `;

  let scannedCodes = 0;
  let finished = false;
  let leftScreen = false;
  const maxCodes = REQUIRED_SCANS;
  const timerElement = document.getElementById('timer');
  const gameTimer = new GameTimer(timerElement, getFastestTime);

  // Tell the shared server a game has started on this device.
  const play = startPlay({ name: getStoredUsername(), email: getStoredEmail() });

  // "Record to beat" under the timer, kept current as other devices set new records.
  const recordLine = document.getElementById('recordLine');
  const updateRecordLine = () => {
    const record = getFastestTime();
    recordLine.hidden = !Number.isFinite(record);
    if (!recordLine.hidden) recordLine.textContent = `Record to beat: ${record.toFixed(2)}s`;
  };
  const refreshRecord = () => refreshFastestTime().then(updateRecordLine);
  refreshRecord();

  const currentElapsed = () => (scannedCodes > 0 && gameTimer.startTime ? gameTimer.getElapsedTime() : null);
  const reportProgress = () => play.progress({ scanned: scannedCodes, elapsed: currentElapsed() });

  const heartbeatTimer = setInterval(reportProgress, HEARTBEAT_MS);
  const recordTimer = setInterval(refreshRecord, RECORD_REFRESH_MS);
  const stopReporting = () => {
    clearInterval(heartbeatTimer);
    clearInterval(recordTimer);
  };

  const handleSuccessfulScan = async (code) => {
    // A detection can still arrive while the finished game is being wrapped up.
    if (finished) return;

    if (scannedCodes === 0) {
      gameTimer.start();
    }

    scannedCodes++;
    document.getElementById('progress').textContent = scannedCodes;
    document.getElementById('pips').children[scannedCodes - 1]?.classList.add('on');

    // Update scanned codes display (the code is shown as text, never as markup)
    const scannedCodesElement = document.getElementById('scannedCodes');
    const codeElement = document.createElement('li');
    codeElement.innerHTML = '<span class="code-num"></span><span class="code-text"></span>';
    codeElement.querySelector('.code-num').textContent = scannedCodes;
    codeElement.querySelector('.code-text').textContent = code;
    scannedCodesElement.appendChild(codeElement);
    if (scannedCodesElement.scrollHeight - scannedCodesElement.clientHeight > 1) {
      scannedCodesElement.scrollTop = scannedCodesElement.scrollHeight;
    }

    if (scannedCodes < maxCodes) {
      buzz(25);
      reportProgress();
      return;
    }

    finished = true;
    buzz([60, 40, 140]);
    const totalTime = gameTimer.stop();
    stopReporting();
    // The leaderboard uses this to say "your time" and highlight the participant's row.
    saveLastResult({ name: getStoredUsername(), time: totalTime });

    // Send the result and shut the camera down at the same time. Waiting is capped: if
    // the network is down the result stays queued on this device and is delivered as
    // soon as it is back, so the participant is never stuck on this screen.
    const delivered = play.finish({ time: totalTime });
    await cleanup();
    await delivered;
    // The participant may have tapped Exit while this was waiting; respect that.
    if (!leftScreen) window.location.hash = '#leaderboard';
  };

  const cleanup = async () => {
    await scannerManager.cleanup();
    gameTimer.cleanup();
  };

  const initScanner = async (retries = 3) => {
    try {
      await scannerManager.initialize('interactive', handleSuccessfulScan);
      document.getElementById('scannerFrame')?.classList.add('is-live');
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

  // Called by the router when this screen is left (Exit, back button, failed camera...).
  return () => {
    leftScreen = true;
    stopReporting();
    if (!finished) {
      finished = true;
      play.abandon({ scanned: scannedCodes, elapsed: currentElapsed() });
    }
    cleanup();
  };
}
