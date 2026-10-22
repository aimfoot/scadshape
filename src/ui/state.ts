// Appens gemensamma tillstånd och händelser mellan UI-modulerna.

import { emptyDoc, type Doc } from '../doc';
import { t } from '../i18n';
import { currentProjectId, loadProject, saveProject } from '../projects';
import { buildModel, type Model } from '../model3d';
import { evalParams } from '../params';
import type { SketchSolver } from '../sketch/solver';
import { store } from './dom';

export const app = {
  /** Aktuell modell (projects.ts); läses in av initState(). */
  projectId: '',
  doc: emptyDoc() as Doc,
  /** Dokumentet med en feature under redigering (förhandsvisning), annars null. */
  previewDoc: null as Doc | null,
  /** 'model' (features), ett exempel-id eller 'egen' (fritt redigerad kod). */
  source: store.get('source') ?? 'model',
  model: null as unknown as Model,
  solver: null as SketchSolver | null,
};

/** Läser in aktuell modell ur lagringen (main.ts, efter openStorage()). */
export function initState() {
  app.projectId = currentProjectId(t('project.default'));
  app.doc = loadProject(app.projectId);
  app.model = buildModel(app.doc);
}

/** Spara aktuell modell. */
export const saveDoc = () => saveProject(app.projectId, app.doc);

export const vars = () => evalParams(app.doc.params).vars;

type Events = {
  /** Dokumentet har ändrats (spara, rita om trädet, rendera). */
  docChanged: void;
  /** Rendera om (t.ex. ny förhandsvisning). */
  render: void;
  /** Lösaren har laddats. */
  solver: SketchSolver;
};
const handlers = new Map<keyof Events, ((v: never) => void)[]>();

export function on<K extends keyof Events>(ev: K, fn: (v: Events[K]) => void) {
  handlers.set(ev, [...(handlers.get(ev) ?? []), fn as (v: never) => void]);
}
export function emit<K extends keyof Events>(ev: K, ...v: Events[K] extends void ? [] : [Events[K]]) {
  for (const fn of handlers.get(ev) ?? []) (fn as (v: Events[K]) => void)(v[0] as Events[K]);
}
