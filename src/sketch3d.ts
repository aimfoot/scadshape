// Skisskurvor som 3D-polylinjer (för att visa skisser i 3D-vyn), på planet inkl. förskjutning.

import type { SketchFeature } from './doc';
import { sketchFrame, toWorld, type Frame } from './frame';
import { arcPoints, type Vec } from './sketch/geom';
import { arcGeom } from './sketch/model';

type P3 = [number, number, number];

export function sketchPolylines(f: SketchFeature, frame: Frame = sketchFrame(f)): P3[][] {
  const map = (p: Vec): P3 => toWorld(frame, p);
  const out: P3[][] = [];
  for (const e of Object.values(f.entities)) {
    if (e.construction) continue;
    let pts: Vec[];
    if (e.type === 'line') pts = [f.points[e.p1], f.points[e.p2]];
    else if (e.type === 'circle') pts = arcPoints(f.points[e.c], e.r, 0, Math.PI * 2, 0.05);
    else {
      const g = arcGeom(f, e);
      pts = arcPoints(g.c, g.r, g.a0, g.sweep, 0.05);
    }
    out.push(pts.map(map));
  }
  return out;
}
