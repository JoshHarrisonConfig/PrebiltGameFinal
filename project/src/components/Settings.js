import { loadSettings, saveSettings } from '../utils/leaderboard.js';
import { handleAuthFailure } from '../utils/auth.js';
import { escapeHtml } from '../utils/dom.js';
import { ApiError } from '../utils/api.js';
import { icon } from './icons.js';
import { closeModal, openModal, prepareModal } from '../utils/modal.js';

const SEQUENCE_LENGTH = 10;

// Admin settings live on the server, so the values edited on the admin laptop are the ones
// every device uses. The dialog fetches them each time it opens.
export function createSettingsModal({ onSignedOut }) {
  const element = document.createElement('div');
  element.id = 'settingsModal';
  element.className = 'modal';
  element.innerHTML = `
    <div class="modal-content settings-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="settingsTitle">Settings</h2>
        <button type="button" class="icon-btn close-modal" data-close-modal aria-label="Close settings">${icon('x', { size: 22 })}</button>
      </div>
      <div class="settings-form">
        <div class="notice notice-warning" id="insecureNotice" hidden>
          The admin password is still the built-in default. Set <code>ADMIN_PASSWORD</code> in the
          site's environment variables before the event.
        </div>
        <div class="field">
          <label for="spotPrizeInterval">Spot prize interval</label>
          <input type="number" id="spotPrizeInterval" min="1" max="1000" step="1" inputmode="numeric" value="5">
          <p class="help-text">Award a spot prize every X players who complete the game</p>
        </div>

        <div class="barcode-sequence">
          <h3>Barcode sequence</h3>
          <div class="sequence-list" id="sequenceList"></div>
          <p class="help-text">Leave empty to accept any barcode for that position</p>
        </div>

        <div class="error-message" id="settingsError" role="alert"></div>
        <div class="modal-footer">
          <button id="saveSettings" class="btn btn-primary" type="button">Save settings</button>
        </div>
      </div>
    </div>
  `;

  const intervalInput = element.querySelector('#spotPrizeInterval');
  const sequenceList = element.querySelector('#sequenceList');
  const saveButton = element.querySelector('#saveSettings');
  const errorBox = element.querySelector('#settingsError');
  const insecureNotice = element.querySelector('#insecureNotice');

  prepareModal(element, { labelledBy: 'settingsTitle' });

  function setBusy(busy) {
    saveButton.disabled = busy;
    if (busy) saveButton.setAttribute('aria-busy', 'true');
    else saveButton.removeAttribute('aria-busy');
    intervalInput.disabled = busy;
    sequenceList.querySelectorAll('input').forEach((input) => {
      input.disabled = busy;
    });
  }

  function showError(message) {
    errorBox.textContent = message;
  }

  function renderSequence(sequence) {
    sequenceList.innerHTML = Array.from({ length: SEQUENCE_LENGTH }, (_, index) => {
      const item = sequence[index] || { code: '', description: '' };
      return `
        <div class="sequence-item">
          <span class="position">${index + 1}</span>
          <input type="text" class="barcode-input" placeholder="Barcode" maxlength="128"
                 aria-label="Barcode ${index + 1}" value="${escapeHtml(item.code)}" data-position="${index}">
          <input type="text" class="description-input" placeholder="Description (optional)" maxlength="200"
                 aria-label="Description ${index + 1}" value="${escapeHtml(item.description)}" data-position="${index}">
        </div>
      `;
    }).join('');
  }

  function close() {
    closeModal(element);
  }

  async function open() {
    showError('');
    renderSequence([]);
    openModal(element, { initialFocus: '#spotPrizeInterval' });
    setBusy(true);
    try {
      const { settings, insecureDefaults } = await loadSettings();
      intervalInput.value = settings.spotPrizeInterval;
      renderSequence(settings.barcodeSequence);
      insecureNotice.hidden = !insecureDefaults;
      setBusy(false);
    } catch (error) {
      if (handleAuthFailure(error)) {
        close();
        onSignedOut();
        return;
      }
      showError('Could not load the settings. Check the connection and reopen this window.');
    }
  }

  async function save() {
    const interval = Number(intervalInput.value);
    if (!Number.isInteger(interval) || interval < 1 || interval > 1000) {
      showError('Spot prize interval must be a whole number between 1 and 1000.');
      return;
    }

    const barcodeSequence = Array.from(sequenceList.querySelectorAll('.sequence-item')).map((item, index) => ({
      position: index + 1,
      code: item.querySelector('.barcode-input').value.trim(),
      description: item.querySelector('.description-input').value.trim()
    }));

    showError('');
    setBusy(true);
    try {
      await saveSettings({ spotPrizeInterval: interval, barcodeSequence });
      setBusy(false);
      close();
    } catch (error) {
      setBusy(false);
      if (handleAuthFailure(error)) {
        close();
        onSignedOut();
        return;
      }
      showError(
        error instanceof ApiError && !error.retryable
          ? 'The server rejected these settings. Check the values and try again.'
          : 'Could not save the settings. Check the connection and try again.'
      );
    }
  }

  saveButton.addEventListener('click', save);

  return { element, open };
}
