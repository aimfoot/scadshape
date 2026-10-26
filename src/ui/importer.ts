// Import in part mode: STL → feature "Imported body" (the file in blobs.ts), SVG → a new sketch
// with lines, arcs and circles (size, placement and locking are chosen first, then the plane).

import { putBlob } from '../blobs';
import { insertFeature, newFeature, type Feature } from '../doc';
import { parseExpr } from '../expr';
import { WORLD_SKETCH } from '../features/code';
import type { MeshFeature } from '../features/mesh';
import { t } from '../i18n';
import { remoteLog } from '../remote';
import { emptySketch } from '../sketch/model';
import { stlInfo } from '../stl';
import { addShapesToSketch, parseSvg, placeDrawing, type SvgDrawing } from '../svg';
import { $, $$, fmtInput, fmtInt } from './dom';
import { openPanel } from './panel';
import { openPlaneDialog } from './sketchmode';
import { app, vars } from './state';
import { showToast } from './toast';

/** Above this many points the geometry is locked by default; above LOCK_MAX always (the solver cannot handle more free ones). */
export const LOCK_DEFAULT = 150;
export const LOCK_MAX = 600;
/** More points than this become too heavy in the sketch (regions, drawing). */
export const SVG_MAX_POINTS = 6000;
const STL_MAX_BYTES = 64 * 1024 * 1024;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || name;
const looksLikeSvg = (text: string) => /<svg[\s>]/i.test(text.slice(0, 4096));

async function importStl(file: File, bytes: Uint8Array) {
  const info = stlInfo(bytes);
  if (!info) return showToast(t('import.badStl'), 'error');
  const hash = await putBlob(bytes);
  const f = newFeature(app.doc, 'mesh', WORLD_SKETCH) as MeshFeature;
  Object.assign(f, { file: hash, fileName: file.name, triangles: info.triangles, min: info.min, max: info.max });
  const base = baseName(file.name);
  let name = base, n = 2;
  while (app.doc.features.some((g: Feature) => g.name === name)) name = `${base} ${n++}`;
  f.name = name;
  remoteLog('import-stl', { bytes: bytes.length, triangles: info.triangles });
  openPanel(f, false);
  const size = info.max.map((v, i) => v - info.min[i]);
  showToast(t('import.stlDone', { name: file.name, size: size.map(v => fmtInput(Math.round(v * 10) / 10)).join(' × ') }));
}

// ---- The SVG dialog ---------------------------------------------------------------------------------

let svg: { drawing: SvgDrawing; name: string } | null = null;
let origin: 'corner' | 'center' = 'corner';
let lockTouched = false;

const svgDlg = () => $<HTMLDialogElement>('#svgDlg');
const widthOf = (d: SvgDrawing) => d.max.x - d.min.x;
const heightOf = (d: SvgDrawing) => d.max.y - d.min.y;

/** The scale from the width field, or null if the field is wrong. */
function svgScale(): number | null {
  if (!svg) return null;
  const r = parseExpr($<HTMLInputElement>('#svgWidth').value.trim() || '0', vars());
  const w = widthOf(svg.drawing);
  if (r.value === null || !(r.value > 0) || !(w > 0)) return null;
  return r.value / w;
}

function updateSvg() {
  if (!svg) return;
  const d = svg.drawing;
  const s = svgScale();
  const err = $('#svgError');
  const ok = $<HTMLButtonElement>('#svgOk');
  for (const b of $$<HTMLButtonElement>('#svgOrigin [data-origin]')) b.setAttribute('aria-pressed', String(b.dataset.origin === origin));
  if (s === null) {
    err.textContent = t('import.svgBadWidth');
    err.hidden = false;
    ok.disabled = true;
    return;
  }
  $('#svgHeight').textContent = `× ${fmtInput(Math.round(heightOf(d) * s * 100) / 100)} mm`;
  const stats = addShapesToSketch(emptySketch(), placeDrawing(d, s, origin));
  const lock = $<HTMLInputElement>('#svgLock');
  if (!lockTouched) lock.checked = stats.points > LOCK_DEFAULT;
  if (stats.points > LOCK_MAX) lock.checked = true;
  lock.disabled = stats.points > LOCK_MAX;
  const parts = [t('import.svgCounts', { points: fmtInt(stats.points), lines: fmtInt(stats.lines), arcs: fmtInt(stats.arcs), circles: fmtInt(stats.circles) })];
  $('#svgStats').textContent = parts.join(' · ');
  const ignored = Object.entries(d.ignored).map(([k, n]) => `${n} ${k}`).join(', ');
  $('#svgIgnored').textContent = ignored ? t('import.svgIgnored', { list: ignored }) : '';
  $('#svgIgnored').hidden = !ignored;
  const tooBig = stats.points > SVG_MAX_POINTS;
  err.textContent = tooBig ? t('import.svgTooBig', { n: fmtInt(stats.points), max: fmtInt(SVG_MAX_POINTS) }) : '';
  err.hidden = !tooBig;
  ok.disabled = tooBig || stats.points + stats.circles === 0;
}

