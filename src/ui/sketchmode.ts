// Sketch mode: the editor, the toolbar, the context bar, the dimension dialog and the plane choice.

import { dependents, insertFeature, newSketch, removeFeature, type SketchFeature } from '../doc';
import { parseExpr } from '../expr';
import { facePlane, findFaceRef, offsetExpr, sketchReference, slantedFace, surfaceDepth } from '../faceref';
import { sketchFrame } from '../frame';
import { t } from '../i18n';
import { sketchRegions } from '../model3d';
import { remoteLog } from '../remote';
import { SketchEditor, type ToolName } from '../sketch/editor';
import type { Plane } from '../sketch/model';
import { $, $$, fmtInput, store, swallowNextClick } from './dom';
import { chipRow, refreshChips } from './params';
import { view, viewer } from './render';
import { app, emit, on, saveDoc, vars } from './state';
import { hideToasts, showToast } from './toast';
import { planeLabel, renderTree } from './tree';

let editor: SketchEditor | null = null;
let editing: SketchFeature | null = null;
export const currentEditor = () => editor;

/** Switch between part mode (3D) and sketch mode. */
export function setMode(m: 'part' | 'sketch') {
  document.body.dataset.mode = m;
  const sketch = m === 'sketch';
  $('#sketchArea').hidden = !sketch;
  $('#partArea').hidden = sketch;
  for (const e of $$('.part-only')) e.hidden = sketch;
  for (const e of $$('.sketch-only')) e.hidden = !sketch;
  hideToasts();
  if (sketch) {
    $('#codePanel').hidden = true;
    $('#tree').hidden = true;
  } else {
    $('#codePanel').hidden = store.get('codeOpen') !== '1';
    $('#tree').hidden = store.get('treeOpen') !== '1';
  }
}

// ---- Context bar and status --------------------------------------------------------------------

function renderCtxbar() {
  const acts = editor && editor.tool === 'select' ? editor.actions() : [];
  const bar = $('#ctxbar');
  bar.hidden = acts.length === 0;
  bar.replaceChildren(
    ...acts.map(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.append(Object.assign(document.createElement('b'), { textContent: a.symbol }), a.label);
      b.addEventListener('click', () => a.run());
      return b;
    }),
  );
}

