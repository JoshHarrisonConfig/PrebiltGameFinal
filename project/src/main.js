// Fonts are bundled with the app (no request to a font CDN, so they load on venue Wi-Fi and
// nothing about the visitor is sent to a third party).
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import { initializeApp } from './app.js';
import { initInstallPrompt } from './utils/pwa.js';
import './styles/main.css';

// Listen from the very start: the browser announces "this app can be installed" only once.
initInstallPrompt();

document.addEventListener('DOMContentLoaded', initializeApp);
