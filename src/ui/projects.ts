// Modeller (projekt): lista, öppna, ny, byt namn, duplicera, ta bort, importera/spara som fil.
// Aktuell modell visas överst i ☰ och som källa ("Min låda") i rullistan.

import { emptyDoc } from '../doc';
import { getLang, t } from '../i18n';
import {
  createProject, deleteProject, duplicateProject, exportProject, listProjects, loadProject, parseProjectFile,
  projectInfo, renameProject, setCurrentProject,
} from '../projects';
import { remoteLog } from '../remote';
import { $, el, store } from './dom';
import { closePanel, currentPanel } from './panel';
import { setSource, view } from './render';
import { exitSketch } from './sketchmode';
import { resetHistory } from './history';
import { app, emit } from './state';
import { showToast } from './toast';
import { embedBlobs, storeEmbedded } from '../blobs';
import { android, saveViaApp } from '../android';

const dlg = () => $<HTMLDialogElement>('#projDlg');
/** Anropas när modellens namn ändrats (källistan visar namnet). */
export const projectHooks = { renamed: () => {} };

export const currentProjectName = () => projectInfo(app.projectId)?.name ?? 'scadshape';

export function switchProject(id: string) {
  if (currentPanel()) closePanel();
  if (document.body.dataset.mode === 'sketch') exitSketch();
  app.projectId = setCurrentProject(id);
  app.doc = loadProject(id);
  app.previewDoc = null;
  resetHistory(); // ångra gäller bara inom en modell
  view.fitNext = true;
  if (app.source !== 'model') setSource('model');
  refreshProjectName();
  emit('docChanged');
}

function refreshProjectName() {
  $('#projName').textContent = currentProjectName();
  projectHooks.renamed();
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(getLang() === 'sv' ? 'sv-SE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });

const ICONS = {
  rename: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

function iconButton(icon: keyof typeof ICONS, label: string, onClick: () => void) {
  const b = el('button', { type: 'button', className: 'icon', title: label });
  b.innerHTML = ICONS[icon];
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function renderList() {
  const items = listProjects().map(p => {
    const open = el('button', { type: 'button', className: 'projopen' }, el('span', { textContent: p.name }), el('small', { textContent: when(p.updated) }));
    if (p.id === app.projectId) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => {
      dlg().close();
      if (p.id !== app.projectId) switchProject(p.id);
    });
    const rename = iconButton('rename', t('project.rename'), () => {
      const input = el('input', { value: p.name, className: 'projname', autocomplete: 'off', enterKeyHint: 'done' });
      const done = () => {
        renameProject(p.id, input.value);
        if (p.id === app.projectId) refreshProjectName();
        renderList();
      };
      input.addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), input.blur()));
      input.addEventListener('blur', done, { once: true });
      open.replaceWith(input);
      input.focus();
      input.select();
    });
    const dup = iconButton('duplicate', t('project.duplicate'), () => {
      switchProject(duplicateProject(p.id, t('project.copy')));
      renderList();
    });
    const del = iconButton('delete', t('project.delete'), () => {
      if (!confirm(t('project.confirmDelete', { name: p.name }))) return;
      deleteProject(p.id);
      remoteLog('project-delete');
      if (p.id === app.projectId) switchProject(listProjects()[0]?.id ?? createProject(t('project.default'), emptyDoc()));
      renderList();
    });
    del.classList.add('danger');
    return el('li', {}, open, rename, dup, del);
  });
  $('#projList').replaceChildren(...items);
}

async function download(name: string, text: string) {
  if (android) return saveViaApp(new File([text], name, { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

/** Ser texten ut som OpenSCAD (och inte som något helt annat)? */
const looksLikeScad = (text: string) =>
  !text.includes('\0') &&
  (/\b(cube|cylinder|sphere|polygon|polyhedron|circle|square|linear_extrude|rotate_extrude|translate|rotate|difference|union|intersection|hull|minkowski|text)\s*\(/.test(text) ||
    /\b(module|function)\s+\w+\s*\(/.test(text) ||
    /^\s*(include|use)\s*</m.test(text));

/** Visa OpenSCAD-kod som Egen kod, med kodpanelen öppen. */
function openScadCode(text: string, name: string) {
  store.set('codeName', name.replace(/\.scad$/i, ''));
  if (currentPanel()) closePanel();
  if (document.body.dataset.mode === 'sketch') exitSketch();
  store.set('code', text); // först – setSource läser den sparade koden
  setSource('egen');
  $('#codePanel').hidden = false;
  $('#btnCode').setAttribute('aria-pressed', 'true');
  store.set('codeOpen', '1');
  // ☰ stängs så att koden syns (lådan ligger annars över kodpanelen).
  $('#tree').hidden = true;
  $('#btnTree').setAttribute('aria-pressed', 'false');
  store.set('treeOpen', '0');
  emit('render');
}

export function openProjects() {
  renderList();
  dlg().showModal();
}

export function initProjects() {
  refreshProjectName();
  $('#btnProjects').addEventListener('click', openProjects);
  $('#projNew').addEventListener('click', () => {
    dlg().close();
    switchProject(createProject(t('project.default')));
    showToast(t('project.created', { name: currentProjectName() }));
  });
  $('#projExport').addEventListener('click', () => {
    const name = `${currentProjectName().replace(/[\\/:*?"<>|]+/g, '_')}.scadshape.json`;
    embedBlobs(exportProject(app.projectId))
      .then(json => download(name, json))
      .then(() => showToast(t('export.downloaded', { name })))
      .catch(e => showToast(`${t('export.saveFailed')}: ${(e as Error).message}`, 'error'));
  });
  const file = $<HTMLInputElement>('#projFile');
  $('#projImport').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (f) void openProjectFile(f);
  });
}

/** Öppnar en modellfil (.scadshape.json) som ny modell, eller OpenSCAD-kod som Egen kod. */
export async function openProjectFile(f: File) {
  const text = await f.text();
  const parsed = parseProjectFile(text);
  if (!parsed) {
    // .scad (eller annan OpenSCAD-kod): öppnas som Egen kod och renderas direkt.
    if (!/\.scad$/i.test(f.name) && !looksLikeScad(text)) return showToast(t('project.badFile'), 'error');
    dlg().close();
    openScadCode(text, f.name);
    remoteLog('open-scad', { bytes: text.length });
    return showToast(t('project.openedScad', { name: f.name }));
  }
  dlg().close();
  await storeEmbedded(text); // importerade STL-filer som följer med modellen
  switchProject(createProject(parsed.name, parsed.doc));
  showToast(t('project.imported', { name: currentProjectName() }));
}
