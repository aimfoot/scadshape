// Sidans del av Android-appen (se src/android.ts och android/): bakåtknappen, systemradernas färg
// efter temat och filer som andra appar öppnar/delar till appen.

import { android, fromBase64 } from '../android';
import { onThemeChange, currentTheme, type Theme } from '../theme';
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
 * Bakåtknappen: stänger det översta som är öppet med appens egna knappar (samma logik som ett
 * tryck). true = hanterat; false = inget öppet, då lägger Android appen i bakgrunden.
 */
function back(): boolean {
  const dialogs = document.querySelectorAll<HTMLDialogElement & { requestClose?: () => void }>('dialog[open]');
  const top = dialogs[dialogs.length - 1];
  if (top) {
    // En synlig tillbaka-knapp i dialogen (t.ex. licenstexten i "Om") går ett steg bakåt.
    const stepBack = [...top.querySelectorAll<HTMLElement>('[data-back]')].find(b => b.offsetParent);
    if (stepBack) return stepBack.click(), true;
    // requestClose skickar 'cancel' först, som Esc – dialoger som ångrar något får veta det.
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

/** Hämtar en fil som väntar hos appen (öppnad/delad från en annan app) och öppnar den. */
async function openPending() {
  const json = android!.takeFile();
  if (!json) return;
  const { name, data } = JSON.parse(json) as { name: string; data: string };
  const file = new File([fromBase64(data)], name);
  if (document.body.dataset.mode === 'sketch') $('#btnDone').click();
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
