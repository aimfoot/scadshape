// The app's shared state and events between the UI modules.

import { codeDoc, emptyDoc, type Doc } from '../doc';
import { t } from '../i18n';
import { createProject, currentProjectId, loadProject, saveProject, setCurrentProject } from '../projects';
import { buildModel, type Model } from '../model3d';
import { evalParams } from '../params';
import type { SketchSolver } from '../sketch/solver';
import { store } from './dom';

export const app = {
  /** The current model (projects.ts); loaded by initState(). */
  projectId: '',
  doc: emptyDoc() as Doc,
  /** The document with a feature being edited (preview), otherwise null. */
  previewDoc: null as Doc | null,
  model: null as unknown as Model,
  solver: null as SketchSolver | null,
};

/** Loads the current model from the storage (main.ts, after openStorage()). */
export function initState() {
  const opened = looseCodeToModels();
  app.projectId = opened ? setCurrentProject(opened) : currentProjectId(t('project.default'));
  app.doc = loadProject(app.projectId);
  app.model = buildModel(app.doc);
}

/** Before there was one model (up to 0.15), your own code and pasted code were kept apart from the
 * models (localStorage). Each becomes a model of its own; the one that was shown is opened, in Code. */
function looseCodeToModels(): string | null {
  const shown = store.get('source');
  let opened: string | null = null;
  for (const [key, source, name] of [['code', ['custom', 'egen'], 'source.custom'], ['pasteCode', ['paste'], 'project.pasted']] as const) {
    const code = store.get(key);
    store.remove(key);
    if (!code?.trim()) continue;
    const id = createProject(t(name), codeDoc(code));
    if (shown && (source as readonly string[]).includes(shown)) opened = id;
  }
  for (const k of ['source', 'codeSource', 'codeName', 'codeOpen']) store.remove(k);
  if (opened) store.set('work', 'code');
  return opened;
}

/** Save the current model. */
export const saveDoc = () => saveProject(app.projectId, app.doc);

export const vars = () => evalParams(app.doc.params).vars;

type Events = {
  /** The document has changed (save, redraw the tree, render). */
  docChanged: void;
  /** Render again (e.g. a new preview). */
  render: void;
  /** The solver has been loaded. */
  solver: SketchSolver;
};
const handlers = new Map<keyof Events, ((v: never) => void)[]>();

export function on<K extends keyof Events>(ev: K, fn: (v: Events[K]) => void) {
  handlers.set(ev, [...(handlers.get(ev) ?? []), fn as (v: never) => void]);
}
export function emit<K extends keyof Events>(ev: K, ...v: Events[K] extends void ? [] : [Events[K]]) {
  for (const fn of handlers.get(ev) ?? []) (fn as (v: Events[K]) => void)(v[0] as Events[K]);
}
