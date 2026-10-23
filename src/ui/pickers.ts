// Picking in the 3D view for the feature panel: regions, revolve axis, hole points and circles.
// Each picker says what the view should show, what a tap does and what the info text should say.

import type { SketchFeature, SolidFeature } from '../doc';
import { holeCandidates, holePoints } from '../features/hole';
import { axisCandidates } from '../features/revolve';
import { textAnchors } from '../features/text';
import { threadCandidates, threadCircles } from '../features/thread';
import { t } from '../i18n';
import { sketchRegions } from '../model3d';
import { sketchFrame } from '../frame';
import { arcPoints, dist } from '../sketch/geom';
import { regionAt, selectRegions } from '../sketch/regions';
import type { Overlay, Viewer } from '../viewer';
import { parseExpr } from '../expr';
import { app, vars } from './state';

export type PickMode = 'regions' | 'axis';

export interface Picker {
  /** Info text ("2 of 3 regions · tap in the view …"). */
  info(f: SolidFeature, sk: SketchFeature, mode: PickMode): string;
  /** Has the user made their own choice (then the "Default" link is shown)? */
  custom(f: SolidFeature): boolean;
  reset(f: SolidFeature): void;
  overlay(f: SolidFeature, sk: SketchFeature, mode: PickMode): Overlay;
  /** Handle a tap; true if something changed. Also returns the key that changed. */
  tap(f: SolidFeature, sk: SketchFeature, p: { x: number; y: number }, viewer: Viewer, mode: PickMode): string | null;
}

type WithRegions = Extract<SolidFeature, { regions: unknown }>;

const regionPicker: Picker = {
  info(f, sk, mode) {
    const { loops, regions } = sketchRegions(sk);
    if (!regions.length) return t('pick.noRegions');
    const n = selectRegions(regions, loops, (f as WithRegions).regions).length;
    const how = mode === 'axis' ? t('pick.tapAxis') : t('pick.tapRegions');
    return `${t('pick.regionsCount', { n, total: regions.length })}${(f as WithRegions).regions ? '' : ` (${t('pick.default').toLowerCase()})`} · ${how}`;
  },
  custom: f => !!(f as WithRegions).regions,
  reset: f => void ((f as WithRegions).regions = null),
  overlay(f, sk, mode) {
    const { loops, regions } = sketchRegions(sk);
    const sel = new Set(selectRegions(regions, loops, (f as WithRegions).regions));
    const axes =
      f.type === 'revolve'
        ? axisCandidates(sk)
            .map(c => ({ a: c.a, b: c.b, selected: JSON.stringify(c.axis) === JSON.stringify(f.axis) }))
            .filter(a => mode === 'axis' || a.selected)
        : [];
    return {
      frame: sketchFrame(sk, vars(), app.doc),
      regions: regions.map((r, i) => ({ outer: loops[r.loop].pts, holes: r.holes.map(h => loops[h].pts), selected: sel.has(i) })),
      axes,
    };
  },
  tap(f, sk, p, viewer, mode) {
    if (f.type === 'revolve' && mode === 'axis') {
      const i = viewer.nearestAxis(p);
      const shown = axisCandidates(sk); // in axis mode all are shown, in the same order
      if (i < 0 || !shown[i]) return null;
      f.axis = shown[i].axis;
      return 'axis';
    }
    const uv = viewer.pickOnPlane(p, sketchFrame(sk, vars(), app.doc));
    if (!uv) return null;
    const { loops, regions } = sketchRegions(sk);
    const hit = regionAt(regions, loops, uv);
    if (hit < 0) return null;
    const g = f as WithRegions;
    const sel = new Set(selectRegions(regions, loops, g.regions));
    if (sel.has(hit)) sel.delete(hit);
    else sel.add(hit);
    g.regions = [...sel].map(i => regions[i].seed);
    return 'regions';
  },
};

type WithPoints = Extract<SolidFeature, { type: 'hole' | 'text' | 'snap' }>;
const hasPoints = (f: SolidFeature): f is WithPoints => f.type === 'hole' || f.type === 'text' || f.type === 'snap';
/** Chosen points for holes, text or snap hooks (the latter two: the origin if none are chosen). */
const chosenPoints = (f: WithPoints, sk: SketchFeature) => (f.type === 'hole' ? holePoints(f, sk) : textAnchors(f as never, sk));

