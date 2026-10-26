// The document: features in order (sketches and the features built on them), variables and
// rollback. The OpenSCAD code is generated from it (model3d.ts); each feature type is described in
// features/.

import { t } from './i18n';
import type { Param } from './params';
import { emptySketch, normalizeSketch, type Plane } from './sketch/model';
import { findLoops } from './sketch/regions';
import { KINDS, type SolidFeature, type SketchFeature } from './features';
import { WORLD_SKETCH, type CodeFeature } from './features/code';
import type { ExtrudeFeature } from './features/extrude';
import type { HoleFeature } from './features/hole';
import type { RevolveFeature } from './features/revolve';

export type Feature = SketchFeature | SolidFeature;
export const isSolidFeature = (f: Feature): f is SolidFeature => f.type !== 'sketch';

export interface Doc {
  v: 2;
  features: Feature[];
  params: Param[];
  /** Number of features that are built (the rollback marker); null = all. */
  rollback: number | null;
}

export const emptyDoc = (): Doc => ({ v: 2, features: [], params: [], rollback: null });

const typeLabel = (type: Feature['type']) => t(type === 'sketch' ? 'feat.sketch' : KINDS[type].label);

/** "Extrude 1", "Extrude 2" … (in the current language). */
export function uniqueName(doc: Doc, type: Feature['type']) {
  const base = typeLabel(type);
  let n = 1;
  while (doc.features.some(f => f.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Change default names ("Skiss 3" ↔ "Sketch 3") to the current language; custom names are left alone. */
export function localizeDefaultNames(doc: Doc, labelsInAllLangs: (type: Feature['type']) => string[]) {
  for (const f of doc.features) {
    const m = /^(.+) (\d+)$/.exec(f.name);
    if (!m || !labelsInAllLangs(f.type).includes(m[1])) continue;
    const name = `${typeLabel(f.type)} ${m[2]}`;
    if (!doc.features.some(g => g !== f && g.name === name)) f.name = name;
  }
}

const newFeatureId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newSketch(doc: Doc, plane: Plane): SketchFeature {
  return { type: 'sketch', id: newFeatureId(), name: uniqueName(doc, 'sketch'), plane, ...emptySketch() };
}

/** New feature of a type, with default values for the sketch. */
export function newFeature<T extends SolidFeature['type']>(doc: Doc, type: T, sketch: SketchFeature): Extract<SolidFeature, { type: T }> {
  return KINDS[type].create(newFeatureId(), uniqueName(doc, type), sketch as SketchFeature) as Extract<SolidFeature, { type: T }>;
}

const sketchById = (doc: Doc, id: string) => doc.features.find((f): f is SketchFeature => f.type === 'sketch' && f.id === id)!;
export const newExtrude = (doc: Doc, sketch: string): ExtrudeFeature => newFeature(doc, 'extrude', sketchById(doc, sketch));
export const newRevolve = (doc: Doc, sketch: string): RevolveFeature => newFeature(doc, 'revolve', sketchById(doc, sketch));
export const newHole = (doc: Doc, sketch: string): HoleFeature => newFeature(doc, 'hole', sketchById(doc, sketch));

/** The model as OpenSCAD code: one code feature holding `code` (what editing the code in Code makes
 * of a model; also a pasted or opened .scad file). Its own variables are in the code. */
export function codeDoc(code: string): Doc {
  const doc = emptyDoc();
  doc.features.push({ ...newFeature(doc, 'code', WORLD_SKETCH), code });
  return doc;
}

/** The code feature of a model that is just code (as codeDoc makes it), else null. Such a model is
 * rendered from its code as it is, so the problem list's line numbers match the code you see. */
export function codeOnly(doc: Doc): CodeFeature | null {
  const [f, ...rest] = doc.features;
  if (rest.length || !f || f.type !== 'code' || f.suppressed || f.op !== 'add' || (f.rep && f.rep !== 'none') || doc.params.length || doc.rollback !== null) return null;
  return f;
}

/** Number of active features (before the rollback marker). */
export const activeCount = (doc: Doc) => (doc.rollback === null ? doc.features.length : Math.min(doc.rollback, doc.features.length));

/** Insert a feature at the rollback marker (or last) and move the marker past it. */
export function insertFeature(doc: Doc, f: Feature) {
  const at = activeCount(doc);
  doc.features.splice(at, 0, f);
  if (doc.rollback !== null) doc.rollback = at + 1;
  if (doc.rollback !== null && doc.rollback >= doc.features.length) doc.rollback = null;
}

export function removeFeature(doc: Doc, f: Feature) {
  const i = doc.features.indexOf(f);
  if (i < 0) return;
  doc.features.splice(i, 1);
  if (doc.rollback !== null && i < doc.rollback) doc.rollback--;
  // Features that were built on a removed sketch are removed too.
  if (f.type === 'sketch') for (const g of dependents(doc, f.id)) removeFeature(doc, g);
}

/** Features that use the sketch. */
export const dependents = (doc: Doc, sketchId: string) => doc.features.filter(f => isSolidFeature(f) && f.sketch === sketchId);

/** Active, unsuppressed sketches before position `before`. */
export const usableSketches = (doc: Doc, before = activeCount(doc)) =>
  doc.features.slice(0, before).filter((f): f is SketchFeature => f.type === 'sketch' && !f.suppressed);

// ---- Migration (the storage is in projects.ts) ---------------------------------------------------------

/** v1 (phases 1–2): only sketches + a shared preview height → v2 with one extrude per sketch. */
export function migrate(d: unknown): Doc | null {
  const o = d as { v?: number; features?: Feature[]; previewHeight?: number; params?: Param[]; rollback?: number | null };
  if (!o || !Array.isArray(o.features)) return null;
  if (o.v === 2) {
    for (const f of o.features) if (f.type === 'sketch') normalizeSketch(f);
    return { ...emptyDoc(), ...(o as Doc) };
  }
  if (o.v !== 1) return null;
  const doc = emptyDoc();
  for (const f of o.features as SketchFeature[]) {
    normalizeSketch(f);
    f.type = 'sketch';
    doc.features.push(f);
    if (findLoops(f).loops.length) {
      const e = newExtrude(doc, f.id);
      e.depth = String(o.previewHeight ?? 5);
      doc.features.push(e);
    }
  }
  return doc;
}

export type { SketchFeature, SolidFeature, ExtrudeFeature, HoleFeature, RevolveFeature };
export type { ThreadFeature } from './features/thread';
export type { ContainerFeature } from './features/container';
export type { RevolveAxis } from './features/revolve';
export type { Op } from './features/common';
export { applyHoleSize, holeCandidates, holePoints, HOLE_SIZES } from './features/hole';
