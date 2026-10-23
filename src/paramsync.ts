// When variables change: recompute the sketch dimensions that use them and solve the sketch again.

import { t } from './i18n';
import type { SketchFeature } from './doc';
import { parseExpr, type Vars } from './expr';
import { visibleAngle, signedAngle } from './sketch/annotate';
import type { SketchSolver } from './sketch/solver';

/** Update the dimensions in a sketch from the variables. On error the sketch is left untouched. */
export function syncSketchParams(sk: SketchFeature, vars: Vars, solver: SketchSolver | null): { changed: boolean; error?: string } {
  const before = JSON.stringify(sk);
  let changed = false;
  for (let i = 0; i < sk.constraints.length; i++) {
    const c = sk.constraints[i];
    if (!('expr' in c) || !c.expr) continue;
    const r = parseExpr(c.expr, vars);
    if (r.value === null) {
      Object.assign(sk, JSON.parse(before));
      return { changed: false, error: t('params.dimError', { sketch: sk.name, expr: c.expr, error: r.error ?? '' }) };
    }
    let value = r.value;
    if (c.type === 'angle') {
      const L = (e: string) => {
        const l = sk.entities[e] as { p1: string; p2: string };
        return { a: sk.points[l.p1], b: sk.points[l.p2] };
      };
      const vis = visibleAngle(L(c.e1), L(c.e2));
      const abs = vis.s1 === vis.s2 ? value : 180 - value;
      value = (Math.sign(c.value) || Math.sign(signedAngle(L(c.e1), L(c.e2))) || 1) * abs;
    } else if (!(value > 0)) {
      Object.assign(sk, JSON.parse(before));
      return { changed: false, error: t('params.dimNotPositive', { sketch: sk.name, expr: c.expr, value }) };
    }
    if (Math.abs(value - c.value) > 1e-12) {
      sk.constraints[i] = { ...c, value } as typeof c;
      changed = true;
    }
  }
  if (changed && solver && !solver.solve(sk).ok) {
    Object.assign(sk, JSON.parse(before));
    return { changed: false, error: t('params.dimConflict', { sketch: sk.name }) };
  }
  return { changed };
}