const pointPicker: Picker = {
  info(f, sk) {
    if (!hasPoints(f)) return '';
    const cand = holeCandidates(sk);
    if (!cand.length) return f.type === 'text' ? t('pick.textOrigin') : f.type === 'snap' ? t('pick.snapOrigin') : t('pick.noPoints');
    const n = chosenPoints(f, sk).length;
    if ((f.type === 'text' || f.type === 'snap') && !n) return `${t(f.type === 'text' ? 'pick.textOrigin' : 'pick.snapOrigin')} · ${t('pick.tapPoints')}`;
    return `${t('pick.pointsCount', { n, total: cand.length })}${f.points ? '' : ` (${t('pick.allStandalone')})`} · ${t('pick.tapPoints')}`;
  },
  custom: f => hasPoints(f) && !!f.points,
  reset: f => void (hasPoints(f) && (f.points = null)),
  overlay(f, sk) {
    if (!hasPoints(f)) return { frame: sketchFrame(sk, vars(), app.doc), regions: [], axes: [] };
    const chosen = new Set(chosenPoints(f, sk));
    return {
      frame: sketchFrame(sk, vars(), app.doc),
      regions: [],
      axes: [],
      points: holeCandidates(sk).map(id => ({ p: sk.points[id], selected: chosen.has(id) })),
      pointsOffset: f.type === 'hole' ? (parseExpr(f.start, vars()).value ?? 0) : 0, // where the drilling starts
    };
  },
  tap(f, sk, p, viewer) {
    if (!hasPoints(f)) return null;
    const cand = holeCandidates(sk);
    const i = viewer.nearestPoint(p);
    if (i < 0 || !cand[i]) return null;
    const chosen = new Set(chosenPoints(f, sk));
    if (chosen.has(cand[i])) chosen.delete(cand[i]);
    else chosen.add(cand[i]);
    f.points = cand.filter(id => chosen.has(id));
    return 'points';
  },
};

const circlePicker: Picker = {
  info(f, sk) {
    if (f.type !== 'thread') return '';
    const cand = threadCandidates(sk);
    if (!cand.length) return t('pick.noCircles');
    return `${t('pick.circlesCount', { n: threadCircles(f, sk).length, total: cand.length })}${f.circles ? '' : ` (${t('pick.all')})`} · ${t('pick.tapCircles')}`;
  },
  custom: f => f.type === 'thread' && !!f.circles,
  reset: f => void (f.type === 'thread' && (f.circles = null)),
  overlay(f, sk) {
    if (f.type !== 'thread') return { frame: sketchFrame(sk, vars(), app.doc), regions: [], axes: [] };
    const chosen = new Set(threadCircles(f, sk));
    return {
      frame: sketchFrame(sk, vars(), app.doc),
      axes: [],
      regions: threadCandidates(sk).map(id => {
        const e = sk.entities[id] as { c: string; r: number };
        const pts = arcPoints(sk.points[e.c], e.r, 0, Math.PI * 2, 0.05);
        pts.pop();
        return { outer: pts, holes: [], selected: chosen.has(id) };
      }),
    };
  },
  tap(f, sk, p, viewer) {
    if (f.type !== 'thread') return null;
    const uv = viewer.pickOnPlane(p, sketchFrame(sk, vars(), app.doc));
    if (!uv) return null;
    // The smallest circle containing the point, otherwise the one whose edge is closest (within 3
    // mm).
    let best: string | null = null, bestScore = Infinity;
    for (const id of threadCandidates(sk)) {
      const e = sk.entities[id] as { c: string; r: number };
      const d = dist(uv, sk.points[e.c]);
      const score = d <= e.r ? e.r : Math.abs(d - e.r) <= 3 ? 1e6 + Math.abs(d - e.r) : Infinity;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (!best) return null;
    const chosen = new Set(threadCircles(f, sk));
    if (chosen.has(best)) chosen.delete(best);
    else chosen.add(best);
    f.circles = threadCandidates(sk).filter(id => chosen.has(id));
    return 'circles';
  },
};

/** Features without a sketch: nothing to pick in the view. */
const noPicker: Picker = {
  info: () => '',
  custom: () => false,
  reset: () => {},
  overlay: (_f, sk) => ({ frame: sketchFrame(sk, vars(), app.doc), regions: [], axes: [] }),
  tap: () => null,
};

export function pickerFor(f: SolidFeature): Picker {
  if (f.type === 'code') return noPicker;
  if (f.type === 'hole' || f.type === 'text' || f.type === 'snap') return pointPicker;
  if (f.type === 'thread') return circlePicker;
  return regionPicker;
}
