// The measure tool in part mode: tap corners, edges and faces; one pick shows its measurements
// (edge length, Ø, coordinates), two picks the distance/angle between them. A third tap starts
// over.

import { describe, measureBetween, refOf, type Ref, type V3 } from '../measure';
import { remoteLog } from '../remote';
import { t } from '../i18n';
import { $, $$ } from './dom';
import { viewer } from './render';
import { showToast } from './toast';
import { clearFace } from './faceselect';

let refs: Ref[] = [];
let active = false;

const marker = (r: Ref): V3 => r.p;

function show() {
  const res = refs.length === 2 ? measureBetween(refs[0], refs[1]) : refs.length === 1 ? describe(refs[0]) : null;
  $('#measureMain').textContent = res?.main ?? t('measure.hint');
  $('#measureDetail').textContent = res?.detail ?? '';
  $<HTMLButtonElement>('#measureClear').hidden = !refs.length;
  viewer.setMarks({
    points: refs.map(marker),
    polylines: refs.flatMap(r => ('poly' in r ? [r.poly] : [])),
    lines: res?.guide && refs.length === 2 ? [res.guide] : [],
  });
}

export function stopMeasure() {
  if (!active) return;
  active = false;
  refs = [];
  viewer.tapOverride = null;
  viewer.setMarks(null);
  $('#measureBar').hidden = true;
  $('#btnMeasure').setAttribute('aria-pressed', 'false');
}

function startMeasure() {
  if (!viewer.meshPositions) return showToast(t('measure.noModel'), 'info');
  clearFace();
  active = true;
  refs = [];
  $('#measureBar').hidden = false;
  $('#btnMeasure').setAttribute('aria-pressed', 'true');
  viewer.tapOverride = p => {
    const pick = viewer.pickMeasure(p);
    if (!pick) {
      refs = [];
      return show();
    }
    const r = refOf(pick, viewer.edgePositions);
    refs = refs.length >= 2 ? [r] : [...refs, r];
    remoteLog('measure', { kinds: refs.map(x => x.kind) });
    show();
  };
  show();
}

export function initMeasure() {
  $('#btnMeasure').addEventListener('click', () => (active ? stopMeasure() : startMeasure()));
  $('#measureDone').addEventListener('click', stopMeasure);
  $('#measureClear').addEventListener('click', () => {
    refs = [];
    show();
  });
  // Other tools (new sketch, features) take over the taps in the 3D view.
  for (const b of $$<HTMLButtonElement>('#partToolbar button')) if (b.id !== 'btnMeasure') b.addEventListener('click', stopMeasure, { capture: true });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && active) stopMeasure();
  });
  // The model has been re-rendered: old picks point to a different mesh.
  viewer.meshChanged.push(() => {
    if (!active) return;
    refs = [];
    show();
  });
}
