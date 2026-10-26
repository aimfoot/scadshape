// Rendering: the OpenSCAD engine, the 3D view, the status bar and the code panel, and the way of
// working on the model (Draw or Code, body[data-work]). Only the latest request is rendered; older
// results are never shown.

import { codeDoc, codeOnly } from '../doc';
import { buildModel, looseSketches } from '../model3d';
import { sketchFrame } from '../frame';
import { remoteLog } from '../remote';
import { ScadEngine, RenderCancelled, logProblems, type RenderResult } from '../scad';
import { sketchPolylines } from '../sketch3d';
import { cutTests, missedCuts } from '../cuts';
import { cutProblems, meshProblems, type Problem } from '../diagnose';
import { parseBinaryStl } from '../stl';
import { Viewer } from '../viewer';
import { bedOf, fitsBed, meshSize, parseBedChoice } from '../bed';
import { t, type Key } from '../i18n';
import { $, $$, el, fmtInt, fmtMs, store } from './dom';
import { showModelNote } from './modelnote';
import { clearProblems, showProblems } from './problems';
import { app, emit, on, vars } from './state';
import { showToast } from './toast';
import cube from '../examples/cube.scad';
import plate from '../examples/plate.scad';
import cup from '../examples/cup.scad';
import heavy from '../examples/heavy.scad';

export const EXAMPLES: { id: string; name: Key; src: string }[] = [
  { id: 'plate', name: 'example.plate', src: plate },
  { id: 'cup', name: 'example.cup', src: cup },
  { id: 'heavy', name: 'example.heavy', src: heavy },
  { id: 'cube', name: 'example.cube', src: cube },
];

export const viewer = new Viewer($('#viewport'));
export const engine = new ScadEngine();

const code = $<HTMLTextAreaElement>('#code');
const logEl = $('#log');
const statusEl = $('#status');
const btnRender = $<HTMLButtonElement>('#btnRender');
const codePanel = $('#codePanel');

/** The sketch that should not be drawn as lines (the one the feature panel shows regions for). */
export const renderOpts = { hideSketch: null as string | null, onRendered: [] as (() => void)[] };

/** A finished render, kept so a new build volume can redo the problem list and the fit warning. */
type Done = { head: string; errs: number; log: string[]; src: string; positions: Float32Array; extra?: Problem[] };
let doneStatus: (Done & { shown: string }) | null = null;

export function setStatus(text: string, kind: '' | 'busy' | 'error' | 'warn' = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  if (text !== doneStatus?.shown) doneStatus = null;
}

/** The printer's build volume chosen in Settings. */
export const currentBed = () => bedOf(parseBedChoice(store.get('bed')));

/** The problem list (with the model's own: too big for the printer, mid-air …) and the status bar for a render with a model. */
function showDone(d: Done) {
  const bed = currentBed();
  const problems = showProblems(d.log, d.src, [...meshProblems(d.positions, bed), ...(d.extra ?? [])]);
  const probText = problems ? ` · ${problems === 1 ? t('status.problem1') : t('status.problems', { n: problems })}` : '';
  const fits = fitsBed(meshSize(d.positions), bed);
  const mm = (v: number) => String(Math.round(v * 10) / 10);
  const text = `${d.head}${probText}${fits ? '' : ` · ${t('bed.tooBig', { w: mm(bed.w), d: mm(bed.d), h: mm(bed.h) })}`}`;
  setStatus(text, d.errs ? 'error' : problems ? 'warn' : '');
  doneStatus = { ...d, shown: text };
}

// Cuts that remove nothing (cuts.ts): two more renders (the CSG export, then the test file), so they
// run once the model has stood still a moment, and not after a slow render; their rows are added
// to the list when they come.
const CUT_DELAY = 1500, CUT_MAX_RENDER_MS = 3000;
let cutTimer = 0, cutGen = 0;

async function checkCuts(src: string) {
  const gen = cutGen;
  const fresh = () => gen === cutGen && !rendering && doneStatus?.src === src;
  try {
    const csg = await engine.render(src, 'csg');
    if (!fresh() || !csg.ok || !csg.data) return;
    const tests = cutTests(new TextDecoder().decode(csg.data));
    if (!tests) return;
    const r = await engine.render(tests.scad);
    if (!fresh() || !r.ok || !r.data) return;
    const missed = missedCuts(parseBinaryStl(r.data).positions, tests.tests);
    if (missed.length && doneStatus) {
      showDone({ ...doneStatus, extra: cutProblems(missed, src) });
      remoteLog('missed-cuts', { n: missed.length });
    }
  } catch {
    /* cancelled: a newer render wins */
  }
}

