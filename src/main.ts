// scadshape – CAD on the phone: sketches with constraints → features (extrude, revolve, holes,
// threads …) → OpenSCAD (WASM, Manifold) → 3D. This is where the UI modules are wired together.

import { localizeDefaultNames, type Feature } from './doc';
import { KINDS } from './features';
import { allLangs, applyI18n, getLang, LANGS, onLangChange, setLang, t, type Lang } from './i18n';
import { installErrorReporting, isDevHost, remoteLog } from './remote';
import { initStart } from './ui/welcome';
import { initScrollHints } from './ui/scrollhint';
import { loadSolver } from './sketch/solver';
import type { ViewName } from './viewer';
import { runBench } from './ui/bench';
import { $, $$, store } from './ui/dom';
import { closePanel, currentPanel, initPanel, openPanel, startFeature } from './ui/panel';
import { initExport } from './ui/export';
import { initPwa } from './ui/pwa';
import { initAndroid } from './ui/android';
import { initAbout } from './ui/about';
import { openStorage, storageForTests, storageHooks } from './kv';
import { initHistory, recordDoc } from './ui/history';
import { initConvert } from './ui/convert';
import { initMeasure, stopMeasure } from './ui/measure';
import { initImport } from './ui/importer';
import { initBlobs } from './blobs';
import { buildModel } from './model3d';
import { applyTheme, onThemeChange, setThemeChoice, themeChoice, type ThemeChoice } from './theme';
import { initParams, openParams, refreshChips } from './ui/params';
import { EXAMPLES, initRenderUi, requestRender, setSource, syncCodePanel, view, viewer, cancelRender } from './ui/render';
import { currentEditor, enterSketch, initSketchMode, refreshSketchTexts, setMode, sketchHooks } from './ui/sketchmode';
import { app, emit, initState, on, saveDoc } from './ui/state';
import { currentProjectName, initProjects, projectHooks } from './ui/projects';
import { showToast } from './ui/toast';
import { initTree, renderTree, treeActions } from './ui/tree';

applyTheme(); // first, so nothing is drawn in the wrong theme
installErrorReporting();
remoteLog('start', { ua: navigator.userAgent, screen: `${screen.width}×${screen.height} @${devicePixelRatio}`, lang: getLang() });
// The models (IndexedDB) are loaded after the theme, so nothing is drawn in the wrong theme
// meanwhile.
await openStorage();
initState();
saveDoc(); // save a possibly migrated document
storageHooks.error = () => showToast(t('storage.saveFailed'), 'error');

// ---- The document changed: save, redraw the tree, render ----------------------------------------

on('docChanged', () => {
  recordDoc();
  saveDoc();
  if (app.source !== 'model') setSource('model');
  renderTree();
  requestRender();
});

treeActions.edit = (f: Feature) => (f.type === 'sketch' ? enterSketch(f) : openPanel(f, true));
sketchHooks.beforeEnter = () => {
  stopMeasure();
  if (currentPanel()) closePanel();
};

// ---- The constraint solver (planegcs) loads in the background -----------------------------------

loadSolver()
  .then(s => {
    app.solver = s;
    emit('solver', s);
    remoteLog('solver-loaded');
  })
  .catch(e => {
    remoteLog('solver-error', { err: String(e) });
    showToast(t('toast.solverFailed'), 'error');
  });

// ---- Source, panels and buttons -------------------------------------------------------------

function fillSources() {
  const sel = $<HTMLSelectElement>('#source');
  sel.replaceChildren(new Option(currentProjectName(), 'model'), ...EXAMPLES.map(e => new Option(t(e.name), e.id)), new Option(t('source.custom'), 'custom'));
  if (![...sel.options].some(o => o.value === app.source)) app.source = 'model';
  sel.value = app.source;
}

function togglePanel(panel: HTMLElement, btn: HTMLButtonElement, key: string, open = panel.hidden) {
  panel.hidden = !open;
  btn.setAttribute('aria-pressed', String(open));
  store.set(key, open ? '1' : '0');
}

