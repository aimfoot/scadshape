// Featurepanelen: skapa/redigera en feature med förhandsvisning. Fälten byggs från
// featurens beskrivning (features/*: fields); val i 3D-vyn sköts av pickers.ts.

import { activeCount, dependents, insertFeature, newFeature, newSketch, removeFeature, usableSketches, type Doc, type SketchFeature, type SolidFeature } from '../doc';
import { KINDS, kindOf, type Field } from '../features';
import { containerTemplate } from '../features/container';
import { WORLD_SKETCH } from '../features/code';
import { REPEAT_FIELDS, repeatCircles, repeatDefaults } from '../features/pattern';
import { t } from '../i18n';
import { remoteLog } from '../remote';
import { planeLabel } from './tree';
import { buildModel } from '../model3d';
import { $, $$, el } from './dom';
import { pickerFor, type PickMode } from './pickers';
import { renderOpts, setSource, viewer } from './render';
import { app, emit, vars } from './state';
import { showToast } from './toast';
import { chipRow } from './params';
import { pickFaceThen, sketchForHit } from './sketchmode';
import { addFaceLoops, faceLoops, smoothFace } from '../faceoutline';
import { findCurveRef } from '../faceref';
import { sketchFrame } from '../frame';
import { outwardOf } from '../features/common';

interface PanelState {
  f: SolidFeature; // arbetskopia
  existing: SolidFeature | null;
  mode: PickMode;
  /** Featurens plats i trädet: skisser före den kan användas (t.ex. som mönsteraxel). */
  before: number;
  /** Mallskiss som skapades för featuren (tas bort om man avbryter). */
  template?: SketchFeature;
}

let panel: PanelState | null = null;
export const currentPanel = () => panel;

const panelEl = () => $('#featPanel');
const sketchSel = () => $<HTMLSelectElement>('#fpSketch');

function panelSketch(): SketchFeature | undefined {
  return app.doc.features.find((f): f is SketchFeature => f.type === 'sketch' && f.id === panel?.f.sketch);
}

// ---- Fält ---------------------------------------------------------------------------------------

/** Rendrade fält med funktioner för att synka dem mot featuren. */
let syncers: (() => void)[] = [];
let lastExpr: HTMLInputElement | null = null;

type AnyField = Field<SolidFeature>;
const get = (key: string) => (panel!.f as unknown as Record<string, unknown>)[key];
const set = (key: string, v: unknown) => ((panel!.f as unknown as Record<string, unknown>)[key] = v);

function changed(key: string, delay = 0) {
  if (!panel) return;
  if (key === 'rep') repeatDefaults(panel.f);
  if (key === 'repRotAxis' && panel.f.repRotAxis === 'circle' && !panel.f.repCircle)
    panel.f.repCircle = repeatCircles({ doc: app.doc, before: panel.before })[0]?.value;
  kindOf(panel.f).changed?.(panel.f, key, panelSketch());
  syncFields();
  updatePreview(delay);
}