function openSvgDialog(text: string, name: string) {
  let drawing: SvgDrawing;
  try {
    drawing = parseSvg(text);
  } catch {
    return showToast(t('import.badSvg'), 'error');
  }
  if (!drawing.shapes.length) {
    const ign = Object.keys(drawing.ignored).length;
    return showToast(t(ign ? 'import.svgOnlyIgnored' : 'import.svgEmpty'), 'error');
  }
  svg = { drawing, name };
  lockTouched = false;
  $('#svgName').textContent = name;
  $('#svgSize').textContent = t('import.svgSize', { w: fmtInput(Math.round(widthOf(drawing) * 100) / 100), h: fmtInput(Math.round(heightOf(drawing) * 100) / 100) });
  $<HTMLInputElement>('#svgWidth').value = fmtInput(Math.round(widthOf(drawing) * 100) / 100);
  updateSvg();
  svgDlg().showModal();
}

function confirmSvg() {
  const s = svgScale();
  if (!svg || s === null) return;
  const shapes = placeDrawing(svg.drawing, s, origin);
  const lock = $<HTMLInputElement>('#svgLock').checked;
  const name = svg.name;
  svgDlg().close();
  openPlaneDialog(f => {
    const stats = addShapesToSketch(f, shapes, { lock });
    f.name = baseName(name);
    remoteLog('import-svg', { ...stats, lock });
    showToast(t(lock ? 'import.svgDoneLocked' : 'import.svgDone', { n: fmtInt(stats.points) }));
  }, t('import.svgPlane'));
}

// ---- Wiring -----------------------------------------------------------------------------------------

export async function importFile(file: File) {
  if (document.body.dataset.mode !== 'part') return;
  // An STL or SVG becomes features: they are worked on in Draw.
  if (document.body.dataset.work === 'code') $('#workMode [data-work=draw]').click();
  const lower = file.name.toLowerCase();
  if (file.size > STL_MAX_BYTES) return showToast(t('import.tooLarge', { mb: STL_MAX_BYTES / 1024 / 1024 }), 'error');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  if (lower.endsWith('.svg') || (!lower.endsWith('.stl') && looksLikeSvg(head))) return openSvgDialog(new TextDecoder().decode(bytes), file.name);
  if (lower.endsWith('.stl') || stlInfo(bytes)) return importStl(file, bytes);
  showToast(t('import.badFile'), 'error');
}

export function initImport() {
  const input = $<HTMLInputElement>('#importFile');
  $('#btnImport').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) importFile(f).catch(e => showToast(`${t('import.failed')}: ${(e as Error).message}`, 'error'));
  });
  $('#svgWidth').addEventListener('input', updateSvg);
  $('#svgLock').addEventListener('change', () => (lockTouched = true));
  for (const b of $$<HTMLButtonElement>('#svgOrigin [data-origin]'))
    b.addEventListener('click', () => {
      origin = b.dataset.origin as 'corner' | 'center';
      updateSvg();
    });
  $('#svgOk').addEventListener('click', confirmSvg);
  $('#svgSizeReset').addEventListener('click', () => {
    if (!svg) return;
    $<HTMLInputElement>('#svgWidth').value = fmtInput(Math.round(widthOf(svg.drawing) * 100) / 100);
    updateSvg();
  });
}

/** For tests: import a file as if it was chosen in the file picker. */
export const importForTest = importFile;
