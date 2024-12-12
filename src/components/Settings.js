import { getSpotPrizeSettings, saveSpotPrizeSettings } from '../utils/storage.js';
import { getBarcodeSequence, saveBarcodeSequence } from '../utils/barcodeSequence.js';

export function renderSettingsModal() {
  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.className = 'modal';
  
  const sequence = getBarcodeSequence();
  const settings = getSpotPrizeSettings();
  
  modal.innerHTML = `
    <div class="modal-content settings-modal">
      <span class="close-modal">&times;</span>
      <h2>Settings</h2>
      <div class="settings-form">
        <div class="form-group">
          <label for="spotPrizeInterval">Spot Prize Interval:</label>
          <input type="number" id="spotPrizeInterval" min="1" value="${settings.interval}">
          <p class="help-text">Award a spot prize every X players who complete the game</p>
        </div>
        
        <div class="form-group barcode-sequence">
          <h3>Barcode Sequence</h3>
          <div class="sequence-list">
            ${sequence.map((item, index) => `
              <div class="sequence-item">
                <span class="position">${index + 1}</span>
                <input type="text" 
                       class="barcode-input" 
                       placeholder="Enter barcode"
                       value="${item.code}"
                       data-position="${index}">
                <input type="text" 
                       class="description-input" 
                       placeholder="Description (optional)"
                       value="${item.description}"
                       data-position="${index}">
              </div>
            `).join('')}
          </div>
          <p class="help-text">Leave empty to accept any barcode for that position</p>
        </div>
        
        <button id="saveSettings" class="btn btn-primary">Save Settings</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeBtn = modal.querySelector('.close-modal');
  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  
  window.addEventListener('click', (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });
  
  const saveBtn = document.getElementById('saveSettings');
  saveBtn.addEventListener('click', () => {
    const interval = parseInt(document.getElementById('spotPrizeInterval').value);
    if (interval > 0) {
      saveSpotPrizeSettings(interval);
    }
    
    const newSequence = Array.from(document.querySelectorAll('.sequence-item')).map(item => ({
      position: parseInt(item.querySelector('.barcode-input').dataset.position) + 1,
      code: item.querySelector('.barcode-input').value.trim(),
      description: item.querySelector('.description-input').value.trim()
    }));
    
    saveBarcodeSequence(newSequence);
    modal.style.display = 'none';
  });
  
  return modal;
}