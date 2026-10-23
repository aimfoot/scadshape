// Faces picked straight in the 3D view (part mode): a tap selects and highlights a face, a tap
// beside the model clears it. With a face selected, Extrude and Sketch in the toolbar act on it; a
// long press opens a menu (extrude, cut, sketch on the face).

import { faceTriangles } from '../faceoutline';
import type { V3 } from '../frame';
import { t } from '../i18n';
import { $, $$, swallowNextClick } from './dom';
import { viewer } from './render';
import { app } from './state';
import { showToast } from './toast';

export type FaceHit = { point: V3; normal: V3 };
export type FaceAction = 'extrude' | 'cut' | 'sketch';

let selected: FaceHit | null = null;
let onAction: ((a: FaceAction, hit: FaceHit) => void) | null = null;
const menu = () => $<HTMLDialogElement>('#faceMenu');

/** The selected face, if any. */
export function selectedFace(): FaceHit | null {
  return selected;
}

/** The selected face, which is cleared (a tool takes it). */
export function takeFace(): FaceHit | null {
  const hit = selected;
  clearFace();
  return hit;
}

export function clearFace() {
  if (!selected) return;
  selected = null;
  viewer.setHighlight(null);
}

/** Select the face under a screen point; false if there is none. */
function selectAt(p: { x: number; y: number }): boolean {
  if (app.source !== 'model' || !viewer.meshPositions) return false;
  const hit = viewer.pickFace(p);
  const tris = hit && faceTriangles(viewer.meshPositions, hit.point, hit.normal, viewer.meshNormals);
  if (!hit || !tris) {
    clearFace();
    return false;
  }
  selected = hit;
  viewer.setHighlight(tris);
  return true;
}

/** A tap in part mode with no panel open. */
export function tapFace(p: { x: number; y: number }) {
  const had = !!selected;
  if (selectAt(p) && !had) showToast(t('faceSel.hint'), 'info');
}

/** A long press in part mode with no panel open: select the face and offer what to do with it. */
export function longPressFace(p: { x: number; y: number }) {
  if (!selectAt(p)) return;
  // Lifting the finger makes the browser click where it was – by then on the menu.
  addEventListener('pointerup', () => swallowNextClick(), { capture: true, once: true });
  menu().showModal();
}

/** `act` runs a menu choice (set by the panel, which owns the features). */
export function initFaceSelect(act: (a: FaceAction, hit: FaceHit) => void) {
  onAction = act;
  for (const b of $$<HTMLButtonElement>('[data-face]'))
    b.addEventListener('click', () => {
      menu().close();
      const hit = takeFace();
      if (hit) onAction?.(b.dataset.face as FaceAction, hit);
    });
  // The face points into the old mesh.
  viewer.meshChanged.push(clearFace);
}