function renderField(field: AnyField): HTMLElement {
  const show = (node: HTMLElement) => syncers.push(() => (node.hidden = field.show ? !field.show(panel!.f) : false));
  let node: HTMLElement;
  switch (field.kind) {
    case 'expr':
    case 'text': {
      const isText = field.kind === 'text';
      const input = el('input', { id: `fp-${field.key}`, autocapitalize: isText ? 'sentences' : 'off', autocomplete: 'off', spellcheck: isText });
      input.dataset.key = field.key;
      // Variabelchipsen skriver in i senaste uttrycksfältet, inte i fri text.
      input.addEventListener('focus', () => !isText && (lastExpr = input));
      input.addEventListener('input', () => {
        set(field.key, input.value);
        changed(field.key, 350);
      });
      syncers.push(() => {
        const v = String(get(field.key) ?? '');
        if (document.activeElement !== input && input.value !== v) input.value = v;
      });
      node = el('label', { className: 'fp-row' }, t(field.label), input, ...(field.kind === 'expr' && field.unit ? [field.unit] : []));
      break;
    }
    case 'choice': {
      const buttons = field.options.map(o => {
        const b = el('button', { type: 'button', textContent: t(o.label) });
        b.dataset.value = o.value;
        b.addEventListener('click', () => {
          set(field.key, o.value);
          changed(field.key);
        });
        return b;
      });
      node = el('div', { className: 'segmented', id: `fp-${field.key}` }, ...buttons);
      syncers.push(() => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === get(field.key)))));
      break;
    }
    case 'check': {
      const input = el('input', { type: 'checkbox', id: `fp-${field.key}` });
      input.addEventListener('change', () => {
        set(field.key, input.checked || undefined);
        changed(field.key);
      });
      syncers.push(() => (input.checked = !!get(field.key)));
      node = el('label', { className: 'fp-check' }, input, ` ${t(field.label)}`);
      break;
    }
    case 'select': {
      const select = el('select', { id: `fp-${field.key}` });
      select.addEventListener('change', () => {
        set(field.key, select.value);
        changed(field.key);
      });
      syncers.push(() => {
        const opts = field.options(panel!.f, { doc: app.doc, before: panel!.before });
        if (select.options.length !== opts.length || opts.some((o, i) => select.options[i].value !== o.value))
          select.replaceChildren(...opts.map(o => new Option(o.label, o.value)));
        select.value = String(get(field.key) ?? opts[0]?.value ?? ''); // saknat värde = första valet
      });
      node = el('label', { className: 'fp-row' }, t(field.label), select);
      break;
    }
    case 'code': {
      const area = el('textarea', { id: `fp-${field.key}`, className: 'fp-code', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', rows: 10 });
      area.addEventListener('input', () => {
        set(field.key, area.value);
        changed(field.key, 600);
      });
      syncers.push(() => {
        const v = String(get(field.key) ?? '');
        if (document.activeElement !== area && area.value !== v) area.value = v;
      });
      node = area;
      break;
    }
    case 'heading':
      node = el('div', { className: 'fp-sub', textContent: t(field.label) });
      break;
    case 'note': {
      const p = el('p', { className: 'fp-note' });
      const note = field;
      syncers.push(() => {
        const n = note.text(panel!.f, vars());
        p.textContent = n?.text ?? '';
        p.classList.toggle('warn', !!n?.warn);
      });
      node = p;
      break;
    }
    case 'pair':
      node = el('div', { className: 'fp-pair' }, renderField(field.fields[0]), renderField(field.fields[1]));
      break;
  }
  show(node);
  return node;
}

function syncFields() {
  if (!panel) return;
  for (const s of syncers) s();
  const f = panel.f;
  const sk = panelSketch();
  const picker = pickerFor(f);
  for (const b of $$<HTMLButtonElement>('#fpPick [data-pick]')) b.setAttribute('aria-pressed', String(b.dataset.pick === panel.mode));
  if (f.type === 'revolve') for (const b of $$<HTMLButtonElement>('#fp-axis [data-axis]')) b.setAttribute('aria-pressed', String(b.dataset.axis === f.axis.kind));
  const noSketch = kindOf(f).pick.kind === 'none';
  $('#fpRegions').textContent = noSketch ? '' : sk ? picker.info(f, sk, panel.mode) : t('err.sketchMissing');
  $('#fpDefault').hidden = noSketch || !picker.custom(f);
  sketchSel().closest('label')!.hidden = noSketch;
  $('#fpRegions').parentElement!.hidden = noSketch;
}

// ---- Öppna / förhandsvisa / stäng -------------------------------------------------------------------

export function openPanel(f: SolidFeature, existing: boolean) {
  if (document.body.dataset.mode !== 'part') return;
  const before = existing ? app.doc.features.indexOf(f) : activeCount(app.doc);
  panel = { f: JSON.parse(JSON.stringify(f)), existing: existing ? f : null, mode: 'regions', before };
  const kind = kindOf(f);
  refreshSketchOptions();
  $('#fpFace').hidden = f.type !== 'extrude' || existing;
  $('#fpTitle').textContent = existing ? f.name : t('panel.new', { name: f.name });
  $('#fpPick').hidden = !(kind.pick.kind === 'regions' && kind.pick.axis);

  syncers = [];
  lastExpr = null;
  const fields: HTMLElement[] = [];
  if (kind.pick.kind === 'regions' && kind.pick.axis) fields.push(axisButtons());
  fields.push(...kind.fields.map(fd => renderField(fd as AnyField)));
  fields.push(...REPEAT_FIELDS.map(fd => renderField(fd as AnyField)));
  fields.push(chipRow(() => lastExpr ?? $$<HTMLInputElement>('#fpFields input:not([type=checkbox])')[0] ?? null));
  $('#fpFields').replaceChildren(...fields);

  panelEl().hidden = false;
  // Liggande: panelen täcker högerkanten – centrera modellen i resten.
  viewer.setRightInset(innerWidth > innerHeight ? panelEl().offsetWidth + 16 : 0);
  if (app.source !== 'model') setSource('model');
  $('#tree').hidden = true;
  $('#btnTree').setAttribute('aria-pressed', 'false');
  renderOpts.hideSketch = panel.f.sketch;
  syncFields();
  updatePreview();
  viewer.fit(); // se till att skissen man arbetar med syns
}

