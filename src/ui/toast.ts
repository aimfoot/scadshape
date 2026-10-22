// Korta notiser (i skissläget i skissytan, annars över 3D-vyn).

import { remoteLog } from '../remote';
import { $, $$ } from './dom';

let timer = 0;

export function showToast(text: string, kind: 'info' | 'error' = 'info') {
  const el = document.body.dataset.mode === 'sketch' ? $('#toast') : $('#partToast');
  for (const t of $$('.toast')) t.hidden = true;
  el.textContent = text;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(timer);
  timer = window.setTimeout(() => (el.hidden = true), kind === 'error' ? 4000 : 2500);
  if (kind === 'error') remoteLog('message', { text });
}

export function hideToasts() {
  for (const t of $$('.toast')) t.hidden = true;
}
