// Behaviour shared by the app's dialogs (admin sign-in, settings):
//   - announced to assistive tech as a modal dialog
//   - Escape or a click on the dimmed backdrop closes it
//   - keyboard focus moves into it, stays inside while open, and returns to the control
//     that opened it
//   - the page behind does not scroll

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const state = new WeakMap();

// Call once for each dialog element. `labelledBy` is the id of the dialog's heading.
export function prepareModal(modal, { labelledBy } = {}) {
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  if (labelledBy) modal.setAttribute('aria-labelledby', labelledBy);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  });
  modal.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(modal));
  });
}

export function isModalOpen(modal) {
  return modal.classList.contains('is-open');
}

export function openModal(modal, { initialFocus } = {}) {
  if (isModalOpen(modal)) return;
  const opener = document.activeElement;

  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeModal(modal);
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep Tab / Shift+Tab inside the dialog.
    const items = [...modal.querySelectorAll(FOCUSABLE)].filter((item) => item.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeydown, true);
  state.set(modal, { opener, onKeydown });

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  // Wait a frame so the element is displayed before it receives focus.
  requestAnimationFrame(() => {
    const target = (initialFocus && modal.querySelector(initialFocus)) || modal.querySelector(FOCUSABLE);
    target?.focus();
  });
}

export function closeModal(modal) {
  if (!isModalOpen(modal)) return;
  const saved = state.get(modal);
  if (saved) {
    document.removeEventListener('keydown', saved.onKeydown, true);
    state.delete(modal);
  }
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.is-open')) document.body.classList.remove('modal-open');
  if (saved?.opener && document.contains(saved.opener)) saved.opener.focus();
}
