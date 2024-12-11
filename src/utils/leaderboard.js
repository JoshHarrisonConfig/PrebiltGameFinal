import * as XLSX from 'xlsx';

const LEADERBOARD_KEY = 'barcodeGame_leaderboard';
const SPOT_PRIZE_KEY = 'barcodeGame_spotPrize';

export function saveScore(username, time) {
  const leaderboard = getLeaderboard();
  leaderboard.push({ username, time, date: new Date().toISOString() });
  leaderboard.sort((a, b) => a.time - b.time);
  const topScores = leaderboard.slice(0, 10);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(topScores));
  checkSpotPrize();
}

export function getLeaderboard() {
  const leaderboard = localStorage.getItem(LEADERBOARD_KEY);
  return leaderboard ? JSON.parse(leaderboard) : [];
}

export function getFastestTime() {
  const leaderboard = getLeaderboard();
  return leaderboard.length > 0 ? leaderboard[0].time : null;
}

export function clearLeaderboard() {
  localStorage.removeItem(LEADERBOARD_KEY);
}

export function exportToExcel() {
  const leaderboard = getLeaderboard();
  const ws = XLSX.utils.json_to_sheet(leaderboard.map(entry => ({
    Username: entry.username,
    'Time (seconds)': entry.time.toFixed(2),
    Date: new Date(entry.date).toLocaleString()
  })));
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leaderboard");
  
  XLSX.writeFile(wb, "barcode-game-leaderboard.xlsx");
}

function checkSpotPrize() {
  const settings = JSON.parse(localStorage.getItem(SPOT_PRIZE_KEY) || '{"interval": 5, "count": 0}');
  settings.count = (settings.count + 1) % settings.interval;
  localStorage.setItem(SPOT_PRIZE_KEY, JSON.stringify(settings));
  
  if (settings.count === 0) {
    return true;
  }
  return false;
}

export function getSpotPrizeSettings() {
  return JSON.parse(localStorage.getItem(SPOT_PRIZE_KEY) || '{"interval": 5, "count": 0}');
}

export function updateSpotPrizeSettings(interval) {
  const settings = getSpotPrizeSettings();
  settings.interval = interval;
  localStorage.setItem(SPOT_PRIZE_KEY, JSON.stringify(settings));
}