// Installerbar app och offline: service workern (sw.js) registreras bara över https
// (eller lokalt med ?sw för tester) – utvecklingsservern över Tailscale är vanlig http.
// Inte i Android-appen: där ligger filerna redan i APK:n.

import { t } from '../i18n';
import { showToast } from './toast';
import { android } from '../android';

export function initPwa() {
  if (android || !('serviceWorker' in navigator)) return;
  const local = location.hostname === '127.0.0.1' && new URLSearchParams(location.search).has('sw');
  if (location.protocol !== 'https:' && !local) return;
  const hadController = !!navigator.serviceWorker.controller;
  // Den nya service workern tar över sidan direkt (clients.claim) → controllerchange.
  // Första gången: nu fungerar appen utan nät. Annars: en ny version är hämtad.
  navigator.serviceWorker.addEventListener('controllerchange', () => showToast(t(hadController ? 'toast.updated' : 'toast.offlineReady')), { once: true });
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* utan service worker fungerar appen ändå, bara inte offline */
  });
}
