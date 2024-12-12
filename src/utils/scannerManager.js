import Quagga from 'quagga';

class ScannerManager {
  constructor() {
    this.isInitialized = false;
    this.currentScanner = null;
    this.mediaStream = null;
    this.initializationAttempts = 0;
    this.maxInitializationAttempts = 3;
    this.scannedCodes = new Set(); // Track scanned codes
    this.isProcessingScan = false; // Prevent multiple rapid scans
  }

  async initialize(containerId, onDetected) {
    try {
      this.initializationAttempts = 0;
      this.scannedCodes.clear(); // Reset scanned codes on new initialization
      return await this.tryInitialize(containerId, onDetected);
    } catch (error) {
      console.error('Failed to initialize scanner:', error);
      throw error;
    }
  }

  async tryInitialize(containerId, onDetected) {
    await this.cleanup();
    this.initializationAttempts++;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Scanner initialization timed out'));
        }, 10000);

        Quagga.init({
          inputStream: {
            name: "Live",
            type: "LiveStream",
            target: document.querySelector(`#${containerId}`),
            constraints: {
              facingMode: "environment",
              width: 640,
              height: 480,
            },
          },
          decoder: {
            readers: ["ean_reader", "ean_8_reader", "code_128_reader", "code_39_reader"],
            debug: {
              drawBoundingBox: true,
              showPattern: true
            }
          },
          locate: true,
          frequency: 10 // Reduce scan frequency to prevent rapid scans
        }, (err) => {
          clearTimeout(timeoutId);

          if (err) {
            this.handleInitError(err, containerId, onDetected, reject);
            return;
          }

          this.isInitialized = true;
          Quagga.start();
          
          this.currentScanner = Quagga.onDetected((result) => {
            this.handleDetection(result, onDetected);
          });

          resolve();
        });
      });
    } catch (error) {
      return this.handleInitError(error, containerId, onDetected);
    }
  }

  handleDetection(result, onDetected) {
    if (this.isProcessingScan) return; // Prevent multiple rapid scans

    const code = result.codeResult.code;
    if (!code) return;

    // Check if this code has already been scanned
    if (this.scannedCodes.has(code)) {
      this.showFeedback(false, 'Barcode already scanned!');
      return;
    }

    this.isProcessingScan = true;
    this.scannedCodes.add(code);
    this.showFeedback(true, 'New barcode scanned!');
    onDetected(code);

    // Reset processing flag after a delay
    setTimeout(() => {
      this.isProcessingScan = false;
    }, 1500); // Prevent new scans for 1.5 seconds
  }

  async handleInitError(error, containerId, onDetected, reject) {
    await this.cleanup();
    
    if (this.initializationAttempts < this.maxInitializationAttempts) {
      console.log(`Retrying scanner initialization (attempt ${this.initializationAttempts + 1}/${this.maxInitializationAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.tryInitialize(containerId, onDetected);
    }

    this.showFeedback(false, 'Failed to access camera');
    if (reject) reject(error);
    throw error;
  }

  async cleanup() {
    try {
      if (this.currentScanner) {
        Quagga.offDetected(this.currentScanner);
        this.currentScanner = null;
      }

      if (this.isInitialized) {
        Quagga.stop();
        this.isInitialized = false;
      }

      if (this.mediaStream) {
        const tracks = this.mediaStream.getTracks();
        await Promise.all(tracks.map(track => {
          track.stop();
          return new Promise(resolve => setTimeout(resolve, 100));
        }));
        this.mediaStream = null;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  showFeedback(success, message) {
    const feedback = document.getElementById('scanFeedback');
    if (!feedback) return;
    
    feedback.className = `scan-feedback ${success ? 'success' : 'error'}`;
    feedback.textContent = message || (success ? 'Scan Successful!' : 'Scan Failed');
    
    setTimeout(() => {
      if (feedback) {
        feedback.className = 'scan-feedback';
        feedback.textContent = '';
      }
    }, 1500);
  }
}

export const scannerManager = new ScannerManager();