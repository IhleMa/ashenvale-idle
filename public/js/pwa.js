// Installable app: service worker registration + "Install" buttons (Chrome/Edge/Android prompt, iOS instructions).
import { modal } from './ui.js';

let deferredPrompt = null;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function showButtons(show) {
  for (const b of document.querySelectorAll('[data-install]')) b.hidden = !show;
}

function instructions() {
  const secure = window.isSecureContext;
  const ios = isIos();
  modal(`<h2>📲 Install Ashenvale Idle</h2>
    ${!secure ? `<p class="warn-text">Installing needs a secure (https://) address. Open the game via your HTTPS domain to install it.</p>` : ''}
    ${ios ? `<ol class="install-steps">
        <li>Open this page in <b>Safari</b>.</li>
        <li>Tap the <b>Share</b> button <span class="kbd">⬆︎</span> at the bottom (iPad: top right).</li>
        <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
      : `<ol class="install-steps">
        <li><b>Chrome / Edge (PC):</b> click the install icon <span class="kbd">⊕</span> on the right of the address bar, or open the menu <span class="kbd">⋮</span> → <b>Install Ashenvale Idle</b> (Edge: <b>Apps → Install this site as an app</b>).</li>
        <li><b>Android:</b> menu <span class="kbd">⋮</span> → <b>Install app</b> / <b>Add to Home screen</b>.</li>
        <li><b>Firefox on Android:</b> menu <span class="kbd">⋮</span> → <b>Install</b>. (Firefox on PC can't install web apps — use Chrome or Edge.)</li></ol>`}
    <p class="muted small">The app opens in its own window without browser bars, has its own icon, and always loads the newest version of the game. You stay logged in.</p>
    <div class="row end"><button class="btn primary" data-close>OK</button></div>`);
}

async function install() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({}));
    deferredPrompt = null;
    if (outcome === 'accepted') showButtons(false);
    return;
  }
  instructions();
}

export function initPwa() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(e => console.warn('Service worker not registered:', e.message));
  }
  if (standalone()) { document.documentElement.classList.add('standalone'); return; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; showButtons(true); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; showButtons(false); });
  // iOS never fires beforeinstallprompt: offer the instructions instead
  if (isIos()) showButtons(true);
  document.addEventListener('click', e => { if (e.target.closest('[data-install]')) { e.preventDefault(); install(); } });
}

export function openInstallHelp() { if (deferredPrompt) install(); else instructions(); }
