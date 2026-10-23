// The app's shared state and events between the UI modules.

import { emptyDoc, type Doc } from '../doc';
import { t } from '../i18n';
import { currentProjectId, loadProject, saveProject } from '../projects';
import { buildModel, type Model } from '../model3d';
import { evalParams } from '../params';
import type { SketchSolver } from '../sketch/solver';
import { store } from './dom';

/** Source ids saved before 2026-10-23 (Swedish) → the current ids. */
const LEGACY_SOURCE: Record<string, string> = { egen: 'custom', plattan: 'plate', kopp: 'cup', tung: 'heavy', kub: 'cube' };
const savedSource = store.get('source');

export const app = {
  /** The current model (projects.ts); loaded by initState(). */
  projectId: '',
  doc: emptyDoc() as Doc,
  /** The document with a feature being edited (preview), otherwise null. */
  previewDoc: null as Doc | null,
  /** 'model' (features), an example id or 'custom' (freely edited code). */
  source: (savedSource && LEGACY_SOURCE[savedSource]) || savedSource || 'model',
  model: null as unknown as Model,
  solver: null as SketchSolver | null,
};

/** Loads the current model from the storage (main.ts, after openStorage()). */
export function initState() {
  app.projectId = currentProjectId(t('project.default'));
  app.doc = loadProject(app.projectId);
  app.model = buildModel(app.doc);
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
