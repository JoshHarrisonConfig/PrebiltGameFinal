export class GameTimer {
  constructor(timerElement, getFastestTime) {
    this.timerElement = timerElement;
    this.getFastestTime = getFastestTime;
    this.startTime = null;
    this.timerInterval = null;
  }

  start() {
    this.startTime = Date.now();
    this.update();
    this.timerInterval = setInterval(() => this.update(), 1000);
  }

  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    return this.getElapsedTime();
  }

  update() {
    if (!this.startTime) return;
    
    const elapsedSeconds = this.getElapsedTime();
    const fastestTime = this.getFastestTime();
    
    const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(elapsedSeconds % 60).toString().padStart(2, '0');
    const timeString = `${minutes}:${seconds}`;

    this.timerElement.textContent = timeString;
    this.updateStyle(elapsedSeconds, fastestTime);
  }

  getElapsedTime() {
    return (Date.now() - this.startTime) / 1000;
  }

  updateStyle(currentTime, fastestTime) {
    this.timerElement.className = 'timer-display';
    
    if (fastestTime === null || fastestTime === undefined) {
      // No records yet, keep default styling
      return;
    }

    if (currentTime <= fastestTime) {
      this.timerElement.classList.add('beating-record');
    } else {
      this.timerElement.classList.add('above-record');
    }
  }

  cleanup() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.startTime = null;
  }
}