/** Skisslistan i panelen (skisser före featuren). */
function refreshSketchOptions() {
  if (!panel) return;
  sketchSel().replaceChildren(...usableSketches(app.doc, panel.before).map(s => new Option(`${s.name} (${planeLabel(s)})`, s.id)));
  sketchSel().value = panel.f.sketch;
}

/** Revolve: snabbval av axel (X/Y) eller "Linje" som växlar till axelval i vyn. */
function axisButtons() {
  const mk = (axis: string, label: string) => {
    const b = el('button', { type: 'button', textContent: label });
    b.dataset.axis = axis;
    b.addEventListener('click', () => {
      if (panel?.f.type !== 'revolve') return;
      if (axis === 'line') panel.mode = 'axis';
      else panel.f.axis = { kind: axis as 'x' | 'y' };
      changed('axis');
    });
    return b;
  };
  return el('div', { className: 'segmented', id: 'fp-axis' }, mk('x', t('axis.x')), mk('y', t('axis.y')), mk('line', t('axis.line')));
}

function updateOverlay() {
  const sk = panelSketch();
  if (!panel || !sk) return viewer.setOverlay(null);
  viewer.setOverlay(pickerFor(panel.f).overlay(panel.f, sk, panel.mode));
}

let previewTimer = 0;
function updatePreview(delay = 0) {
  if (!panel) return;
  updateOverlay();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (!panel) return;
    const d: Doc = JSON.parse(JSON.stringify(app.doc));
    let at: number;
    if (panel.existing) {
      at = app.doc.features.indexOf(panel.existing);
      d.features[at] = JSON.parse(JSON.stringify(panel.f));
    } else {
      at = activeCount(app.doc);
      d.features.splice(at, 0, JSON.parse(JSON.stringify(panel.f)));
    }
    d.rollback = at + 1 >= d.features.length ? null : at + 1; // visa modellen fram till featuren
    app.previewDoc = d;
    emit('render');
  }, delay);
}

/** Efter varje rendering: visa featurens fel i panelen. */
renderOpts.onRendered.push(() => {
  if (!panel) return;
  const err = app.model.errors.get(panel.f.id);
  $('#fpError').textContent = err ? `⚠ ${err}` : '';
  $('#fpError').hidden = !err;
});

export function closePanel() {
  panel = null;
  app.previewDoc = null;
  clearTimeout(previewTimer);
  panelEl().hidden = true;
  renderOpts.hideSketch = null;
  viewer.setOverlay(null);
  viewer.setRightInset(0);
}

/** Standardskiss för en ny feature: senaste användbara skissen, helst en som inte redan används. */
function defaultSketch(type: SolidFeature['type']): SketchFeature | null {
  const cands = usableSketches(app.doc).filter(s => KINDS[type].usable(s));
  return [...cands].reverse().find(s => !dependents(app.doc, s.id).length) ?? cands[cands.length - 1] ?? null;
}

/**
 * Extrudera en yta: tryck på en plan yta → ny skiss på den med ytans kontur (låst), som används av
 * featuren. Utan öppen panel startar en ny extrudering; annars byter den öppna (nya) featuren skiss.
 */
