// Rendering: OpenSCAD-motorn, 3D-vyn, statusraden, kodpanelen och källan (modell/exempel/egen kod).
// Bara den senaste begäran renderas; äldre resultat visas aldrig.

import { buildModel, looseSketches } from '../model3d';
import { sketchFrame } from '../frame';
import { remoteLog } from '../remote';
import { ScadEngine, RenderCancelled, logProblems, type RenderResult } from '../scad';
import { sketchPolylines } from '../sketch3d';
import { parseBinaryStl } from '../stl';
import { Viewer } from '../viewer';
import { t, type Key } from '../i18n';
import { $, fmtInt, fmtMs, store } from './dom';
import { app, on, vars } from './state';
import kub from '../examples/kub.scad';
import plattan from '../examples/plattan.scad';
import kopp from '../examples/kopp.scad';
import tung from '../examples/tung.scad';

export const EXAMPLES: { id: string; name: Key; src: string }[] = [
  { id: 'plattan', name: 'example.plate', src: plattan },
  { id: 'kopp', name: 'example.cup', src: kopp },
  { id: 'tung', name: 'example.heavy', src: tung },
  { id: 'kub', name: 'example.cube', src: kub },
];

export const viewer = new Viewer($('#viewport'));
export const engine = new ScadEngine();

const code = $<HTMLTextAreaElement>('#code');
const logEl = $('#log');
const statusEl = $('#status');
const btnRender = $<HTMLButtonElement>('#btnRender');
const codePanel = $('#codePanel');

/** Skissen som inte ska ritas som linjer (den som featurepanelen visar regioner för). */
export const renderOpts = { hideSketch: null as string | null, onRendered: [] as (() => void)[] };

export function setStatus(text: string, kind: '' | 'busy' | 'error' = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

export function currentCode(): string {
  if (app.source === 'model') return (app.model = buildModel(app.previewDoc ?? app.doc)).code;
  if (app.source === 'egen') return store.get('code') ?? '';
  return EXAMPLES.find(e => e.id === app.source)?.src ?? '';
}

export function syncCodePanel() {
  code.value = currentCode();
  code.readOnly = app.source === 'model';
  code.classList.toggle('readonly', code.readOnly);
}

export function setSource(s: string) {
  if (s !== app.source) view.fitNext = true; // ny källa = ny modell
  app.source = s;
  store.set('source', s);
  $('#codeBar').hidden = s === 'model'; // "Gör om till skisser" bara för kod
  ($<HTMLSelectElement>('#source')).value = s;
  syncCodePanel();
}

function showLog(log: string[]) {
  const problems = new Set(logProblems(log));
  logEl.replaceChildren(
    ...log
      .filter(l => !/^Could not initialize localization/.test(l))
      .map(l => {
        const div = document.createElement('div');
        div.textContent = l;
        if (problems.has(l)) div.className = /^WARNING/.test(l) ? 'warn' : 'err';
        return div;
      }),
  );
}

let renderWanted = false;
let rendering = false;
/** Anpassa vyn efter nästa rendering. */
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
  $('#fpBusy').hidden = false;
  try {
    while (renderWanted) {
      renderWanted = false;
      await renderOnce();
    }
  } finally {
    rendering = false;
    btnRender.textContent = t('ui.render');
    $('#fpBusy').hidden = true;
  }
}

async function renderOnce() {
  const d = app.previewDoc ?? app.doc;
  viewer.setSketchLines(app.source === 'model' ? looseSketches(d).filter(s => s.id !== renderOpts.hideSketch).flatMap(s => sketchPolylines(s, sketchFrame(s, vars(), d))) : []);
  const src = app.source === 'egen' ? code.value : currentCode();
  if (app.source !== 'egen') code.value = src;
  else store.set('code', code.value);
  for (const cb of renderOpts.onRendered) cb();
  const errs = app.source === 'model' ? app.model.errors.size : 0;
  const errText = errs ? ` · ${t('status.treeErrors', { n: errs })}` : '';
  if (app.source === 'model' && app.model.solids === 0) {
    viewer.setMesh(null);
    logEl.replaceChildren();
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
  if (renderWanted) return; // något nyare väntar – visa inte gammal geometri
  showLog(r.log);
  if (!r.ok || !r.data) {
    setStatus(r.log.some(l => /Current top level object is empty/.test(l)) ? t('status.empty') + errText : t('status.seeLog'), 'error');
    if (codePanel.hidden && app.source !== 'model') codePanel.hidden = false;
    if (app.source === 'model') remoteLog('model-error', { problems: logProblems(r.log).slice(0, 5) });
    return;
  }
  const mesh = parseBinaryStl(r.data);
  const before = { center: viewer.bounds.center.clone(), radius: viewer.bounds.radius };
  viewer.setMesh(mesh);
  // Exempel/egen kod: en helt annan modell (storlek × 2 eller flyttad mer än sin storlek) → anpassa vyn.
  // I den egna modellen står kameran kvar när man ändrar ett mått.
  const after = viewer.bounds;
  const moved = after.center.distanceTo(before.center) > Math.max(after.radius, before.radius);
  const resized = after.radius > 2 * before.radius || after.radius < before.radius / 2;
  if (!view.fitNext && app.source !== 'model' && (moved || resized)) viewer.fit();
  if (view.fitNext) viewer.setView('iso');
  view.fitNext = false;
  setStatus(`${fmtMs(r.renderMs)} · ${t('status.triangles', { n: fmtInt(mesh.triangles) })}${errText}`, errs ? 'error' : '');
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
  btnRender.addEventListener('click', () => (rendering ? cancelRender() : requestRender()));
  code.addEventListener('input', () => {
    if (app.source === 'model') return;
    store.set('code', code.value); // först – setSource läser tillbaka den sparade koden
    if (app.source !== 'egen') setSource('egen');
  });
  code.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      requestRender();
    }
  });
}