function updateSketchUi() {
  if (!editor) return;
  $('#hintText').textContent = editor.hint;
  renderCtxbar();
  $('#btnGlyphs').setAttribute('aria-pressed', String(editor.showConstraints));
  $('#btnFinish').hidden = !editor.chainActive;
  $<HTMLButtonElement>('#btnUndo').disabled = !editor.canUndo;
  $<HTMLButtonElement>('#btnRedo').disabled = !editor.canRedo;
  $<HTMLButtonElement>('#btnDelete').disabled = $<HTMLButtonElement>('#btnConstruction').disabled = editor.selectedCount === 0;
  for (const b of $$<HTMLButtonElement>('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === editor.tool));
  $('#sidesBar').hidden = editor.tool !== 'polygon';
  for (const b of $$<HTMLButtonElement>('[data-sides]')) b.setAttribute('aria-pressed', String(Number(b.dataset.sides) === editor.polygonSides));
  $('#btnGrid').setAttribute('aria-pressed', String(editor.snapToGrid));
  const n = editor.loopCount;
  const { open } = editor.openInfo;
  const parts = [n === 1 ? t('sketch.oneRegion') : n ? t('sketch.regions', { n }) : ''];
  if (open) parts.push(open === 1 ? t('sketch.oneOpenEnd') : t('sketch.openEnds', { n: open }));
  const dof = editor.dof;
  const info = $('#loopInfo');
  info.textContent = parts.filter(Boolean).join(' · ');
  if (dof !== null && Object.keys(editor.sketch.entities).length + Object.values(editor.sketch.points).filter(p => p.standalone).length) {
    const d = document.createElement('b');
    d.textContent = dof === 0 ? t('sketch.fullyDefined') : dof === 1 ? t('sketch.oneDof') : t('sketch.dofs', { n: dof });
    if (dof === 0) d.className = 'ok';
    if (info.textContent) info.append(' · ');
    info.append(d);
  }
}

// ---- Dimension dialog ------------------------------------------------------------------------

const dimDlg = () => $<HTMLDialogElement>('#dimDlg');
const dimValue = () => $<HTMLInputElement>('#dimValue');
let dimId: string | null = null;
let dimDir: 'aligned' | 'h' | 'v' | undefined;
let dimRd: 'radius' | 'diameter' | undefined;

function openDimension(id: string, viaTap = false) {
  const info = editor?.dimensionInfo(id);
  if (!info) return;
  if (viaTap) swallowNextClick();
  dimId = id;
  dimDir = info.dir;
  dimRd = info.rd;
  $('#dimTitle').textContent = info.title;
  $('#dimUnit').textContent = info.unit;
  $('#dimDir').hidden = !info.dir;
  $('#dimRd').hidden = !info.rd;
  syncDimButtons();
  refreshChips();
  dimValue().value = info.expr ?? fmtInput(info.value);
  $('#dimError').hidden = true;
  dimDlg().showModal();
  dimValue().focus();
  dimValue().select();
}

function syncDimButtons() {
  for (const b of $$<HTMLButtonElement>('#dimDlg [data-dir]')) b.setAttribute('aria-pressed', String(b.dataset.dir === dimDir));
  for (const b of $$<HTMLButtonElement>('#dimDlg [data-rd]')) b.setAttribute('aria-pressed', String(b.dataset.rd === dimRd));
}

function initDimDialog() {
  $('#dimChips').replaceWith(Object.assign(chipRow(() => dimValue()), { id: 'dimChips' }));
  for (const b of $$<HTMLButtonElement>('#dimDlg [data-dir]'))
    b.addEventListener('click', () => {
      if (!dimId || !editor) return;
      dimDir = b.dataset.dir as typeof dimDir;
      const v = editor.previewDimension(dimId, { dir: dimDir });
      if (v !== null) dimValue().value = fmtInput(v);
      $('#dimTitle').textContent = t(dimDir === 'h' ? 'dim.hDistance' : dimDir === 'v' ? 'dim.vDistance' : 'dim.distance');
      syncDimButtons();
    });
  for (const b of $$<HTMLButtonElement>('#dimDlg [data-rd]'))
    b.addEventListener('click', () => {
      if (!dimId || !editor) return;
      const cur = parseExpr(dimValue().value, vars());
      const next = b.dataset.rd as typeof dimRd;
      if (cur.value !== null && !cur.uses.length && next !== dimRd) dimValue().value = fmtInput(next === 'diameter' ? cur.value * 2 : cur.value / 2);
      dimRd = next;
      $('#dimTitle').textContent = t(dimRd === 'radius' ? 'dim.radius' : 'dim.diameter');
      syncDimButtons();
    });
  $('#dimForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!dimId || !editor) return dimDlg().close();
    const r = parseExpr(dimValue().value, vars());
    const err = $('#dimError');
    if (r.value === null) {
      err.textContent = r.error ?? t('err.parse');
      err.hidden = false;
      return;
    }
    if (editor.setDimension(dimId, r.value, { dir: dimDir, rd: dimRd, expr: r.uses.length ? dimValue().value.trim() : undefined })) dimDlg().close();
    else {
      err.textContent = t('err.conflict');
      err.hidden = false;
    }
  });
  $('#dimCancel').addEventListener('click', () => dimDlg().close());
  $('#dimDelete').addEventListener('click', () => {
    if (dimId && editor) {
      editor.selection.clear();
      editor.selection.add(`c:${dimId}`);
      editor.deleteSelection();
    }
    dimDlg().close();
  });
}

// ---- Into and out of sketch mode --------------------------------------------------------------------

/** Called before sketch mode opens (e.g. to close the feature panel). */
export const sketchHooks = { beforeEnter: () => {} };

export function enterSketch(f: SketchFeature) {
  sketchHooks.beforeEnter();
  editing = f;
  setMode('sketch');
  $('#sketchTitle').textContent = `${f.name} · ${planeLabel(f)}`;
  if (!editor) {
    editor = new SketchEditor($('#sketchHost'), f);
    editor.onChange = () => saveDoc();
    editor.onState = updateSketchUi;
    editor.onMessage = showToast;
    editor.onEditDimension = openDimension;
    editor.snapToGrid = store.get('snapGrid') !== '0';
    editor.polygonSides = Number(store.get('polygonSides')) || 6;
    editor.showConstraints = store.get('showConstraints') !== '0';
    if (app.solver) editor.setSolver(app.solver);
  } else editor.setSketch(f);
  // The model's edges in the sketch plane (e.g. the face being sketched on) to see and snap to.
  const pos = app.source === 'model' ? viewer.meshPositions : null;
  editor.reference = pos ? sketchReference(pos, sketchFrame(f, vars(), app.doc)) : null;
  if (!editor.reference?.segments.length) editor.reference = null;
  editor.fitReference = !!f.outward;
  editor.fit();
  editor.setTool(Object.keys(f.entities).length || Object.keys(f.points).length ? 'select' : 'line');
  remoteLog('sketch-enter', { name: f.name, plane: f.plane, offset: f.offset, outward: f.outward, reference: editor.reference?.segments.length ?? 0 });
}

/** Sketch on a round face: how far the surface falls away below the drawing (see SketchFeature.seat). */
function updateSeat(sk: SketchFeature) {
  const pos = app.source === 'model' ? viewer.meshPositions : null;
  if (!sk.outward || !pos) return;
  const xs: number[] = [], ys: number[] = [];
  for (const e of Object.values(sk.entities)) {
    const ids = e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.c] : [e.c, e.p1, e.p2];
    const r = e.type === 'circle' ? e.r : e.type === 'arc' ? Math.hypot(sk.points[e.p1].x - sk.points[e.c].x, sk.points[e.p1].y - sk.points[e.c].y) : 0;
    for (const id of ids) xs.push(sk.points[id].x - r, sk.points[id].x + r), ys.push(sk.points[id].y - r, sk.points[id].y + r);
  }
  if (!xs.length) return;
  const d = surfaceDepth(pos, sketchFrame(sk, vars(), app.doc), { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  // No round surface found (e.g. covered by what has already been built on the sketch): keep the
  // old seat.
  if (d > 0) sk.seat = d;
}

export function exitSketch() {
  if (!editing) return;
  editor?.finishOperation();
  const sk = editing;
  editing = null;
  updateSeat(sk);
  // A completely empty new sketch does not need to be saved.
  const keep = Object.keys(sk.entities).length > 0 || Object.keys(sk.points).length > 0 || dependents(app.doc, sk.id).length > 0;
  if (!keep) removeFeature(app.doc, sk);
  setMode('part');
  view.fitNext = app.model.solids === 0;
  emit('docChanged');
  remoteLog('sketch-exit', {
    name: sk.name,
    entities: Object.keys(sk.entities).length,
    constraints: sk.constraints.length,
    dof: editor?.dof,
    loops: editor?.loopCount,
    ...editor?.openInfo,
    solids: app.model.solids,
    sketch: { points: sk.points, entities: sk.entities },
  });
  // After a new sketch: hint at the next step.
  if (keep && !dependents(app.doc, sk.id).length) {
    if (sketchRegions(sk).regions.length) showToast(t('toast.makeSolid', { name: sk.name }));
    else if (Object.values(sk.points).some(p => p.standalone)) showToast(t('toast.makeHoles', { name: sk.name }));
  }
}

// ---- Planval ------------------------------------------------------------------------------------

/** Open the plane choice for a new sketch; content is put into the sketch once the plane is chosen. */
export let openPlaneDialog: (content?: ((f: SketchFeature) => void) | null, title?: string) => void = () => {};

/** Content waiting for the new sketch's plane (e.g. an imported SVG), or null. */
let pendingContent: ((f: SketchFeature) => void) | null = null;

function newSketchOn(plane: Plane, init: (f: SketchFeature) => void) {
  const f = newSketch(app.doc, plane);
  init(f);
  addSketchAndEnter(f);
}

function addSketchAndEnter(f: SketchFeature) {
  pendingContent?.(f);
  pendingContent = null;
  insertFeature(app.doc, f);
  saveDoc();
  renderTree();
  enterSketch(f);
}

// ---- Sketch on a face: tap a flat face in the 3D view ------------------------------------------------

function stopFacePick() {
  viewer.tapOverride = null;
  $('#faceBar').hidden = true;
}

type FaceHit = { point: [number, number, number]; normal: [number, number, number] };

/**
 * New sketch (not inserted) in the tapped face's plane: a base plane with offset, or a slanted face
 * with its own plane (follows the extrude it comes from, otherwise fixed in space).
 */
export function sketchForHit(hit: FaceHit): SketchFeature {
  const fp = facePlane(hit.normal, hit.point);
  remoteLog('face-pick', { normal: hit.normal.map(v => Math.round(v * 1000) / 1000), plane: fp?.plane, offset: fp?.offset, flipped: fp?.flipped });
  if (!fp) {
    const sf = slantedFace(viewer.meshPositions!, hit.normal, hit.point);
    const ref = findFaceRef(app.doc, vars(), hit.normal, hit.point);
    remoteLog('face-ref', { ref });
    const f = newSketch(app.doc, sf.plane);
    f.face = sf.face;
    if (ref) {
      f.faceRef = ref;
      const { o, u, v } = sketchFrame(f, vars(), app.doc);
      f.face = { o, u, v };
    }
    f.outward = 'normal';
    return f;
  }
  const f = newSketch(app.doc, fp.plane);
  const off = offsetExpr(app.doc, fp.plane, fp.offset, vars());
  if (off !== '0') f.offset = off;
  f.outward = fp.flipped ? 'reverse' : 'normal';
  return f;
}

/** Let the user tap a face in the 3D view (the "Tap a face" bar with Cancel). */
export function pickFaceThen(onHit: (hit: FaceHit) => void): boolean {
  if (app.source !== 'model' || !viewer.meshPositions) {
    showToast(t('plane.noModel'), 'info');
    return false;
  }
  $('#faceBar').hidden = false;
  remoteLog('face-pick-start', {});
  viewer.tapOverride = p => {
    const hit = viewer.pickFace(p);
    if (!hit) return showToast(t('plane.noFace'), 'info');
    stopFacePick();
    swallowNextClick();
    onHit(hit);
  };
  return true;
}

function startFacePick() {
  pickFaceThen(hit => addSketchAndEnter(sketchForHit(hit)));
}

function initPlaneDialog() {
  const dlg = $<HTMLDialogElement>('#planeDlg');
  const offset = $<HTMLInputElement>('#planeOffset');
  $('#planeChips').replaceWith(Object.assign(chipRow(() => offset), { id: 'planeChips' }));
  $('#btnNewSketch').addEventListener('click', () => openPlaneDialog());
  openPlaneDialog = (content = null, title = t('plane.title')) => {
    stopFacePick();
    pendingContent = content;
    $('#planeDlg h2').textContent = title;
    offset.value = '0';
    $('#planeError').hidden = true;
    $<HTMLButtonElement>('#btnPickFace').disabled = app.source !== 'model' || !viewer.meshPositions;
    refreshChips();
    dlg.showModal();
  };
  $('#btnPickFace').addEventListener('click', () => {
    dlg.close();
    startFacePick();
  });
  $('#faceCancel').addEventListener('click', stopFacePick);
  for (const b of $$<HTMLButtonElement>('[data-plane]'))
    b.addEventListener('click', () => {
      const off = offset.value.trim() || '0';
      const r = parseExpr(off, vars());
      if (r.value === null) {
        $('#planeError').textContent = `${t('field.offset')}: ${r.error}`;
        $('#planeError').hidden = false;
        return;
      }
      dlg.close();
      newSketchOn(b.dataset.plane as Plane, f => {
        if (r.value !== 0 || r.uses.length) f.offset = off;
      });
    });
}

// ---- Wiring -------------------------------------------------------------------------------------

export function initSketchMode() {
  initDimDialog();
  initPlaneDialog();
  on('solver', s => editor?.setSolver(s));
  $('#btnDone').addEventListener('click', exitSketch);
  $('#btnUndo').addEventListener('click', () => editor?.undo());
  $('#btnRedo').addEventListener('click', () => editor?.redo());
  $('#btnDelete').addEventListener('click', () => editor?.deleteSelection());
  $('#btnConstruction').addEventListener('click', () => editor?.toggleConstruction());
  $('#btnFinish').addEventListener('click', () => editor?.finishOperation());
  $('#btnGrid').addEventListener('click', () => {
    if (!editor) return;
    editor.snapToGrid = !editor.snapToGrid;
    store.set('snapGrid', editor.snapToGrid ? '1' : '0');
    updateSketchUi();
  });
  $('#btnSketchFit').addEventListener('click', () => editor?.fit());
  $('#btnGlyphs').addEventListener('click', () => {
    if (!editor) return;
    editor.showConstraints = !editor.showConstraints;
    store.set('showConstraints', editor.showConstraints ? '1' : '0');
    editor.requestDraw();
    updateSketchUi();
  });
  for (const b of $$<HTMLButtonElement>('[data-tool]')) b.addEventListener('click', () => editor?.setTool(b.dataset.tool as ToolName));
  for (const b of $$<HTMLButtonElement>('[data-sides]'))
    b.addEventListener('click', () => {
      if (!editor) return;
      editor.polygonSides = Number(b.dataset.sides);
      store.set('polygonSides', b.dataset.sides!);
      updateSketchUi();
    });

  // The face pick is cancelled by Esc or by another tool in part mode.
  $('#partToolbar').addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('button')?.id !== 'btnNewSketch') stopFacePick();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && viewer.tapOverride) stopFacePick();
    if (!editor || document.body.dataset.mode !== 'sketch' || dimDlg().open) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if ((e.ctrlKey || e.metaKey) && k === 'y') editor.redo();
    else if (k === 'escape') editor.finishOperation();
    else if (k === 'delete' || k === 'backspace') editor.deleteSelection();
    else {
      const tools: Record<string, ToolName> = { s: 'select', p: 'point', l: 'line', r: 'rect', t: 'rectc', c: 'circle', g: 'polygon', o: 'slot', a: 'arc3', m: 'arcc' };
      if (tools[k] && !e.ctrlKey && !e.metaKey) editor.setTool(tools[k]);
    }
  });
}

/** Language change: redraw the sketch mode's texts. */
export function refreshSketchTexts() {
  if (editor) {
    editor.requestDraw();
    updateSketchUi();
  }
  if (editing) $('#sketchTitle').textContent = `${editing.name} · ${planeLabel(editing)}`;
}
