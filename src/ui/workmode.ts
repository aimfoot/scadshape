// The way of working on the one model, chosen at the top: Draw (sketches and features) or Code (the
// model as OpenSCAD code, edited in place; with the AI chat's prompt and Convert to sketches). Code
// from elsewhere (a pasted AI answer, a .scad file, text shared from another app) becomes a model too.

import { codeDoc } from '../doc';
import { createProject, renameProject } from '../projects';
import { cancelRender, commitCode, requestRender, setWork, syncCodePanel, view, type Work } from './render';
import { closePanel, currentPanel } from './panel';
import { stopMeasure } from './measure';
import { refreshProjectName, switchProject } from './projects';
import { $$ } from './dom';
import { app, emit } from './state';

export function switchWork(w: Work) {
  if (currentPanel()) closePanel();
  stopMeasure();
  setWork(w);
}

/** Show `code` as a model named `name`, in Code: the current model if it is empty, else a new one. */
export function openCode(code: string, name: string) {
  commitCode(); // what you wrote stays in its model
  view.fitNext = true;
  if (app.doc.features.length) switchProject(createProject(name, codeDoc(code)));
  else {
    renameProject(app.projectId, name);
    refreshProjectName();
    app.doc = codeDoc(code);
    emit('docChanged');
  }
  switchWork('code');
  syncCodePanel(true);
  cancelRender();
  requestRender();
}

export function initWorkMode() {
  for (const b of $$<HTMLButtonElement>('#workMode [data-work]')) b.addEventListener('click', () => switchWork(b.dataset.work as Work));
}