/** A new build volume: redraw the plate, the problem list and the fit warning. */
export function applyBed() {
  viewer.setBed(currentBed());
  if (doneStatus) showDone(doneStatus);
}

/** The two ways of working on the one model: Draw (sketches and features) and Code (the model as
 * OpenSCAD code, edited in place). */
export type Work = 'draw' | 'code';
export const work = (): Work => (document.body.dataset.work === 'code' ? 'code' : 'draw');

/** The model's code: a model that is just code as it is (its lines match the problem list), any
 * other generated from its features. */
export function currentCode(): string {
  const d = app.previewDoc ?? app.doc;
  app.model = buildModel(d);
  return codeOnly(d)?.code ?? app.model.code;
}

/** The model's code as the editor last got it: anything else in the editor is an edit not yet in the
 * model (Render is highlighted meanwhile). */
let shownCode = '';
const syncRunButton = () => $('#btnRunCode').classList.toggle('stale', code.value !== shownCode);

/** Show the model's code in the editor – unless it has edits that are not in the model yet. */
export function syncCodePanel(force = false) {
  if (!force && code.value !== shownCode) return;
  code.value = shownCode = currentCode();
  syncRunButton();
}

/** Code's edits go into the model: a model that is just code gets the new code; a drawn model
 * becomes code (Draw's undo brings the sketches back, Convert to sketches turns the code into
 * sketches). Called by Render, Ctrl+Enter, going back to Draw and the app going to the background.
 * Returns whether the model changed. */
export function commitCode(): boolean {
  if (code.value === shownCode) return false;
  const c = codeOnly(app.doc);
  if (c) c.code = code.value;
  else {
    const kept = app.doc.features.length > 0;
    app.doc = codeDoc(code.value);
    if (kept) showToast(t('code.becameCode'));
  }
  shownCode = code.value;
  syncRunButton();
  emit('docChanged');
  return true;
}

export function setWork(w: Work) {
  if (w === 'draw') commitCode();
  document.body.dataset.work = w;
  store.set('work', w);
  for (const b of $$<HTMLButtonElement>('#workMode [data-work]')) b.setAttribute('aria-pressed', String(b.dataset.work === w));
  codePanel.hidden = w !== 'code';
  syncCodePanel();
}

function showLog(log: string[]) {
  const problems = new Set(logProblems(log));
  // A warning repeated by a loop (thousands of times, interleaved with others) once, where it first
  // appears, with a count.
  const runs: { line: string; n: number }[] = [];
  const first = new Map<string, { line: string; n: number }>();
  for (const l of log) {
    if (/^Could not initialize localization/.test(l)) continue;
    const seen = problems.has(l) ? first.get(l) : undefined;
    if (seen) seen.n++;
    else {
      const r = { line: l, n: 1 };
      runs.push(r);
      if (problems.has(l)) first.set(l, r);
    }
  }
  logEl.replaceChildren(
    ...runs.map(({ line, n }) => {
      const div = document.createElement('div');
      div.textContent = line;
      if (n > 1) div.append(el('span', { className: 'times', textContent: ` ${t('dx.times', { n })}` }));
      if (problems.has(line)) div.className = /^WARNING/.test(line) ? 'warn' : 'err';
      return div;
    }),
  );
}

let renderWanted = false;
let rendering = false;
/** Fit the view after the next rendering. */
export const view = { fitNext: true };
export const isRendering = () => rendering;

export function requestRender() {
  renderWanted = true;
  clearTimeout(cutTimer);
  cutGen++;
  if (!rendering) void renderLoop();
}

export function cancelRender() {
  renderWanted = false;
  if (engine.busy) engine.cancel();
}

async function renderLoop() {
  rendering = true;
  btnRender.textContent = t('ui.cancel');
  // Everything renders by itself: the button is only Cancel, shown once a render takes a while.
  const showCancel = window.setTimeout(() => (btnRender.hidden = false), 400);
  $('#fpBusy').hidden = false;
  try {
    while (renderWanted) {
      renderWanted = false;
      await renderOnce();
    }
  } finally {
    rendering = false;
    clearTimeout(showCancel);
    btnRender.hidden = true;
    btnRender.textContent = t('ui.render');
    $('#fpBusy').hidden = true;
  }
}

