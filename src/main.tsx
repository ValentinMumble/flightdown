import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import {App} from './App';
import {StoreProvider} from './data/store';
// Leaflet's styles first, so the cockpit's own map styles come after and win.
import 'leaflet/dist/leaflet.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/ui.css';
import './styles/instruments.css';
import './styles/hud.css';
import './styles/weather.css';
import './styles/sim.css';

// A page opened before a deploy asks for files the new deploy no longer has (the radio, the maps): reload to get the
// new ones, rather than leave the page blank. Not twice in a row, so a file that is really missing cannot start a
// reload loop.
const RELOADED_AT_KEY = 'reloaded-for-deploy-at';
const RELOAD_GAP_MS = 10_000;

/** Reloads into the new deploy, unless the page did so in the last 10 seconds. Whether it reloads. */
const reloadForDeploy = (): boolean => {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0) < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();

  return true;
};

window.addEventListener('vite:preloadError', event => {
  if (reloadForDeploy()) event.preventDefault();
});

// Flightdown keeps itself on this device with a service worker (sw/sw.js), so it opens at once, even at the field with
// no signal. A new deploy installs in the background, then takes over: the page reloads into it at once while nothing
// was tapped yet, else when it next comes back to the front.
const hasWorker = import.meta.env.PROD && 'serviceWorker' in navigator;
let tapped = false;
let outdated = false;
window.addEventListener('pointerdown', () => (tapped = true), {capture: true, once: true});
if (hasWorker) {
  // The first install takes over a page that is already the live one.
  let controlled = null !== navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (tapped) outdated = true;
    else reloadForDeploy();
  });
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {
      // No service worker: the app still works, it needs the network to open.
    }
  });
}

// An app on a phone's home screen can sit in memory for days and come back as it was, on an old deploy. Each time it
// comes back to the front (at most once a minute), the service worker looks for a new deploy.
const UPDATE_CHECK_GAP_MS = 60_000;
let checkedUpdateAt = 0;
document.addEventListener('visibilitychange', async () => {
  if ('visible' !== document.visibilityState) return;
  if (outdated) {
    reloadForDeploy();
    return;
  }
  if (!hasWorker || Date.now() - checkedUpdateAt < UPDATE_CHECK_GAP_MS) return;
  checkedUpdateAt = Date.now();
  try {
    await (await navigator.serviceWorker.getRegistration())?.update();
  } catch {
    // Offline: the next return to the front tries again.
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
