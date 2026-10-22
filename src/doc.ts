// Dokumentet: features i ordning (skisser och features som bygger på dem), variabler och rollback.
// OpenSCAD-koden genereras ur det (model3d.ts); varje feature-typ beskrivs i features/.

import { t } from './i18n';
import type { Param } from './params';
import { emptySketch, normalizeSketch, type Plane } from './sketch/model';
import { findLoops } from './sketch/regions';
import { KINDS, type SolidFeature, type SketchFeature } from './features';
import type { ExtrudeFeature } from './features/extrude';
import type { HoleFeature } from './features/hole';
import type { RevolveFeature } from './features/revolve';

export type Feature = SketchFeature | SolidFeature;
export const isSolidFeature = (f: Feature): f is SolidFeature => f.type !== 'sketch';

export interface Doc {
  v: 2;
  features: Feature[];
  params: Param[];
  /** Antal features som byggs (rollback-markören); null = alla. */
  rollback: number | null;
}

export const emptyDoc = (): Doc => ({ v: 2, features: [], params: [], rollback: null });

const typeLabel = (type: Feature['type']) => t(type === 'sketch' ? 'feat.sketch' : KINDS[type].label);

/** "Extrudera 1", "Extrudera 2" … (på aktuellt språk). */
export function uniqueName(doc: Doc, type: Feature['type']) {
  const base = typeLabel(type);
  let n = 1;
  while (doc.features.some(f => f.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Byt standardnamn ("Skiss 3" ↔ "Sketch 3") till aktuellt språk; egna namn lämnas orörda. */
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

/** Ny feature av en typ, med standardvärden för skissen. */
export function newFeature<T extends SolidFeature['type']>(doc: Doc, type: T, sketch: SketchFeature): Extract<SolidFeature, { type: T }> {
  return KINDS[type].create(newFeatureId(), uniqueName(doc, type), sketch as SketchFeature) as Extract<SolidFeature, { type: T }>;
}

const sketchById = (doc: Doc, id: string) => doc.features.find((f): f is SketchFeature => f.type === 'sketch' && f.id === id)!;
export const newExtrude = (doc: Doc, sketch: string): ExtrudeFeature => newFeature(doc, 'extrude', sketchById(doc, sketch));
export const newRevolve = (doc: Doc, sketch: string): RevolveFeature => newFeature(doc, 'revolve', sketchById(doc, sketch));
export const newHole = (doc: Doc, sketch: string): HoleFeature => newFeature(doc, 'hole', sketchById(doc, sketch));

/** Antal features som är aktiva (före rollback-markören). */
export const activeCount = (doc: Doc) => (doc.rollback === null ? doc.features.length : Math.min(doc.rollback, doc.features.length));

/** Lägg in en feature vid rollback-markören (eller sist) och flytta markören förbi den. */
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
  // Features som byggde på en borttagen skiss tas också bort.
  if (f.type === 'sketch') for (const g of dependents(doc, f.id)) removeFeature(doc, g);
}

/** Features som använder skissen. */
export const dependents = (doc: Doc, sketchId: string) => doc.features.filter(f => isSolidFeature(f) && f.sketch === sketchId);

/** Aktiva, ej undertryckta skisser före position `before`. */
export const usableSketches = (doc: Doc, before = activeCount(doc)) =>
  doc.features.slice(0, before).filter((f): f is SketchFeature => f.type === 'sketch' && !f.suppressed);

// ---- Migrering (lagringen finns i projects.ts) ---------------------------------------------------------

/** v1 (fas 1–2): bara skisser + en gemensam förhandsvisningshöjd → v2 med en extrudering per skiss. */
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