async function renderOnce() {
  const d = app.previewDoc ?? app.doc;
  viewer.setSketchLines(looseSketches(d).filter(s => s.id !== renderOpts.hideSketch).flatMap(s => sketchPolylines(s, sketchFrame(s, vars(), d))));
  const src = currentCode();
  if (code.value === shownCode) code.value = src; // edits not yet in the model stay in the editor
  shownCode = src;
  syncRunButton();
  // The comment at the top of a model that is code (e.g. from an AI chat) says what it is.
  showModelNote(codeOnly(d) ? src : null);
  for (const cb of renderOpts.onRendered) cb();
  const errs = app.model.errors.size;
  const errText = errs ? ` · ${t('status.treeErrors', { n: errs })}` : '';
  if (app.model.solids === 0) {
    viewer.setMesh(null);
    logEl.replaceChildren();
    clearProblems();
    if (view.fitNext) viewer.setView('iso');
    view.fitNext = app.doc.features.length === 0;
    setStatus(app.doc.features.length ? t('status.noSolid') + errText : t('status.start'), errs ? 'error' : '');
    return;
  }
  setStatus(engine.loadMs === null ? t('status.loadingEngine') : t('status.rendering'), 'busy');
  let r: RenderResult;
  try {
    r = await engine.render(src);
  } catch (e) {
    if (e instanceof RenderCancelled) setStatus(t('status.cancelled'));
    else {
      remoteLog('render-error', { err: String(e) });
      setStatus(`${t('status.error')}: ${e}`, 'error');
    }
    return;
  }
  if (renderWanted) return; // something newer is waiting – do not show old geometry
  showLog(r.log);
  const mesh = r.ok && r.data ? parseBinaryStl(r.data) : null;
  if (!mesh) {
    const problems = showProblems(r.log, src);
    const probText = problems ? ` · ${problems === 1 ? t('status.problem1') : t('status.problems', { n: problems })}` : '';
    // Empty with no warning that explains it (e.g. if (false) …): just "nothing to show".
    const empty = r.log.some(l => /Current top level object is empty/.test(l)) && !logProblems(r.log).length;
    setStatus(empty ? t('status.empty') + errText : problems ? t('status.error') + probText : t('status.seeLog'), 'error');
    remoteLog('model-error', { problems: logProblems(r.log).slice(0, 5) });
    return;
  }
  const before = { center: viewer.bounds.center.clone(), radius: viewer.bounds.radius };
  viewer.setMesh(mesh);
  // Code: an entirely different model (size × 2 or moved more than its size) → fit the view. In a
  // drawn model the camera stays put when a dimension changes.
  const after = viewer.bounds;
  const moved = after.center.distanceTo(before.center) > Math.max(after.radius, before.radius);
  const resized = after.radius > 2 * before.radius || after.radius < before.radius / 2;
  if (!view.fitNext && codeOnly(d) && (moved || resized)) viewer.fit();
  if (view.fitNext) viewer.setView('iso');
  view.fitNext = false;
  // Rendered, but with problems (an unknown function leaves parts out without failing): say so.
  showDone({ head: `${fmtMs(r.renderMs)} · ${t('status.triangles', { n: fmtInt(mesh.triangles) })}${errText}`, errs, log: r.log, src, positions: mesh.positions });
  // A drawn model is built from features, not written code: its cuts are not checked.
  if (codeOnly(d) && /\bdifference\s*\(/.test(src) && r.renderMs < CUT_MAX_RENDER_MS) {
    clearTimeout(cutTimer);
    cutTimer = window.setTimeout(() => void checkCuts(src), CUT_DELAY);
  }
}

engine.onLoaded = ms => {
  remoteLog('engine-loaded', { ms });
  if (!engine.busy && statusEl.classList.contains('busy')) setStatus(t('status.engineReady', { time: fmtMs(ms) }));
};
engine.onFatal = err => {
  remoteLog('engine-fatal', { err });
  setStatus(`${t('status.engineError')}: ${err}`, 'error');
};

on('render', requestRender);

export function initRenderUi() {
  applyBed();
  btnRender.addEventListener('click', () => (rendering ? cancelRender() : requestRender()));
  // Code renders when you ask (Render or Ctrl+Enter), so you can write freely.
  code.addEventListener('input', syncRunButton);
  const run = $('#btnRunCode');
  run.addEventListener('pointerdown', e => e.preventDefault()); // keep the keyboard and the caret
  run.addEventListener('click', () => commitCode() || requestRender());
  code.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitCode() || requestRender();
    }
  });
}
