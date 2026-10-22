// scadshape – CAD i telefonen: skisser med villkor → features (extrudera, revolve, hål, gängor …)
// → OpenSCAD (WASM, Manifold) → 3D. Här kopplas UI-modulerna ihop.

import { localizeDefaultNames, type Feature } from './doc';
import { KINDS } from './features';
import { allLangs, applyI18n, getLang, LANGS, onLangChange, setLang, t, type Lang } from './i18n';
import { installErrorReporting, remoteLog } from './remote';
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

applyTheme(); // först, så att inget hinner ritas i fel tema
installErrorReporting();
remoteLog('start', { ua: navigator.userAgent, screen: `${screen.width}×${screen.height} @${devicePixelRatio}`, lang: getLang() });
// Modellerna (IndexedDB) läses in efter temat, så att inget hinner ritas i fel tema under tiden.
await openStorage();
initState();
saveDoc(); // spara ev. migrerat dokument
storageHooks.error = () => showToast(t('storage.saveFailed'), 'error');

// ---- Dokumentet ändrat: spara, rita om trädet, rendera ------------------------------------------

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

// ---- Villkorslösaren (planegcs) laddas i bakgrunden ---------------------------------------------

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

// ---- Källa, paneler och knappar -------------------------------------------------------------

function fillSources() {
  const sel = $<HTMLSelectElement>('#source');
  sel.replaceChildren(new Option(currentProjectName(), 'model'), ...EXAMPLES.map(e => new Option(t(e.name), e.id)), new Option(t('source.custom'), 'egen'));
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
// Mätknappen är ett utvecklarverktyg: finns inte i appen (och runBench följer då inte med).
if (__DEV_TOOLS__) $('#btnBench').addEventListener('click', runBench);
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

// Testkrok (headless-tester i tools/browser).
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

// Importerade filer: när listan är inläst byggs modellen om (en saknad fil blir ett fel i trädet).
initBlobs().then(
  () => {
    if (!app.doc.features.some(f => f.type === 'mesh')) return;
    app.model = buildModel(app.doc);
    renderTree();
    requestRender();
  },
  () => {},
);

// Android-appen: bakåtknappen, systemraderna, filer från andra appar (sist – allt annat är igång).
initAndroid();
document.body.classList.remove('loading');