function initTheme() {
  const sel = $<HTMLSelectElement>('#theme');
  sel.value = themeChoice();
  sel.addEventListener('change', () => {
    setThemeChoice(sel.value as ThemeChoice);
    remoteLog('theme', { choice: sel.value });
  });
  onThemeChange(() => {
    viewer.setTheme();
    currentEditor()?.requestDraw();
  });
  viewer.setTheme();
}

function initLanguage() {
  const sel = $<HTMLSelectElement>('#lang');
  sel.replaceChildren(...Object.entries(LANGS).map(([k, name]) => new Option(name, k)));
  sel.value = getLang();
  sel.addEventListener('change', () => setLang(sel.value as Lang));
  onLangChange(() => {
    remoteLog('lang', { lang: getLang() });
    localizeDefaultNames(app.doc, type => allLangs(type === 'sketch' ? 'feat.sketch' : KINDS[type].label));
    saveDoc();
    fillSources();
    renderTree();
    refreshSketchTexts();
    if (currentPanel()) {
      const p = currentPanel()!;
      closePanel();
      openPanel(p.existing ?? p.f, !!p.existing);
    }
    syncCodePanel();
    requestRender();
  });
}

document.documentElement.lang = getLang();
applyI18n();
fillSources();
initLanguage();
initTheme();
initRenderUi();
initTree();
initPanel();
initExport();
initProjects();
initHistory();
initConvert();
initMeasure();
initImport();
projectHooks.renamed = fillSources;
initPwa();
initAbout();
initStart();
initScrollHints();
initParams();
initSketchMode();
syncCodePanel();
renderTree();
refreshChips();
setMode('part');

$('#source').addEventListener('change', e => {
  if (currentPanel()) closePanel();
  setSource((e.target as HTMLSelectElement).value);
  view.fitNext = true;
  cancelRender();
  requestRender();
});
$('#btnCode').addEventListener('click', () => togglePanel($('#codePanel'), $('#btnCode'), 'codeOpen'));
$('#btnTree').addEventListener('click', () => togglePanel($('#tree'), $('#btnTree'), 'treeOpen'));
// The benchmark button is a developer tool: not in the app (and runBench is then left out). Only on
// the dev server: that is where the measurement ends up (the public web and the app have no use for
// it).
if (__DEV_TOOLS__ && isDevHost) $('#btnBench').addEventListener('click', runBench);
else $('#btnBench').remove();
$('#btnParams').addEventListener('click', openParams);
$('#btnExtrude').addEventListener('click', () => startFeature('extrude'));
$('#btnRevolve').addEventListener('click', () => startFeature('revolve'));
$('#btnHole').addEventListener('click', () => startFeature('hole'));
$('#btnThread').addEventListener('click', () => startFeature('thread'));
$('#btnContainer').addEventListener('click', () => startFeature('container'));
$('#btnText').addEventListener('click', () => startFeature('text'));
$('#btnSnap').addEventListener('click', () => startFeature('snap'));
$('#btnFit').addEventListener('click', () => viewer.fit());
for (const b of $$<HTMLButtonElement>('[data-view]')) b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName));

// Test hook (headless tests in tools/browser).
Object.assign(window, {
  __scadshape: {
    get doc() { return app.doc; },
    viewer,
    get editor() { return currentEditor(); },
    get source() { return app.source; },
    get model() { return app.model; },
    get panel() { return currentPanel(); },
    storage: storageForTests,
  },
});

requestRender();

// Imported files: when the list is loaded the model is rebuilt (a missing file becomes an error in
// the tree).
initBlobs().then(
  () => {
    if (!app.doc.features.some(f => f.type === 'mesh')) return;
    app.model = buildModel(app.doc);
    renderTree();
    requestRender();
  },
  () => {},
);

// The Android app: back button, system bars, files from other apps (last – everything else is
// running).
initAndroid();
document.body.classList.remove('loading');
