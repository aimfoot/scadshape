// The feature panel: create/edit a feature with a preview. The fields are built from the feature's
// description (features/*: fields); picking in the 3D view is handled by pickers.ts.

import { activeCount, dependents, insertFeature, newFeature, newSketch, removeFeature, usableSketches, type Doc, type SketchFeature, type SolidFeature } from '../doc';
import { KINDS, kindOf, type Field } from '../features';
import { containerTemplate } from '../features/container';
import { applyContainer } from '../containerparts';
import { WORLD_SKETCH } from '../features/code';
import { REPEAT_FIELDS, repeatCircles, repeatDefaults } from '../features/pattern';
import { t } from '../i18n';
import { remoteLog } from '../remote';
import { planeLabel } from './tree';
import { buildModel } from '../model3d';
import { $, $$, el } from './dom';
import { pickerFor, type PickMode } from './pickers';
import { renderOpts, setWork, viewer, work } from './render';
import { app, emit, vars } from './state';
import { showToast } from './toast';
import { chipRow } from './params';
import { pickFaceThen, sketchForHit, sketchOnFace } from './sketchmode';
import { clearFace, initFaceSelect, longPressFace, takeFace, tapFace, type FaceHit } from './faceselect';
import { addFaceLoops, faceLoops, smoothFace } from '../faceoutline';
import { findCurveRef } from '../faceref';
import { dot, sketchFrame, sub, toPlane } from '../frame';
import { parseExpr } from '../expr';
import { newId } from '../sketch/model';
import type { Vec } from '../sketch/geom';
import { textSurface, type TextFeature, type TextSurface } from '../features/text';
import { inwardOf, outwardOf } from '../features/common';

interface PanelState {
  f: SolidFeature; // working copy
  existing: SolidFeature | null;
  mode: PickMode;
  /** The feature's place in the tree: sketches before it can be used (e.g. as a pattern axis). */
  before: number;
  /** Template sketch created for the feature (removed if you cancel). */
  template?: SketchFeature;
  /** The sketch as it was before the text was moved (an existing feature: restored on Cancel). */
  sketchBackup?: string;
}

let panel: PanelState | null = null;
export const currentPanel = () => panel;

const panelEl = () => $('#featPanel');
const sketchSel = () => $<HTMLSelectElement>('#fpSketch');

function panelSketch(): SketchFeature | undefined {
  return app.doc.features.find((f): f is SketchFeature => f.type === 'sketch' && f.id === panel?.f.sketch);
}

// ---- Fields -------------------------------------------------------------------------------------

/** Rendered fields with functions to sync them with the feature. */
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
      // The variable chips type into the last expression field, not into free text.
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
        select.value = String(get(field.key) ?? opts[0]?.value ?? ''); // missing value = the first choice
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

// ---- Open / preview / close -------------------------------------------------------------------------

export function openPanel(f: SolidFeature, existing: boolean) {
  if (document.body.dataset.mode !== 'part') return;
  clearFace();
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
  // The panel covers the right edge (landscape) or the bottom (portrait) – center the model in the
  // rest.
  const landscape = innerWidth > innerHeight;
  viewer.setRightInset(landscape ? panelEl().offsetWidth + 16 : 0);
  viewer.setBottomInset(landscape ? 0 : panelEl().offsetHeight + 8);
  if (work() !== 'draw') setWork('draw'); // features are edited in Draw
  $('#tree').hidden = true;
  $('#btnTree').setAttribute('aria-pressed', 'false');
  renderOpts.hideSketch = panel.f.sketch;
  viewer.drag = f.type === 'text' ? dragText : null;
  syncFields();
  updatePreview();
  viewer.fit(); // make sure the sketch being worked on is visible
}

/** The sketch list in the panel (sketches before the feature). */
function refreshSketchOptions() {
  if (!panel) return;
  sketchSel().replaceChildren(...usableSketches(app.doc, panel.before).map(s => new Option(`${s.name} (${planeLabel(s)})`, s.id)));
  sketchSel().value = panel.f.sketch;
}

/** Revolve: quick choice of axis (X/Y) or "Line" that switches to picking the axis in the view. */
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
    d.rollback = at + 1 >= d.features.length ? null : at + 1; // show the model up to the feature
    app.previewDoc = d;
    emit('render');
  }, delay);
}

/** After every rendering: show the feature's error in the panel. */
renderOpts.onRendered.push(() => {
  if (!panel) return;
  const err = app.model.errors.get(panel.f.id);
  $('#fpError').textContent = err ? `⚠ ${err}` : '';
  $('#fpError').hidden = !err;
});

export function closePanel() {
  panel = null;
  viewer.drag = null;
  textDrag = null;
  app.previewDoc = null;
  clearTimeout(previewTimer);
  panelEl().hidden = true;
  renderOpts.hideSketch = null;
  viewer.setOverlay(null);
  viewer.setRightInset(0);
  viewer.setBottomInset(0);
}

// ---- Text on a face: placed where the face is tapped, dragged along it ----------------------------

/**
 * A sketch that only holds the text's place: at most one point, nothing drawn, used by no other
 * feature. Such a sketch moves with the text (to another face too).
 */
