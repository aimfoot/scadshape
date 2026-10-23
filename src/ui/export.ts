// Export the model as 3MF, STL or OpenSCAD code. The file is prepared when the dialog opens (and
// when the format changes), so "Download"/"Share" works right on the tap – Android requires sharing
// to be started directly by a tap.

import { t } from '../i18n';
import { buildModel } from '../model3d';
import { remoteLog } from '../remote';
import { logProblems, type ExportFormat } from '../scad';
import { $, $$, store } from './dom';
import { currentCode, engine } from './render';
import { app } from './state';
import { currentProjectName } from './projects';
import { showToast } from './toast';
import { android, saveViaApp, shareViaApp } from '../android';
import type { MeshFeature } from '../features/mesh';

type Format = '3mf' | 'stl' | 'scad';
const MIME: Record<Format, string> = { '3mf': 'model/3mf', stl: 'model/stl', scad: 'text/plain' };
const ENGINE_FORMAT: Record<Exclude<Format, 'scad'>, ExportFormat> = { '3mf': '3mf', stl: 'binstl' };

const dlg = () => $<HTMLDialogElement>('#exportDlg');
const nameInput = () => $<HTMLInputElement>('#exName');
let format: Format = (store.get('exportFormat') as Format) || '3mf';
let file: File | null = null;
let job = 0;

/** The code that is exported: the whole model (without a preview from an open panel). */
const exportCode = () => (app.source === 'model' ? buildModel(app.doc).code : currentCode());

/** In the downloaded code import() points to the original file's name (put the file next to the .scad file). */
function scadForDownload(code: string) {
  const names = new Map(app.doc.features.filter((f): f is MeshFeature => f.type === 'mesh').map(f => [f.file, f.fileName]));
  return code.replace(/"\/imports\/([0-9a-f]{24})\.stl"/g, (m, h) => (names.has(h) ? JSON.stringify(names.get(h)) : m));
}

const fileName = () => `${(nameInput().value.trim() || 'scadshape').replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;

function setInfo(text: string, error = false) {
  $('#exInfo').textContent = text;
  $('#exInfo').classList.toggle('error', error);
}

function setReady(ready: boolean) {
  $<HTMLButtonElement>('#exDownload').disabled = !ready;
  const share = $<HTMLButtonElement>('#exShare');
  share.disabled = !ready;
  share.hidden = !(file && (android || navigator.canShare?.({ files: [file] })));
}

const kB = (n: number) => `${(n / 1024).toLocaleString(undefined, { maximumFractionDigits: n < 10240 ? 1 : 0 })} kB`;

async function prepare() {
  const my = ++job;
  file = null;
  setReady(false);
  for (const b of $$<HTMLButtonElement>('#exFormat [data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === format));
  const code = exportCode();
  if (format === 'scad') {
    file = new File([scadForDownload(code)], fileName(), { type: MIME.scad });
    setInfo(t('export.ready', { size: kB(file.size) }));
    return setReady(true);
  }
  setInfo(t('export.preparing'));
  try {
    const r = await engine.render(code, ENGINE_FORMAT[format], undefined, 180_000);
    if (my !== job) return;
    if (!r.ok || !r.data) {
      const why = logProblems(r.log)[0] ?? t('export.empty');
      return setInfo(`⚠ ${why}`, true);
    }
    file = new File([r.data], fileName(), { type: MIME[format] });
    setInfo(t('export.ready', { size: kB(file.size) }));
    setReady(true);
  } catch (e) {
    if (my === job) setInfo(`⚠ ${(e as Error).message}`, true);
  }
}

async function download() {
  if (!file) return;
  const named = file.name === fileName() ? file : new File([file], fileName(), { type: file.type });
  if (android) {
    try {
      await saveViaApp(named);
    } catch (e) {
      return showToast(`${t('export.saveFailed')}: ${(e as Error).message}`, 'error');
    }
    remoteLog('export', { format, bytes: named.size });
    return showToast(t('export.downloaded', { name: named.name }));
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(named);
  a.download = named.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  remoteLog('export', { format, bytes: named.size });
  showToast(t('export.downloaded', { name: named.name }));
}

async function share() {
  if (!file) return;
  const named = new File([file], fileName(), { type: file.type });
  try {
    if (android) await shareViaApp(named);
    else await navigator.share({ files: [named], title: named.name });
    remoteLog('export-share', { format, bytes: named.size });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') showToast(`${t('export.shareFailed')}: ${(e as Error).message}`, 'error');
  }
}

export function openExport() {
  nameInput().value = currentProjectName();
  dlg().showModal();
  void prepare();
}

export function initExport() {
  $('#btnExport').addEventListener('click', openExport);
  for (const b of $$<HTMLButtonElement>('#exFormat [data-format]'))
    b.addEventListener('click', () => {
      format = b.dataset.format as Format;
      store.set('exportFormat', format);
      void prepare();
    });
  $('#exDownload').addEventListener('click', () => void download());
  $('#exShare').addEventListener('click', () => void share());
  dlg().addEventListener('close', () => {
    job++; // a running preparation should no longer be shown
    file = null;
  });
}
