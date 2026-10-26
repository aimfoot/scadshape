// Models (projects): list, open, new, rename, duplicate, delete, import/save as file. The current
// model is shown at the top of ☰.

import { emptyDoc } from '../doc';
import { getLang, t } from '../i18n';
import {
  createProject, deleteProject, duplicateProject, exportProject, listProjects, loadProject, parseProjectFile,
  projectInfo, renameProject, setCurrentProject,
} from '../projects';
import { remoteLog } from '../remote';
import { $, el, store } from './dom';
import { closePanel, currentPanel } from './panel';
import { commitCode, view } from './render';
import { openCode } from './workmode';
import { exitSketch } from './sketchmode';
import { resetHistory } from './history';
import { app, emit } from './state';
import { showToast } from './toast';
import { embedBlobs, storeEmbedded } from '../blobs';
import { android, saveViaApp } from '../android';

const dlg = () => $<HTMLDialogElement>('#projDlg');
export const currentProjectName = () => projectInfo(app.projectId)?.name ?? 'scadshape';

export function switchProject(id: string) {
  commitCode(); // edits in Code stay in the model they were made in
  if (currentPanel()) closePanel();
  if (document.body.dataset.mode === 'sketch') exitSketch();
  app.projectId = setCurrentProject(id);
  app.doc = loadProject(id);
  app.previewDoc = null;
  resetHistory(); // undo only applies within one model
  view.fitNext = true;
  refreshProjectName();
  emit('docChanged');
}

export function refreshProjectName() {
  $('#projName').textContent = currentProjectName();
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

/** Does the text look like OpenSCAD (and not like something else entirely)? */
const looksLikeScad = (text: string) =>
  !text.includes('\0') &&
  (/\b(cube|cylinder|sphere|polygon|polyhedron|circle|square|linear_extrude|rotate_extrude|translate|rotate|difference|union|intersection|hull|minkowski|text)\s*\(/.test(text) ||
    /\b(module|function)\s+\w+\s*\(/.test(text) ||
    /^\s*(include|use)\s*</m.test(text));

/** Open OpenSCAD code as a model, in Code. */
function openScadCode(text: string, name: string) {
  if (document.body.dataset.mode === 'sketch') exitSketch();
  // ☰ is closed so the code is visible (the drawer would otherwise cover the code panel).
  $('#tree').hidden = true;
  $('#btnTree').setAttribute('aria-pressed', 'false');
  store.set('treeOpen', '0');
  openCode(text, name.replace(/\.scad$/i, ''));
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

/** Opens a model file (.scadshape.json) as a new model, or OpenSCAD code as Custom code. */
export async function openProjectFile(f: File) {
  const text = await f.text();
  const parsed = parseProjectFile(text);
  if (!parsed) {
    // .scad (or other OpenSCAD code): opened as Custom code and rendered right away.
    if (!/\.scad$/i.test(f.name) && !looksLikeScad(text)) return showToast(t('project.badFile'), 'error');
    dlg().close();
    openScadCode(text, f.name);
    remoteLog('open-scad', { bytes: text.length });
    return showToast(t('project.openedScad', { name: f.name }));
  }
  dlg().close();
  await storeEmbedded(text); // imported STL files that come with the model
  switchProject(createProject(parsed.name, parsed.doc));
  showToast(t('project.imported', { name: currentProjectName() }));
}
