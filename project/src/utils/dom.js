// Names and emails come from other people's devices, so anything that ends up in
// innerHTML must be escaped. A name like "<img onerror=...>" is shown as text, not run.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

// 83.4 -> "01:23", same format as the in-game timer.
export function formatClock(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// "Ada Lovelace" -> "AL", "Plato" -> "P". Works on whole characters, so emoji are not split.
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

// A stable avatar colour per person (one of six brand-friendly hues).
export function avatarClass(name) {
  let hash = 0;
  for (const character of String(name ?? '')) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return `avatar--${hash % 6}`;
}

// A finish time for the leaderboard: just the time for today ("5:07 PM"), with the date
// added for earlier days. `iso` is for the <time> element, `label` is what people read.
export function formatFinished(timestamp, now = Date.now()) {
  const date = new Date(timestamp);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const label = sameDay ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
  return { iso: date.toISOString(), label };
}
