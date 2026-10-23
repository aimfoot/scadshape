// Rendering: the OpenSCAD engine, the 3D view, the status bar, the code panel and the source
// (model/example/custom code). Only the latest request is rendered; older results are never shown.

import { buildModel, looseSketches } from '../model3d';
import { sketchFrame } from '../frame';
import { remoteLog } from '../remote';
import { ScadEngine, RenderCancelled, logProblems, type RenderResult } from '../scad';
import { sketchPolylines } from '../sketch3d';
import { parseBinaryStl } from '../stl';
import { Viewer } from '../viewer';
import { bedOf, fitsBed, parseBedChoice } from '../bed';
import { t, type Key } from '../i18n';
import { $, el, fmtInt, fmtMs, store } from './dom';
import { clearProblems, showProblems } from './problems';
import { app, on, vars } from './state';
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

/** The status after a finished render, kept so a new build volume can redo the fit warning. */
let doneStatus: { base: string; errs: number; warn: boolean; size: [number, number, number]; shown: string } | null = null;

export function setStatus(text: string, kind: '' | 'busy' | 'error' | 'warn' = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  if (text !== doneStatus?.shown) doneStatus = null;
}

/** The printer's build volume chosen in Settings. */
export const currentBed = () => bedOf(parseBedChoice(store.get('bed')));

function showDoneStatus(d: { base: string; errs: number; warn: boolean; size: [number, number, number] }) {
  const bed = currentBed();
  const fits = fitsBed(d.size, bed);
  const mm = (v: number) => String(Math.round(v * 10) / 10);
  const text = fits ? d.base : `${d.base} · ${t('bed.tooBig', { w: mm(bed.w), d: mm(bed.d), h: mm(bed.h) })}`;
  setStatus(text, d.errs ? 'error' : fits && !d.warn ? '' : 'warn');
  doneStatus = { ...d, shown: text };
}

/** A new build volume: redraw the plate and the fit warning. */
export function applyBed() {
  viewer.setBed(currentBed());
  if (doneStatus) showDoneStatus(doneStatus);
}

/** The model's size (x, y, z) from its triangles. */
function meshSize(pos: Float32Array): [number, number, number] {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    if (pos[i] < mn[k]) mn[k] = pos[i];
    if (pos[i] > mx[k]) mx[k] = pos[i];
  }
  return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
}

export function currentCode(): string {
  if (app.source === 'model') return (app.model = buildModel(app.previewDoc ?? app.doc)).code;
  if (app.source === 'custom') return store.get('code') ?? '';
  return EXAMPLES.find(e => e.id === app.source)?.src ?? '';
}

export function syncCodePanel() {
  code.value = currentCode();
  code.readOnly = app.source === 'model';
  code.classList.toggle('readonly', code.readOnly);
}

export function setSource(s: string) {
  if (s !== app.source) view.fitNext = true; // new source = new model
  app.source = s;
  store.set('source', s);
  $('#codeBar').hidden = s === 'model'; // "Convert to sketches" only for code
  ($<HTMLSelectElement>('#source')).value = s;
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
  viewer.setSketchLines(app.source === 'model' ? looseSketches(d).filter(s => s.id !== renderOpts.hideSketch).flatMap(s => sketchPolylines(s, sketchFrame(s, vars(), d))) : []);
  const src = app.source === 'custom' ? code.value : currentCode();
  if (app.source !== 'custom') code.value = src;
  else store.set('code', code.value);
  for (const cb of renderOpts.onRendered) cb();
  const errs = app.source === 'model' ? app.model.errors.size : 0;
  const errText = errs ? ` · ${t('status.treeErrors', { n: errs })}` : '';
  if (app.source === 'model' && app.model.solids === 0) {
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
  const problems = showProblems(r.log, src);
  const probText = problems ? ` · ${problems === 1 ? t('status.problem1') : t('status.problems', { n: problems })}` : '';
  if (!r.ok || !r.data) {
    // Empty with no warning that explains it (e.g. if (false) …): just "nothing to show".
    const empty = r.log.some(l => /Current top level object is empty/.test(l)) && !logProblems(r.log).length;
    setStatus(empty ? t('status.empty') + errText : problems ? t('status.error') + probText : t('status.seeLog'), 'error');
    if (codePanel.hidden && app.source !== 'model') codePanel.hidden = false;
    if (app.source === 'model') remoteLog('model-error', { problems: logProblems(r.log).slice(0, 5) });
    return;
  }
  const mesh = parseBinaryStl(r.data);
  const before = { center: viewer.bounds.center.clone(), radius: viewer.bounds.radius };
  viewer.setMesh(mesh);
  // Example/custom code: an entirely different model (size × 2 or moved more than its size) → fit
  // the view. In the user's own model the camera stays put when a dimension changes.
  const after = viewer.bounds;
  const moved = after.center.distanceTo(before.center) > Math.max(after.radius, before.radius);
  const resized = after.radius > 2 * before.radius || after.radius < before.radius / 2;
  if (!view.fitNext && app.source !== 'model' && (moved || resized)) viewer.fit();
  if (view.fitNext) viewer.setView('iso');
  view.fitNext = false;
  // Rendered, but with problems (an unknown function leaves parts out without failing): say so.
  showDoneStatus({ base: `${fmtMs(r.renderMs)} · ${t('status.triangles', { n: fmtInt(mesh.triangles) })}${errText}${probText}`, errs, warn: problems > 0, size: meshSize(mesh.positions) });
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

let codeTimer = 0;

export function initRenderUi() {
  applyBed();
  btnRender.addEventListener('click', () => (rendering ? cancelRender() : requestRender()));
  code.addEventListener('input', () => {
    if (app.source === 'model') return;
    store.set('code', code.value); // first – setSource reads back the saved code
    if (app.source !== 'custom') setSource('custom');
    // Custom code renders by itself when the typing pauses.
    clearTimeout(codeTimer);
    codeTimer = window.setTimeout(requestRender, 800);
  });
  code.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      requestRender();
    }
  });
}
