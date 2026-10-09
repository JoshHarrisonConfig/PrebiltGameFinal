import { icon } from './icons.js';

// "A new version is ready" - shown after a deploy reached an installed copy of the app.
// Refresh reloads into the new version; the close button hides the notice until the next update.
export function createUpdateNotice({ onDismiss } = {}) {
  const notice = document.createElement('div');
  notice.id = 'updateNotice';
  notice.className = 'toast';
  notice.setAttribute('role', 'status');
  notice.innerHTML = `
    <span class="toast-text">New version ready</span>
    <button type="button" class="chip-btn" data-action="refresh">Refresh</button>
    <button type="button" class="icon-btn toast-close" data-action="dismiss" aria-label="Dismiss">${icon('x', { size: 20 })}</button>
  `;
  notice.querySelector('[data-action="refresh"]').addEventListener('click', () => window.location.reload());
  notice.querySelector('[data-action="dismiss"]').addEventListener('click', () => onDismiss?.());
  return notice;
}