function placeSketch(f: SolidFeature, sk: SketchFeature): boolean {
  if (f.type !== 'text') return false;
  return !Object.keys(sk.entities).length && Object.keys(sk.points).length <= 1 && !sk.constraints.length && dependents(app.doc, sk.id).every(g => g.id === f.id);
}

/** Before the first move of an existing feature's sketch: a copy to restore if the panel is cancelled. */
function keepSketch(sk: SketchFeature) {
  if (panel?.existing && !panel.sketchBackup) panel.sketchBackup = JSON.stringify(sk);
}

/** The text's place (its sketch point; the origin if it has none). */
const anchorOf = (sk: SketchFeature): Vec => Object.values(sk.points)[0] ?? { x: 0, y: 0 };

function setAnchor(f: TextFeature, sk: SketchFeature, p: Vec) {
  const id = Object.keys(sk.points)[0] ?? newId(sk, 'p');
  sk.points[id] = { x: p.x, y: p.y, standalone: true };
  f.points = null;
}

/** New text on the face hit in the 3D view, at the tapped point. */
function textOnFace(hit: FaceHit) {
  const sk = sketchForHit(hit);
  const at = toPlane(sketchFrame(sk, vars(), app.doc), hit.point);
  insertFeature(app.doc, sk);
  emit('docChanged');
  const f = newFeature(app.doc, 'text', sk);
  setAnchor(f, sk, at);
  remoteLog('text-on-face', { plane: sk.plane, face: !!sk.face });
  openPanel(f, false);
  panel!.template = sk;
}

/** A tap with a text panel open: the text moves there, onto another face if need be. */
function moveTextTo(p: { x: number; y: number }): boolean {
  const sk = panelSketch();
  const f = panel?.f;
  if (!sk || f?.type !== 'text' || !placeSketch(f, sk)) return false;
  const hit = viewer.pickFace(p);
  if (!hit) return false;
  keepSketch(sk);
  const fr = sketchFrame(sk, vars(), app.doc);
  const next = sketchForHit(hit);
  const nf = sketchFrame(next, vars(), app.doc);
  if (Math.abs(dot(fr.n, nf.n)) < 0.9999 || Math.abs(dot(sub(nf.o, fr.o), fr.n)) > 0.02) {
    // Another face: the sketch takes its plane, and the text keeps raised/engraved.
    for (const key of ['plane', 'offset', 'face', 'faceRef', 'outward', 'seat'] as const) {
      if (next[key] === undefined) delete sk[key];
      else (sk as unknown as Record<string, unknown>)[key] = next[key];
    }
    f.direction = f.op === 'remove' ? inwardOf(sk) : outwardOf(sk);
  }
  setAnchor(f, sk, toPlane(sketchFrame(sk, vars(), app.doc), hit.point));
  // On a round side the point is measured along it.
  const ray = viewer.rayAt(p);
  const along = textSurface(f, sk, app.doc, vars()).fromRay(ray.o, ray.d);
  if (along) setAnchor(f, sk, along);
  changed('points');
  return true;
}

/** Dragging the text along its face (the view rotates if the finger is not on the text). */
let textDrag: { surface: TextSurface; off: Vec } | null = null;
const dragText: NonNullable<typeof viewer.drag> = {
  start(p) {
    const sk = panelSketch();
    const f = panel?.f;
    if (!sk || f?.type !== 'text' || !placeSketch(f, sk)) return false;
    const surface = textSurface(f, sk, app.doc, vars());
    const ray = viewer.rayAt(p);
    const at = surface.fromRay(ray.o, ray.d);
    if (!at) return false;
    // On the text: inside a generous box around it.
    const a = anchorOf(sk);
    const size = parseExpr(f.size, vars()).value ?? 8;
    const ang = ((parseExpr(f.angle || '0', vars()).value ?? 0) * Math.PI) / 180;
    const dx = at.x - a.x, dy = at.y - a.y;
    const x = dx * Math.cos(ang) + dy * Math.sin(ang), y = -dx * Math.sin(ang) + dy * Math.cos(ang);
    const len = [...f.text].length * size * 0.7, pad = size * 0.6;
    const x0 = f.halign === 'left' ? 0 : f.halign === 'right' ? -len : -len / 2;
    if (x < x0 - pad || x > x0 + len + pad || Math.abs(y) > size * 0.6 + pad) return false;
    keepSketch(sk);
    textDrag = { surface, off: { x: a.x - at.x, y: a.y - at.y } };
    return true;
  },
  move(p) {
    const sk = panelSketch();
    if (!textDrag || !sk || panel?.f.type !== 'text') return;
    const ray = viewer.rayAt(p);
    const at = textDrag.surface.fromRay(ray.o, ray.d);
    if (!at) return;
    setAnchor(panel.f, sk, { x: at.x + textDrag.off.x, y: at.y + textDrag.off.y });
    changed('points');
  },
  end() {
    if (textDrag) remoteLog('text-drag', { at: panelSketch() && anchorOf(panelSketch()!) });
    textDrag = null;
  },
};

