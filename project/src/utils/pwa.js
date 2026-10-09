// Progressive Web App glue: installing the app, and keeping an installed copy up to date.
// The offline behaviour itself lives in the service worker (build/sw-template.js).

const UPDATE_CHECK_MS = 30 * 60 * 1000;

// ---- Install ---------------------------------------------------------------------------

let deferredPrompt = null;
const installListeners = new Set();
const notifyInstall = () => installListeners.forEach((listener) => listener());

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || window.navigator.standalone === true;
}

// Call once, as early as possible: the browser fires "beforeinstallprompt" only once.
export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Hold the browser's own mini prompt back; the app offers an "Install app" button instead.
    event.preventDefault();
    deferredPrompt = event;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstall();
  });
}

export const canInstall = () => deferredPrompt !== null && !isStandalone();

export function onInstallAvailabilityChange(listener) {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

// Resolves 'accepted' | 'dismissed' | 'unavailable'.
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null; // a prompt can only be used once
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  notifyInstall();
  return outcome;
}

// ---- Service worker and updates ----------------------------------------------------------

// Registers the worker (production builds only: in development a cache would hide edits).
// `onUpdateReady` is called when a newer version of the app has been installed and is ready
// to use after a reload.
export function registerServiceWorker({ onUpdateReady } = {}) {
  if (!import.meta.env?.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      // If a worker already controlled this page, a later change of controller means an update
      // (the very first install claiming the page for the first time is not one).
      const hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) onUpdateReady?.();
      });

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });

      // A device left on this page all day should still pick up a deploy: look for one every
      // half hour, when the app comes back to the foreground, and when the network returns.
      const checkForUpdate = () => registration.update().catch(() => {});
      setInterval(checkForUpdate, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkForUpdate();
      });
      window.addEventListener('online', checkForUpdate);
    } catch (error) {
      console.warn('Offline support could not be enabled:', error);
    }
  });
}
