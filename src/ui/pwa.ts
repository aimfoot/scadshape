// Installable app and offline: the service worker (sw.js) is only registered over https (or locally
// with ?sw for tests) – the dev server over Tailscale is plain http. Not in the Android app: the
// files are already in the APK there.

import { t } from '../i18n';
import { showToast } from './toast';
import { android } from '../android';

export function initPwa() {
  if (android || !('serviceWorker' in navigator)) return;
  const local = location.hostname === '127.0.0.1' && new URLSearchParams(location.search).has('sw');
  if (location.protocol !== 'https:' && !local) return;
  const hadController = !!navigator.serviceWorker.controller;
  // The new service worker takes over the page right away (clients.claim) → controllerchange. The
  // first time: the app now works without network. Otherwise: a new version has been downloaded.
  navigator.serviceWorker.addEventListener('controllerchange', () => showToast(t(hadController ? 'toast.updated' : 'toast.offlineReady')), { once: true });
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* without a service worker the app still works, just not offline */
  });
}
