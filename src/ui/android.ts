// The page's part of the Android app (see src/android.ts and android/): the back button, the system
// bars' color by theme and files that other apps open/share to the app.

import { android, fromBase64 } from '../android';
import { onThemeChange, currentTheme, type Theme } from '../theme';
import { receiveCode } from './aiflow';
import { $ } from './dom';
import { importFile } from './importer';
import { openProjectFile } from './projects';
import { showToast } from './toast';
import { t } from '../i18n';

const visible = (sel: string) => {
  const el = document.querySelector<HTMLElement>(sel);
  return !!el && !el.hidden;
};

/**
 * The back button: closes the topmost open thing with the app's own buttons (the same logic as a
 * tap). true = handled; false = nothing open, then Android sends the app to the background.
 */
function back(): boolean {
  const dialogs = document.querySelectorAll<HTMLDialogElement & { requestClose?: () => void }>('dialog[open]');
  const top = dialogs[dialogs.length - 1];
  if (top) {
    // A visible back button in the dialog (e.g. the licence text in "About") goes one step back.
    const stepBack = [...top.querySelectorAll<HTMLElement>('[data-back]')].find(b => b.offsetParent);
    if (stepBack) return stepBack.click(), true;
    // requestClose sends 'cancel' first, like Esc – dialogs that undo something get to know.
    if (top.requestClose) top.requestClose();
    else top.close();
    return true;
  }
  if (visible('#faceBar')) return $('#faceCancel').click(), true;
  if (visible('#measureBar')) return $('#btnMeasure').click(), true;
  if (visible('#featPanel')) return $('#fpCancel').click(), true;
  if (document.body.dataset.mode === 'sketch') return $('#btnDone').click(), true;
  if (visible('#tree')) return $('#btnTree').click(), true;
  return false;
}

function setBars(th: Theme) {
  const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content || '#ffffff';
  android!.setBars(color, th === 'dark');
}

/** Fetches a file waiting in the app (opened/shared from another app) and opens it. */
async function openPending() {
  const json = android!.takeFile();
  if (!json) return;
  const { name, data, text } = JSON.parse(json) as { name: string; data: string; text?: string };
  if (document.body.dataset.mode === 'sketch') $('#btnDone').click();
  // Text shared from another app (an AI chat's answer): its code becomes Custom code.
  if (text !== undefined) {
    const ok = receiveCode(text);
    showToast(ok ? t('ai.received') : t('ai.noCode'), ok ? 'info' : 'error');
    return;
  }
  const file = new File([fromBase64(data)], name);
  try {
    if (/\.(stl|svg)$/i.test(name)) await importFile(file);
    else await openProjectFile(file);
  } catch (e) {
    showToast(`${t('import.failed')}: ${(e as Error).message}`, 'error');
  }
}

export function initAndroid() {
  if (!android) return;
  const w = globalThis as { scadshapeBack?: () => boolean; scadshapeOpenPending?: () => void };
  w.scadshapeBack = back;
  w.scadshapeOpenPending = () => void openPending();
  setBars(currentTheme());
  onThemeChange(setBars);
  void openPending();
}
