// The way of working, chosen at the top: Draw (sketches and features), Code (write OpenSCAD yourself,
// with no AI aids) or Paste (code from an AI chat: copy the prompt, paste the answer, copy the
// problems back). Each is a source (render.ts): Draw is the model, Code your own code or an example,
// Paste the pasted code.

import { EXAMPLES, cancelRender, requestRender, setSource, view, type Work } from './render';
import { closePanel, currentPanel } from './panel';
import { stopMeasure } from './measure';
import { $$, store } from './dom';

/** The code source Code comes back to: your own code, or the example you last looked at. */
function codeSource() {
  const s = store.get('codeSource');
  return s && EXAMPLES.some(e => e.id === s) ? s : 'custom';
}

/** Show `source` (a way of working's source, or another code source from the drop-down). */
export function showSource(source: string) {
  if (currentPanel()) closePanel();
  stopMeasure();
  setSource(source);
  view.fitNext = true;
  cancelRender();
  requestRender();
}

export function switchWork(work: Work) {
  showSource(work === 'draw' ? 'model' : work === 'paste' ? 'paste' : codeSource());
}

export function initWorkMode() {
  for (const b of $$<HTMLButtonElement>('#workMode [data-work]')) b.addEventListener('click', () => switchWork(b.dataset.work as Work));
}
