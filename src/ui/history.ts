// Ångra/gör om i delläget: en ögonblicksbild av dokumentet per ändring (docChanged).
// Ett helt skisspass blir ett steg (skissläget har en egen, finare ångra).

import { $ } from './dom';
import { closePanel, currentPanel } from './panel';
import { app, emit } from './state';

const MAX_STEPS = 60;
let undoStack: string[] = [];
let redoStack: string[] = [];
let current = '';

function sync() {
  $<HTMLButtonElement>('#btnDocUndo').disabled = !undoStack.length;
  $<HTMLButtonElement>('#btnDocRedo').disabled = !redoStack.length;
}

/** Anropas vid varje docChanged: spara föregående läge om dokumentet ändrats. */
export function recordDoc() {
  const now = JSON.stringify(app.doc);
  if (now === current) return;
  undoStack.push(current);
  if (undoStack.length > MAX_STEPS) undoStack.shift();
  redoStack = [];
  current = now;
  sync();
}

/** Börja om (ny modell öppnad). */
export function resetHistory() {
  undoStack = [];
  redoStack = [];
  current = JSON.stringify(app.doc);
  sync();
}

function restore(state: string) {
  if (currentPanel()) closePanel();
  current = state;
  app.doc = JSON.parse(state);
  emit('docChanged'); // recordDoc ser att inget ändrats
  sync();
}

export function undoDoc() {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(current);
  restore(prev);
}

export function redoDoc() {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(current);
  restore(next);
}

export function initHistory() {
  resetHistory();
  $('#btnDocUndo').addEventListener('click', undoDoc);
  $('#btnDocRedo').addEventListener('click', redoDoc);
}
