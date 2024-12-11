import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../config/constants.js';

export function getBarcodeSequence() {
  const sequence = localStorage.getItem(STORAGE_KEYS.BARCODE_SEQUENCE);
  return sequence ? JSON.parse(sequence) : DEFAULT_SETTINGS.barcodeSequence;
}

export function saveBarcodeSequence(sequence) {
  localStorage.setItem(STORAGE_KEYS.BARCODE_SEQUENCE, JSON.stringify(sequence));
}

export function validateBarcode(scannedCode) {
  const sequence = getBarcodeSequence();
  const currentPosition = getCurrentPosition();
  
  if (currentPosition >= sequence.length) {
    return false;
  }
  
  const expectedCode = sequence[currentPosition].code;
  return expectedCode === '' || expectedCode === scannedCode;
}

export function getCurrentPosition() {
  const scannedCodes = document.querySelectorAll('.scanned-codes div').length;
  return scannedCodes;
}

export function getExpectedCode() {
  const sequence = getBarcodeSequence();
  const position = getCurrentPosition();
  return position < sequence.length ? sequence[position].code : null;
}