export function extrudeFace() {
  pickFaceThen(hit => {
    // Rund yta: förtjocka/skär längs ytan (egen feature) i stället för en skiss.
    const tris = smoothFace(viewer.meshPositions!, hit.point, hit.normal);
    if (tris) {
      if (panel && !panel.existing) {
        const tpl = panel.template;
        closePanel();
        if (tpl && !dependents(app.doc, tpl.id).length) removeFeature(app.doc, tpl);
      }
      const f = newFeature(app.doc, 'surface', WORLD_SKETCH);
      f.tris = tris;
      // Sidan på en extruderad cirkel/båge: följ den (annars en fast kopia av ytan).
      f.ref = findCurveRef(app.doc, vars(), hit.normal, hit.point) ?? undefined;
      remoteLog('extrude-face', { curved: true, triangles: tris.length / 9, ref: f.ref });
      emit('docChanged');
      openPanel(f, false);
      return;
    }
    const sk = sketchForHit(hit);
    const loops = faceLoops(viewer.meshPositions!, sketchFrame(sk, vars(), app.doc), hit.point);
    if (!loops.length) return showToast(t('face.noOutline'), 'info');
    addFaceLoops(sk, loops);
    sk.name = t('face.sketchName', { name: sk.name });
    remoteLog('extrude-face', { plane: sk.plane, face: !!sk.face, loops: loops.map(l => (l.kind === 'circle' ? 'c' : l.pts.length)) });
    const old = panel?.template;
    insertFeature(app.doc, sk);
    if (panel && !panel.existing) {
      panel.before++;
      if (old && !dependents(app.doc, old.id).length) {
        removeFeature(app.doc, old);
        panel.before--;
      }
      panel.template = sk;
      panel.f.sketch = sk.id;
      renderOpts.hideSketch = sk.id;
      (panel.f as { regions?: unknown }).regions = null;
      if (panel.f.type === 'extrude') panel.f.direction = panel.f.op === 'remove' ? (outwardOf(sk) === 'normal' ? 'reverse' : 'normal') : outwardOf(sk);
      emit('docChanged');
      refreshSketchOptions();
      syncFields();
      updatePreview();
      return;
    }
    emit('docChanged');
    openPanel(newFeature(app.doc, 'extrude', sk), false);
    panel!.template = sk;
  });
}

/** Ny feature av typen (från verktygsfältet). */
export function startFeature(type: SolidFeature['type']) {
  if (KINDS[type].pick.kind === 'none') return openPanel(newFeature(app.doc, type, WORLD_SKETCH), false);
  const sk = defaultSketch(type);
  // Extrudera utan sluten skiss men med en modell: välj en yta att extrudera.
  if (!sk && type === 'extrude' && app.source === 'model' && viewer.meshPositions) {
    showToast(t('face.pickHint'), 'info');
    return extrudeFace();
  }
  if (!sk && (type === 'container' || type === 'text' || type === 'snap')) {
    // Ingen skiss än: behållaren börjar med en rektangel med mått, text/snäpphake i origo på toppvyns plan.
    const tpl = newSketch(app.doc, 'XY');
    if (type === 'container') containerTemplate(tpl);
    insertFeature(app.doc, tpl);
    emit('docChanged');
    openPanel(newFeature(app.doc, type, tpl), false);
    panel!.template = tpl;
    if (type === 'container') showToast(t('toast.containerTemplate', { name: tpl.name }));
    return;
  }
  if (!sk) return showToast(t(type === 'hole' ? 'toast.needPoints' : type === 'thread' ? 'toast.needCircles' : 'toast.needClosed'), 'error');
  openPanel(newFeature(app.doc, type, sk), false);
}

export function initPanel() {
  $('#fpFace').addEventListener('click', extrudeFace);
  $('#fpCancel').addEventListener('click', () => {
    const tpl = panel?.template;
    closePanel();
    if (tpl) {
      removeFeature(app.doc, tpl);
      emit('docChanged');
    } else emit('render');
  });
  $('#fpOk').addEventListener('click', () => {
    if (!panel) return;
    const f = panel.f;
    if (panel.existing) Object.assign(panel.existing, f);
    else insertFeature(app.doc, f);
    remoteLog('feature-ok', { type: f.type, existing: !!panel.existing, error: buildModel(app.doc).errors.get(f.id) });
    closePanel();
    emit('docChanged');
  });
  sketchSel().addEventListener('change', () => {
    if (!panel) return;
    panel.f.sketch = sketchSel().value;
    pickerFor(panel.f).reset(panel.f);
    if (panel.f.type === 'revolve') panel.f.axis = { kind: 'y' };
    renderOpts.hideSketch = panel.f.sketch;
    changed('sketch');
  });
  $('#fpDefault').addEventListener('click', () => {
    if (!panel) return;
    pickerFor(panel.f).reset(panel.f);
    changed('regions');
  });
  for (const b of $$<HTMLButtonElement>('#fpPick [data-pick]'))
    b.addEventListener('click', () => {
      if (!panel) return;
      panel.mode = b.dataset.pick as PickMode;
      syncFields();
      updatePreview();
    });
  // Tryck i 3D-vyn: välj regioner, axel, punkter eller cirklar.
  viewer.onTap = p => {
    const sk = panelSketch();
    if (!panel || !sk) return;
    const key = pickerFor(panel.f).tap(panel.f, sk, p, viewer, panel.mode);
    if (!key) return;
    if (key === 'axis') panel.mode = 'regions';
    changed(key);
  };
}