/** Default sketch for a new feature: the latest usable sketch, preferably one not already used. */
function defaultSketch(type: SolidFeature['type']): SketchFeature | null {
  const cands = usableSketches(app.doc).filter(s => KINDS[type].usable(s));
  return [...cands].reverse().find(s => !dependents(app.doc, s.id).length) ?? cands[cands.length - 1] ?? null;
}

/**
 * Extrude a face: tap a flat face → a new sketch on it with the face's outline (locked), used by
 * the feature. Without an open panel a new extrude starts; otherwise the open (new) feature
 * switches sketch.
 */
export function extrudeFace() {
  pickFaceThen(hit => extrudeHit(hit, 'add'));
}

/** Extrude (or, with 'remove', cut into) the face hit in the 3D view – see extrudeFace. */
function extrudeHit(hit: FaceHit, op: 'add' | 'remove') {
  // Round face: thicken/cut along the surface (its own feature) instead of a sketch.
  const tris = smoothFace(viewer.meshPositions!, hit.point, hit.normal, viewer.meshNormals);
  if (tris) {
    if (panel && !panel.existing) {
      const tpl = panel.template;
      closePanel();
      if (tpl && !dependents(app.doc, tpl.id).length) removeFeature(app.doc, tpl);
    }
    const f = newFeature(app.doc, 'surface', WORLD_SKETCH);
    f.tris = tris;
    // The side of an extruded circle/arc: follow it (otherwise a fixed copy of the surface).
    f.ref = findCurveRef(app.doc, vars(), hit.normal, hit.point) ?? undefined;
    f.op = op;
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
  const f = newFeature(app.doc, 'extrude', sk);
  if (op === 'remove') {
    f.op = 'remove';
    f.direction = inwardOf(sk);
  }
  openPanel(f, false);
  panel!.template = sk;
}

/** New feature of the type (from the toolbar). */
export function startFeature(type: SolidFeature['type']) {
  // A face selected in the 3D view: Extrude extrudes it.
  const face = type === 'extrude' || type === 'text' ? takeFace() : null;
  if (face) return type === 'text' ? textOnFace(face) : extrudeHit(face, 'add');
  if (KINDS[type].pick.kind === 'none') return openPanel(newFeature(app.doc, type, WORLD_SKETCH), false);
  const sk = defaultSketch(type);
  // Extrude without a closed sketch but with a model: pick a face to extrude.
  if (!sk && type === 'extrude' && viewer.meshPositions) {
    showToast(t('face.pickHint'), 'info');
    return extrudeFace();
  }
  // Text with a model and no points sketched for it: tap the face to put it on.
  const prepared = !!sk && !dependents(app.doc, sk.id).length && Object.values(sk.points).some(p => p.standalone);
  if (type === 'text' && !prepared && viewer.meshPositions) {
    showToast(t('text.pickFace'), 'info');
    pickFaceThen(textOnFace);
    return;
  }
  if (!sk && (type === 'container' || type === 'text' || type === 'snap')) {
    // No sketch yet: the container starts with a rectangle with dimensions, text/snap hook at the
    // origin on the top view's plane.
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
    const backup = panel?.sketchBackup;
    closePanel();
    if (backup) {
      const sk: SketchFeature = JSON.parse(backup);
      const i = app.doc.features.findIndex(g => g.id === sk.id);
      if (i >= 0) app.doc.features[i] = sk;
      emit('docChanged');
    } else if (tpl) {
      removeFeature(app.doc, tpl);
      emit('docChanged');
    } else emit('render');
  });
  $('#fpOk').addEventListener('click', () => {
    if (!panel) return;
    const f = panel.f;
    if (f.type === 'container') {
      // The container goes into the tree as its parts (body, cavity, lid, threads …).
      const r = applyContainer(app.doc, f);
      if ('error' in r) return showToast(r.error, 'error');
      remoteLog('feature-ok', { type: f.type, existing: !!panel.existing, parts: r.parts.length });
      closePanel();
      emit('docChanged');
      showToast(t('toast.containerParts', { n: r.parts.filter(g => g.type !== 'sketch').length }));
      return;
    }
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
  // Tap in the 3D view: pick regions, axis, points or circles – or, with no panel open, a face.
  viewer.onTap = p => {
    if (!panel) {
      if (partMode()) tapFace(p);
      return;
    }
    if (moveTextTo(p)) return;
    const sk = panelSketch();
    if (!sk) return;
    const key = pickerFor(panel.f).tap(panel.f, sk, p, viewer, panel.mode);
    if (!key) return;
    if (key === 'axis') panel.mode = 'regions';
    changed(key);
  };  viewer.onLongPress = p => {
    if (!panel && partMode()) longPressFace(p);
  };
  initFaceSelect((action, hit) => {
    if (action === 'sketch') return sketchOnFace(hit);
    if (action === 'text') return textOnFace(hit);
    extrudeHit(hit, action === 'cut' ? 'remove' : 'add');
  });
}

/** Part mode with nothing else using taps in the 3D view (the measure tool sets tapOverride). */
const partMode = () => document.body.dataset.mode === 'part';
